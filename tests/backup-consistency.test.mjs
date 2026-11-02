import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBackupUnchanged} from '../src/backup-consistency.js';
test('recusa exportação se registros ou auditoria mudaram durante leitura',()=>{
 const initial={moradores:[{id:'1',nome:'Teste'}],encomendas:[],auditoria:[]};
 assert.doesNotThrow(()=>assertBackupUnchanged(initial,structuredClone(initial)));
 for(const mutate of [x=>x.moradores[0].nome='Outro',x=>x.encomendas.push({id:'2'}),x=>x.moradores.pop(),x=>x.auditoria.push({id:'3'})]){
 const changed=structuredClone(initial);mutate(changed);assert.throws(()=>assertBackupUnchanged(initial,changed),/mudaram/);
 }
});
