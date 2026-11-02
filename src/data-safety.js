export async function fetchAllRows(queryFactory, pageSize=500) {
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500)throw new Error("Tamanho de página inválido.");
  const rows=[]; const seen=new Set();
  for(let offset=0;;offset+=pageSize) {
    const {data,error}=await queryFactory().range(offset,offset+pageSize-1);
    if(error)throw error;
    if(!Array.isArray(data))throw new Error("Resposta inválida ao carregar registros.");
    for(const row of data) {
      if(row.id!=null&&seen.has(row.id))throw new Error("Os dados mudaram durante a consulta. Atualize novamente.");
      if(row.id!=null)seen.add(row.id); rows.push(row);
    }
    if(data.length<pageSize)return rows;
  }
}
export async function fetchAllResult(factory) {
  try{return {data:await fetchAllRows(factory),error:null};}catch(error){return {data:null,error};}
}
export function csvCell(value) {
  let text=String(value??"");
  if(/^[\s\uFEFF]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function localOllamaUrl(value) {
  const url=new URL(value);
  if(url.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw new Error("Use o endereço local do Ollama, por exemplo http://localhost:11434. Endereços externos não são permitidos.");
  return url.origin;
}

export function parseCsv(text) {
  text=String(text).replace(/^\uFEFF/,"");
  const head=text.split(/\r?\n/,1)[0];
  const delimiter=(head.match(/;/g)||[]).length>(head.match(/,/g)||[]).length?";":",";
  const rows=[];let row=[],cell="",quoted=false,closed=false;
  const pushCell=()=>{row.push(cell.trim());cell="";closed=false;};
  const pushRow=()=>{pushCell();if(row.some(Boolean))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
    if(ch==='"'){if(cell.trim()||closed)throw new Error("Aspas inválidas no CSV.");quoted=true;}
    else if(ch===delimiter)pushCell();
    else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;pushRow();}
    else{if(closed&&!/\s/.test(ch))throw new Error("Texto inesperado após aspas no CSV.");cell+=ch;}
  }
  if(quoted)throw new Error("O CSV contém aspas não fechadas.");
  if(cell||row.length)pushRow();
  return rows;
}

export function validateImageFile(file) {
  if(!file||!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Envie uma foto JPG, PNG ou WebP.");
  if(file.size>10*1024*1024)throw new Error("A foto deve ter até 10 MB.");
  return file;
}
