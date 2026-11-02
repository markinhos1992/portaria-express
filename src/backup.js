export const MAX_BACKUP_BYTES=20*1024*1024;
const ITERATIONS=310000;
const encoder=new TextEncoder();
const decoder=new TextDecoder();
export function toBase64(bytes){let text="";for(let i=0;i<bytes.length;i+=4096)text+=String.fromCharCode(...bytes.subarray(i,i+4096));return btoa(text);}
export function fromBase64(text){if(typeof text!=="string"||text.length>MAX_BACKUP_BYTES*2||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new Error("Arquivo de cópia inválido.");return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
export function validateSnapshot(snapshot){
 if(!snapshot||snapshot.version!==1||!snapshot.condominio?.id||!snapshot.tables||!Array.isArray(snapshot.photos))throw new Error("Formato de cópia não reconhecido.");
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(snapshot.condominio.id))throw new Error("Condomínio da cópia inválido.");
 for(const table of ['moradores','encomendas','auditoria']){
  const rows=snapshot.tables[table];if(!Array.isArray(rows))throw new Error("Cópia incompleta: "+table);
  const ids=new Set();for(const row of rows){if(!row||!uuid.test(row.id)||row.condominio_id!==snapshot.condominio.id||ids.has(row.id))throw new Error("Registros inválidos ou de outro condomínio.");ids.add(row.id);}
 }
 const photos=new Map();
 for(const photo of snapshot.photos){if(!photo||typeof photo.path!=="string"||!photo.path.startsWith(snapshot.condominio.id+'/')||photos.has(photo.path)||!['image/jpeg','image/png','image/webp'].includes(photo.contentType))throw new Error("Comprovante inválido na cópia.");fromBase64(photo.data);photos.set(photo.path,photo);}
 for(const row of snapshot.tables.encomendas){if(!['pendente','retirada'].includes(row.status))throw new Error("Status inválido na cópia.");if(row.comprovante_path&&!photos.has(row.comprovante_path))throw new Error("Cópia incompleta: falta comprovante de "+row.protocolo);}
 if(encoder.encode(JSON.stringify(snapshot)).length>MAX_BACKUP_BYTES)throw new Error("A cópia ultrapassa 20 MB. Solicite backup completo do servidor.");
 return snapshot;
}
async function deriveKey(passphrase,salt,usage){
 if(typeof passphrase!=="string"||passphrase.length<12)throw new Error("Use uma senha de cópia com pelo menos 12 caracteres.");
 const material=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);
}
export async function sealBackup(snapshot,passphrase){
 validateSnapshot(snapshot);
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await deriveKey(passphrase,salt,['encrypt']);
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('PORTARIA_BACKUP_V1')},key,encoder.encode(JSON.stringify(snapshot)));
 return JSON.stringify({format:'portaria-express-encrypted',version:1,iterations:ITERATIONS,salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ciphertext))});
}
export async function openBackup(text,passphrase){
 if(typeof text!=="string"||encoder.encode(text).length>30*1024*1024)throw new Error("Arquivo muito grande ou inválido.");
 const envelope=JSON.parse(text);
 if(envelope.format!=='portaria-express-encrypted'||envelope.version!==1||envelope.iterations!==ITERATIONS)throw new Error("Formato ou versão de cópia inválidos.");
 const salt=fromBase64(envelope.salt),iv=fromBase64(envelope.iv),ciphertext=fromBase64(envelope.ciphertext);
 if(salt.length!==16||iv.length!==12)throw new Error("Arquivo de cópia inválido.");
 const key=await deriveKey(passphrase,salt,['decrypt']);let plaintext;
 try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode('PORTARIA_BACKUP_V1')},key,ciphertext);}catch{throw new Error("Senha incorreta ou cópia alterada/corrompida.");}
 return validateSnapshot(JSON.parse(decoder.decode(plaintext)));
}
