import {openBackup,fromBase64} from './backup.js';
const $=id=>document.getElementById(id);
let snapshot=null,photoUrl=null,generation=0,page=0;
function clearPhoto(){if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;$('photo').replaceChildren();}
function clearData(){snapshot=null;page=0;clearPhoto();$('summary').hidden=true;$('results').replaceChildren();$('title').textContent='';$('counts').textContent='';}
function reset(){generation++;clearData();$('open').disabled=false;$('password').value='';$('file').value='';$('search').value='';$('status').textContent='Dados fechados e retirados da tela.';}
function render(){
 if(!snapshot)return;clearPhoto();const type=$('table').value,search=$('search').value.trim().toLocaleLowerCase('pt-BR');
 const all=snapshot.tables[type].filter(row=>Object.values(row).some(value=>String(value??'').toLocaleLowerCase('pt-BR').includes(search)));
 page=Math.min(page,Math.max(0,Math.ceil(all.length/100)-1));const rows=all.slice(page*100,(page+1)*100);
 const table=document.createElement('table'),head=document.createElement('tr');
 for(const title of type==='auditoria'?['Data','Ação','Usuário','Protocolo']:['Nome','Unidade','Protocolo / situação','Comprovante']){const th=document.createElement('th');th.textContent=title;head.append(th);}table.append(head);
 for(const row of rows){const tr=document.createElement('tr');
 const values=type==='auditoria'?[row.data,row.acao,row.usuario,row.protocolo]:[row.nome||row.morador,`${row.bloco} / ${row.apartamento}`,type==='encomendas'?`${row.protocolo} · ${row.status}${row.arquivado_em?' · arquivada':''}`:(row.ativo?'Ativo':'Inativo')];
 for(const value of values){const td=document.createElement('td');td.textContent=value||'—';tr.append(td);}
 if(type!=='auditoria'){const td=document.createElement('td');if(row.comprovante_path){const button=document.createElement('button');button.textContent='Ver foto';button.onclick=()=>{clearPhoto();const file=snapshot.photos.find(photo=>photo.path===row.comprovante_path);photoUrl=URL.createObjectURL(new Blob([fromBase64(file.data)],{type:file.contentType}));const img=document.createElement('img');img.alt='Comprovante recuperado da cópia';img.src=photoUrl;$('photo').append(img);};td.append(button);}tr.append(td);}table.append(tr);}
 const navigation=document.createElement('div');for(const [label,delta,disabled] of [['Anterior',-1,page===0],['Próxima',1,(page+1)*100>=all.length]]){const button=document.createElement('button');button.textContent=label;button.disabled=disabled;button.onclick=()=>{page+=delta;render();};navigation.append(button);}const count=document.createElement('p');count.textContent=`${all.length} resultados · Página ${page+1} de ${Math.max(1,Math.ceil(all.length/100))}`;
 $('results').replaceChildren(count,table,navigation);
}
$('open').onclick=async()=>{
 const ticket=++generation;clearData();const file=$('file').files[0];const password=$('password').value;
 if(!file){$('status').textContent='Escolha o arquivo de cópia.';return;}if(file.size>30*1024*1024){$('status').textContent='Arquivo acima do limite de 30 MB.';return;}
 $('open').disabled=true;$('status').textContent='Verificando senha e integridade…';
 try{const recovered=await openBackup(await file.text(),password);if(ticket!==generation)return;snapshot=recovered;$('password').value='';$('title').textContent=snapshot.condominio.nome||'Condomínio';$('counts').textContent=`Cópia de ${snapshot.createdAt}: ${snapshot.tables.moradores.length} moradores, ${snapshot.tables.encomendas.length} encomendas, ${snapshot.tables.auditoria.length} eventos e ${snapshot.photos.length} fotos.`;$('summary').hidden=false;$('status').textContent='Cópia recuperada para consulta. Nenhum dado do banco foi alterado.';render();}
 catch(error){if(ticket===generation){$('status').textContent=error.message;$('password').value='';}}
 finally{if(ticket===generation)$('open').disabled=false;}
};
$('clear').onclick=reset;$('search').oninput=()=>{page=0;render();};$('table').onchange=()=>{page=0;render();};window.addEventListener('pagehide',reset);

