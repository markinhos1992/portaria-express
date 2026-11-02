import React,{useEffect,useRef,useState} from 'react';
import {fetchAllRows} from './data-safety.js';
import {readBackupTables,assertBackupUnchanged} from './backup-consistency.js';
import {MAX_BACKUP_BYTES,toBase64,sealBackup} from './backup.js';
export default function BackupPanel({client,user}){
 const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const active=useRef(true),lock=useRef(false);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const exportBackup=async()=>{
  if(lock.current)return;
  if(password.length<12||password!==confirmation){setStatus('Use pelo menos 12 caracteres e repita a mesma senha.');return;}
  lock.current=true;setBusy(true);setStatus('Carregando todos os registros do condomínio…');
  try{
   const tenant=user.condominio_id;
   const snapshot={version:1,createdAt:new Date().toISOString(),condominio:{id:tenant,nome:user.condominio},tables:{},photos:[]};
   for(const [key,table] of Object.entries({moradores:'portaria_moradores',encomendas:'portaria_encomendas',auditoria:'portaria_auditoria'})){
    snapshot.tables[key]=await fetchAllRows(()=>client.from(table).select('*').eq('condominio_id',tenant).order('id'));
    if(!active.current)throw new Error('Operação cancelada.');
   }
   let size=new TextEncoder().encode(JSON.stringify(snapshot)).length;
   if(size>MAX_BACKUP_BYTES)throw new Error('Os dados ultrapassam 20 MB. Solicite backup completo do servidor.');
   const paths=[...new Set(snapshot.tables.encomendas.map(row=>row.comprovante_path).filter(Boolean))];
   for(let i=0;i<paths.length;i++){
    if(!active.current)throw new Error('Operação cancelada.');
    setStatus(`Incluindo comprovante ${i+1} de ${paths.length}…`);
    const {data,error}=await client.storage.from('portaria-comprovantes').download(paths[i]);if(error)throw new Error('Não foi possível incluir todos os comprovantes. Nenhuma cópia parcial será gerada.');
    if(size+Math.ceil(data.size*4/3)>MAX_BACKUP_BYTES)throw new Error('As fotos ultrapassam o limite de 20 MB desta cópia. Solicite backup completo do servidor.');
    const photo={path:paths[i],contentType:data.type||'image/jpeg',data:toBase64(new Uint8Array(await data.arrayBuffer()))};
    size+=new TextEncoder().encode(JSON.stringify(photo)).length;snapshot.photos.push(photo);
   }
   if(!active.current)return;
   setStatus('Conferindo se os registros mudaram durante a cópia…');
   assertBackupUnchanged(snapshot.tables,await readBackupTables(client,tenant));
   if(!active.current)return;
   setStatus('Protegendo a cópia com criptografia…');const content=await sealBackup(snapshot,password);
   if(!active.current)return;
   const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`portaria-${tenant}-${new Date().toISOString().slice(0,10)}.pxbackup.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setPassword('');setConfirmation('');setStatus(`Cópia gerada: ${snapshot.tables.moradores.length} moradores, ${snapshot.tables.encomendas.length} encomendas, ${snapshot.tables.auditoria.length} eventos e ${paths.length} fotos. Confira o arquivo em Downloads e faça o teste de abertura.`);
  }catch(error){if(active.current)setStatus('Falha: '+error.message);}finally{lock.current=false;if(active.current)setBusy(false);}
 };
 return <section className="card"><div className="ch"><h3>Cópia de segurança do condomínio</h3></div><div style={{padding:20}}>
  <p style={{marginBottom:16}}>Baixe moradores, encomendas, histórico de auditoria e fotos em um arquivo criptografado. A senha fica somente nesta tela e não pode ser recuperada pelo sistema.</p>
  <div className="f"><label htmlFor="backup-password">SENHA DA CÓPIA · MÍNIMO 12 CARACTERES</label><input id="backup-password" className="inp" type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></div>
  <div className="f"><label htmlFor="backup-confirmation">CONFIRME A SENHA DA CÓPIA</label><input id="backup-confirmation" className="inp" type="password" autoComplete="new-password" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></div>
  <button className="btn bp" disabled={busy} onClick={exportBackup}>{busy?'Preparando…':'Gerar cópia protegida'}</button>
  <p role="status" style={{margin:'16px 0'}}>{status}</p>
  <p>Limite de 20 MB antes da criptografia. Contas, senhas de acesso e configurações do servidor não fazem parte desta cópia. O arquivo permite recuperar os dados para consulta; não sobrescreve o banco em uso.</p>
  <p style={{marginTop:12}}><a href={`${import.meta.env.BASE_URL}recuperar.html`} target="_blank" rel="noopener noreferrer">Abrir cópia para consulta e conferir fotos</a></p>
  <p><a href={`${import.meta.env.BASE_URL}recuperar-offline.html`} download="recuperar-portaria-offline.html">Baixar leitor de recuperação para usar sem internet</a></p>
  <p style={{marginTop:12}}>Rotina sugerida: gerar uma cópia ao final de cada dia de operação, guardá-la em local restrito e testar a abertura semanalmente. Uma cópia ainda não gerada não protege os dados.</p>
 </div></section>;
}

