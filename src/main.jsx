import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { normalizeWhatsAppPhone } from "./whatsapp.js";

// A versão antiga guardava senhas em texto puro no navegador. Elas não são
// usadas pela autenticação Supabase e são removidas no upgrade por segurança.
try { localStorage.removeItem("px_users"); } catch {}

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
// ⚠️ Passo 3: Cole seus dados aqui após criar o projeto no Supabase
// Project Settings → API → copie "Project URL" e "anon public"
const SUPABASE_URL = "https://uilesmexlfojvsgbkhvr.supabase.co";
const SUPABASE_KEY = "sb_publishable_V-HBvWLH1JsAjsy4wJfx9A_wN139-au";

const DB_OK = !SUPABASE_URL.includes("COLE") && !SUPABASE_KEY.includes("COLE");
const supabaseClient = DB_OK
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}})
  : null;
let ACTIVE_TENANT_ID = null;
const TENANT_TABLES = {encomendas:"portaria_encomendas",moradores:"portaria_moradores",logs:"portaria_auditoria"};

// A leitura de etiquetas usa Ollama local e não exige chave de API.
const getOllamaModel = () => {
  try { return localStorage.getItem("px_ollama_model") || "qwen3.5:2b"; } catch { return "qwen3.5:2b"; }
};
const getOllamaUrl = () => {
  try { return localStorage.getItem("px_ollama_url") || "http://localhost:11434"; } catch { return "http://localhost:11434"; }
};

// Acesso às tabelas novas protegido por sessão Supabase Auth e RLS por condomínio.
const db = {
  async getAll(table) {
    if(!supabaseClient || !ACTIVE_TENANT_ID) throw new Error("Sessão ou condomínio não configurado");
    const target=TENANT_TABLES[table]||table;
    const orderColumn=table==="logs"?"data":"criado_em";
    let query=supabaseClient.from(target).select("*").eq("condominio_id",ACTIVE_TENANT_ID);
    const {data,error}=await query.order(orderColumn,{ascending:false});
    if(error) throw error;
    return data||[];
  },
  async insert(table, row) {
    if(!supabaseClient || !ACTIVE_TENANT_ID) throw new Error("Sessão ou condomínio não configurado");
    const target=TENANT_TABLES[table]||table;
    const payload={...row,condominio_id:ACTIVE_TENANT_ID};
    if(table==="logs") payload.usuario_id=(await supabaseClient.auth.getUser()).data.user?.id;
    const {data,error}=await supabaseClient.from(target).insert(payload).select().single();
    if(error) throw error;
    return data;
  },
  async update(table, id, row) {
    if(!supabaseClient || !ACTIVE_TENANT_ID) throw new Error("Sessão ou condomínio não configurado");
    const payload=table==="moradores"?{...row,atualizado_em:new Date().toISOString()}:row;
    const {data,error}=await supabaseClient.from(TENANT_TABLES[table]||table).update(payload).eq("id",id).eq("condominio_id",ACTIVE_TENANT_ID).select().single();
    if(error) throw error;
    return data;
  },
  async delete(table, id) {
    if(!supabaseClient || !ACTIVE_TENANT_ID) throw new Error("Sessão ou condomínio não configurado");
    let result;
    if(table==="encomendas"){
      const {data:{user}}=await supabaseClient.auth.getUser();
      result=await supabaseClient.from(TENANT_TABLES[table]).update({arquivado_em:new Date().toISOString(),arquivado_por:user?.id||null}).eq("id",id).eq("condominio_id",ACTIVE_TENANT_ID).select("id");
    } else result=await supabaseClient.from(TENANT_TABLES[table]||table).delete().eq("id",id).eq("condominio_id",ACTIVE_TENANT_ID).select("id");
    const {data,error}=result;
    if(error) throw error;
    if(!data?.length) throw new Error("Nenhum registro foi alterado. Atualize a tela e tente novamente.");
    return true;
  },
  async deleteBatch(table, ids) {
    if(!ids.length) return true;
    if(!supabaseClient || !ACTIVE_TENANT_ID) throw new Error("Sessão ou condomínio não configurado");
    let result;
    if(table==="encomendas"){
      const {data:{user}}=await supabaseClient.auth.getUser();
      result=await supabaseClient.from(TENANT_TABLES[table]).update({arquivado_em:new Date().toISOString(),arquivado_por:user?.id||null}).in("id",ids).eq("condominio_id",ACTIVE_TENANT_ID).select("id");
    } else result=await supabaseClient.from(TENANT_TABLES[table]||table).delete().in("id",ids).eq("condominio_id",ACTIVE_TENANT_ID).select("id");
    const {data,error}=result;
    if(error) throw error;
    if((data||[]).length!==ids.length) throw new Error("Nem todos os registros foram alterados. Atualize a tela para sincronizar os dados.");
    return true;
  },
};

const today = new Date();
const fmtISO = (off=0) => { const d=new Date(); d.setDate(d.getDate()-off); return d.toISOString(); };
const gp = (n,iso) => { const d=new Date(iso); return `PX-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(n).padStart(4,'0')}`; };

const MOCK_MORADORES = [];
const MOCK_ENCOMENDAS = [];
const MOCK_LOGS = [];


// ─── PERMISSÕES ───────────────────────────────────────────────────────────────
const PERMS = {
  admin:    ["dashboard","encomendas","retirada","moradores","usuarios","notificacoes","relatorios","logs","configuracoes","xwriter"],
  porteiro: ["dashboard","encomendas","retirada","moradores","notificacoes","relatorios","logs","xwriter"],
};
const READONLY = {
  porteiro: ["moradores","relatorios","logs"],
};
const canAccess = (perfil, page) => (PERMS[perfil]||[]).includes(page);
const isReadonly = (perfil, page) => (READONLY[perfil]||[]).includes(page);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtDate  = iso => !iso ? "—" : new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
const fmtShort = iso => !iso ? "—" : new Date(iso).toLocaleDateString("pt-BR");
const isToday  = iso => { if(!iso) return false; const d=new Date(iso),t=new Date(); return d.getDate()===t.getDate()&&d.getMonth()===t.getMonth()&&d.getFullYear()===t.getFullYear(); };
const getDias  = iso => Math.floor((Date.now()-new Date(iso))/86400000);
const simil    = (a,b) => { a=a.toLowerCase();b=b.toLowerCase();let m=0;const wa=a.split(" "),wb=b.split(" ");wa.forEach(w=>{if(wb.some(x=>x.includes(w)||w.includes(x)))m++;});return m/Math.max(wa.length,1); };
const makeProto= () => { const d=new Date(); return `PX-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(Math.floor(Math.random()*9000)+1000).padStart(4,'0')}`; };
const doExport = (data,name) => {
  if(!data.length) return;
  const keys=Object.keys(data[0]);
  const rows=[keys.join(","),...data.map(r=>keys.map(k=>`"${String(r[k]||"").replace(/"/g,'""')}"`).join(","))];
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv"})); a.download=name; a.click();
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const Styles = () => (
  <style>{`
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0f1117;--sf:#171c27;--s2:#1e2535;--s3:#252d40;
      --b1:#2a3349;--b2:#334060;
      --ac:#f59e0b;--ac2:#fbbf24;--ad:#f59e0b22;
      --gn:#10b981;--gd:#10b98122;--rd:#ef4444;--rdd:#ef444422;--bl:#3b82f6;--bld:#3b82f622;
      --t1:#e8eaf0;--t2:#8b93a8;--t3:#5a6278;
      --fn:system-ui,-apple-system,'Segoe UI',sans-serif;--fn2:system-ui,-apple-system,'Segoe UI',sans-serif;
      --r:12px;--rs:8px;
    }
    html,body,#root{height:100%;background:var(--bg);font-family:var(--fn);color:var(--t1)}
    input,select,textarea,button{font-family:var(--fn);outline:none}
    button{cursor:pointer;border:none}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:var(--sf)}
    ::-webkit-scrollbar-thumb{background:var(--b2);border-radius:99px}
    .app{display:flex;height:100vh;overflow:hidden}
    /* SIDEBAR */
    .sb{width:240px;min-width:240px;background:var(--sf);border-right:1px solid var(--b1);display:flex;flex-direction:column}
    .sb-logo{padding:24px 20px 20px;border-bottom:1px solid var(--b1)}
    .sb-logo h1{font-family:var(--fn2);font-size:18px;font-weight:700}
    .sb-logo h1 span{color:var(--ac)}
    .sb-logo p{font-size:11px;color:var(--t3);margin-top:3px}
    .sb-nav{flex:1;padding:16px 12px;overflow-y:auto}
    .nsec{font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1.2px;text-transform:uppercase;padding:0 8px;margin:16px 0 8px}
    .ni{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--rs);cursor:pointer;transition:all .15s;color:var(--t2);font-size:13.5px;font-weight:500;margin-bottom:2px;border:1px solid transparent}
    .ni:hover{background:var(--s2);color:var(--t1)}
    .ni.on{background:var(--ad);color:var(--ac);border-color:#f59e0b33}
    .ni svg{width:17px;height:17px;flex-shrink:0}
    .sb-usr{padding:16px;border-top:1px solid var(--b1)}
    .sb-usr-row{display:flex;align-items:center;gap:10px}
    .av{width:34px;height:34px;border-radius:99px;background:var(--ad);border:1.5px solid var(--ac);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:var(--ac);flex-shrink:0}
    .av-info p{font-size:13px;font-weight:600}
    .av-info span{font-size:11px;color:var(--t3);text-transform:capitalize}
    .logbtn{margin-top:8px;width:100%;padding:8px;border-radius:var(--rs);background:var(--rdd);border:1px solid #ef444433;color:var(--rd);font-size:12px;font-weight:600;transition:all .15s}
    .logbtn:hover{background:#ef444433}
    /* MAIN */
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
    .topbar{padding:16px 28px;border-bottom:1px solid var(--b1);background:var(--sf);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
    .topbar h2{font-family:var(--fn2);font-size:18px;font-weight:600}
    .topbar p{font-size:12px;color:var(--t3);margin-top:2px}
    .pg{flex:1;overflow-y:auto;padding:24px 28px}
    /* BANNER */
    .dbb{background:#f59e0b15;border:1.5px solid #f59e0b44;border-radius:var(--rs);padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ac)}
    .dbb svg{width:16px;height:16px;flex-shrink:0}
    .dbb strong{font-weight:700}
    .dbb-ok{background:var(--gd);border-color:#10b98144;color:var(--gn)}
    /* STATS */
    .sg{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;margin-bottom:24px}
    .sc{background:var(--sf);border:1px solid var(--b1);border-radius:var(--r);padding:20px;display:flex;align-items:flex-start;gap:14px}
    .sc:hover{border-color:var(--b2)}
    .sc-icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .sc-icon svg{width:20px;height:20px}
    .sc h3{font-size:22px;font-weight:700;font-family:var(--fn2)}
    .sc p{font-size:12px;color:var(--t2);margin-top:2px}
    /* CARD */
    .card{background:var(--sf);border:1px solid var(--b1);border-radius:var(--r);overflow:hidden;margin-bottom:20px}
    .ch{padding:16px 20px;border-bottom:1px solid var(--b1);display:flex;align-items:center;justify-content:space-between}
    .ch h3{font-size:14px;font-weight:600}
    .ch p{font-size:12px;color:var(--t3)}
    .tw{overflow-x:auto}
    table{width:100%;border-collapse:collapse}
    th{font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;padding:10px 16px;text-align:left;border-bottom:1px solid var(--b1);white-space:nowrap}
    td{font-size:13px;color:var(--t2);padding:12px 16px;border-bottom:1px solid #1e2535;vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#ffffff04}
    td strong{color:var(--t1);font-weight:500}
    /* BADGE */
    .badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
    .by{background:var(--ad);color:var(--ac);border:1px solid #f59e0b33}
    .bg{background:var(--gd);color:var(--gn);border:1px solid #10b98133}
    .br{background:var(--rdd);color:var(--rd);border:1px solid #ef444433}
    .bb{background:var(--bld);color:var(--bl);border:1px solid #3b82f633}
    /* BTN */
    .btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:var(--rs);font-size:13px;font-weight:600;transition:all .15s;white-space:nowrap}
    .btn svg{width:14px;height:14px}
    .bp{background:var(--ac);color:#0f1117} .bp:hover{background:var(--ac2)}
    .bs{background:var(--s2);color:var(--t1);border:1px solid var(--b2)} .bs:hover{background:var(--s3)}
    .bg2{background:transparent;color:var(--t2);border:1px solid var(--b1)} .bg2:hover{color:var(--t1);background:var(--s2)}
    .bd{background:var(--rdd);color:var(--rd);border:1px solid #ef444433} .bd:hover{background:#ef444433}
    .bgr{background:var(--gd);color:var(--gn);border:1px solid #10b98133} .bgr:hover{background:#10b98133}
    .bsm{padding:5px 10px;font-size:12px}
    .blg{padding:12px 24px;font-size:15px;border-radius:var(--r)}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    /* INPUT */
    .f{margin-bottom:16px}
    .f label{display:block;font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px;letter-spacing:.3px}
    .inp{width:100%;padding:10px 14px;background:var(--s2);border:1.5px solid var(--b2);border-radius:var(--rs);color:var(--t1);font-size:13.5px;transition:border-color .15s}
    .inp:focus{border-color:var(--ac)}
    .inp::placeholder{color:var(--t3)}
    textarea.inp{resize:vertical;min-height:80px}
    .r2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .r3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
    /* MODAL */
    .ov{position:fixed;inset:0;background:#00000088;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
    .modal{background:var(--sf);border:1px solid var(--b2);border-radius:16px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px #00000055}
    .mw{max-width:720px}
    .mh{padding:20px 24px;border-bottom:1px solid var(--b1);display:flex;align-items:center;justify-content:space-between}
    .mh h3{font-size:16px;font-weight:700;font-family:var(--fn2)}
    .mb{padding:24px}
    .mf{padding:16px 24px;border-top:1px solid var(--b1);display:flex;justify-content:flex-end;gap:10px}
    .xb{width:32px;height:32px;border-radius:99px;background:var(--s2);border:1px solid var(--b1);color:var(--t2);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
    .xb:hover{color:var(--t1)}
    /* SEARCH BAR */
    .sbar{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
    .sw{position:relative;flex:1;min-width:200px}
    .sw svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--t3);pointer-events:none}
    .sw .inp{padding-left:36px}
    /* UPLOAD */
    .uz{border:2px dashed var(--b2);border-radius:var(--r);padding:28px;text-align:center;cursor:pointer;transition:all .15s}
    .uz:hover{border-color:var(--ac);background:var(--ad)}
    .uz p{color:var(--t3);font-size:13px}
    .uz svg{width:28px;height:28px;color:var(--t3);margin:0 auto 10px;display:block}
    .prev{width:100%;max-height:180px;object-fit:contain;border-radius:var(--rs);background:#00000033;margin-top:10px}
    /* OCR */
    .ocr{background:var(--s2);border:1px solid var(--b1);border-radius:var(--rs);padding:14px;margin-bottom:16px}
    .ocr-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .ocr-lbl{font-size:11px;color:var(--t3);min-width:90px;flex-shrink:0}
    .ocr-val{font-size:13px;color:var(--ac);font-weight:500}
    /* AI */
    .aib{background:linear-gradient(135deg,#1e2535,#252d40);border:1.5px solid #f59e0b44;border-radius:var(--r);padding:16px;margin-bottom:16px}
    .aih{display:flex;align-items:center;gap:8px;margin-bottom:12px}
    .ait{background:var(--ad);border:1px solid #f59e0b44;color:var(--ac);font-size:10px;font-weight:700;letter-spacing:1px;padding:2px 8px;border-radius:99px}
    .ais{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#00000022;border-radius:var(--rs);margin-bottom:8px;cursor:pointer;border:1px solid transparent;transition:all .15s}
    .ais:hover{border-color:var(--ac);background:var(--ad)}
    .ais strong{font-size:13px;color:var(--t1)}
    .ais span{font-size:11px;color:var(--t3)}
    .aisc{background:var(--ad);color:var(--ac);font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;margin-left:auto;flex-shrink:0}
    /* NOTIFY */
    .notif{background:var(--gd);border:1px solid #10b98133;border-radius:var(--rs);padding:16px;margin-top:16px}
    .notif p{font-size:13px;color:var(--gn);margin-bottom:10px}
    .notif code{display:block;background:#00000033;padding:10px 12px;border-radius:6px;font-size:12px;color:#a7f3d0;word-break:break-all;margin-bottom:10px}
    /* LOGIN */
    .lp{height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg)}
    .lbg{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 50%,#f59e0b0d,transparent 60%),radial-gradient(ellipse at 70% 20%,#3b82f60a,transparent 50%);pointer-events:none}
    .lc{background:var(--sf);border:1px solid var(--b2);border-radius:20px;padding:40px;width:100%;max-width:400px;position:relative;z-index:1;box-shadow:0 8px 40px #00000055}
    .li{width:56px;height:56px;background:var(--ad);border:2px solid var(--ac);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px}
    /* MISC */
    .empty{text-align:center;padding:48px 20px}
    .empty svg{width:40px;height:40px;color:var(--t3);margin:0 auto 12px;display:block}
    .empty p{color:var(--t3);font-size:14px}
    .spin{width:18px;height:18px;border:2px solid var(--b2);border-top-color:var(--ac);border-radius:50%;animation:sp .7s linear infinite;display:inline-block;vertical-align:middle}
    @keyframes sp{to{transform:rotate(360deg)}}
    .dok{background:var(--gd);color:var(--gn);font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}
    .dw{background:var(--ad);color:var(--ac);font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}
    .dd{background:var(--rdd);color:var(--rd);font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}
    /* PAGINATION */
    .pgn{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--b1);flex-wrap:wrap;gap:10px}
    .pgn-info{font-size:12px;color:var(--t3)}
    .pgn-btns{display:flex;align-items:center;gap:4px}
    .pgn-btn{width:32px;height:32px;border-radius:var(--rs);background:var(--s2);border:1px solid var(--b1);color:var(--t2);font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
    .pgn-btn:hover:not(:disabled){background:var(--s3);color:var(--t1)}
    .pgn-btn.on{background:var(--ac);color:#0f1117;border-color:var(--ac)}
    .pgn-btn:disabled{opacity:.35;cursor:not-allowed}
    .pgn-size{padding:5px 8px;background:var(--s2);border:1px solid var(--b1);border-radius:var(--rs);color:var(--t1);font-size:12px;font-family:var(--fn)}
    /* OFFLINE BANNER */
    .offbanner{background:#f59e0b18;border:1.5px solid #f59e0b55;border-radius:var(--rs);padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ac);animation:fadeIn .3s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
    .offbanner svg{width:16px;height:16px;flex-shrink:0}
    /* SCANNER */
    .scan-wrap{position:relative;border-radius:var(--r);overflow:hidden;background:#000;margin-bottom:12px}
    .scan-video{width:100%;max-height:260px;object-fit:cover;display:block}
    .scan-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
    .scan-frame{width:220px;height:140px;border:2px solid var(--ac);border-radius:8px;position:relative;box-shadow:0 0 0 9999px #00000066}
    .scan-line{position:absolute;left:0;right:0;height:2px;background:var(--ac);animation:scanMove 2s linear infinite;box-shadow:0 0 8px var(--ac)}
    @keyframes scanMove{0%{top:0}50%{top:100%}100%{top:0}}
    .scan-corner{position:absolute;width:16px;height:16px;border-color:var(--ac);border-style:solid}
    .scan-corner.tl{top:-2px;left:-2px;border-width:3px 0 0 3px}
    .scan-corner.tr{top:-2px;right:-2px;border-width:3px 3px 0 0}
    .scan-corner.bl{bottom:-2px;left:-2px;border-width:0 0 3px 3px}
    .scan-corner.br{bottom:-2px;right:-2px;border-width:0 3px 3px 0}
    .scan-result{background:var(--gd);border:1px solid #10b98133;border-radius:var(--rs);padding:10px 14px;margin-bottom:10px;font-size:13px;color:var(--gn);display:flex;align-items:center;gap:8px}
    .scan-tabs{display:flex;gap:6px;margin-bottom:14px}
    .scan-tab{flex:1;padding:10px;border-radius:var(--rs);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--b1);background:var(--s2);color:var(--t2);text-align:center;transition:all .15s}
    .scan-tab.on{border-color:var(--ac);background:var(--ad);color:var(--ac)}
    /* MOBILE BOTTOM NAV */
    .mob-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--sf);border-top:1px solid var(--b1);z-index:50;padding:6px 0}
    .mob-nav-inner{display:flex;justify-content:space-around}
    .mob-ni{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 8px;cursor:pointer;color:var(--t3);font-size:9px;font-weight:600;flex:1;border-radius:var(--rs);transition:all .15s}
    .mob-ni svg{width:22px;height:22px}
    .mob-ni.on{color:var(--ac)}
    .hbtn{display:flex;width:36px;height:36px;border-radius:var(--rs);background:var(--s2);border:1px solid var(--b1);color:var(--t2);align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
    .hbtn svg{width:18px;height:18px}
    /* QUICK MENU */
    .qm-wrap{position:relative}
    .qm{position:absolute;top:calc(100% + 8px);left:0;background:var(--sf);border:1px solid var(--b2);border-radius:var(--r);min-width:240px;box-shadow:0 8px 32px #00000055;z-index:200;overflow:hidden;animation:qmIn .15s ease}
    @keyframes qmIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
    .qm-title{font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;text-transform:uppercase;padding:12px 16px 6px}
    .qm-item{display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;transition:background .12s;color:var(--t2);font-size:13px;font-weight:500}
    .qm-item:hover{background:var(--s2);color:var(--t1)}
    .qm-item svg{width:16px;height:16px;flex-shrink:0}
    .qm-icon{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .qm-icon svg{width:15px;height:15px}
    .qm-sep{height:1px;background:var(--b1);margin:4px 0}
    .sb-ov{display:none;position:fixed;inset:0;background:#00000066;z-index:40}
    .sb-ov.show{display:block}
    @media(max-width:1024px){
      .sb{width:200px;min-width:200px}
      .pg{padding:20px 16px}
      .topbar{padding:14px 16px}
      .r3{grid-template-columns:1fr 1fr}
    }
    @media(max-width:767px){
      .sb{position:fixed;left:0;top:0;bottom:0;z-index:45;transform:translateX(-100%);transition:transform .25s;width:260px!important;min-width:260px!important}
      .sb.open{transform:translateX(0)}
      .mob-nav{display:block}
      .main{height:100vh}
      .pg{padding:16px 12px;padding-bottom:84px}
      .topbar{padding:12px 14px}
      .topbar p{display:none}
      .sg{grid-template-columns:1fr 1fr}
      .r2,.r3{grid-template-columns:1fr}
      .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
      table{min-width:500px}
      .ov{padding:0;align-items:flex-end}
      .modal{border-radius:20px 20px 0 0;max-height:92vh;max-width:100%!important}
      .lc{padding:28px 20px;border-radius:16px}
      .sbar{flex-direction:column}
      .blg{padding:10px 18px;font-size:14px}
    }
    @media(max-width:399px){
      .sg{grid-template-columns:1fr}
      .topbar h2{font-size:15px}
    }
  `}</style>
);

// ─── ÍCONES ───────────────────────────────────────────────────────────────────
const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  users:    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  package:  <><path d="m12.89 1.45 8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.78 0l-8-4a2 2 0 0 1-1.11-1.8V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.78 0z"/><polyline points="2.32 6.16 12 11 21.68 6.16"/><line x1="12" y1="22.76" x2="12" y2="11"/></>,
  check:    <><polyline points="20 6 9 17 4 12"/></>,
  plus:     <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
  search:   <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  edit:     <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
  trash:    <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4h6v2"/></>,
  report:   <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
  log:      <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="13 2 13 9 20 9"/></>,
  whatsapp: <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></>,
  camera:   <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
  ai:       <><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></>,
  x:        <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  notify:   <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
  db:       <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
  key:      <><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>,
  eye:      <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
  eyeoff:   <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>,
  gear:     <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
};

