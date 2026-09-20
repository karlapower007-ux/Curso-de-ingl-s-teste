import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";

const BASE=String(process.env.FNS_BASE_URL || "https://consciencia-fabiano.focoeepoder2.workers.dev").replace(/\/$/,"");
const OWNER=String(process.env.FNS_OWNER_TOKEN || "").trim();
const DB=String(process.env.SUPABASE_DB_URL || "").trim();
const STATUS_PATH=path.resolve(process.env.ETL_STATUS_PATH || ".ci-results/v75-secondary-hydration.json");
const PAGE_SIZE=250;
const UPSERT_BATCH=200;
const MAX_FETCH_RETRIES=4;

async function writeStatus(data){
  await fs.mkdir(path.dirname(STATUS_PATH),{recursive:true});
  const safe={
    state:String(data.state||"unknown"),
    primary_total:Number(data.primary_total||0),
    mirrored_chunks:Number(data.mirrored_chunks||0),
    hydrated_embeddings:Number(data.hydrated_embeddings||0),
    total_books:Number(data.total_books||0),
    generation:String(data.generation||""),
    source_signature:String(data.source_signature||""),
    reason:String(data.reason||"")
  };
  await fs.writeFile(STATUS_PATH,JSON.stringify(safe,null,2)+"\n");
  console.log("FNS_ETL_STATE="+safe.state);
}

function fail(message){
  throw new Error(String(message||"ETL failed"));
}

function quotaLike(status,text){
  return status===429 || /quota|free tier|exceeded allowed rows read|too many requests/i.test(String(text||""));
}

async function adminGet(url){
  let last=null;
  for(let attempt=1;attempt<=MAX_FETCH_RETRIES;attempt++){
    try{
      const res=await fetch(url,{
        headers:{
          "X-FNS-Owner-Token":OWNER,
          "Accept":"application/json"
        }
      });
      const text=await res.text();
      if(res.ok){
        let data={};
        try{data=JSON.parse(text||"{}");}catch{}
        return {ok:true,status:res.status,data,text};
      }
      if(quotaLike(res.status,text)){
        return {ok:false,waiting:true,status:res.status,text};
      }
      last=new Error("Primary HTTP "+res.status+" "+text.slice(0,300));
      if(res.status<500) throw last;
    }catch(error){
      last=error;
    }
    await new Promise(r=>setTimeout(r,Math.min(12000,1200*(2**(attempt-1)))));
  }
  throw last || new Error("Primary unavailable");
}

function psql(args,input){
  const r=spawnSync("psql",[DB,"-v","ON_ERROR_STOP=1",...args],{
    encoding:"utf8",
    input:input ?? undefined,
    maxBuffer:64*1024*1024
  });
  if(r.status!==0){
    throw new Error("psql failed: "+String(r.stderr||r.stdout||"").slice(0,1200));
  }
  return String(r.stdout||"").trim();
}

function normalizeVector(raw){
  let v=Array.isArray(raw?.vector)?raw.vector:(Array.isArray(raw?.embedding)?raw.embedding:null);
  if(!v && typeof raw?.embedding==="string"){
    try{
      const parsed=JSON.parse(raw.embedding);
      if(Array.isArray(parsed))v=parsed;
    }catch{}
  }
  if(!Array.isArray(v))return null;
  const clean=v.map(Number);
  if(clean.length!==384 || clean.some(x=>!Number.isFinite(x)))return null;
  return clean;
}

function hashText(text){
  return crypto.createHash("sha256").update(String(text||"")).digest("hex");
}

