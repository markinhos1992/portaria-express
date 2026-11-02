import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAllRows, fetchAllResult, csvCell, localOllamaUrl, parseCsv, validateImageFile} from '../src/data-safety.js';
import {matchResidentName} from '../src/ocr-schema.js';
import {normalizeWhatsAppPhone} from '../src/whatsapp.js';
test('carrega 1501 registros em quatro páginas sem truncar',async()=>{
 const records=Array.from({length:1501},(_,id)=>({id}));let calls=0;
 const result=await fetchAllRows(()=>({range:async(a,b)=>{calls++;return {data:records.slice(a,b+1),error:null};}}));
 assert.deepEqual(result,records);assert.equal(calls,4);
});
test('não apresenta sucesso parcial quando uma página falha',async()=>{
 const error=new Error('conexão perdida');let calls=0;
 await assert.rejects(fetchAllRows(()=>({range:async()=>++calls===1?{data:Array.from({length:500},(_,id)=>({id}))}:{error}})),/conexão perdida/);
 assert.equal((await fetchAllResult(()=>({range:async()=>({error})}))).error,error);
});
test('detecta duplicação causada por mudança durante paginação',async()=>{
 await assert.rejects(fetchAllRows(()=>({range:async()=>({data:[{id:1}]})}),1),/mudaram/);
 await assert.rejects(fetchAllRows(()=>{},0),/inválido/);
});
test('exportação protege fórmulas e mantém zero e aspas',()=>{
 for(const value of ["=SUM(A1:A2)"," +1","\t@CMD","-1"])assert.equal(csvCell(value).charCodeAt(1),39);
 assert.equal(csvCell(0),'"0"');assert.equal(csvCell('a"b'),'"a""b"');
});
test('CSV aceita BOM, ponto e vírgula, aspas e observação multilinha',()=>{
 const csv='\uFEFFnome;bloco;apartamento;obs\r\n"Ana; Maria";A;101;"linha 1\nlinha ""2"""';
 assert.deepEqual(parseCsv(csv),[['nome','bloco','apartamento','obs'],['Ana; Maria','A','101','linha 1\nlinha "2"']]);
 assert.throws(()=>parseCsv('a,b\n"sem fim'),/fechadas/);
 assert.throws(()=>parseCsv('a,b\n"a"invalido,b'),/inesperado/);
});
test('Ollama aceita apenas endereço local sem credenciais nem caminhos',()=>{
 assert.equal(localOllamaUrl('http://localhost:11434/'),'http://localhost:11434');
 assert.equal(localOllamaUrl('http://127.0.0.1:11434'),'http://127.0.0.1:11434');
 for(const u of ['https://externo.com','http://localhost.evil.com','http://user:pass@localhost:11434','http://localhost:11434/outra','http://localhost:11434/?foto=1'])assert.throws(()=>localOllamaUrl(u));
});
test('nome automático exige nome explícito e unidade única',()=>{
 const residents=[{nome:'Ana Maria',ativo:true,bloco:'A',apartamento:'101'}];const unit={bloco:'A',apartamento:'101'};
 assert.equal(matchResidentName('DESTINATÁRIO: ANA MARIA',residents,unit),'Ana Maria');
 assert.equal(matchResidentName('ANA',residents,unit),'');
 assert.equal(matchResidentName('ANA MARIA',[...residents,...residents],unit),'');
 assert.equal(matchResidentName('ANA MARIA',residents,{...unit,apartamento:'102'}),'');
});
test('WhatsApp preserva DDI sem duplicação e rejeita telefone incompleto',()=>{
 assert.equal(normalizeWhatsAppPhone('+55 (61) 99999-0000'),'5561999990000');
 assert.equal(normalizeWhatsAppPhone('(61) 99999-0000'),'5561999990000');
 assert.equal(normalizeWhatsAppPhone('123'),'');
});

test('fotos rejeitam SVG, arquivos não imagem e tamanho excessivo',()=>{
 assert.throws(()=>validateImageFile({type:'image/svg+xml',size:10}));
 assert.throws(()=>validateImageFile({type:'text/html',size:10}));
 assert.throws(()=>validateImageFile({type:'image/png',size:11*1024*1024}));
 assert.equal(validateImageFile({type:'image/jpeg',size:100}).size,100);
});
