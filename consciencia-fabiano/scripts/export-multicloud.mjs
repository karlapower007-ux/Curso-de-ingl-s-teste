import fs from "node:fs/promises";
import path from "node:path";

const BASE=(process.env.FNS_BASE_URL || "https://consciencia-fabiano.karlapower007.workers.dev").replace(/\/$/,"");
const OWNER_TOKEN=String(process.env.FNS_OWNER_TOKEN || "gadu").trim();
const OUT_DIR=path.resolve("public/biblioteca_backup");
const MANIFEST=path.resolve("public/biblioteca_backup.json");
const PAGE_SIZE=250;
const MAX_ATTEMPTS=6;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function request(url,options={}){
  let last;
  for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
    const res=await fetch(url,{
      ...options,
      headers:{
        "X-FNS-Owner-Token":OWNER_TOKEN,
        ...(options.headers || {})
      }
    });
    if(res.ok) return res;
    const text=await res.text().catch(()=>"");
    last=new Error("HTTP "+res.status+" "+text.slice(0,400));
    const quota=res.status===429 || /Exceeded allowed rows read|free tier|quota/i.test(text);
    if(!quota && res.status<500) throw last;
    await sleep(Math.min(60000,2000*(2**(attempt-1))));
  }
  throw last;
}

await fs.rm(OUT_DIR,{recursive:true,force:true});
await fs.mkdir(OUT_DIR,{recursive:true});

let offset=0,total=null,part=0,exported=0,vectors=0,mirrored=0;
const parts=[];

while(total===null || offset<total){
  const res=await request(BASE+"/api/admin/export-library?offset="+offset+"&limit="+PAGE_SIZE);
  const data=await res.json();
  if(data.ok!==true) throw new Error("Export page failed");
  total=Number(data.total || 0);
  const records=Array.isArray(data.records)?data.records:[];
  if(!records.length) break;

  const chunks=records.map(r=>({
    id:r.id,document_id:r.document_id,filename:r.filename,title:r.title,author:r.author,
    language:r.language,page:r.page,chunk_index:r.chunk_index,text:r.text
  }));
  const vectorRows=records.filter(r=>Array.isArray(r.vector)&&r.vector.length>=64).map(r=>({
    key:r.id,id:r.id,document_id:r.document_id,filename:r.filename,title:r.title,author:r.author,
    language:r.language,page:r.page,chunk_index:r.chunk_index,text:r.text,vector:r.vector
  }));

  const filename="part-"+String(part).padStart(4,"0")+".json";
  await fs.writeFile(path.join(OUT_DIR,filename),JSON.stringify({chunks,vectors:vectorRows}));
  parts.push({url:"/biblioteca_backup/"+filename,records:records.length,vectors:vectorRows.length});
  exported+=records.length;vectors+=vectorRows.length;

  try{
    const mirror=await request(BASE+"/api/admin/mirror-upsert",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({records:vectorRows})
    });
    const m=await mirror.json().catch(()=>({}));
    if(m.any_upserted) mirrored+=vectorRows.length;
  }catch(error){
    console.warn("mirror warning:",error.message);
  }

  offset=Number(data.next_offset || (offset+records.length));
  part++;
}

const manifest={
  version:2,
  format:"fns-rag-static-backup-v2-sharded",
  generated_at:new Date().toISOString(),
  total_records:exported,
  total_vectors:vectors,
  expected_embeddings:25199,
  mirrored_records:mirrored,
  parts
};
await fs.writeFile(MANIFEST,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({ok:true,total_records:exported,total_vectors:vectors,parts:parts.length,mirrored_records:mirrored}));