function normalizeRecord(raw,generation){
  const text=String(raw?.text||"");
  return {
    id:String(raw?.id||raw?.key||"").slice(0,180),
    document_id:String(raw?.document_id||raw?.doc_key||"").slice(0,180),
    filename:String(raw?.filename||raw?.title||"Documento").slice(0,300),
    title:String(raw?.title||raw?.filename||"Documento").slice(0,500),
    author:String(raw?.author||"").slice(0,300),
    language:String(raw?.language||"pt").slice(0,40),
    page:Number(raw?.page||0)||0,
    chunk_index:Number(raw?.chunk_index||0)||0,
    text:text.slice(0,12000),
    content_hash:String(raw?.content_hash||raw?.content_sha256||hashText(text)).toLowerCase().slice(0,180),
    embedding:normalizeVector(raw),
    source_generation:generation,
    source_backend:"cloudflare-primary-etl",
    metadata:{
      original_r2_key:String(raw?.original_r2_key||raw?.r2_key||"").slice(0,700),
      embedding_model:String(raw?.embedding_model||"").slice(0,180)
    }
  };
}

async function upsertBatch(records,generation,tmpDir,batchNo){
  const ndjson=path.join(tmpDir,"batch-"+String(batchNo).padStart(5,"0")+".ndjson");
  await fs.writeFile(ndjson,records.map(r=>JSON.stringify(r)).join("\n")+"\n");
  const quotedPath=ndjson.replace(/'/g,"''");
  const gen=generation.replace(/'/g,"''");
  const sql=`
CREATE TEMP TABLE fns_etl_json(payload jsonb);
\\copy fns_etl_json(payload) FROM '${quotedPath}' WITH (FORMAT text);
INSERT INTO public.library_chunks(
  id,document_id,filename,title,author,language,page,chunk_index,text,content_hash,
  embedding,source_generation,source_backend,metadata,updated_at
)
SELECT
  payload->>'id',
  payload->>'document_id',
  coalesce(payload->>'filename',''),
  coalesce(payload->>'title',''),
  coalesce(payload->>'author',''),
  coalesce(payload->>'language','pt'),
  coalesce((payload->>'page')::integer,0),
  coalesce((payload->>'chunk_index')::integer,0),
  payload->>'text',
  coalesce(payload->>'content_hash',''),
  CASE
    WHEN jsonb_typeof(payload->'embedding')='array'
      AND jsonb_array_length(payload->'embedding')=384
    THEN (payload->'embedding')::text::extensions.vector(384)
    ELSE NULL
  END,
  '${gen}',
  'cloudflare-primary-etl',
  coalesce(payload->'metadata','{}'::jsonb),
  now()
FROM fns_etl_json
WHERE coalesce(payload->>'id','')<>'' AND coalesce(payload->>'document_id','')<>'' AND coalesce(payload->>'text','')<>''
ON CONFLICT(id) DO UPDATE SET
  document_id=excluded.document_id,
  filename=excluded.filename,
  title=excluded.title,
  author=excluded.author,
  language=excluded.language,
  page=excluded.page,
  chunk_index=excluded.chunk_index,
  text=excluded.text,
  content_hash=excluded.content_hash,
  embedding=coalesce(excluded.embedding,public.library_chunks.embedding),
  source_generation=excluded.source_generation,
  source_backend=excluded.source_backend,
  metadata=excluded.metadata,
  updated_at=now();
`;
  psql(["-q","-c",sql]);
  await fs.unlink(ndjson).catch(()=>{});
}

if(!OWNER){
  await writeStatus({state:"blocked",reason:"missing FNS_OWNER_TOKEN"});
  process.exit(2);
}
if(!DB){
  await writeStatus({state:"blocked",reason:"missing SUPABASE_DB_URL"});
  process.exit(2);
}

const psqlVersion=spawnSync("psql",["--version"],{encoding:"utf8"});
if(psqlVersion.status!==0){
  await writeStatus({state:"blocked",reason:"psql unavailable"});
  process.exit(2);
}

const probe=await adminGet(BASE+"/api/admin/export-library?offset=0&limit=1");
if(probe.waiting){
  await writeStatus({state:"waiting",reason:"primary quota/read limit not reset"});
  process.exit(0);
}
if(!probe.ok || probe.data?.ok!==true){
  await writeStatus({state:"waiting",reason:"primary export endpoint not readable"});
  process.exit(0);
}

const primaryTotal=Math.max(0,Number(probe.data?.total||0));
if(primaryTotal<=0){
  await writeStatus({state:"blocked",reason:"primary reported zero records"});
  process.exit(3);
}

const generation="v75-etl-"+Date.now().toString(36);
const signature=crypto.createHash("sha256");
const tmpDir=await fs.mkdtemp(path.join(os.tmpdir(),"fns-v75-etl-"));
let offset=0;
let exported=0;
let batchNo=0;

try{
  while(offset<primaryTotal){
    const page=await adminGet(BASE+"/api/admin/export-library?offset="+offset+"&limit="+PAGE_SIZE);
    if(page.waiting){
      await writeStatus({state:"waiting",primary_total:primaryTotal,reason:"quota returned during ETL; no manifest promoted"});
      process.exit(0);
    }
    if(!page.ok || page.data?.ok!==true) fail("Primary export page failed at offset "+offset);
    const raw=Array.isArray(page.data?.records)?page.data.records:[];
    if(!raw.length) fail("Primary ended early at "+offset+" of "+primaryTotal);

    const normalized=raw.map(r=>normalizeRecord(r,generation));
    for(const row of normalized){
      signature.update(row.id+"|"+row.document_id+"|"+row.content_hash+"\n");
    }
    for(let i=0;i<normalized.length;i+=UPSERT_BATCH){
      await upsertBatch(normalized.slice(i,i+UPSERT_BATCH),generation,tmpDir,batchNo++);
    }
    exported+=normalized.length;
    offset=Number(page.data?.next_offset ?? (offset+raw.length));
    if(!Number.isFinite(offset) || offset<=0) fail("Invalid next_offset");
  }

  if(exported!==primaryTotal) fail("ETL count mismatch: exported="+exported+" primary="+primaryTotal);

  const genEsc=generation.replace(/'/g,"''");
  const counts=psql(["-At","-F","|","-c",
    `select count(*),count(*) filter(where embedding is not null),count(distinct document_id)
       from public.library_chunks where source_generation='${genEsc}';`
  ]).split("|").map(Number);

  const [mirroredChunks,hydratedEmbeddings,totalBooks]=counts;
  if(mirroredChunks!==primaryTotal) fail("Secondary generation count mismatch");
  if(!(hydratedEmbeddings>0)) fail("Secondary hydrated_embeddings is zero");
  if(!(totalBooks>0)) fail("Secondary total_books is zero");

  const sourceSignature=signature.digest("hex");
  const sigEsc=sourceSignature.replace(/'/g,"''");
  psql(["-q","-c",
    `insert into public.library_manifest(
       id,generation,source_signature,total_books,total_chunks,vector_count,metadata,source_backend,updated_at
     ) values (
       'current','${genEsc}','${sigEsc}',${totalBooks},${mirroredChunks},${hydratedEmbeddings},
       jsonb_build_array(jsonb_build_object('source','cloudflare-primary','verified',true)),
       'supabase-secondary-etl',now()
     )
     on conflict(id) do update set
       generation=excluded.generation,
       source_signature=excluded.source_signature,
       total_books=excluded.total_books,
       total_chunks=excluded.total_chunks,
       vector_count=excluded.vector_count,
       metadata=excluded.metadata,
       source_backend=excluded.source_backend,
       updated_at=now();`
  ]);

  const verify=psql(["-At","-F","|","-c",
    "select total_chunks,vector_count,total_books,generation,source_signature from public.library_manifest where id='current';"
  ]).split("|");
  if(Number(verify[0])!==primaryTotal || Number(verify[1])<=0 || verify[3]!==generation){
    fail("Manifest verification failed");
  }

  await writeStatus({
    state:"hydrated",
    primary_total:primaryTotal,
    mirrored_chunks:mirroredChunks,
    hydrated_embeddings:hydratedEmbeddings,
    total_books:totalBooks,
    generation,
    source_signature:sourceSignature
  });
} catch(error){
  await writeStatus({state:"failed",primary_total:primaryTotal,generation,reason:String(error?.message||error)});
  process.exitCode=1;
} finally {
  await fs.rm(tmpDir,{recursive:true,force:true}).catch(()=>{});
}
