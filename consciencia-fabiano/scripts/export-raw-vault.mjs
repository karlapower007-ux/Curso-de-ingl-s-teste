import {mkdir,readdir,readFile,writeFile,rm} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
import path from "node:path";

const steelDir=path.resolve("public/steel");
const outDir=path.resolve("raw-vault/generated");
await mkdir(outDir,{recursive:true});
for(const name of await readdir(outDir).catch(()=>[])){
  if(/\.(txt|md)$/i.test(name)) await rm(path.join(outDir,name),{force:true});
}
const index=JSON.parse(await readFile(path.join(steelDir,"index.json"),"utf8").catch(()=>"{\"shards\":[]}"));
const docs=new Map();
for(const shard of (Array.isArray(index.shards)?index.shards:[])){
  const p=path.join("public",String(shard.path||"").replace(/^\//,""));
  let rows=[];
  try{rows=JSON.parse(gunzipSync(await readFile(p)).toString("utf8"));}catch{continue;}
  for(const row of (Array.isArray(rows)?rows:[])){
    const id=String(row.document_id||"unknown");
    const list=docs.get(id)||[];
    list.push(row);
    docs.set(id,list);
  }
}
let written=0;
for(const [id,rows] of docs){
  rows.sort((a,b)=>Number(a.chunk_index||0)-Number(b.chunk_index||0));
  const first=rows[0]||{};
  const safe=String(first.title||first.filename||id).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-zA-Z0-9._ -]+/g," ").replace(/\s+/g," ").trim().slice(0,90)||id;
  const header=[
    "# "+String(first.title||first.filename||"Documento"),
    first.author?"Autor: "+first.author:"",
    "Document ID: "+id,
    ""
  ].filter(Boolean).join("\n");
  const body=rows.map(r=>String(r.text||"")).join("\n");
  await writeFile(path.join(outDir,safe+".md"),header+"\n"+body+"\n","utf8");
  written++;
}
console.log("RAW_VAULT_FILES="+written);
