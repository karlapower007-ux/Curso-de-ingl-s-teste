import {mkdir,readdir,rm,writeFile} from "node:fs/promises";
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import path from "node:path";

const outDir=path.resolve("public/steel");
const pageSize=Math.max(100,Math.min(1000,Number(process.env.STEEL_SHARD_ROWS||500)));
const supabase=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const token=String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_RAG_KEY||"").trim();

await mkdir(outDir,{recursive:true});
for(const name of await readdir(outDir).catch(()=>[])){
  if(/^shard-\d+\.json\.gz$/.test(name)) await rm(path.join(outDir,name),{force:true});
}

const index={
  version:"7.0.0",
  generated_at:new Date().toISOString(),
  source:supabase&&token?"supabase-rag_embeddings":"unconfigured",
  compression:"gzip",
  total_rows:0,
  shard_rows:pageSize,
  shards:[]
};

if(!supabase||!token){
  await writeFile(path.join(outDir,"index.json"),JSON.stringify(index,null,2));
  console.log("STEEL_VAULT=unconfigured");
  process.exit(0);
}

let offset=0,shardNo=0;
while(true){
  const url=new URL(supabase+"/rest/v1/rag_embeddings");
  url.searchParams.set("select","id,document_id,filename,title,author,language,page,chunk_index,text");
  url.searchParams.set("order","document_id.asc,chunk_index.asc");
  url.searchParams.set("limit",String(pageSize));
  url.searchParams.set("offset",String(offset));
  let res;
  try{
    res=await fetch(url,{
      headers:{
        "Authorization":"Bearer "+token,
        "apikey":token,
        "Accept":"application/json"
      }
    });
  }catch(error){
    console.log("STEEL_VAULT_FETCH_ERROR="+String(error?.message||error));
    break;
  }
  if(!res.ok){
    console.log("STEEL_VAULT_HTTP="+res.status);
    break;
  }
  const rows=await res.json().catch(()=>[]);
  if(!Array.isArray(rows)||!rows.length) break;

  const clean=rows.map(row=>({
    id:String(row?.id||""),
    document_id:String(row?.document_id||""),
    filename:String(row?.filename||""),
    title:String(row?.title||row?.filename||""),
    author:String(row?.author||""),
    language:String(row?.language||"pt"),
    page:Number(row?.page||0)||null,
    chunk_index:Number(row?.chunk_index||0),
    text:String(row?.text||"")
  })).filter(row=>row.document_id&&row.text);

  const json=Buffer.from(JSON.stringify(clean));
  const gz=gzipSync(json,{level:9});
  shardNo++;
  const filename="shard-"+String(shardNo).padStart(5,"0")+".json.gz";
  await writeFile(path.join(outDir,filename),gz);
  const hash=createHash("sha256").update(gz).digest("hex");
  index.shards.push({
    path:"/steel/"+filename,
    rows:clean.length,
    bytes:gZSafe(gz.length),
    sha256:hash,
    first_document_id:clean[0]?.document_id||"",
    last_document_id:clean.at(-1)?.document_id||""
  });
  index.total_rows+=clean.length;
  offset+=rows.length;
  console.log("STEEL_SHARD="+filename+" rows="+clean.length);
  if(rows.length<pageSize) break;
}

await writeFile(path.join(outDir,"index.json"),JSON.stringify(index,null,2));
console.log("STEEL_VAULT_ROWS="+index.total_rows);
console.log("STEEL_VAULT_SHARDS="+index.shards.length);

function gZSafe(n){return Number.isFinite(Number(n))?Number(n):0;}