const Icon = ({ n }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[n]}</svg>;

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const friendlyAuthError = (error, fallback) => {
  const message=String(error?.message||"");
  const lower=message.toLowerCase();
  if(lower.includes("failed to fetch")||lower.includes("networkerror")||lower.includes("fetch failed")) return "Não foi possível conectar ao serviço de acesso. Verifique sua internet e tente novamente.";
  if(lower.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if(lower.includes("email not confirmed")) return "Confirme seu e-mail pelo link enviado antes de entrar.";
  if(lower.includes("user already registered")) return "Este e-mail já possui uma conta. Use Entrar ou recupere a senha.";
  if(lower.includes("password should be at least")) return "A senha não atende ao tamanho mínimo exigido pelo serviço.";
  return message||fallback;
};

const Login = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [modo, setModo] = useState("entrar");
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [loading, setLoading] = useState(false);
  const recuperar=async()=>{
    if(!supabaseClient||!email.trim())return setErro("Informe seu e-mail para receber o link de redefinição.");
    setLoading(true);setErro("");setMensagem("");
    try {
      const {error}=await supabaseClient.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin+window.location.pathname});
      if(error)throw error;
      setMensagem("Se houver uma conta para esse e-mail, enviaremos um link para redefinir a senha.");
    } catch(e) {setErro(friendlyAuthError(e,"Não foi possível enviar o link. Tente novamente."));}
    finally {setLoading(false);}
  };
  const entrar = async () => {
    if(!supabaseClient) return setErro("O serviço de autenticação ainda não foi configurado.");
    if(!email.trim()||!senha) return setErro("Informe e-mail e senha.");
    setLoading(true); setErro(""); setMensagem("");
    try {
      const {data,error}=await supabaseClient.auth.signInWithPassword({email:email.trim(),password:senha});
      if(error) throw error;
      onLogin(data.session);
    } catch(e) { setErro(friendlyAuthError(e,"Não foi possível entrar. Confira seu e-mail e senha.")); }
    finally { setLoading(false); }
  };
  const cadastrar = async () => {
    if(!supabaseClient) return setErro("O serviço de autenticação ainda não foi configurado.");
    if(!email.trim()||senha.length<8) return setErro("Informe seu e-mail e crie uma senha com pelo menos 8 caracteres.");
    setLoading(true); setErro(""); setMensagem("");
    try {
      const {data,error}=await supabaseClient.auth.signUp({email:email.trim(),password:senha,options:{emailRedirectTo:window.location.origin+window.location.pathname}});
      if(error) throw error;
      if(data.session) onLogin(data.session);
      else setMensagem("Confira seu e-mail para confirmar a conta. Depois, volte e entre para concluir a configuração.");
    } catch(e) { setErro(friendlyAuthError(e,"Não foi possível criar a conta.")); }
    finally { setLoading(false); }
  };
  return (
    <div className="lp" style={{position:"relative",height:"auto",minHeight:"100dvh",overflowY:"auto",padding:"28px 16px"}}>
      <div className="lbg"/>
      <div style={{width:"100%",maxWidth:840,position:"relative",zIndex:1}}>
      <div className="lc" style={{margin:"0 auto 20px"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div className="li">📦</div>
          <h1 style={{fontFamily:"var(--fn2)",fontSize:22,fontWeight:700}}>Portaria <span style={{color:"var(--ac)"}}>Express</span></h1>
          <p style={{fontSize:13,color:"var(--t3)",marginTop:6}}>Gestão organizada de encomendas e retiradas para condomínios.</p>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button className={`scan-tab${modo==="entrar"?" on":""}`} onClick={()=>{setModo("entrar");setErro("");}}>Entrar</button>
          <button className={`scan-tab${modo==="criar"?" on":""}`} onClick={()=>{setModo("criar");setErro("");}}>Criar conta</button>
        </div>
        <div className="f"><label>E-MAIL</label><input className="inp" type="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setErro("");}} placeholder="voce@condominio.com.br" onKeyDown={e=>e.key==="Enter"&& (modo==="entrar"?entrar():cadastrar())}/></div>
        <div className="f"><label>SENHA {modo==="criar"&&"(mínimo 8 caracteres)"}</label><input className="inp" type="password" autoComplete={modo==="entrar"?"current-password":"new-password"} value={senha} onChange={e=>{setSenha(e.target.value);setErro("");}} onKeyDown={e=>e.key==="Enter"&& (modo==="entrar"?entrar():cadastrar())}/></div>
        {erro&&<p style={{color:"var(--rd)",fontSize:13,marginBottom:12,textAlign:"center"}}>{erro}</p>}
        {mensagem&&<p style={{color:"var(--gn)",fontSize:13,marginBottom:12,textAlign:"center"}}>{mensagem}</p>}
        <button className="btn bp blg" style={{width:"100%"}} disabled={loading} onClick={modo==="entrar"?entrar:cadastrar}>{loading?<><span className="spin"/> Aguarde...</>:modo==="entrar"?"Entrar no sistema":"Criar minha conta"}</button>
        {modo==="entrar"&&<button style={{display:"block",margin:"12px auto 0",background:"none",color:"var(--ac)",fontSize:12}} onClick={recuperar}>Esqueci minha senha</button>}
        <p style={{textAlign:"center",fontSize:11,color:"var(--t3)",marginTop:16}}>Cada conta acessa somente os condomínios aos quais foi vinculada.</p>
      </div>
      <section className="card" aria-labelledby="sobre-portaria" style={{padding:22,marginBottom:0}}>
        <div style={{marginBottom:18}}>
          <span className="badge by">SOBRE O SISTEMA</span>
          <h2 id="sobre-portaria" style={{fontFamily:"var(--fn2)",fontSize:20,marginTop:10}}>Tudo sobre o Portaria Express</h2>
          <p style={{fontSize:13,color:"var(--t2)",lineHeight:1.7,marginTop:8}}>O Portaria Express é um sistema para registrar encomendas recebidas na portaria, acompanhar cada pacote até a retirada pelo morador e manter um histórico claro da operação. Ele reúne o trabalho diário da equipe em um só lugar e pode ser usado em computadores, tablets e celulares.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {[
            {i:"package",t:"Recebimento de pacotes",d:"Registre destinatário, apartamento, bloco, transportadora e protocolo. Use preenchimento manual, scanner ou câmera com leitura assistida por IA."},
            {i:"check",t:"Retirada com comprovante",d:"Localize encomendas pendentes e registre a retirada com foto privada e identificação da equipe, depois de configurar o armazenamento no Supabase."},
            {i:"users",t:"Cadastro de moradores",d:"Mantenha moradores, unidades e telefones organizados para agilizar o recebimento e o envio de avisos."},
            {i:"whatsapp",t:"Avisos pelo WhatsApp",d:"Prepare uma mensagem com os dados da encomenda e abra o WhatsApp para que a portaria confirme e envie o aviso."},
            {i:"report",t:"Painel e relatórios",d:"Acompanhe pendências e retiradas, consulte o histórico, filtre registros e exporte relatórios em CSV."},
            {i:"key",t:"Acesso e auditoria",d:"Entre com conta autenticada, convide a equipe por código e consulte o registro de ações do condomínio."},
            {i:"db",t:"Dados separados por condomínio",d:"Com a migração do Supabase aplicada, as permissões do banco isolam os registros por condomínio e sincronizam os dados pela internet."},
            {i:"x",t:"Publicações para Twitter / X",d:"Escreva comunicados públicos, use hashtags sugeridas, copie o texto e abra o X com o rascunho preenchido. A publicação pode exigir login no X."},
          ].map(item=>(
            <div key={item.t} style={{background:"var(--s2)",border:"1px solid var(--b1)",borderRadius:"var(--rs)",padding:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,color:"var(--ac)",marginBottom:7}}><Icon n={item.i}/><strong style={{fontSize:13,color:"var(--t1)"}}>{item.t}</strong></div>
              <p style={{fontSize:12,color:"var(--t2)",lineHeight:1.6}}>{item.d}</p>
            </div>
          ))}
        </div>
        <p style={{fontSize:11,color:"var(--t3)",lineHeight:1.6,marginTop:16}}>O envio de avisos pelo WhatsApp é confirmado pela equipe. A leitura por IA depende do Ollama instalado e ativo no computador. A equipe deve definir e informar o prazo de retenção das fotos de retirada.</p>
      </section>
      </div>
    </div>
  );
};

const TenantSetup = ({session,onDone,onLogout}) => {
  const [modo,setModo]=useState("criar");
  const [condominio,setCondominio]=useState("");
  const [nome,setNome]=useState("");
  const [convite,setConvite]=useState("");
  const [erro,setErro]=useState("");
  const [loading,setLoading]=useState(false);
  const salvar=async()=>{
    setLoading(true);setErro("");
    try {
      const result=modo==="criar"
        ? await supabaseClient.rpc("portaria_criar_condominio",{p_nome:condominio,p_nome_usuario:nome})
        : await supabaseClient.rpc("portaria_aceitar_convite",{p_token:convite.trim(),p_nome:nome});
      if(result.error) throw result.error;
      await onDone();
    } catch(e) { setErro(e.message||"Não foi possível concluir a configuração."); }
    finally { setLoading(false); }
  };
  return <><Styles/><div className="lp" style={{padding:24}}><div className="lc">
    <h2 style={{fontFamily:"var(--fn2)",marginBottom:8}}>Quase pronto</h2>
    <p style={{fontSize:13,color:"var(--t2)",lineHeight:1.6,marginBottom:18}}>Conta: {session.user.email}. Crie um condomínio ou use um convite recebido do administrador.</p>
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      <button className={`scan-tab${modo==="criar"?" on":""}`} onClick={()=>{setModo("criar");setErro("");}}>Criar condomínio</button>
      <button className={`scan-tab${modo==="convite"?" on":""}`} onClick={()=>{setModo("convite");setErro("");}}>Aceitar convite</button>
    </div>
    <div className="f"><label>SEU NOME</label><input className="inp" value={nome} onChange={e=>setNome(e.target.value)} autoComplete="name"/></div>
    {modo==="criar"?<div className="f"><label>NOME DO CONDOMÍNIO</label><input className="inp" value={condominio} onChange={e=>setCondominio(e.target.value)} placeholder="Condomínio das Palmeiras"/></div>:<div className="f"><label>CÓDIGO DO CONVITE</label><input className="inp" value={convite} onChange={e=>setConvite(e.target.value)} autoComplete="off"/></div>}
    {erro&&<p style={{color:"var(--rd)",fontSize:12,marginBottom:12}}>{erro}</p>}
    <button className="btn bp" disabled={loading} onClick={salvar}>{loading?"Salvando...":modo==="criar"?"Criar condomínio":"Aceitar convite"}</button>
    <button className="btn bg2" style={{marginLeft:8}} onClick={onLogout}>Sair</button>
  </div></div></>;
};

const ResetPassword = ({onComplete}) => {
  const [senha,setSenha]=useState("");const [erro,setErro]=useState("");const [loading,setLoading]=useState(false);
  const salvar=async()=>{
    if(senha.length<8)return setErro("Use uma senha com pelo menos 8 caracteres.");
    setLoading(true);setErro("");
    try {
      const {error}=await supabaseClient.auth.updateUser({password:senha});
      if(error)throw error;
      onComplete();
    } catch(e) {setErro(friendlyAuthError(e,"Não foi possível redefinir a senha. Solicite um novo link."));}
    finally {setLoading(false);}
  };
  return <><Styles/><div className="lp"><div className="lc"><h2 style={{marginBottom:12}}>Redefinir senha</h2><div className="f"><label>NOVA SENHA</label><input className="inp" type="password" autoComplete="new-password" value={senha} onChange={e=>setSenha(e.target.value)}/></div>{erro&&<p style={{color:"var(--rd)",fontSize:12,marginBottom:12}}>{erro}</p>}<button className="btn bp" disabled={loading} onClick={salvar}>{loading?"Salvando...":"Salvar nova senha"}</button></div></div></>;
};

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
const Sidebar = ({ page, setPage, user, onLogout }) => {
  const allNav = [{sec:"PRINCIPAL"},{id:"dashboard",l:"Dashboard",i:"dashboard"},{id:"encomendas",l:"Encomendas",i:"package"},{id:"retirada",l:"Retirada",i:"check"},{sec:"GESTÃO"},{id:"moradores",l:"Moradores",i:"users"},{id:"usuarios",l:"Usuários",i:"key"},{id:"notificacoes",l:"Notificações",i:"notify"},{id:"xwriter",l:"Twitter / X",i:"x"},{id:"relatorios",l:"Relatórios",i:"report"},{id:"logs",l:"Auditoria",i:"log"},{sec:"SISTEMA"},{id:"configuracoes",l:"Configurações",i:"gear"}];
  const nav = allNav.filter((item,index) => item.id ? canAccess(user.perfil,item.id) : allNav.slice(index+1).some(next => !next.sec && canAccess(user.perfil,next.id)));
  return (
    <div className="sb">
      <div className="sb-logo"><h1>📦 Portaria <span>Express</span></h1><p>Gestão de Encomendas</p></div>
      <nav className="sb-nav">
        {nav.map((n,i)=>n.sec?<div key={i} className="nsec">{n.sec}</div>:
          <div key={n.id} className={`ni${page===n.id?" on":""}`} onClick={()=>setPage(n.id)}><Icon n={n.i}/>{n.l}</div>
        )}
      </nav>
      <div className="sb-usr">
        <div className="sb-usr-row">
          <div className="av">{user.nome[0]}</div>
          <div className="av-info"><p>{user.nome.split(" ")[0]}</p><span>{user.perfil}</span></div>
        </div>
        <button className="logbtn" onClick={onLogout}>Sair do sistema</button>
      </div>
    </div>
  );
};

// ─── BANNER ───────────────────────────────────────────────────────────────────
const Banner = () => DB_OK
  ? <div className="dbb dbb-ok"><Icon n="db"/><span><strong>Dados protegidos por condomínio</strong> — sincronizados com o Supabase</span></div>
  : <div className="dbb"><Icon n="db"/><span><strong>Modo demo</strong> — configure SUPABASE_URL e SUPABASE_KEY no código para ativar o banco. Dados não persistem ao recarregar.</span></div>;

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const Dashboard = ({ encomendas, moradores }) => {
  const pend = encomendas.filter(e=>e.status==="pendente");
  const retir = encomendas.filter(e=>e.status==="retirada");
  const hj = encomendas.filter(e=>isToday(e.criado_em));
  const agd = [...pend].sort((a,b)=>new Date(a.criado_em)-new Date(b.criado_em));
  const ult = [...encomendas].sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em)).slice(0,10);
  return (
    <div>
      <Banner/>
      <div className="sg">
        {[{i:"users",l:"Moradores Ativos",v:moradores.filter(m=>m.ativo).length,c:"#3b82f6",bg:"var(--bld)"},{i:"package",l:"Pendentes",v:pend.length,c:"var(--ac)",bg:"var(--ad)"},{i:"check",l:"Retiradas",v:retir.length,c:"var(--gn)",bg:"var(--gd)"},{i:"camera",l:"Recebidas Hoje",v:hj.length,c:"#a78bfa",bg:"#a78bfa22"}].map((s,i)=>(
          <div className="sc" key={i}>
            <div className="sc-icon" style={{background:s.bg,color:s.c}}><Icon n={s.i}/></div>
            <div><h3>{s.v}</h3><p>{s.l}</p></div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:20}}>
        <div className="card">
          <div className="ch"><h3>Últimas 10 Encomendas</h3></div>
          <div className="tw"><table>
            <thead><tr><th>Protocolo</th><th>Morador</th><th>Status</th><th>Data</th></tr></thead>
            <tbody>
              {ult.length===0&&<tr><td colSpan={4}><div className="empty"><Icon n="package"/><p>Nenhuma encomenda</p></div></td></tr>}
              {ult.map(e=>(
                <tr key={e.id}>
                  <td><code style={{fontSize:11,color:"var(--t3)"}}>{e.protocolo}</code></td>
                  <td><strong>{e.morador}</strong><br/><span style={{fontSize:11,color:"var(--t3)"}}>Bl {e.bloco}/Ap {e.apartamento}</span></td>
                  <td><span className={`badge ${e.status==="pendente"?"by":"bg"}`}>{e.status==="pendente"?"⏳ Pendente":"✓ Retirada"}</span></td>
                  <td style={{fontSize:11}}>{fmtShort(e.criado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <div className="ch"><h3>Aguardando — por tempo</h3></div>
          <div className="tw"><table>
            <thead><tr><th>Morador</th><th>Ap</th><th>Dias</th></tr></thead>
            <tbody>
              {agd.length===0&&<tr><td colSpan={3} style={{textAlign:"center",color:"var(--t3)",padding:32}}>Nenhuma pendente 🎉</td></tr>}
              {agd.map(e=>{ const d=getDias(e.criado_em); return (
                <tr key={e.id}>
                  <td><strong>{e.morador}</strong></td>
                  <td>Bl {e.bloco}/{e.apartamento}</td>
                  <td><span className={d<=1?"dok":d<=3?"dw":"dd"}>{d}d</span></td>
                </tr>
              );})}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>
  );
};

// ─── READONLY BANNER ─────────────────────────────────────────────────────────
const ReadonlyBanner = () => (
  <div style={{background:"#a78bfa22",border:"1.5px solid #a78bfa44",borderRadius:"var(--rs)",padding:"10px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:10,fontSize:13,color:"#a78bfa"}}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16,flexShrink:0}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span><strong>Modo visualização</strong> — apenas administradores podem editar esta seção.</span>
  </div>
);

// ─── MORADORES ────────────────────────────────────────────────────────────────
const Moradores = ({ moradores, setMoradores, user }) => {
  const [srch, setSrch] = useState(""); const [fb, setFb] = useState(""); const [modal, setModal] = useState(null); const [form, setForm] = useState({}); const [delId, setDelId] = useState(null);
  const importRef=useRef(null);
  const readonly = isReadonly(user.perfil, "moradores");
  const blocos = [...new Set(moradores.map(m=>m.bloco))].sort();
  const list = moradores.filter(m=>(!srch||m.nome.toLowerCase().includes(srch.toLowerCase())||m.apartamento.includes(srch))&&(!fb||m.bloco===fb));
  const save = async () => {
    if(!form.nome?.trim()||!form.apartamento?.trim()||!form.bloco?.trim()) return alert("Preencha nome, apartamento e bloco.");
    const row={nome:form.nome.trim(),apartamento:form.apartamento.trim(),bloco:form.bloco.trim(),telefone:form.telefone||"",whatsapp:form.whatsapp||"",obs:form.obs||"",ativo:!!form.ativo};
    try {
      const saved=modal==="novo"?await db.insert("moradores",row):await db.update("moradores",form.id,row);
      setMoradores(p=>modal==="novo"?[...p,saved].sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR")):p.map(m=>m.id===form.id?saved:m));
      setModal(null);
    } catch(e) { alert("Não foi possível salvar o morador. Os dados continuam no formulário.\n\n"+(e.message||"Verifique a conexão.")); }
  };
  const lerCsv=async file=>{
    if(!file)return;
    try {
      const text=(await file.text()).replace(/^\uFEFF/,"");
      const linhas=text.split(/\r?\n/).filter(l=>l.trim());
      if(linhas.length<2) throw new Error("O arquivo precisa ter cabeçalho e ao menos um morador.");
      const delimiter=(linhas[0].match(/;/g)||[]).length>(linhas[0].match(/,/g)||[]).length?";":",";
      const parse=line=>{const vals=[];let cur="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'&&line[i+1]==='"'&&quoted){cur+='"';i++;}else if(ch==='"'){quoted=!quoted;}else if(ch===delimiter&&!quoted){vals.push(cur.trim());cur="";}else cur+=ch;}vals.push(cur.trim());return vals;};
      const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
      const headers=parse(linhas[0]).map(norm);
      const find=(...keys)=>headers.findIndex(h=>keys.includes(h));
      const ix={nome:find("nome","morador","nomecompleto"),bloco:find("bloco","torre"),apartamento:find("apartamento","ap","unidade"),telefone:find("telefone","celular"),whatsapp:find("whatsapp"),obs:find("obs","observacoes","observacao")};
      if(ix.nome<0||ix.bloco<0||ix.apartamento<0) throw new Error("Inclua colunas com nome, bloco e apartamento. Telefone e WhatsApp são opcionais.");
      const rows=linhas.slice(1).map(parse).map(c=>({nome:c[ix.nome]||"",bloco:c[ix.bloco]||"",apartamento:c[ix.apartamento]||"",telefone:ix.telefone>=0?c[ix.telefone]||"":"",whatsapp:ix.whatsapp>=0?c[ix.whatsapp]||"":"",obs:ix.obs>=0?c[ix.obs]||"":"",ativo:true,condominio_id:ACTIVE_TENANT_ID})).filter(r=>r.nome&&r.bloco&&r.apartamento);
      if(!rows.length) throw new Error("Não encontrei linhas válidas para importar.");
      const {data,error}=await supabaseClient.from("portaria_moradores").insert(rows).select();
      if(error) throw error;
      setMoradores(p=>[...p,...(data||[])].sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR")));
      alert(`${data?.length||0} morador(es) importado(s).`);
    } catch(e) {alert("Falha na importação: "+(e.message||"Confira o CSV e tente novamente."));}
    finally {if(importRef.current)importRef.current.value="";}
  };
  return (
    <div>
      {readonly && <ReadonlyBanner/>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginBottom:20}}>
        {!readonly&&<><input ref={importRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={e=>lerCsv(e.target.files?.[0])}/>
        <button className="btn bg2 bsm" onClick={()=>importRef.current?.click()}><Icon n="download"/> Importar CSV</button></>}
        {!readonly && <button className="btn bp" onClick={()=>{setForm({nome:"",apartamento:"",bloco:"",telefone:"",whatsapp:"",obs:"",ativo:true});setModal("novo")}}><Icon n="plus"/> Novo Morador</button>}
      </div>
      <div className="sbar">
        <div className="sw"><Icon n="search"/><input className="inp" placeholder="Nome, apartamento..." value={srch} onChange={e=>setSrch(e.target.value)}/></div>
        <select className="inp" style={{width:160}} value={fb} onChange={e=>setFb(e.target.value)}>
          <option value="">Todos os blocos</option>{blocos.map(b=><option key={b}>{b}</option>)}
        </select>
      </div>
      <div className="card"><div className="tw"><table>
        <thead><tr><th>Nome</th><th>Bloco/Ap</th><th>Telefone</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          {list.length===0&&<tr><td colSpan={5}><div className="empty"><Icon n="users"/><p>Nenhum morador</p></div></td></tr>}
          {list.map(m=>(
            <tr key={m.id}>
              <td><strong>{m.nome}</strong>{m.obs&&<><br/><span style={{fontSize:11,color:"var(--t3)"}}>{m.obs}</span></>}</td>
              <td>Bl <strong>{m.bloco}</strong> / Ap <strong>{m.apartamento}</strong></td>
              <td>{m.telefone||"—"}</td>
              <td><span className={`badge ${m.ativo?"bg":"br"}`}>{m.ativo?"Ativo":"Inativo"}</span></td>
              <td>{!readonly && <div style={{display:"flex",gap:6}}>
                <button className="btn bg2 bsm" onClick={()=>{setForm({...m});setModal("editar")}}><Icon n="edit"/></button>
                <button className="btn bd bsm" onClick={()=>setDelId(m.id)}><Icon n="trash"/></button>
              </div>}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
      {(modal==="novo"||modal==="editar")&&(
        <div className="ov" onClick={()=>setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="mh"><h3>{modal==="novo"?"Novo Morador":"Editar Morador"}</h3><button className="xb" onClick={()=>setModal(null)}><Icon n="x"/></button></div>
            <div className="mb">
              <div className="f"><label>NOME *</label><input className="inp" value={form.nome||""} onChange={e=>setForm({...form,nome:e.target.value})} placeholder="Nome completo"/></div>
              <div className="r3">
                <div className="f"><label>BLOCO *</label><input className="inp" value={form.bloco||""} onChange={e=>setForm({...form,bloco:e.target.value})} placeholder="A"/></div>
                <div className="f"><label>APARTAMENTO *</label><input className="inp" value={form.apartamento||""} onChange={e=>setForm({...form,apartamento:e.target.value})} placeholder="101"/></div>
                <div className="f"><label>STATUS</label>
                  <select className="inp" value={form.ativo?"ativo":"inativo"} onChange={e=>setForm({...form,ativo:e.target.value==="ativo"})}>
                    <option value="ativo">Ativo</option><option value="inativo">Inativo</option>
                  </select>
                </div>
              </div>
              <div className="r2">
                <div className="f"><label>TELEFONE</label><input className="inp" value={form.telefone||""} onChange={e=>setForm({...form,telefone:e.target.value})}/></div>
                <div className="f"><label>WHATSAPP</label><input className="inp" value={form.whatsapp||""} onChange={e=>setForm({...form,whatsapp:e.target.value})}/></div>
              </div>
              <div className="f"><label>OBSERVAÇÕES</label><textarea className="inp" value={form.obs||""} onChange={e=>setForm({...form,obs:e.target.value})}/></div>
            </div>
            <div className="mf"><button className="btn bg2" onClick={()=>setModal(null)}>Cancelar</button><button className="btn bp" onClick={save}>Salvar</button></div>
          </div>
        </div>
      )}
      {delId&&(
        <div className="ov" onClick={()=>setDelId(null)}>
          <div className="modal" style={{maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div className="mb" style={{textAlign:"center",padding:32}}>
              <div style={{fontSize:36,marginBottom:16}}>🗑️</div>
              <h3 style={{marginBottom:8}}>Excluir morador?</h3>
              <p style={{color:"var(--t3)",fontSize:13,marginBottom:24}}>Esta ação não pode ser desfeita.</p>
              <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                <button className="btn bg2" onClick={()=>setDelId(null)}>Cancelar</button>
                <button className="btn bd" onClick={async()=>{try{await db.delete("moradores",delId);setMoradores(p=>p.filter(m=>m.id!==delId));setDelId(null);}catch(e){alert("Não foi possível excluir o morador.\n\n"+(e.message||"Verifique a conexão."));}}}>Excluir</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── FOTO CAPTURE (câmera via getUserMedia — funciona em qualquer browser) ────
const FotoCapture = ({ img, setImg, onOCR, loading }) => {
  const [mode, setMode] = useState("idle"); // idle | solicitando | camera | preview | bloqueado
  const [flash, setFlash] = useState(false);
  const [errDetalhe, setErrDetalhe] = useState("");
  const videoRef = useRef();
  const canvasRef = useRef();
  const streamRef = useRef();

  const startCam = async () => {
    setMode("solicitando");
    setErrDetalhe("");
    try {
      // Verifica suporte
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrDetalhe("Seu navegador não suporta câmera. Use o Chrome.");
        setMode("bloqueado"); return;
      }
      // Tenta câmera traseira primeiro, depois qualquer câmera
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: {exact:"environment"} }
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setMode("camera");
      // Pequeno delay para o DOM renderizar o video element
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if(videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(()=>{});
          }
        });
      });
    } catch(e) {
      const nome = e.name || "";
      if(nome === "NotAllowedError" || nome === "PermissionDeniedError") {
        setErrDetalhe("PERMISSÃO NEGADA");
      } else if(nome === "NotFoundError") {
        setErrDetalhe("Nenhuma câmera encontrada no dispositivo.");
      } else if(nome === "NotReadableError") {
        setErrDetalhe("Câmera em uso por outro aplicativo. Feche e tente novamente.");
      } else {
        setErrDetalhe("Erro: " + (e.message || nome));
      }
      setMode("bloqueado");
    }
  };

  const stopCam = () => {
    if(streamRef.current) { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
    setMode("idle");
  };

  const capturar = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if(!video||!canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    setFlash(true);
    setTimeout(()=>setFlash(false), 200);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setImg(dataUrl);
    stopCam();
    setMode("preview");
    onOCR(dataUrl);
  };

  useEffect(()=>()=>stopCam(),[]);

  // Foto capturada — mostrar preview
  if(img && mode!=="camera" && mode!=="solicitando" && mode!=="bloqueado") return (
    <div>
      <img src={img} style={{width:"100%",maxHeight:220,objectFit:"contain",borderRadius:"var(--rs)",background:"#00000033",marginBottom:12}} alt="etiqueta"/>
      <div style={{display:"flex",gap:10}}>
        <button className="btn bs" style={{flex:1}} onClick={()=>{setImg(null);setMode("idle");}}>↩ Nova foto</button>
        <button className="btn bp" style={{flex:1}} onClick={()=>onOCR(img)} disabled={loading}>
          {loading?<><span className="spin"/> Lendo...</>:<><Icon n="ai"/> Ler novamente com IA</>}
        </button>
      </div>
    </div>
  );

  // Aguardando permissão
  if(mode==="solicitando") return (
    <div style={{textAlign:"center",padding:"32px 16px"}}>
      <div style={{fontSize:48,marginBottom:16}}>📷</div>
      <p style={{color:"var(--ac)",fontWeight:700,fontSize:15,marginBottom:8}}>Solicitando permissão...</p>
      <p style={{color:"var(--t2)",fontSize:13}}>Quando o navegador perguntar, toque em <strong>"Permitir"</strong></p>
    </div>
  );

  // Câmera ativa
  if(mode==="camera") return (
    <div>
      <div style={{position:"relative",borderRadius:"var(--rs)",overflow:"hidden",background:"#000",marginBottom:10}}>
        <video ref={videoRef} style={{width:"100%",maxHeight:280,objectFit:"cover",display:"block"}} playsInline muted autoPlay/>
        <canvas ref={canvasRef} style={{display:"none"}}/>
        {flash && <div style={{position:"absolute",inset:0,background:"#fff",opacity:0.7}}/>}
        <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
            width:"80%",height:"60%",border:"2px solid var(--ac)",borderRadius:8,
            boxShadow:"0 0 0 9999px #00000055"}}>
            <div style={{position:"absolute",top:0,left:0,width:20,height:20,borderTop:"3px solid var(--ac)",borderLeft:"3px solid var(--ac)"}}/>
            <div style={{position:"absolute",top:0,right:0,width:20,height:20,borderTop:"3px solid var(--ac)",borderRight:"3px solid var(--ac)"}}/>
            <div style={{position:"absolute",bottom:0,left:0,width:20,height:20,borderBottom:"3px solid var(--ac)",borderLeft:"3px solid var(--ac)"}}/>
            <div style={{position:"absolute",bottom:0,right:0,width:20,height:20,borderBottom:"3px solid var(--ac)",borderRight:"3px solid var(--ac)"}}/>
          </div>
        </div>
      </div>
      <p style={{textAlign:"center",fontSize:12,color:"var(--t3)",marginBottom:10}}>Encaixe a etiqueta na área marcada</p>
      <div style={{display:"flex",gap:10}}>
        <button className="btn bd" style={{flex:1}} onClick={stopCam}>✕ Cancelar</button>
        <button className="btn bp blg" style={{flex:2,justifyContent:"center"}} onClick={capturar}>📸 Capturar</button>
      </div>
    </div>
  );

  // Câmera bloqueada — instruções detalhadas + alternativas
  if(mode==="bloqueado") return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {errDetalhe==="PERMISSÃO NEGADA" ? (
        <div style={{background:"var(--rdd)",border:"1px solid #ef444433",borderRadius:"var(--r)",padding:16}}>
          <p style={{fontWeight:700,color:"var(--rd)",fontSize:14,marginBottom:12}}>🚫 Permissão negada</p>
          <p style={{fontSize:13,color:"var(--t2)",marginBottom:10}}>Para liberar a câmera no Chrome:</p>
          <div style={{background:"var(--s2)",borderRadius:"var(--rs)",padding:12,display:"flex",flexDirection:"column",gap:6}}>
            <p style={{fontSize:12,color:"var(--t2)"}}>1️⃣ Toque no ícone 🔒 na barra de endereços</p>
            <p style={{fontSize:12,color:"var(--t2)"}}>2️⃣ Toque em <strong>"Permissões"</strong></p>
            <p style={{fontSize:12,color:"var(--t2)"}}>3️⃣ Ative <strong>"Câmera"</strong> → Permitir</p>
            <p style={{fontSize:12,color:"var(--t2)"}}>4️⃣ Recarregue a página</p>
          </div>
        </div>
      ) : (
        <div style={{background:"#f59e0b15",border:"1.5px solid #f59e0b44",borderRadius:"var(--r)",padding:16,textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:8}}>📷</div>
          <p style={{fontWeight:700,color:"var(--ac)",fontSize:14,marginBottom:4}}>Câmera não disponível</p>
          <p style={{fontSize:12,color:"var(--t2)"}}>{errDetalhe}</p>
        </div>
      )}
      <button className="btn bp blg" style={{width:"100%",justifyContent:"center"}} onClick={startCam}>
        🔄 Tentar Novamente
      </button>
      {/* Alternativa: upload de arquivo */}
      <div style={{borderTop:"1px solid var(--b1)",paddingTop:12}}>
        <p style={{fontSize:12,color:"var(--t3)",textAlign:"center",marginBottom:10}}>Ou envie uma foto da galeria:</p>
        <label style={{display:"block",cursor:"pointer"}}>
          <div className="uz" style={{padding:16}}>
            <Icon n="download"/>
            <p>Clique para escolher uma foto da galeria</p>
          </div>
          <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
            if(e.target.files[0]){
              const r=new FileReader();
              r.onload=ev=>{ const dataUrl=ev.target.result; setImg(dataUrl); setMode("preview"); onOCR(dataUrl); };
              r.readAsDataURL(e.target.files[0]);
            }
          }}/>
        </label>
      </div>
    </div>
  );

  // Estado inicial
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12,alignItems:"center",padding:"8px 0"}}>
      <canvas ref={canvasRef} style={{display:"none"}}/>
      <div style={{fontSize:56,marginBottom:4}}>📷</div>
      <p style={{color:"var(--t1)",fontWeight:600,fontSize:15}}>Fotografar Etiqueta</p>
      <p style={{textAlign:"center",fontSize:13,color:"var(--t2)",lineHeight:1.6}}>
        Ao clicar, permita o acesso à câmera. Depois da foto, a IA configurada tenta preencher os dados automaticamente. Revise tudo antes de salvar.
      </p>
      <p style={{textAlign:"center",fontSize:11,color:"var(--t3)",lineHeight:1.5}}>Com Ollama, a imagem é analisada localmente neste computador. Revise os dados sugeridos antes de salvar.</p>
      <button className="btn bp blg" style={{width:"100%",justifyContent:"center",marginTop:4}} onClick={startCam}>
        📷 Ativar Câmera
      </button>
    </div>
  );
};

// ─── NOVA ENCOMENDA ───────────────────────────────────────────────────────────
const NovaModal = ({ moradores, onSave, onClose, user }) => {
  const [step, setStep] = useState(1);
  const [inputMode, setInputMode] = useState("manual"); // foto | scanner | manual
  const [img, setImg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ocr, setOcr] = useState(null);
  const [sugs, setSugs] = useState([]);
  const [form, setForm] = useState({morador:"",apartamento:"",bloco:"",telefone:"",transportadora:"",rastreio:"",remetente:""});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState("");
  const fRef = useRef();
  const videoRef = useRef();
  const canvasRef = useRef();
  const streamRef = useRef();
  const animRef = useRef();

  const readImg = f => { const r=new FileReader(); r.onload=e=>setImg(e.target.result); r.readAsDataURL(f); };

  // Start camera for barcode scanning
  const startScanner = async () => {
    setScanError(""); setScanResult(null); setScanning(true);
    try {
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScanError("SEM_CAMERA"); setScanning(false); return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width:{ideal:1280}, height:{ideal:720} }
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(()=>{});
          scanFrame();
        }
      }));
    } catch(e) {
      const nome = e.name || "";
      if(nome === "NotAllowedError" || nome === "PermissionDeniedError") {
        setScanError("PERMISSAO_NEGADA");
      } else {
        setScanError("SEM_CAMERA");
      }
      setScanning(false);
    }
  };

  const stopScanner = () => {
    if(streamRef.current) { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
    if(animRef.current) { cancelAnimationFrame(animRef.current); animRef.current=null; }
    setScanning(false);
  };

  const scanFrame = () => {
    if(!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if(video.readyState !== video.HAVE_ENOUGH_DATA) { animRef.current=requestAnimationFrame(scanFrame); return; }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      // Try BarcodeDetector API (Chrome/Android)
      if("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["code_128","code_39","ean_13","ean_8","qr_code","data_matrix","pdf417"] });
        detector.detect(canvas).then(codes => {
          if(codes.length > 0) {
            const code = codes[0].rawValue;
            const labelImage = canvas.toDataURL("image/jpeg", 0.92);
            setScanResult(code);
            setForm(f=>({...f, rastreio: code}));
            setImg(labelImage);
            stopScanner();
            setStep(2);
            runOCR(labelImage);
            return;
          }
          animRef.current = requestAnimationFrame(scanFrame);
        }).catch(()=>{ animRef.current = requestAnimationFrame(scanFrame); });
      } else {
        // Fallback: read frame as image and send to Claude OCR
        animRef.current = requestAnimationFrame(scanFrame);
      }
    } catch { animRef.current = requestAnimationFrame(scanFrame); }
  };

  const scanManualConfirm = () => {
    if(!form.rastreio) return alert("Digite o código de barras.");
    setScanResult(form.rastreio);
    setStep(2);
  };

  const capturarEtiquetaScanner = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if(!video || !canvas || !video.videoWidth) return alert("Aguarde a câmera iniciar e enquadre a etiqueta inteira.");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const labelImage = canvas.toDataURL("image/jpeg", 0.92);
    setImg(labelImage);
    stopScanner();
    setStep(2);
    runOCR(labelImage);
  };

  useEffect(() => { return () => stopScanner(); }, []);

  const switchMode = (mode) => { stopScanner(); setInputMode(mode); setScanResult(null); setScanError(""); if(mode!=="infra") setForm(f=>({...f,rastreio:""})); };

  // Comprime a imagem antes de enviá-la ao Ollama local.
  const compressImg = (dataUrl, maxW=1024, quality=0.82) => new Promise(resolve => {
    const canvas = document.createElement("canvas");
    const image = new Image();
    image.onload = () => {
      let w = image.width, h = image.height;
      if(w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(image, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.src = dataUrl;
  });

  const runOCR = async (imageInput=img) => {
    if(!imageInput) return alert("Tire ou envie uma foto da etiqueta antes de ler com IA.");

    setLoading(true);
    try {
      // A imagem é processada pelo Ollama no próprio computador.
      const compressed = await compressImg(imageInput);
      const base64Data = compressed.split(",")[1];

      const prompt = `Analise esta etiqueta de encomenda brasileira e extraia os dados do DESTINATÁRIO.
Retorne SOMENTE este JSON sem markdown nem texto extra:
{"nome":"","apartamento":"","bloco":"","telefone":"","rastreio":"","transportadora":"","remetente":""}
Campos: nome do destinatário, apartamento, bloco, telefone, código de rastreio (ex: BR123456789BR), transportadora (Correios/Jadlog/Loggi/Shopee/etc), remetente (Amazon/Shein/etc).
Separe unidade e bloco: "BLOCO TESTE AP 999" significa bloco "TESTE" e apartamento "999". Rastreio deve conter apenas o código, sem a palavra RASTREIO. Se não visível deixe "". NÃO invente.`;

      const endpoint = getOllamaUrl().replace(/\/+$/, "") + "/api/chat";
      const res = await fetch(endpoint, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        signal:AbortSignal.timeout(180_000),
        body:JSON.stringify({
          model:getOllamaModel(),
          messages:[{role:"user",content:prompt,images:[base64Data]}],
          format:"json",
          think:false,
          stream:false,
          options:{temperature:0,num_ctx:2048,num_predict:400}
        })
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data?.error || `Ollama respondeu HTTP ${res.status}`);
      const txt = data.message?.content || "";
      if(!txt) throw new Error("Ollama não retornou texto. Confira se o modelo está instalado.");

      const clean = txt.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();

      // Parser robusto: tenta JSON completo, depois tenta reparar truncado
      let p = {};
      try {
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if(jsonMatch) p = JSON.parse(jsonMatch[0]);
        else throw new Error("sem JSON");
      } catch {
        // JSON truncado — extrai campos individualmente com regex
        const extract = (key) => {
          const m = clean.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)`));
          return m ? m[1].replace(/\\n/g," ").trim() : "";
        };
        p = {
          nome: extract("nome"),
          apartamento: extract("apartamento"),
          bloco: extract("bloco"),
          telefone: extract("telefone"),
          rastreio: extract("rastreio"),
          transportadora: extract("transportadora"),
          remetente: extract("remetente"),
        };
        if(!p.nome) throw new Error("Não foi possível extrair dados da etiqueta. Resposta: " + clean.slice(0,120));
      }

      setOcr(p);
      setForm(f=>({...f,...p,morador:p.nome||f.morador}));
      const sg = moradores.filter(m=>m.ativo).map(m=>{
        let sc=0;
        if(p.nome) sc+=simil(p.nome,m.nome)*60;
        if(p.apartamento&&m.apartamento===p.apartamento) sc+=25;
        if(p.bloco&&m.bloco===p.bloco) sc+=10;
        return {...m,score:Math.round(sc)};
      }).filter(m=>m.score>10).sort((a,b)=>b.score-a.score).slice(0,3);
      setSugs(sg);
      setStep(2);

    } catch(err) {
      console.error("OCR error:", err);
      const msg = err.message || "";
      if(msg.includes("Failed to fetch")||msg.includes("NetworkError")||msg.includes("fetch")||msg.includes("CORS")) {
        alert("❌ Não consegui conectar ao Ollama.\n\nAbra o Ollama neste computador e instale o modelo qwen3.5:2b. Depois, tente novamente. Se o site estiver publicado, ele ainda precisa estar aberto neste mesmo computador e o Ollama precisa permitir a origem do site.");
      } else if(err.name==="TimeoutError"||err.name==="AbortError") {
        alert("⌛ A leitura demorou mais de 3 minutos e foi interrompida. Confira se o Ollama está respondendo, se o computador tem memória suficiente e se o modelo escolhido é adequado para este aparelho.");
      } else if(msg.includes("not found")||msg.includes("pull model")||msg.includes("model")) {
        alert("❌ Modelo não encontrado no Ollama. Instale o qwen3.5:2b e tente de novo.\n\n" + msg);
      } else {
        alert("❌ Erro ao ler etiqueta: " + msg + "\n\nPreencha os dados manualmente.");
      }
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if(!form.morador) return alert("Informe o morador.");
    setSaving(true);
    const enc = {protocolo:makeProto(),morador:form.morador,apartamento:form.apartamento,bloco:form.bloco,telefone:form.telefone,transportadora:form.transportadora,rastreio:form.rastreio,remetente:form.remetente,status:"pendente",criado_por:user.nome,criado_em:new Date().toISOString(),retirado_em:null,retirado_por:null};
    try {
      const saved=await db.insert("encomendas",enc);
      if(!saved?.id) throw new Error("O banco não confirmou a gravação.");
      onSave(saved); setSaved(saved); setStep(3);
    } catch(e) { alert("A encomenda não foi registrada. Confira sua conexão e tente novamente.\n\n"+(e.message||"")); }
    finally {setSaving(false);}
  };

  const waMsg = saved?encodeURIComponent(`Olá, ${saved.morador}. Sua encomenda foi recebida na portaria do condomínio. Protocolo: ${saved.protocolo}.`):"";
  const waPhone = normalizeWhatsAppPhone(saved?.telefone);

  return (
    <div className="ov" onClick={onClose}>
      <div className="modal mw" onClick={e=>e.stopPropagation()}>
        <div className="mh"><h3>📦 Nova Encomenda{step===3?" — Notificação":""}</h3><button className="xb" onClick={onClose}><Icon n="x"/></button></div>
        <div className="mb">
          {step===1&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:14}}>
                <div className={`scan-tab${inputMode==="manual"?" on":""}`} onClick={()=>switchMode("manual")}>⌨️ Manual</div>
                <div className={`scan-tab${inputMode==="infra"?" on":""}`} onClick={()=>switchMode("infra")}>🔴 Infravermelho</div>
                <div className={`scan-tab${inputMode==="scanner"?" on":""}`} onClick={()=>switchMode("scanner")}>📡 Scanner Câmera</div>
                <div className={`scan-tab${inputMode==="foto"?" on":""}`} onClick={()=>switchMode("foto")}>📷 Câmera IA</div>
              </div>

              {inputMode==="foto"&&(
                <FotoCapture img={img} setImg={setImg} onOCR={runOCR} loading={loading}/>
              )}

              {inputMode==="infra"&&(
                <>
                  <div style={{textAlign:"center",padding:"12px 0 8px"}}>
                    <div style={{fontSize:40,marginBottom:10}}>🔴</div>
                    <p style={{color:"var(--t1)",fontSize:14,fontWeight:600,marginBottom:6}}>Scanner de Infravermelho / USB / Bluetooth</p>
                    <p style={{color:"var(--t2)",fontSize:12,marginBottom:16}}>Clique no campo abaixo e aponte o scanner para o código de barras da etiqueta. O código será lido automaticamente.</p>
                  </div>
                  <div className="f">
                    <label>AGUARDANDO LEITURA DO SCANNER...</label>
                    <input
                      className="inp"
                      value={form.rastreio||""}
                      onChange={e=>setForm({...form,rastreio:e.target.value})}
                      onKeyDown={e=>{
                        if(e.key==="Enter"&&form.rastreio){
                          setScanResult(form.rastreio);
                          setStep(2);
                        }
                      }}
                      placeholder="🔴 Aponte o scanner aqui..."
                      autoFocus
                      style={{fontSize:15,letterSpacing:1,textAlign:"center",borderColor:"var(--ac)",background:"var(--ad)"}}
                    />
                    <p style={{fontSize:11,color:"var(--t3)",marginTop:6,textAlign:"center"}}>O scanner vai preencher e pressionar Enter automaticamente</p>
                  </div>
                  {form.rastreio&&(
                    <div style={{background:"var(--gd)",border:"1px solid #10b98133",borderRadius:"var(--rs)",padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:18}}>✅</span>
                      <div>
                        <p style={{fontSize:12,color:"var(--gn)",fontWeight:600}}>Código lido!</p>
                        <code style={{fontSize:13,color:"var(--t1)"}}>{form.rastreio}</code>
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",gap:10}}>
                    <button className="btn bs" style={{flex:1}} onClick={()=>setForm({...form,rastreio:""})}>🗑️ Limpar</button>
                    <button className="btn bp" style={{flex:2}} onClick={()=>{if(!form.rastreio)return alert("Aponte o scanner para o código.");setScanResult(form.rastreio);setStep(2);}}>
                      Continuar →
                    </button>
                  </div>
                  <div style={{marginTop:16,background:"var(--s2)",border:"1px solid var(--b1)",borderRadius:"var(--rs)",padding:12}}>
                    <p style={{fontSize:11,color:"var(--t3)",fontWeight:600,marginBottom:6}}>💡 COMO USAR</p>
                    <p style={{fontSize:12,color:"var(--t2)"}}>1. Conecte o scanner via USB ou Bluetooth</p>
                    <p style={{fontSize:12,color:"var(--t2)"}}>2. Clique no campo acima para focar</p>
                    <p style={{fontSize:12,color:"var(--t2)"}}>3. Aponte o scanner para o código de barras</p>
                    <p style={{fontSize:12,color:"var(--t2)"}}>4. O scanner lê e avança automaticamente</p>
                  </div>
                </>
              )}

              {inputMode==="scanner"&&(
                <>
                  {/* ── ERRO: Permissão negada ── */}
                  {scanError==="PERMISSAO_NEGADA" && (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div style={{background:"var(--rdd)",border:"1px solid #ef444433",borderRadius:"var(--r)",padding:16}}>
                        <p style={{fontWeight:700,color:"var(--rd)",fontSize:14,marginBottom:10}}>🚫 Permissão de câmera negada</p>
                        <div style={{background:"var(--s2)",borderRadius:"var(--rs)",padding:12,display:"flex",flexDirection:"column",gap:5}}>
                          <p style={{fontSize:12,color:"var(--t2)"}}>1️⃣ Clique no ícone 🔒 na barra de endereços</p>
                          <p style={{fontSize:12,color:"var(--t2)"}}>2️⃣ Vá em <strong>"Permissões do site"</strong></p>
                          <p style={{fontSize:12,color:"var(--t2)"}}>3️⃣ Ative <strong>"Câmera"</strong> → Permitir</p>
                          <p style={{fontSize:12,color:"var(--t2)"}}>4️⃣ Recarregue a página e tente novamente</p>
                        </div>
                      </div>
                      <p style={{fontSize:12,color:"var(--t3)",textAlign:"center"}}>Ou use uma alternativa abaixo 👇</p>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <button className="btn bs" style={{justifyContent:"center",flexDirection:"column",padding:"14px 12px",gap:6,height:"auto"}}
                          onClick={()=>{setScanError("");setInputMode("leitor");}}>
                          <span style={{fontSize:22}}>🔌</span>
                          <span style={{fontSize:12}}>Scanner USB/BT</span>
                        </button>
                        <button className="btn bs" style={{justifyContent:"center",flexDirection:"column",padding:"14px 12px",gap:6,height:"auto"}}
                          onClick={()=>{setScanError("");setInputMode("manual");}}>
                          <span style={{fontSize:22}}>⌨️</span>
                          <span style={{fontSize:12}}>Digitar código</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── ERRO: Sem câmera / não suportado ── */}
                  {scanError==="SEM_CAMERA" && (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div style={{background:"#f59e0b15",border:"1.5px solid #f59e0b44",borderRadius:"var(--r)",padding:16,textAlign:"center"}}>
                        <div style={{fontSize:40,marginBottom:10}}>📷</div>
                        <p style={{fontWeight:700,color:"var(--ac)",fontSize:14,marginBottom:6}}>Câmera não disponível</p>
                        <p style={{fontSize:13,color:"var(--t2)"}}>Este dispositivo não tem câmera ou ela não foi reconhecida.</p>
                      </div>
                      <p style={{fontSize:12,color:"var(--t3)",textAlign:"center",fontWeight:600}}>Escolha uma alternativa:</p>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <button className="btn bs" style={{justifyContent:"center",flexDirection:"column",padding:"16px 12px",gap:8,height:"auto",border:"1.5px solid var(--b2)"}}
                          onClick={()=>{setScanError("");setInputMode("leitor");}}>
                          <span style={{fontSize:26}}>🔌</span>
                          <span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>Scanner USB/BT</span>
                          <span style={{fontSize:11,color:"var(--t3)",textAlign:"center"}}>Conecte um leitor físico</span>
                        </button>
                        <button className="btn bs" style={{justifyContent:"center",flexDirection:"column",padding:"16px 12px",gap:8,height:"auto",border:"1.5px solid var(--b2)"}}
                          onClick={()=>{setScanError("");setInputMode("manual");}}>
                          <span style={{fontSize:26}}>⌨️</span>
                          <span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>Digitar manualmente</span>
                          <span style={{fontSize:11,color:"var(--t3)",textAlign:"center"}}>Informe o código de rastreio</span>
                        </button>
                      </div>
                      <button className="btn bg2" style={{width:"100%",justifyContent:"center"}} onClick={()=>{setScanError("");startScanner();}}>
                        🔄 Tentar câmera novamente
                      </button>
                    </div>
                  )}

                  {/* ── Estado normal: pronto para escanear ── */}
                  {!scanError && !scanning && !scanResult && (
                    <div style={{textAlign:"center",padding:"24px 0"}}>
                      <div style={{fontSize:40,marginBottom:12}}>📡</div>
                      <p style={{color:"var(--t2)",fontSize:13,marginBottom:8}}>Aponte a câmera para o código de barras ou QR code da etiqueta. Ao detectar o código, o sistema tenta também ler os dados impressos com IA.</p>
                      <p style={{color:"var(--t3)",fontSize:11,lineHeight:1.5,marginBottom:16}}>Com Ollama, a imagem é analisada neste computador. Um leitor USB/Bluetooth lê somente o código de rastreio.</p>
                      <button className="btn bp blg" onClick={startScanner}><Icon n="camera"/> Ativar Scanner</button>
                    </div>
                  )}

                  {/* ── Câmera ativa ── */}
                  {!scanError && scanResult && <div className="scan-result">✅ Código lido: <strong>{scanResult}</strong></div>}
                  {!scanError && scanning&&(
                    <div className="scan-wrap">
                      <video ref={videoRef} className="scan-video" playsInline muted/>
                      <canvas ref={canvasRef} style={{display:"none"}}/>
                      <div className="scan-overlay">
                        <div className="scan-frame">
                          <div className="scan-line"/>
                          <div className="scan-corner tl"/><div className="scan-corner tr"/>
                          <div className="scan-corner bl"/><div className="scan-corner br"/>
                        </div>
                      </div>
                    </div>
                  )}
                  {!scanError && scanning&&<>
                    <button className="btn bp" style={{width:"100%",marginBottom:8,justifyContent:"center"}} onClick={capturarEtiquetaScanner}>
                      <Icon n="ai"/> Capturar etiqueta inteira e preencher com IA
                    </button>
                    <button className="btn bd" style={{width:"100%",marginBottom:10,justifyContent:"center"}} onClick={stopScanner}>✕ Parar Scanner</button>
                  </>}
                  {!scanError && scanResult&&(
                    <div style={{display:"flex",gap:10,marginTop:4}}>
                      <button className="btn bs" style={{flex:1}} onClick={()=>{setScanResult(null);startScanner();}}>Escanear novamente</button>
                      <button className="btn bp" style={{flex:1}} onClick={()=>setStep(2)}>Continuar →</button>
                    </div>
                  )}
                </>
              )}

              {inputMode==="manual"&&(
                <>
                  <div className="f"><label>MORADOR *</label>
                    <input className="inp" value={form.morador||""} onChange={e=>setForm({...form,morador:e.target.value})} placeholder="Nome completo do morador"/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    <div className="f"><label>BLOCO</label>
                      <input className="inp" value={form.bloco||""} onChange={e=>setForm({...form,bloco:e.target.value})} placeholder="A"/>
                    </div>
                    <div className="f"><label>APARTAMENTO</label>
                      <input className="inp" value={form.apartamento||""} onChange={e=>setForm({...form,apartamento:e.target.value})} placeholder="101"/>
                    </div>
                  </div>
                  <div className="f"><label>TELEFONE / WHATSAPP</label>
                    <input className="inp" value={form.telefone||""} onChange={e=>setForm({...form,telefone:e.target.value})} placeholder="11999990000"/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    <div className="f"><label>TRANSPORTADORA</label>
                      <select className="inp" value={form.transportadora||""} onChange={e=>setForm({...form,transportadora:e.target.value})}>
                        <option value="">Selecione...</option>
                        <option>Correios</option>
                        <option>Jadlog</option>
                        <option>Loggi</option>
                        <option>Total Express</option>
                        <option>Mercado Envios</option>
                        <option>Shopee Express</option>
                        <option>Amazon</option>
                        <option>Shein</option>
                        <option>Sequoia</option>
                        <option>Azul Cargo</option>
                        <option value="outro">Outra</option>
                      </select>
                    </div>
                    <div className="f"><label>REMETENTE</label>
                      <input className="inp" value={form.remetente||""} onChange={e=>setForm({...form,remetente:e.target.value})} placeholder="Amazon, Shein..."/>
                    </div>
                  </div>
                  <div className="f"><label>CÓDIGO DE RASTREIO</label>
                    <input className="inp" value={form.rastreio||""} onChange={e=>setForm({...form,rastreio:e.target.value})} placeholder="BR123456789BR"/>
                  </div>
                  <button className="btn bp blg" style={{width:"100%",justifyContent:"center"}}
                    onClick={()=>{if(!form.morador)return alert("Informe o nome do morador.");setStep(2);}}>
                    Revisar e Salvar →
                  </button>
                </>
              )}
            </>
          )}
          {step===2&&(
            <>
              {loading&&<div className="scan-result"><span className="spin"/> Lendo a etiqueta e preenchendo os dados…</div>}
              {!loading&&!ocr&&scanResult&&form.rastreio&&<div style={{background:"var(--bld)",border:"1px solid #3b82f633",borderRadius:"var(--rs)",padding:12,marginBottom:14,fontSize:12,color:"var(--t2)",lineHeight:1.6}}>O código de barras trouxe o rastreio. Para preencher também morador, unidade e remetente, fotografe a etiqueta inteira com a leitura por IA.</div>}
              {ocr&&(
                <div className="ocr">
                  <p style={{fontSize:11,color:"var(--t3)",marginBottom:8,fontWeight:600}}>✓ DADOS EXTRAÍDOS PELA IA — confirme ou corrija:</p>
                  {Object.entries(ocr).filter(([,v])=>v).map(([k,v])=>(
                    <div className="ocr-row" key={k}><span className="ocr-lbl">{k}</span><span className="ocr-val">{v}</span></div>
                  ))}
                </div>
              )}
              {sugs.length>0&&(
                <div className="aib">
                  <div className="aih"><Icon n="ai"/><span className="ait">IA · SUGESTÃO</span></div>
                  <p style={{fontSize:12,color:"var(--t3)",marginBottom:10}}>Moradores mais prováveis — clique para selecionar:</p>
                  {sugs.map(m=>(
                    <div key={m.id} className="ais" onClick={()=>setForm(f=>({...f,morador:m.nome,apartamento:m.apartamento,bloco:m.bloco,telefone:m.telefone}))}>
                      <div><strong>{m.nome}</strong><br/><span>Bl {m.bloco}/Ap {m.apartamento} · {m.telefone}</span></div>
                      <span className="aisc">{m.score}%</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="f"><label>MORADOR *</label><input className="inp" value={form.morador||""} onChange={e=>setForm({...form,morador:e.target.value})} placeholder="Nome do morador"/></div>
              <div className="r3">
                <div className="f"><label>BLOCO</label><input className="inp" value={form.bloco||""} onChange={e=>setForm({...form,bloco:e.target.value})} placeholder="A"/></div>
                <div className="f"><label>APARTAMENTO</label><input className="inp" value={form.apartamento||""} onChange={e=>setForm({...form,apartamento:e.target.value})} placeholder="101"/></div>
                <div className="f"><label>TELEFONE</label><input className="inp" value={form.telefone||""} onChange={e=>setForm({...form,telefone:e.target.value})} placeholder="11999990000"/></div>
              </div>
              <div className="r2">
                <div className="f"><label>TRANSPORTADORA</label><input className="inp" value={form.transportadora||""} onChange={e=>setForm({...form,transportadora:e.target.value})} placeholder="Correios"/></div>
                <div className="f"><label>RASTREIO</label><input className="inp" value={form.rastreio||""} onChange={e=>setForm({...form,rastreio:e.target.value})} placeholder="BR000000000BR"/></div>
              </div>
              <div className="f"><label>REMETENTE</label><input className="inp" value={form.remetente||""} onChange={e=>setForm({...form,remetente:e.target.value})} placeholder="Amazon, Shopee..."/></div>
            </>
          )}
          {step===3&&saved&&(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:48,marginBottom:16}}>✅</div>
              <h3 style={{color:"var(--gn)",marginBottom:8}}>Encomenda registrada{DB_OK?" no banco":""}!</h3>
              <div style={{background:"var(--s2)",border:"1px solid var(--b1)",borderRadius:"var(--rs)",padding:16,marginBottom:20}}>
                <p style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>PROTOCOLO</p>
                <p style={{fontFamily:"var(--fn2)",fontSize:20,fontWeight:700,color:"var(--ac)",letterSpacing:1}}>{saved.protocolo}</p>
              </div>
              <div className="notif">
                <p>📱 Mensagem pronta para WhatsApp:</p>
                <code>Olá, {saved.morador}. Sua encomenda foi recebida na portaria. Protocolo: {saved.protocolo}.</code>
                <div style={{display:"flex",gap:10}}>
                  {waPhone&&<a href={`https://wa.me/${waPhone}?text=${waMsg}`} target="_blank" rel="noreferrer" className="btn bgr" style={{flex:1,justifyContent:"center",textDecoration:"none"}}>
                    <Icon n="whatsapp"/> Abrir WhatsApp
                  </a>}
                  <button className="btn bg2" style={{flex:1}} onClick={onClose}>Fechar</button>
                </div>
              </div>
            </div>
          )}
        </div>
        {step!==3&&(
          <div className="mf">
            {step===2&&<button className="btn bg2" onClick={()=>setStep(1)}>← Voltar</button>}
            {step===1&&<button className="btn bg2" onClick={onClose}>Cancelar</button>}
            {step===2&&<button className="btn bp" onClick={handleSave} disabled={saving}>
              {saving?<><span className="spin"/> Salvando...</>:<><Icon n="check"/> Salvar Encomenda</>}
            </button>}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── PAGINAÇÃO ────────────────────────────────────────────────────────────────
const Pagination = ({ total, page, perPage, setPage, setPerPage }) => {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  // Gera botões de página inteligentes
  const getPages = () => {
    if (pages <= 7) return Array.from({length: pages}, (_, i) => i + 1);
    const arr = [1];
    if (page > 3) arr.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) arr.push(i);
    if (page < pages - 2) arr.push("...");
    arr.push(pages);
    return arr;
  };
  return (
    <div className="pgn">
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span className="pgn-info">Mostrando {from}–{to} de {total}</span>
        <select className="pgn-size" value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPage(1);}}>
          {[15,25,50,100].map(n=><option key={n} value={n}>{n} por página</option>)}
        </select>
      </div>
      <div className="pgn-btns">
        <button className="pgn-btn" disabled={page===1} onClick={()=>setPage(1)} title="Primeira">«</button>
        <button className="pgn-btn" disabled={page===1} onClick={()=>setPage(p=>p-1)} title="Anterior">‹</button>
        {getPages().map((p,i)=> p==="..."
          ? <span key={`e${i}`} style={{color:"var(--t3)",padding:"0 4px",fontSize:13}}>…</span>
          : <button key={p} className={`pgn-btn${page===p?" on":""}`} onClick={()=>setPage(p)}>{p}</button>
        )}
        <button className="pgn-btn" disabled={page===pages} onClick={()=>setPage(p=>p+1)} title="Próxima">›</button>
        <button className="pgn-btn" disabled={page===pages} onClick={()=>setPage(pages)} title="Última">»</button>
      </div>
    </div>
  );
};

// ─── ENCOMENDAS ───────────────────────────────────────────────────────────────
const DIAS_ARQUIVO_SUGERIDO = 15;

const Encomendas = ({ encomendas, setEncomendas, moradores, user, addLog }) => {
  const [showModal, setShowModal] = useState(false);
  const [srch, setSrch] = useState(""); const [fs, setFs] = useState(""); const [fb, setFb] = useState("");
  const [pg, setPg]     = useState(1);
  const [perPg, setPerPg] = useState(25);
  const [delId, setDelId]   = useState(null);
  const [showLimp, setShowLimp] = useState(false);

  const blocos   = [...new Set(encomendas.map(e=>e.bloco))].sort();
  const filtered = encomendas.filter(e=>
    (!srch||e.morador.toLowerCase().includes(srch.toLowerCase())||e.protocolo.toLowerCase().includes(srch.toLowerCase())||e.apartamento.includes(srch))&&
    (!fs||e.status===fs)&&(!fb||e.bloco===fb)
  ).sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em));

  useEffect(()=>setPg(1), [srch, fs, fb]);
  const pageData = filtered.slice((pg-1)*perPg, pg*perPg);

  const limite15  = new Date(Date.now() - DIAS_ARQUIVO_SUGERIDO * 86400000);
  const elegiveis = encomendas.filter(e => e.status==="retirada" && e.retirado_em && new Date(e.retirado_em) < limite15);
  const retiradas = encomendas.filter(e => e.status==="retirada");

  const handleSave = enc => {
    setEncomendas(p=>[enc,...p]);
    addLog({acao:"Encomenda criada",protocolo:enc.protocolo,usuario:user.nome,data:new Date().toISOString()});
    setPg(1);
  };

  const excluirUm = async (id) => {
    const enc = encomendas.find(e=>e.id===id);
    if(!enc)return;
    try {
      await db.delete("encomendas",id);
      setEncomendas(p=>p.map(e=>e.id===id?{...e,arquivado_em:new Date().toISOString()}:e));setDelId(null);
      await addLog({acao:"Encomenda arquivada",protocolo:enc.protocolo,usuario:user.nome,data:new Date().toISOString()});
    } catch(e) { alert("Não foi possível arquivar. O registro foi mantido na lista.\n\n"+(e.message||"Verifique a conexão e as permissões.")); }
  };

  const limparAntigas = async () => {
    const ids=elegiveis.map(e=>e.id);
    try {
      await db.deleteBatch("encomendas",ids);
      setEncomendas(p=>p.map(e=>ids.includes(e.id)?{...e,arquivado_em:new Date().toISOString()}:e));setShowLimp(false);
      await addLog({acao:`Encomendas arquivadas: ${elegiveis.length}`,protocolo:"—",usuario:user.nome,data:new Date().toISOString()});
    } catch(e) { alert("O arquivamento falhou e os registros foram mantidos.\n\n"+(e.message||"Verifique sua conexão.")); }
  };

  const limparTodas = async () => {
    const ids=retiradas.map(e=>e.id);
    try {
      await db.deleteBatch("encomendas",ids);
      setEncomendas(p=>p.map(e=>ids.includes(e.id)?{...e,arquivado_em:new Date().toISOString()}:e));setShowLimp(false);
      await addLog({acao:`Encomendas arquivadas: ${retiradas.length}`,protocolo:"—",usuario:user.nome,data:new Date().toISOString()});
    } catch(e) { alert("O arquivamento falhou e os registros foram mantidos.\n\n"+(e.message||"Verifique sua conexão.")); }
  };

  return (
    <div>
      <Banner/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,gap:10,flexWrap:"wrap"}}>
        <button className="btn bs" onClick={()=>setShowLimp(true)} style={{position:"relative"}}>
          🗃️ Gerenciar arquivo
          {elegiveis.length>0 && <span style={{position:"absolute",top:-6,right:-6,background:"var(--rd)",color:"#fff",borderRadius:"99px",fontSize:10,fontWeight:700,padding:"2px 6px"}}>{elegiveis.length}</span>}
        </button>
        <button className="btn bp blg" onClick={()=>setShowModal(true)}><Icon n="plus"/> Nova Encomenda</button>
      </div>
      <div className="sbar">
        <div className="sw" style={{flex:2}}><Icon n="search"/><input className="inp" placeholder="Morador, protocolo, apartamento..." value={srch} onChange={e=>setSrch(e.target.value)}/></div>
        <select className="inp" style={{width:160}} value={fs} onChange={e=>setFs(e.target.value)}>
          <option value="">Todos os status</option><option value="pendente">Pendente</option><option value="retirada">Retirada</option>
        </select>
        <select className="inp" style={{width:140}} value={fb} onChange={e=>setFb(e.target.value)}>
          <option value="">Todos os blocos</option>{blocos.map(b=><option key={b}>{b}</option>)}
        </select>
      </div>
      <div className="card">
        <div className="ch">
          <h3>Encomendas ({filtered.length})</h3>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
          </div>
        </div>
        <div className="tw"><table>
          <thead><tr><th>Protocolo</th><th>Morador</th><th>Transportadora</th><th>Rastreio</th><th>Status</th><th>Recebida</th><th></th></tr></thead>
          <tbody>
            {pageData.length===0 && <tr><td colSpan={7}><div className="empty"><Icon n="package"/><p>Nenhuma encomenda</p></div></td></tr>}
            {pageData.map(e => {
              const diasRet = e.retirado_em ? getDias(e.retirado_em) : null;
              const expirado = diasRet !== null && diasRet >= DIAS_ARQUIVO_SUGERIDO;
              return (
                <tr key={e.id} style={expirado?{opacity:0.55}:{}}>
                  <td><code style={{fontSize:11,color:"var(--t3)"}}>{e.protocolo}</code></td>
                  <td><strong>{e.morador}</strong><br/><span style={{fontSize:11,color:"var(--t3)"}}>Bl {e.bloco} / Ap {e.apartamento}</span></td>
                  <td>{e.transportadora||"—"}</td>
                  <td><code style={{fontSize:11,color:"var(--bl)"}}>{e.rastreio||"—"}</code></td>
                  <td>
                    <span className={`badge ${e.status==="pendente"?"by":"bg"}`}>{e.status==="pendente"?"⏳ Pendente":"✓ Retirada"}</span>
                    {expirado && <><br/><span style={{fontSize:10,color:"var(--t3)",fontWeight:600}}>🗃️ {diasRet}d — pode arquivar</span></>}
                  </td>
                  <td style={{fontSize:11}}>{fmtDate(e.criado_em)}<br/><span style={{color:"var(--t3)"}}>{e.criado_por}</span></td>
                  <td><button className="btn bd bsm" title="Arquivar" onClick={()=>setDelId(e.id)}><Icon n="trash"/></button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <Pagination total={filtered.length} page={pg} perPage={perPg} setPage={setPg} setPerPage={setPerPg}/>
      </div>
      {showModal && <NovaModal moradores={moradores} onSave={handleSave} onClose={()=>setShowModal(false)} user={user}/>}
      {delId && (
        <div className="ov" onClick={()=>setDelId(null)}>
          <div className="modal" style={{maxWidth:340}} onClick={e=>e.stopPropagation()}>
            <div className="mb" style={{textAlign:"center",padding:32}}>
              <div style={{fontSize:36,marginBottom:12}}>🗑️</div>
              <h3 style={{marginBottom:8}}>Arquivar encomenda?</h3>
              <code style={{fontSize:11,color:"var(--t3)",display:"block",marginBottom:8}}>{encomendas.find(e=>e.id===delId)?.protocolo}</code>
              <p style={{color:"var(--t3)",fontSize:13,marginBottom:24}}>Ela sai da lista ativa e permanece no histórico do condomínio.</p>
              <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                <button className="btn bg2" onClick={()=>setDelId(null)}>Cancelar</button>
                <button className="btn bp" onClick={()=>excluirUm(delId)}>Arquivar encomenda</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showLimp && (
        <div className="ov" onClick={()=>setShowLimp(false)}>
          <div className="modal" style={{maxWidth:480}} onClick={e=>e.stopPropagation()}>
            <div className="mh"><h3>🗃️ Arquivar encomendas</h3><button className="xb" onClick={()=>setShowLimp(false)}><Icon n="x"/></button></div>
            <div className="mb">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
                {[
                  {label:"Total no sistema",val:encomendas.length,color:"var(--bl)"},
                  {label:"Retiradas",val:retiradas.length,color:"var(--gn)"},
                  {label:`+${DIAS_ARQUIVO_SUGERIDO}d elegíveis`,val:elegiveis.length,color:"var(--rd)"},
                ].map(s=>(
                  <div key={s.label} style={{background:"var(--s2)",borderRadius:"var(--rs)",padding:12,textAlign:"center",border:"1px solid var(--b1)"}}>
                    <p style={{fontSize:22,fontWeight:700,fontFamily:"var(--fn2)",color:s.color}}>{s.val}</p>
                    <p style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{s.label}</p>
                  </div>
                ))}
              </div>
              <div style={{background:"var(--gd)",border:"1px solid #10b98133",borderRadius:"var(--rs)",padding:14,marginBottom:12,fontSize:13,color:"var(--gn)"}}>
                <p style={{fontWeight:700,marginBottom:4}}>Retenção controlada</p>
                <p>Encomendas retiradas há mais de <strong>{DIAS_ARQUIVO_SUGERIDO} dias</strong> podem ser arquivadas manualmente. Nenhum registro é excluído automaticamente.</p>
              </div>
              <div style={{background:"var(--s2)",border:"1px solid var(--b1)",borderRadius:"var(--rs)",padding:14,marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <p style={{fontWeight:600,fontSize:13,color:"var(--t1)"}}>Arquivar retiradas com +{DIAS_ARQUIVO_SUGERIDO} dias</p>
                    <p style={{fontSize:12,color:"var(--t3)",marginTop:2}}>{elegiveis.length} encomendas elegíveis</p>
                  </div>
                  <button className="btn bs" disabled={elegiveis.length===0} onClick={limparAntigas}>Arquivar ({elegiveis.length})</button>
                </div>
              </div>
              <div style={{background:"var(--rdd)",border:"1px solid #ef444433",borderRadius:"var(--rs)",padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <p style={{fontWeight:600,fontSize:13,color:"var(--rd)"}}>Arquivar todas as retiradas</p>
                    <p style={{fontSize:12,color:"var(--t3)",marginTop:2}}>{retiradas.length} encomendas · mantidas no histórico</p>
                  </div>
                  <button className="btn bd" disabled={retiradas.length===0} onClick={limparTodas}>Arquivar tudo ({retiradas.length})</button>
                </div>
              </div>
            </div>
            <div className="mf"><button className="btn bg2" onClick={()=>setShowLimp(false)}>Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── RETIRADA ─────────────────────────────────────────────────────────────────
const Retirada = ({ encomendas, setEncomendas, user, addLog }) => {
  const [srch, setSrch] = useState("");
  const [searchMode, setSearchMode] = useState("nome"); // "nome" | "protocolo"
  const [sel, setSel] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [protocoloInput, setProtocoloInput] = useState("");
  const [protocoloErr, setProtocoloErr] = useState("");
  const srchRef = useRef();
  const fRef = useRef();

  const pend = encomendas.filter(e => {
    if (e.status !== "pendente") return false;
    if (!srch) return true;
    const q = srch.toLowerCase();
    if (searchMode === "protocolo") return e.protocolo.toLowerCase().includes(q);
    return e.morador.toLowerCase().includes(q) || e.apartamento.includes(q) || e.bloco.toLowerCase().includes(q);
  });

  const buscarPorProtocolo = () => {
    const p = protocoloInput.trim().toUpperCase();
    if (!p) { setProtocoloErr("Digite o protocolo ou código de rastreio."); return; }
    const enc = encomendas.find(e => e.status === "pendente" &&
      (e.protocolo.toUpperCase() === p || (e.rastreio && e.rastreio.toUpperCase() === p))
    );
    if (enc) { setProtocoloErr(""); setSel(enc); }
    else { setProtocoloErr(`Nenhuma encomenda pendente com protocolo "${p}"`); }
  };

  const confirm = async () => {
    if(!photo) return alert("Foto de retirada obrigatória.");
    setSaving(true);
    const now=new Date().toISOString();
    let objectPath="";
    try {
      const image=await new Promise((resolve,reject)=>{
        const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error("A foto não pôde ser processada."));im.src=photo;
      });
      const scale=Math.min(1,1440/Math.max(image.width,image.height));
      const canvas=document.createElement("canvas");canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
      canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.72));
      if(!blob)throw new Error("Não foi possível comprimir a foto.");
      objectPath=`${ACTIVE_TENANT_ID}/${sel.id}/${crypto.randomUUID()}.jpg`;
      const {error:uploadError}=await supabaseClient.storage.from("portaria-comprovantes").upload(objectPath,blob,{contentType:"image/jpeg",upsert:false});
      if(uploadError)throw uploadError;
      const upd={status:"retirada",retirado_em:now,retirado_por:user.nome,comprovante_path:objectPath};
      await db.update("encomendas",sel.id,upd);
      setEncomendas(p=>p.map(e=>e.id===sel.id?{...e,...upd}:e));
      await addLog({acao:"Retirada confirmada",protocolo:sel.protocolo,usuario:user.nome,data:now});
      setDone(true);
    } catch(e) {
      if(objectPath) await supabaseClient.storage.from("portaria-comprovantes").remove([objectPath]).catch(()=>{});
      alert("A retirada não foi confirmada. A encomenda continua pendente.\n\n"+(e.message||"Verifique a conexão e tente novamente."));
    } finally {setSaving(false);}
  };

  const reset = () => { setSel(null); setPhoto(null); setDone(false); setProtocoloInput(""); setProtocoloErr(""); };

  return (
    <div>
      <Banner/>
      {/* PAINEL DE BUSCA */}
      <div style={{background:"var(--sf)",border:"1px solid var(--b1)",borderRadius:"var(--r)",padding:20,marginBottom:20}}>
        <p style={{fontSize:13,color:"var(--t2)",marginBottom:14,fontWeight:600}}>Buscar encomenda pendente</p>
        {/* Abas de modo */}
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[{k:"nome",l:"🔍 Por nome / apartamento"},{k:"protocolo",l:"📋 Por protocolo / rastreio"}].map(m=>(
            <button key={m.k}
              className={`scan-tab${searchMode===m.k?" on":""}`}
              onClick={()=>{setSearchMode(m.k);setSrch("");setProtocoloInput("");setProtocoloErr("");}}
            >{m.l}</button>
          ))}
        </div>

        {searchMode==="nome" && (
          <div className="sw">
            <Icon n="search"/>
            <input ref={srchRef} className="inp" style={{fontSize:15}} placeholder="Nome, bloco ou apartamento..." value={srch} onChange={e=>setSrch(e.target.value)}/>
          </div>
        )}

        {searchMode==="protocolo" && (
          <div>
            <div style={{display:"flex",gap:10}}>
              <input
                className="inp"
                style={{fontSize:15,flex:1,letterSpacing:1,fontFamily:"monospace",borderColor: protocoloErr?"var(--rd)":"var(--b2)"}}
                placeholder="PX-2025-0601-1234 ou BR123456789BR"
                value={protocoloInput}
                onChange={e=>{setProtocoloInput(e.target.value);setProtocoloErr("");}}
                onKeyDown={e=>e.key==="Enter"&&buscarPorProtocolo()}
                autoFocus
              />
              <button className="btn bp" onClick={buscarPorProtocolo} style={{flexShrink:0}}>
                <Icon n="search"/> Buscar
              </button>
            </div>
            {protocoloErr && (
              <p style={{color:"var(--rd)",fontSize:12,marginTop:8,display:"flex",alignItems:"center",gap:6}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:14,height:14,flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {protocoloErr}
              </p>
            )}
            <p style={{fontSize:11,color:"var(--t3)",marginTop:8}}>💡 Aceita o protocolo interno (PX-…) ou o código de rastreio da transportadora</p>
          </div>
        )}
      </div>

      {/* TABELA DE RESULTADOS (apenas no modo nome) */}
      {searchMode === "nome" && (
        <div className="card">
          <div className="ch"><h3>Pendentes {srch ? `para "${srch}"` : ""} ({pend.length})</h3></div>
          <div className="tw"><table>
            <thead><tr><th>Morador</th><th>Protocolo</th><th>Bloco/Ap</th><th>Transportadora</th><th>Recebida</th><th>Ação</th></tr></thead>
            <tbody>
              {pend.length===0&&<tr><td colSpan={6}><div className="empty"><Icon n="check"/><p>{srch?"Nenhum resultado":"Nenhuma encomenda pendente 🎉"}</p></div></td></tr>}
              {pend.map(e=>(
                <tr key={e.id}>
                  <td><strong>{e.morador}</strong></td>
                  <td><code style={{fontSize:11,color:"var(--t3)"}}>{e.protocolo}</code></td>
                  <td>Bl <strong>{e.bloco}</strong> / Ap <strong>{e.apartamento}</strong></td>
                  <td>{e.transportadora||"—"}</td>
                  <td style={{fontSize:11}}>{fmtDate(e.criado_em)}</td>
                  <td><button className="btn bgr" onClick={()=>setSel(e)}><Icon n="check"/> Confirmar Retirada</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* MODAL CONFIRMAÇÃO */}
      {sel&&(
        <div className="ov" onClick={reset}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="mh"><h3>Confirmar Retirada</h3><button className="xb" onClick={reset}><Icon n="x"/></button></div>
            <div className="mb">
              {!done?(
                <>
                  <div style={{background:"var(--s2)",border:"1px solid var(--b1)",borderRadius:"var(--rs)",padding:14,marginBottom:16}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <div>
                        <p style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>PROTOCOLO</p>
                        <p style={{fontFamily:"var(--fn2)",fontSize:16,fontWeight:700,color:"var(--ac)"}}>{sel.protocolo}</p>
                      </div>
                      <div>
                        <p style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>MORADOR</p>
                        <p style={{fontSize:14,fontWeight:600}}>{sel.morador}</p>
                        <p style={{fontSize:12,color:"var(--t3)"}}>Bl {sel.bloco} / Ap {sel.apartamento}</p>
                      </div>
                    </div>
                    {sel.transportadora && <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--b1)"}}>
                      <p style={{fontSize:11,color:"var(--t3)"}}>TRANSPORTADORA: <strong style={{color:"var(--t2)"}}>{sel.transportadora}</strong>
                      {sel.rastreio && <> · RASTREIO: <code style={{color:"var(--bl)",fontSize:11}}>{sel.rastreio}</code></>}</p>
                    </div>}
                  </div>
                  <div className="f">
                    <label>FOTO DE RETIRADA *</label>
                    <div className="uz" onClick={()=>fRef.current?.click()}>
                      <Icon n="camera"/><p>Foto de quem está retirando a encomenda</p>
                      <input ref={fRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){const r=new FileReader();r.onload=ev=>setPhoto(ev.target.result);r.readAsDataURL(e.target.files[0])}}}/>
                    </div>
                    {photo&&<img src={photo} className="prev" alt="foto"/>}
                  </div>
                </>
              ):(
                <div style={{textAlign:"center",padding:20}}>
                  <div style={{fontSize:48,marginBottom:16}}>✅</div>
                  <h3 style={{color:"var(--gn)",marginBottom:8}}>Retirada confirmada{DB_OK?" no banco":""}!</h3>
                  <p style={{color:"var(--t3)",fontSize:13}}>Registrado por <strong>{user.nome}</strong></p>
                  <button className="btn bg2" style={{marginTop:20}} onClick={reset}>Fechar</button>
                </div>
              )}
            </div>
            {!done&&<div className="mf">
              <button className="btn bg2" onClick={reset}>Cancelar</button>
              <button className="btn bgr blg" onClick={confirm} disabled={saving}>
                {saving?<><span className="spin"/> Salvando...</>:<><Icon n="check"/> Confirmar Retirada</>}
              </button>
            </div>}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── RELATÓRIOS ───────────────────────────────────────────────────────────────
const Relatorios = ({ encomendas, user }) => {
  const [comprovante,setComprovante]=useState(null);
  const abrirComprovante=async enc=>{
    try {
      const {data,error}=await supabaseClient.storage.from("portaria-comprovantes").createSignedUrl(enc.comprovante_path,60);
      if(error)throw error;
      setComprovante({url:data.signedUrl,protocolo:enc.protocolo});
    } catch(e) { alert("Não foi possível abrir o comprovante. "+(e.message||"Tente novamente.")); }
  };
  const readonly = isReadonly(user.perfil, "relatorios");
  const [fs,setFs]=useState(""); const [fb,setFb]=useState(""); const [fm,setFm]=useState(""); const [di,setDi]=useState(""); const [df,setDf]=useState("");
  const blocos=[...new Set(encomendas.map(e=>e.bloco))].sort();
  const list=encomendas.filter(e=>{
    if(fs&&e.status!==fs) return false;
    if(fb&&e.bloco!==fb) return false;
    if(fm&&!e.morador.toLowerCase().includes(fm.toLowerCase())) return false;
    if(di&&new Date(e.criado_em)<new Date(di)) return false;
    if(df&&new Date(e.criado_em)>new Date(df+"T23:59:59")) return false;
    return true;
  }).sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em));
  return (
    <div>
      <div className="card" style={{marginBottom:20}}>
        <div className="ch"><h3>Filtros</h3></div>
        <div style={{padding:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:14}}>
          <div className="f"><label>STATUS</label><select className="inp" value={fs} onChange={e=>setFs(e.target.value)}><option value="">Todos</option><option value="pendente">Pendente</option><option value="retirada">Retirada</option></select></div>
          <div className="f"><label>BLOCO</label><select className="inp" value={fb} onChange={e=>setFb(e.target.value)}><option value="">Todos</option>{blocos.map(b=><option key={b}>{b}</option>)}</select></div>
          <div className="f"><label>MORADOR</label><input className="inp" value={fm} onChange={e=>setFm(e.target.value)} placeholder="Filtrar..."/></div>
          <div className="f"><label>DATA INÍCIO</label><input className="inp" type="date" value={di} onChange={e=>setDi(e.target.value)}/></div>
          <div className="f"><label>DATA FIM</label><input className="inp" type="date" value={df} onChange={e=>setDf(e.target.value)}/></div>
        </div>
      </div>
      <div className="card">
        <div className="ch">
          <div><h3>Histórico</h3><p>{list.length} registros · inclui arquivadas</p></div>
          {!readonly && <button className="btn bs" onClick={()=>doExport(list.map(e=>({Protocolo:e.protocolo,Morador:e.morador,Bloco:e.bloco,Ap:e.apartamento,Transportadora:e.transportadora||"",Status:e.status,Arquivada:e.arquivado_em?"Sim":"Não",Recebida:fmtDate(e.criado_em),Retirada:fmtDate(e.retirado_em)})),"relatorio.csv")}>
            <Icon n="download"/> Exportar CSV
          </button>}
        </div>
        <div className="tw"><table>
          <thead><tr><th>Protocolo</th><th>Morador</th><th>Bloco/Ap</th><th>Transportadora</th><th>Status</th><th>Recebida</th><th>Retirada</th></tr></thead>
          <tbody>
            {list.length===0&&<tr><td colSpan={7}><div className="empty"><Icon n="report"/><p>Sem registros</p></div></td></tr>}
            {list.map(e=>(
              <tr key={e.id}>
                <td><code style={{fontSize:11,color:"var(--t3)"}}>{e.protocolo}</code></td>
                <td><strong>{e.morador}</strong>{e.arquivado_em&&<><br/><span className="badge bb">Arquivada</span></>}</td>
                <td>Bl {e.bloco}/Ap {e.apartamento}</td>
                <td>{e.transportadora||"—"}</td>
                <td><span className={`badge ${e.status==="pendente"?"by":"bg"}`}>{e.status==="pendente"?"⏳ Pendente":"✓ Retirada"}</span></td>
                <td style={{fontSize:11}}>{fmtDate(e.criado_em)}</td>
                <td style={{fontSize:11}}>{fmtDate(e.retirado_em)}{e.retirado_por&&<><br/><span style={{color:"var(--t3)"}}>{e.retirado_por}</span></>}{e.comprovante_path&&<><br/><button className="btn bs" onClick={()=>abrirComprovante(e)}>Ver comprovante</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      {comprovante&&<div className="ov" onClick={()=>setComprovante(null)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="mh"><h3>Comprovante {comprovante.protocolo}</h3><button className="btn bs" onClick={()=>setComprovante(null)}>Fechar</button></div><div className="mb"><img src={comprovante.url} alt="Comprovante de retirada" style={{maxWidth:"100%"}}/><p>Visualização privada temporária. O link expira em 1 minuto.</p></div></div></div>}
    </div>
  );
};

// ─── LOGS ─────────────────────────────────────────────────────────────────────
const Logs = ({ logs }) => (
  <div className="card">
    <div className="ch"><h3>Logs de Auditoria</h3><p>{logs.length} registros</p></div>
    <div className="tw"><table>
      <thead><tr><th>#</th><th>Ação</th><th>Protocolo</th><th>Usuário</th><th>Data/Hora</th></tr></thead>
      <tbody>
        {logs.length===0&&<tr><td colSpan={5}><div className="empty"><Icon n="log"/><p>Nenhum log</p></div></td></tr>}
        {[...logs].reverse().map((l,i)=>(
          <tr key={l.id||i}>
            <td style={{color:"var(--t3)",fontSize:11}}>{logs.length-i}</td>
            <td><span className="badge bb">{l.acao}</span></td>
            <td><code style={{fontSize:11,color:"var(--t3)"}}>{l.protocolo}</code></td>
            <td><strong>{l.usuario}</strong></td>
            <td style={{fontSize:11}}>{fmtDate(l.data)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  </div>
);

// ─── CONFIGURAÇÕES ────────────────────────────────────────────────────────────
const Configuracoes = () => {
  const [ollamaModel, setOllamaModel] = useState(getOllamaModel);
  const [ollamaUrl, setOllamaUrl] = useState(getOllamaUrl);
  const [saved, setSaved] = useState(false);
  const [legacyKeyPresent, setLegacyKeyPresent] = useState(() => {
    try { return !!localStorage.getItem("px_anthropic_key"); } catch { return false; }
  });

  const salvar = () => {
    try {
      localStorage.setItem("px_ollama_model", ollamaModel.trim() || "qwen3.5:2b");
      localStorage.setItem("px_ollama_url", ollamaUrl.trim() || "http://localhost:11434");
      setSaved(true); setTimeout(()=>setSaved(false), 2500);
    } catch {
      setSaved(false);
      alert("Não foi possível salvar as configurações neste navegador.");
    }
  };
  const removerChaveAntiga = () => {
    try {
      localStorage.removeItem("px_anthropic_key");
      localStorage.removeItem("px_ia_provider");
      setLegacyKeyPresent(false);
    } catch {
      alert("Não foi possível apagar a chave antiga deste navegador.");
    }
  };

  return (
    <div>
      <div className="card" style={{marginBottom:20}}>
        <div className="ch">
          <div>
            <h3>🤖 Inteligência Artificial — Leitura de Etiqueta</h3>
            <p>Ollama local com Qwen 3.5, sem chave de API</p>
          </div>
          <span className="badge bg">✓ Ollama local</span>
        </div>
        <div style={{padding:20}}>
          {legacyKeyPresent&&<div role="alert" style={{marginBottom:18,background:"#f59e0b0d",border:"1px solid #f59e0b55",borderRadius:"var(--rs)",padding:12,fontSize:12,color:"var(--t2)",lineHeight:1.6}}>
            Uma versão antiga salvava uma chave externa neste navegador. Esta versão não a utiliza. <button className="btn bd bsm" style={{marginLeft:8}} onClick={removerChaveAntiga}>Apagar chave antiga deste navegador</button>
          </div>}
          <div className="f">
            <label>MODELO INSTALADO NO OLLAMA</label>
            <input className="inp" value={ollamaModel} onChange={e=>{setOllamaModel(e.target.value);setSaved(false);}} placeholder="qwen3.5:2b"/>
            <p style={{fontSize:11,color:"var(--t3)",marginTop:6}}>Recomendado para começar: qwen3.5:2b. Instale o mesmo nome no Ollama.</p>
          </div>
          <div className="f">
            <label>ENDEREÇO DO OLLAMA NESTE COMPUTADOR</label>
            <input className="inp" value={ollamaUrl} onChange={e=>{setOllamaUrl(e.target.value);setSaved(false);}} placeholder="http://localhost:11434"/>
          </div>
          <div style={{margin:"16px 0",background:"#10b9810d",border:"1px solid #10b98133",borderRadius:"var(--rs)",padding:12,fontSize:12,color:"var(--t2)",lineHeight:1.6}}>
            <strong style={{color:"var(--gn)"}}>✅ Sem token e sem cobrança por consulta.</strong><br/>
            1. <a href="https://ollama.com/download" target="_blank" rel="noreferrer" style={{color:"var(--ac)"}}>Instale o Ollama</a> neste computador.<br/>
            2. Instale o modelo <code>qwen3.5:2b</code> e mantenha o Ollama aberto.<br/>
            3. No site publicado, permita no Ollama a origem HTTPS do site.<br/>
            As fotos da etiqueta são enviadas ao serviço Ollama configurado; use um endereço local e confiável.
          </div>
          <button className="btn bp" onClick={salvar}>{saved?"✅ Configuração salva":"💾 Salvar configuração"}</button>
        </div>
      </div>
    </div>
  );
};

// ─── APP ──────────────────────────────────────────────────────────────────────
// ─── USUÁRIOS ─────────────────────────────────────────────────────────────────
const Usuarios = ({condominioId,currentUserId}) => {
  const [membros,setMembros]=useState([]);
  const [email,setEmail]=useState("");
  const [emailConvidado,setEmailConvidado]=useState("");
  const [perfil,setPerfil]=useState("porteiro");
  const [convite,setConvite]=useState("");
  const [erro,setErro]=useState("");
  const [loading,setLoading]=useState(false);
  const carregar=async()=>{
    const {data,error}=await supabaseClient.from("portaria_membros").select("id,nome,perfil,criado_em,usuario_id").eq("condominio_id",condominioId).order("criado_em");
    if(error) setErro(error.message); else {setMembros(data||[]);setErro("");}
  };
  useEffect(()=>{carregar();},[condominioId]);
  const criarConvite=async()=>{
    if(!email.trim()) return setErro("Informe o e-mail da pessoa que será convidada.");
    setLoading(true);setErro("");
    try {
      const {data,error}=await supabaseClient.rpc("portaria_criar_convite",{p_condominio:condominioId,p_email:email.trim(),p_perfil:perfil});
      if(error) throw error;
      setConvite(data);setEmailConvidado(email.trim());setEmail("");
    } catch(e) {setErro(e.message||"Não foi possível gerar o convite.");}
    finally {setLoading(false);}
  };
  const remover=async membro=>{
    if(!window.confirm(`Remover o acesso de ${membro.nome}?`)) return;
    const {error}=await supabaseClient.from("portaria_membros").delete().eq("id",membro.id).eq("condominio_id",condominioId);
    if(error) setErro(error.message); else carregar();
  };
  return <div>
    <div className="card" style={{padding:20,marginBottom:16}}>
      <h3 style={{marginBottom:8}}>Convidar alguém para este condomínio</h3>
      <p style={{fontSize:12,color:"var(--t2)",lineHeight:1.6,marginBottom:14}}>O convite fica vinculado ao e-mail informado e vence em sete dias. Envie o código à pessoa por um canal privado.</p>
      <div className="r2">
        <div className="f"><label>E-MAIL</label><input className="inp" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="porteiro@exemplo.com"/></div>
        <div className="f"><label>PERFIL</label><select className="inp" value={perfil} onChange={e=>setPerfil(e.target.value)}><option value="porteiro">Porteiro</option><option value="admin">Administrador</option></select></div>
      </div>
      <button className="btn bp" disabled={loading} onClick={criarConvite}>{loading?"Gerando...":"Gerar convite seguro"}</button>
      {convite&&<div style={{marginTop:14,padding:14,background:"var(--s2)",borderRadius:"var(--rs)"}}><p style={{fontSize:12,marginBottom:8}}>Código de uso único para {emailConvidado}:</p><code style={{wordBreak:"break-all",color:"var(--ac)"}}>{convite}</code><button className="btn bs bsm" style={{marginLeft:10}} onClick={()=>navigator.clipboard?.writeText(convite)}>Copiar</button></div>}
      {erro&&<p style={{color:"var(--rd)",fontSize:12,marginTop:12}}>{erro}</p>}
    </div>
    <div className="card"><div className="ch"><div><h3>Acessos do condomínio</h3><p>{membros.length} membro(s)</p></div><button className="btn bs bsm" onClick={carregar}>Atualizar</button></div>
      <div className="tw"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Acesso</th></tr></thead><tbody>
        {membros.map(m=><tr key={m.id}><td><strong>{m.nome}{m.usuario_id===currentUserId?" (você)":""}</strong></td><td><span className={`badge ${m.perfil==="admin"?"by":"bb"}`}>{m.perfil==="admin"?"Administrador":"Porteiro"}</span></td><td>{m.usuario_id!==currentUserId&&<button className="btn bd bsm" onClick={()=>remover(m)}>Remover acesso</button>}</td></tr>)}
        {!membros.length&&<tr><td colSpan={3}><div className="empty"><Icon n="users"/><p>Nenhum membro cadastrado</p></div></td></tr>}
      </tbody></table></div>
    </div>
  </div>;
};
const Notificacoes = ({ encomendas, moradores }) => {
  const [busca, setBusca] = useState("");
  const [enviados, setEnviados] = useState({});
  const [msgCustom, setMsgCustom] = useState(null); // {enc, texto}

  const pendentes = encomendas.filter(e => e.status === "pendente" &&
    (!busca || e.morador.toLowerCase().includes(busca.toLowerCase()) ||
     e.apartamento.includes(busca) || e.bloco.toLowerCase().includes(busca.toLowerCase()))
  ).sort((a,b) => new Date(a.criado_em)-new Date(b.criado_em));

  const getMorador = (enc) => moradores.find(m =>
    m.nome.toLowerCase() === enc.morador.toLowerCase() ||
    (m.apartamento === enc.apartamento && m.bloco === enc.bloco)
  );

  const msgPadrao = (enc) =>
    `Olá, ${enc.morador.split(" ")[0]}! 📦

Sua encomenda chegou na portaria do condomínio.

Protocolo: *${enc.protocolo}*
Transportadora: ${enc.transportadora||"—"}
Rastreio: ${enc.rastreio||"—"}

Por favor, retire em horário comercial.

_Portaria Express_`;

  const abrirWA = (enc, msgOverride) => {
    const mor = getMorador(enc);
    const tel = mor?.whatsapp || mor?.telefone || enc.telefone;
    if(!tel) return alert("Morador sem telefone cadastrado. Adicione o telefone na aba Moradores.");
    const num = normalizeWhatsAppPhone(tel);
    if(!num) return alert("Telefone inválido. Informe DDD e número, com ou sem +55.");
    const msg = encodeURIComponent(msgOverride || msgPadrao(enc));
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank");
    setEnviados(p=>({...p,[enc.id]:true}));
  };

  const copiarMsg = (enc) => {
    navigator.clipboard?.writeText(msgPadrao(enc)).then(()=>alert("Mensagem copiada!"));
  };

  return (
    <div>
      <div style={{background:"var(--gd)",border:"1px solid #10b98133",borderRadius:"var(--rs)",padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:10,fontSize:13,color:"var(--gn)"}}>
        <Icon n="whatsapp"/>
        <span><strong>{pendentes.length} encomendas</strong> aguardando retirada para notificar</span>
      </div>

      <div className="sbar">
        <div className="sw"><Icon n="search"/>
          <input className="inp" placeholder="Buscar morador, bloco, apartamento..." value={busca} onChange={e=>setBusca(e.target.value)}/>
        </div>
      </div>

      {pendentes.length===0 && (
        <div className="empty"><Icon n="whatsapp"/><p>Nenhuma encomenda pendente para notificar</p></div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {pendentes.map(enc => {
          const mor = getMorador(enc);
          const temTel = !!normalizeWhatsAppPhone(mor?.whatsapp || mor?.telefone || enc.telefone);
          const jaEnviou = enviados[enc.id];
          const diasEsp = Math.floor((Date.now()-new Date(enc.criado_em))/86400000);
          return (
            <div key={enc.id} style={{background:"var(--sf)",border:`1.5px solid ${jaEnviou?"#10b98144":diasEsp>=3?"#ef444433":"var(--b1)"}`,borderRadius:"var(--r)",padding:16}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12,gap:10}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <strong style={{fontSize:14}}>{enc.morador}</strong>
                    {jaEnviou && <span className="badge bg">WhatsApp aberto — confirme o envio</span>}
                    {diasEsp>=3 && !jaEnviou && <span className="badge br">⚠️ {diasEsp}d esperando</span>}
                    {diasEsp<3 && !jaEnviou && <span className="badge by">{diasEsp===0?"Hoje":`${diasEsp}d`}</span>}
                  </div>
                  <p style={{fontSize:12,color:"var(--t3)"}}>Bl {enc.bloco} / Ap {enc.apartamento} · {enc.transportadora||"—"}</p>
                  <code style={{fontSize:11,color:"var(--t3)"}}>{enc.protocolo}</code>
                  {!temTel && <p style={{fontSize:11,color:"var(--rd)",marginTop:4}}>⚠️ Sem telefone cadastrado</p>}
                  {temTel && <p style={{fontSize:11,color:"var(--t3)",marginTop:2}}>📱 {mor?.whatsapp||mor?.telefone||enc.telefone}</p>}
                </div>
              </div>

              <div style={{background:"var(--s2)",borderRadius:"var(--rs)",padding:"10px 12px",marginBottom:12,fontSize:12,color:"var(--t2)",whiteSpace:"pre-line",lineHeight:1.6}}>
                {msgPadrao(enc)}
              </div>

              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button
                  className={`btn ${temTel?"bgr":"bg2"}`}
                  style={{flex:1,justifyContent:"center",minWidth:120}}
                  onClick={()=>abrirWA(enc)}
                  disabled={!temTel}
                >
                  <Icon n="whatsapp"/> WhatsApp
                </button>
                <button className="btn bs" style={{flex:1,justifyContent:"center",minWidth:100}} onClick={()=>copiarMsg(enc)}>
                  📋 Copiar
                </button>
                <button className="btn bs" style={{flex:1,justifyContent:"center",minWidth:100}} onClick={()=>setMsgCustom({enc, texto:msgPadrao(enc)})}>
                  ✏️ Editar
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {msgCustom && (
        <div className="ov" onClick={()=>setMsgCustom(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="mh"><h3>✏️ Editar Mensagem</h3><button className="xb" onClick={()=>setMsgCustom(null)}><Icon n="x"/></button></div>
            <div className="mb">
              <p style={{fontSize:12,color:"var(--t3)",marginBottom:10}}>Para: <strong>{msgCustom.enc.morador}</strong> — Bl {msgCustom.enc.bloco}/Ap {msgCustom.enc.apartamento}</p>
              <div className="f">
                <label>MENSAGEM</label>
                <textarea className="inp" style={{minHeight:180,lineHeight:1.6}} value={msgCustom.texto} onChange={e=>setMsgCustom(p=>({...p,texto:e.target.value}))}/>
              </div>
            </div>
            <div className="mf">
              <button className="btn bg2" onClick={()=>setMsgCustom(null)}>Cancelar</button>
              <button className="btn bs" onClick={()=>{navigator.clipboard?.writeText(msgCustom.texto).then(()=>alert("Copiado!"));setMsgCustom(null);}}>📋 Copiar</button>
              <button className="btn bgr" onClick={()=>{abrirWA(msgCustom.enc,msgCustom.texto);setMsgCustom(null);}}>
                <Icon n="whatsapp"/> Abrir WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── CRIADOR DE PUBLICAÇÕES PARA X ────────────────────────────────────────────
const XWriter = () => {
  const [texto, setTexto] = useState(() => { try { return localStorage.getItem("px_x_draft") || ""; } catch { return ""; } });
  const [copiado, setCopiado] = useState(false);
  const limite = 280;
  const restante = limite - texto.length;
  const atualizar = value => {
    setTexto(value);
    try { localStorage.setItem("px_x_draft", value); } catch {}
    setCopiado(false);
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      alert("Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.");
    }
  };
  const tags = ["#Condomínio", "#Aviso", "#Comunicado"];
  const adicionarTag = tag => {
    if(texto.includes(tag)) return;
    atualizar(`${texto}${texto && !texto.endsWith(" ") ? " " : ""}${tag}`);
  };
  const compartilhar = () => {
    if(!texto.trim()) return;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  };
  return (
    <div>
      <div className="card">
        <div className="ch"><div><h3>✍️ Criar publicação</h3><p>Escreva e prepare um post para compartilhar no X.</p></div><span className="badge bb">Sem conectar conta</span></div>
        <div style={{padding:20}}>
          <div className="f">
            <label htmlFor="x-post">TEXTO DA PUBLICAÇÃO</label>
            <textarea id="x-post" className="inp" rows="7" maxLength={limite} value={texto} onChange={e=>atualizar(e.target.value)} placeholder="Escreva um aviso ou comunicado público..." style={{minHeight:150}} />
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:7,fontSize:12,color:restante<20?"var(--rd)":"var(--t3)"}}>
              <span>Rascunho salvo neste navegador.</span><strong>{texto.length}/{limite}</strong>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:18}}>
            <span style={{fontSize:12,color:"var(--t3)"}}>Adicionar:</span>
            {tags.map(tag=><button key={tag} className="btn bg2 bsm" onClick={()=>adicionarTag(tag)}>{tag}</button>)}
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button className="btn bp" onClick={compartilhar} disabled={!texto.trim()}>𝕏 Abrir X para publicar</button>
            <button className="btn bs" onClick={copiar} disabled={!texto.trim()}>{copiado?"✅ Copiado":"📋 Copiar texto"}</button>
            <button className="btn bg2" onClick={()=>atualizar("")} disabled={!texto}>Limpar rascunho</button>
          </div>
        </div>
      </div>
      <div className="card" style={{padding:16,display:"flex",gap:12,alignItems:"flex-start"}}>
        <span style={{fontSize:20}}>ℹ️</span><p style={{fontSize:12,color:"var(--t2)",lineHeight:1.6}}>Você não precisa conectar sua conta do X ao Portaria Express. Ao abrir o X, ele poderá solicitar login para concluir a publicação. Este espaço é ideal para comunicados públicos; não inclua dados pessoais de moradores ou encomendas.</p>
      </div>
    </div>
  );
};

const META = {
  dashboard:     {title:"Dashboard",       desc:"Visão geral do sistema"},
  encomendas:    {title:"Encomendas",      desc:"Registrar e gerenciar encomendas"},
  retirada:      {title:"Retirada",        desc:"Confirmar retirada de pacotes"},
  moradores:     {title:"Moradores",       desc:"Cadastro de moradores"},
  relatorios:    {title:"Relatórios",      desc:"Histórico e exportação"},
  logs:          {title:"Auditoria",       desc:"Log de ações do sistema"},
  usuarios:      {title:"Usuários",        desc:"Gerenciar acessos ao sistema"},
  notificacoes:  {title:"Notificações",    desc:"Avisar moradores sobre encomendas"},
  configuracoes: {title:"Configurações",   desc:"IA local Ollama e preferências do sistema"},
  xwriter:       {title:"Twitter / X",     desc:"Crie e compartilhe publicações sem conectar sua conta"},
};

const ALL_MOB_NAV = [
  {id:"dashboard",l:"Início",i:"dashboard"},
  {id:"encomendas",l:"Encomendas",i:"package"},
  {id:"retirada",l:"Retirada",i:"check"},
  {id:"notificacoes",l:"WhatsApp",i:"whatsapp"},
  {id:"xwriter",l:"Twitter / X",i:"x"},
  {id:"moradores",l:"Moradores",i:"users"},
];

function App() {
  const [session,setSession]=useState(null);
  const [user,setUser]=useState(null);
  const [needsSetup,setNeedsSetup]=useState(false);
  const [recoveringPassword,setRecoveringPassword]=useState(false);
  const [tenantOptions,setTenantOptions]=useState([]);
  const [authReady,setAuthReady]=useState(false);
  const [dataLoading,setDataLoading]=useState(false);
  const [dataSyncing,setDataSyncing]=useState(false);
  const [dataError,setDataError]=useState("");
  const [page,setPage]=useState("dashboard");
  const [moradores,setMor]=useState([]);
  const [encomendas,setEnc]=useState([]);
  const [logs,setLogs]=useState([]);
  const [sbOpen,setSbOpen]=useState(false);
  const [qmOpen,setQmOpen]=useState(false);
  const [quickEnc,setQuickEnc]=useState(false);
  const qmRef=useRef(null);
  const loadRequestRef=useRef(0);

  useEffect(()=>{
    if(!supabaseClient){setAuthReady(true);return;}
    let alive=true;
    supabaseClient.auth.getSession().then(({data,error})=>{
      if(!alive)return;
      if(error)setDataError(error.message);
      setSession(data?.session||null);setAuthReady(true);
    }).catch(e=>{if(alive){setDataError(e.message);setAuthReady(true);}});
    const {data:{subscription}}=supabaseClient.auth.onAuthStateChange((event,next)=>{
      if(!alive)return;
      if(event==="PASSWORD_RECOVERY")setRecoveringPassword(true);
      setSession(next);
      if(!next){loadRequestRef.current++;ACTIVE_TENANT_ID=null;setUser(null);setTenantOptions([]);setMor([]);setEnc([]);setLogs([]);setNeedsSetup(false);setDataError("");}
    });
    return ()=>{alive=false;subscription.unsubscribe();};
  },[]);

  const loadTenant=async(activeSession,selectedTenantId=null)=>{
    if(!activeSession||!supabaseClient)return;
    const requestId=++loadRequestRef.current;
    const backgroundRefresh=!!user&&(!selectedTenantId||user.condominio_id===selectedTenantId);
    if(!backgroundRefresh){setDataLoading(true);setDataSyncing(false);}else setDataSyncing(true);
    setDataError("");
    try {
      const {data:members,error:memberError}=await supabaseClient.from("portaria_membros").select("id,condominio_id,usuario_id,nome,perfil").eq("usuario_id",activeSession.user.id).order("criado_em");
      if(requestId!==loadRequestRef.current)return;
      if(memberError)throw memberError;
      if(!members?.length){ACTIVE_TENANT_ID=null;setUser(null);setTenantOptions([]);setMor([]);setEnc([]);setLogs([]);setNeedsSetup(true);return;}
      const {data:condominiums,error:condominiumError}=await supabaseClient.from("portaria_condominios").select("id,nome").in("id",members.map(m=>m.condominio_id));
      if(requestId!==loadRequestRef.current)return;
      if(condominiumError)throw condominiumError;
      const condominiumNames=Object.fromEntries((condominiums||[]).map(c=>[c.id,c.nome]));
      const options=members.map(m=>({...m,nome_condominio:condominiumNames[m.condominio_id]||m.condominio_id}));
      setTenantOptions(options);
      const member=options.find(m=>m.condominio_id===selectedTenantId)||options.find(m=>m.condominio_id===user?.condominio_id)||options[0];
      ACTIVE_TENANT_ID=member.condominio_id;
      const [condoResult,residentsResult,packagesResult,logsResult]=await Promise.all([
        Promise.resolve({data:{id:member.condominio_id,nome:member.nome_condominio},error:null}),
        supabaseClient.from("portaria_moradores").select("*").eq("condominio_id",member.condominio_id).order("nome"),
        supabaseClient.from("portaria_encomendas").select("*").eq("condominio_id",member.condominio_id).order("criado_em",{ascending:false}),
        supabaseClient.from("portaria_auditoria").select("*").eq("condominio_id",member.condominio_id).order("data",{ascending:false}).limit(1000)
      ]);
      if(requestId!==loadRequestRef.current)return;
      const failure=[condoResult,residentsResult,packagesResult,logsResult].find(r=>r.error);
      if(failure)throw failure.error;
      setUser({...member,email:activeSession.user.email,condominio:condoResult.data.nome});
      setMor(residentsResult.data||[]);setEnc(packagesResult.data||[]);setLogs(logsResult.data||[]);setNeedsSetup(false);
    } catch(e) {
      if(requestId===loadRequestRef.current){ACTIVE_TENANT_ID=null;setUser(null);setMor([]);setEnc([]);setLogs([]);setDataError(e.message||"Falha ao carregar os dados do condomínio.");}
    } finally {if(requestId===loadRequestRef.current){setDataLoading(false);setDataSyncing(false);}}
  };

  useEffect(()=>{
    if(!authReady)return;
    if(!session){ACTIVE_TENANT_ID=null;setUser(null);setNeedsSetup(false);return;}
    loadTenant(session);
  },[authReady,session?.user?.id]);

  useEffect(()=>{
    const userId=session?.user?.id;
    const tenantId=user?.condominio_id;
    if(!userId||!tenantId||!supabaseClient)return;
    let timer=null;
    let disposed=false;
    const refresh=()=>{
      if(disposed)return;
      clearTimeout(timer);
      timer=setTimeout(()=>{if(ACTIVE_TENANT_ID===tenantId)loadTenant(session,tenantId);},250);
    };
    const channel=supabaseClient.channel(`portaria-sync-${tenantId}`)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"portaria_encomendas",filter:`condominio_id=eq.${tenantId}`},refresh)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"portaria_encomendas",filter:`condominio_id=eq.${tenantId}`},refresh)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"portaria_moradores",filter:`condominio_id=eq.${tenantId}`},refresh)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"portaria_moradores",filter:`condominio_id=eq.${tenantId}`},refresh)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"portaria_auditoria",filter:`condominio_id=eq.${tenantId}`},refresh)
      .subscribe();
    return ()=>{disposed=true;clearTimeout(timer);supabaseClient.removeChannel(channel);};
  },[session?.user?.id,user?.condominio_id]);

  useEffect(()=>{
    const userId=session?.user?.id;
    const tenantId=user?.condominio_id;
    if(!userId||!tenantId||!supabaseClient)return;
    let active=true;
    const verifyMembership=async()=>{
      const {data:members,error}=await supabaseClient.from("portaria_membros").select("id,condominio_id").eq("usuario_id",userId);
      if(!active)return;
      if(error){
        ACTIVE_TENANT_ID=null;setUser(null);setMor([]);setEnc([]);setLogs([]);setDataError("Não foi possível confirmar seu acesso. Conecte-se novamente para continuar.");
      } else if(!members?.length){
        ACTIVE_TENANT_ID=null;setUser(null);setTenantOptions([]);setMor([]);setEnc([]);setLogs([]);setNeedsSetup(true);
      } else if(!members.some(m=>m.condominio_id===tenantId)){
        loadTenant(session);
      }
    };
    const refreshOnFocus=()=>{
      if(document.visibilityState==="visible"&&ACTIVE_TENANT_ID===tenantId)loadTenant(session,tenantId);
    };
    const interval=setInterval(verifyMembership,60_000);
    window.addEventListener("focus",refreshOnFocus);
    document.addEventListener("visibilitychange",refreshOnFocus);
    return ()=>{active=false;clearInterval(interval);window.removeEventListener("focus",refreshOnFocus);document.removeEventListener("visibilitychange",refreshOnFocus);};
  },[session?.user?.id,user?.condominio_id]);

  const addLog=useCallback(async(event)=>{
    if(!supabaseClient||!ACTIVE_TENANT_ID||!session?.user?.id)return;
    const row={...event,condominio_id:ACTIVE_TENANT_ID,usuario_id:session.user.id};
    const {data,error}=await supabaseClient.from("portaria_auditoria").insert(row).select().single();
    if(error){setDataError("A ação foi concluída, mas o registro de auditoria falhou: "+error.message);return;}
    setLogs(p=>[data,...p].slice(0,1000));
  },[session?.user?.id]);

  useEffect(()=>{
    const handler=e=>{if(qmRef.current&&!qmRef.current.contains(e.target))setQmOpen(false);};
    document.addEventListener("mousedown",handler);return()=>document.removeEventListener("mousedown",handler);
  },[]);

  const navigate=pg=>{if(user&&!canAccess(user.perfil,pg)){setPage("dashboard");return;}setPage(pg);setSbOpen(false);};
  useEffect(()=>{if(user&&!canAccess(user.perfil,page))setPage("dashboard");},[user,page]);

  if(!authReady||dataLoading) return <><Styles/><div className="lp"><div className="lc" style={{textAlign:"center"}}>Conectando ao Portaria Express...</div></div></>;
  if(recoveringPassword)return <ResetPassword onComplete={()=>{setRecoveringPassword(false);supabaseClient.auth.signOut();}}/>;
  if(!session) return <><Styles/><Login onLogin={setSession}/></>;
  if(needsSetup) return <TenantSetup session={session} onDone={()=>loadTenant(session)} onLogout={()=>supabaseClient.auth.signOut()}/>;
  if(!user) return <><Styles/><div className="lp"><div className="lc"><h3>Não foi possível carregar seu acesso</h3><p style={{margin:"12px 0",color:"var(--t2)"}}>{dataError||"Confira a configuração do banco e tente novamente."}</p><button className="btn bg2" onClick={()=>supabaseClient.auth.signOut()}>Sair</button></div></div></>;

  const m=META[page]||{};
  const mobNav=ALL_MOB_NAV.filter(n=>canAccess(user.perfil,n.id));
  return <><Styles/><div className="app">
    <Sidebar page={page} setPage={navigate} user={user} onLogout={()=>supabaseClient.auth.signOut()} open={sbOpen} onClose={()=>setSbOpen(false)}/>
    <div className="main">
      <div className="topbar"><div style={{display:"flex",alignItems:"center",gap:10}}>
        <div className="qm-wrap" ref={qmRef}><button className="hbtn" onClick={()=>{setQmOpen(o=>!o);setSbOpen(false);}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
          {qmOpen&&<div className="qm"><div className="qm-title">Atalhos rápidos</div>
            <div className="qm-item" onClick={()=>{setQuickEnc(true);setQmOpen(false);}}><div className="qm-icon" style={{background:"var(--ad)",color:"var(--ac)"}}><Icon n="plus"/></div><div><div style={{fontWeight:600,color:"var(--t1)"}}>Nova Encomenda</div><div style={{fontSize:11,color:"var(--t3)"}}>Registrar pacote recebido</div></div></div>
            <div className="qm-item" onClick={()=>{navigate("retirada");setQmOpen(false);}}><div className="qm-icon" style={{background:"var(--gd)",color:"var(--gn)"}}><Icon n="check"/></div><div><div style={{fontWeight:600,color:"var(--t1)"}}>Confirmar Retirada</div><div style={{fontSize:11,color:"var(--t3)"}}>Registrar retirada de pacote</div></div></div>
            <div className="qm-item" onClick={()=>{navigate("notificacoes");setQmOpen(false);}}><div className="qm-icon" style={{background:"var(--gd)",color:"var(--gn)"}}><Icon n="whatsapp"/></div><div><div style={{fontWeight:600,color:"var(--t1)"}}>Notificações</div><div style={{fontSize:11,color:"var(--t3)"}}>Avisar moradores via WhatsApp</div></div></div>
            <div className="qm-item" onClick={()=>{navigate("moradores");setQmOpen(false);}}><div className="qm-icon" style={{background:"var(--bld)",color:"var(--bl)"}}><Icon n="users"/></div><div><div style={{fontWeight:600,color:"var(--t1)"}}>Moradores</div><div style={{fontSize:11,color:"var(--t3)"}}>Ver lista de moradores</div></div></div>
            {user.perfil==="admin"&&<div className="qm-item" onClick={()=>{navigate("usuarios");setQmOpen(false);}}><div className="qm-icon" style={{background:"var(--rdd)",color:"var(--rd)"}}><Icon n="key"/></div><div style={{fontWeight:600,color:"var(--t1)"}}>Usuários</div></div>}
            <div className="qm-sep"/><div className="qm-item" onClick={()=>supabaseClient.auth.signOut()}><div className="qm-icon" style={{background:"var(--rdd)",color:"var(--rd)"}}><Icon n="logout"/></div><div style={{color:"var(--rd)",fontWeight:600}}>Sair do sistema</div></div>
          </div>}
        </div><div><h2>{m.title}</h2><p>{m.desc}</p></div></div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>{tenantOptions.length>1?<select className="inp" aria-label="Condomínio ativo" value={user.condominio_id} onChange={e=>loadTenant(session,e.target.value)}>{tenantOptions.map(t=><option key={t.condominio_id} value={t.condominio_id}>{t.nome_condominio}</option>)}</select>:<span style={{fontSize:12,color:"var(--t3)"}}>{user.condominio}</span>}<button className="hbtn" aria-label="Atualizar dados" title={dataSyncing?"Sincronizando dados…":"Atualizar dados agora"} disabled={dataSyncing} onClick={()=>loadTenant(session,user.condominio_id)}>{dataSyncing?"…":"↻"}</button><button className="hbtn" title={`Conta: ${user.email}`} onClick={()=>supabaseClient.auth.signOut()}><Icon n="logout"/></button><button className="hbtn" onClick={()=>setSbOpen(o=>!o)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button><span style={{fontSize:12,color:"var(--t3)"}}>{new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"})}</span></div>
      </div>
      {dataError&&<div role="alert" className="offbanner" style={{margin:"12px 24px 0"}}><strong>Problema de sincronização:</strong> {dataError}<button className="btn bs bsm" style={{marginLeft:10}} onClick={()=>loadTenant(session)}>Tentar novamente</button></div>}
      <div className="pg">
        {page==="dashboard"&&<Dashboard encomendas={encomendas.filter(e=>!e.arquivado_em)} moradores={moradores}/>}
        {page==="encomendas"&&<Encomendas encomendas={encomendas.filter(e=>!e.arquivado_em)} setEncomendas={setEnc} moradores={moradores} user={user} addLog={addLog}/>}
        {page==="retirada"&&<Retirada encomendas={encomendas.filter(e=>!e.arquivado_em)} setEncomendas={setEnc} user={user} addLog={addLog}/>}
        {page==="moradores"&&<Moradores moradores={moradores} setMoradores={setMor} user={user}/>}
        {page==="relatorios"&&<Relatorios encomendas={encomendas} user={user}/>}
        {page==="logs"&&<Logs logs={logs}/>}
        {page==="notificacoes"&&<Notificacoes encomendas={encomendas.filter(e=>!e.arquivado_em)} moradores={moradores}/>}
        {page==="xwriter"&&<XWriter/>}
        {page==="usuarios"&&<Usuarios condominioId={user.condominio_id} currentUserId={session.user.id}/>}
        {page==="configuracoes"&&<Configuracoes/>}
      </div>
      {quickEnc&&<NovaModal moradores={moradores} onSave={async enc=>{setEnc(p=>[enc,...p]);await addLog({acao:"Encomenda criada",protocolo:enc.protocolo,usuario:user.nome,data:new Date().toISOString()});setQuickEnc(false);}} onClose={()=>setQuickEnc(false)} user={user}/>}
    </div>
    <nav className="mob-nav"><div className="mob-nav-inner">{mobNav.map(n=><div key={n.id} className={"mob-ni"+(page===n.id?" on":"")} onClick={()=>navigate(n.id)}><Icon n={n.i}/><span>{n.l}</span></div>)}</div></nav>
  </div></>;
}
    const root = createRoot(document.getElementById("root"));
    root.render(<App/>);
