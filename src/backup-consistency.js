import {fetchAllRows} from './data-safety.js';
export const backupTables={moradores:'portaria_moradores',encomendas:'portaria_encomendas',auditoria:'portaria_auditoria'};
export async function readBackupTables(client,tenant){
 const tables={};
 for(const [key,table] of Object.entries(backupTables))tables[key]=await fetchAllRows(()=>client.from(table).select('*').eq('condominio_id',tenant).order('id'));
 return tables;
}
export function assertBackupUnchanged(before,after){
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Os registros mudaram durante a cópia. Aguarde uma pausa nas operações e gere novamente.');
}
