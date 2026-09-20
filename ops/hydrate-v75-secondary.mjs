import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const BASE=String(process.env.FNS_BASE_URL || "https://consciencia-fabiano.focoeepoder2.workers.dev").replace(/\/$/,"");
const SECONDARY=String(process.env.FNS_SECONDARY_URL || "https://bfctgmtidroczuwzhqkg.supabase.co/functions/v1/fns-resilience-secondary").replace(/\/$/,"");
const OWNER=String(process.env.FNS_OWNER_TOKEN || "").trim();
const STATUS_PATH=path.resolve(process.env.ETL_STATUS_PATH || ".ci-results/v75-secondary-hydration.json");
const PAGE_SIZE=200;
const UPSERT_BATCH=200;
const MAX_FETCH_RETRIES=4;

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

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
    source:String(data.source||""),
    source_generation:String(data.source_generation||""),
    reason:String(data.reason||"")
  };
  await fs.writeFile(STATUS_PATH,JSON.stringify(safe,null,2)+"\n");
  console.log("FNS_ETL_STATE="+safe.state);
}

function quotaLike(status,text){
  return status===429 || /quota|free tier|exceeded allowed rows read|too many requests/i.test(String(text||""));
}

async function adminGet(url){
  let last=null;
  for(let attempt=1;attempt<=MAX_FETCH_RETRIES;attempt++){
    try{
      const res=await fetch(url,{headers:{
        "X-FNS-Owner-Token":OWNER,
        "Accept":"application/json"
      }});
      const text=await res.text();
      let data={};
      try{data=JSON.parse(text||"{}");}catch{}
      if(res.ok) return {ok:true,status:res.status,data,text};
      if(quotaLike(res.status,text)) return {ok:false,waiting:true,status:res.status,text};
      last=new Error("Primary HTTP "+res.status+" "+text.slice(0,300));
      if(res.status<500) throw last;
    }catch(error){
      last=error;
    }
    await sleep(Math.min(12000,1200*(2**(attempt-1))));
  }
  throw last || new Error("Primary unavailable");
}

async function secondaryPost(action,body){
  let last=null;
  for(let attempt=1;attempt<=MAX_FETCH_RETRIES;attempt++){
    try{
      const res=await fetch(SECONDARY+"?action="+encodeURIComponent(action),{
        method:"POST",
        headers:{
          "X-FNS-Owner-Token":OWNER,
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body:JSON.stringify(body||{})
      });
      const text=await res.text();
      let data={};
      try{data=JSON.parse(text||"{}");}catch{}
      if(res.ok && data?.ok!==false) return data;
      last=new Error("Secondary "+action+" HTTP "+res.status+" "+String(data?.code||text).slice(0,300));
      if(res.status<500 || res.status===409) throw last;
    }catch(error){
      last=error;
    }
    await sleep(Math.min(12000,1200*(2**(attempt-1))));
  }
  throw last || new Error("Secondary unavailable");
}

function normalizeVector(raw){
  let vector=Array.isArray(raw?.vector)?raw.vector:(Array.isArray(raw?.embedding)?raw.embedding:null);
  if(!vector && typeof raw?.embedding==="string"){
    try{
      const parsed=JSON.parse(raw.embedding);
      if(Array.isArray(parsed)) vector=parsed;
    }catch{}
  }
  if(!Array.isArray(vector)) return null;
  const clean=vector.map(Number);
  return clean.length===384 && clean.every(Number.isFinite) ? clean : null;
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
    vector:normalizeVector(raw),
    source_generation:generation,
    original_r2_key:String(raw?.original_r2_key||raw?.r2_key||"").slice(0,700),
    embedding_model:String(raw?.embedding_model||"").slice(0,180)
  };
}

if(!OWNER){
  await writeStatus({state:"blocked",reason:"missing FNS_OWNER_TOKEN"});
  process.exit(2);
}

let sourceMode="durable-object";
let sourceGeneration="";
let primaryTotal=0;
let probeReason="";
let r2Reason="";

try{
  const r2=await adminGet(BASE+"/api/admin/omni-sync-state");
  const r2Total=Math.max(0,Number(r2?.data?.total||0));
  const r2Vectors=Math.max(0,Number(r2?.data?.vectors||0));
  const r2Authoritative=r2?.data?.authoritative===true;
  if(r2.ok && r2.data?.ok===true && r2Authoritative && r2Total>0 && r2Vectors>0){
    sourceMode="r2";
    primaryTotal=r2Total;
    sourceGeneration=String(r2.data?.generation||"");
    console.log("FNS_ETL_SOURCE=r2-authoritative total="+primaryTotal+" vectors="+r2Vectors+" generation="+sourceGeneration);
  }else if(r2.ok && r2.data?.ok===true && r2Total>0){
    r2Reason="R2 snapshot is non-authoritative or has zero vectors";
  }else{
    r2Reason=r2?.waiting ? "R2 snapshot temporarily unavailable" : "R2 snapshot empty or unreadable";
  }
}catch(error){
  r2Reason="R2 state failed: "+String(error?.message||error).slice(0,220);
}

if(primaryTotal<=0){
  try{
    const probe=await adminGet(BASE+"/api/admin/export-library?mode=cursor&limit=1&include_total=1");
    if(probe.waiting){
      probeReason="primary quota/read limit not reset";
    }else if(probe.ok && probe.data?.ok===true && Number(probe.data?.total||0)>0){
      primaryTotal=Math.max(0,Number(probe.data.total||0));
      sourceMode="durable-object";
      console.log("FNS_ETL_SOURCE=durable-object total="+primaryTotal);
    }else{
      probeReason="primary export endpoint not readable";
    }
  }catch(error){
    const message=String(error?.message||error);
    probeReason=/Error 1101|Worker threw exception/i.test(message)
      ? "primary Cloudflare Worker 1101"
      : "primary export unavailable: "+message.slice(0,220);
  }
}

if(primaryTotal<=0){
  await writeStatus({
    state:"waiting",
    source:"none",
    reason:[probeReason,r2Reason].filter(Boolean).join("; ")
  });
  process.exit(0);
}

const generation="v75-etl-"+Date.now().toString(36);
const signature=crypto.createHash("sha256");
let cursorId="";
let exported=0;

try{
  if(sourceMode==="durable-object"){
    let cursorId="";
    while(exported<primaryTotal){
      const params=new URLSearchParams({
        mode:"cursor",
        limit:String(PAGE_SIZE)
      });
      if(cursorId) params.set("after_id",cursorId);

      const page=await adminGet(BASE+"/api/admin/export-library?"+params.toString());
      if(page.waiting){
        await writeStatus({
          state:"waiting",primary_total:primaryTotal,generation,source:sourceMode,
          reason:"quota returned during cursor ETL; manifest not promoted"
        });
        process.exit(0);
      }
      if(!page.ok || page.data?.ok!==true) throw new Error("Primary cursor export failed after "+exported+" records");

      const raw=Array.isArray(page.data?.records)?page.data.records:[];
      if(!raw.length){
        if(page.data?.done===true && exported===primaryTotal) break;
        throw new Error("Primary cursor ended early at "+exported+" of "+primaryTotal);
      }

      const records=raw.map(r=>normalizeRecord(r,generation));
      for(const row of records){
        signature.update(row.id+"|"+row.document_id+"|"+row.content_hash+"\n");
      }

      for(let i=0;i<records.length;i+=UPSERT_BATCH){
        const batch=records.slice(i,i+UPSERT_BATCH);
        const mirrored=await secondaryPost("mirror_chunks",{generation,records:batch});
        if(Number(mirrored?.records||0)!==batch.length){
          throw new Error("Secondary batch count mismatch after "+exported+" records");
        }
      }

      exported+=records.length;
      const next=page.data?.next_cursor||null;
      if(page.data?.done===true) break;
      if(!next?.id) throw new Error("Primary cursor missing next_cursor");
      if(next.id===cursorId) throw new Error("Primary cursor did not advance");
      cursorId=String(next.id);
    }
  }else{
    let offset=0;
    while(exported<primaryTotal){
      const page=await adminGet(
        BASE+"/api/admin/omni-sync-page?offset="+encodeURIComponent(offset)+"&limit="+encodeURIComponent(PAGE_SIZE)
      );
      if(page.waiting){
        await writeStatus({
          state:"waiting",primary_total:primaryTotal,generation,source:sourceMode,source_generation:sourceGeneration,
          reason:"R2 snapshot temporarily unavailable during ETL"
        });
        process.exit(0);
      }
      if(!page.ok || page.data?.ok!==true) throw new Error("R2 omni-sync page failed at offset "+offset);

      const raw=Array.isArray(page.data?.rows)?page.data.rows:[];
      if(!raw.length){
        if(page.data?.done===true && exported===primaryTotal) break;
        throw new Error("R2 snapshot ended early at "+exported+" of "+primaryTotal);
      }

      const records=raw.map(r=>normalizeRecord(r,generation));
      for(const row of records){
        signature.update(row.id+"|"+row.document_id+"|"+row.content_hash+"\n");
      }

      for(let i=0;i<records.length;i+=UPSERT_BATCH){
        const batch=records.slice(i,i+UPSERT_BATCH);
        const mirrored=await secondaryPost("mirror_chunks",{generation,records:batch});
        if(Number(mirrored?.records||0)!==batch.length){
          throw new Error("Secondary R2 batch count mismatch after "+exported+" records");
        }
      }

      exported+=records.length;
      const nextOffset=Number(page.data?.next_offset ?? (offset+raw.length));
      if(page.data?.done===true) break;
      if(!Number.isFinite(nextOffset) || nextOffset<=offset) throw new Error("R2 snapshot cursor did not advance");
      offset=nextOffset;
    }
  }

  if(exported!==primaryTotal){
    throw new Error("ETL count mismatch: exported="+exported+" primary="+primaryTotal);
  }

  const stats=await secondaryPost("generation_stats",{generation});
  const mirroredChunks=Number(stats?.total_chunks||0);
  const hydratedEmbeddings=Number(stats?.vector_count||0);
  const totalBooks=Number(stats?.total_books||0);

  if(mirroredChunks!==primaryTotal) throw new Error("Secondary generation count mismatch");
  if(!(hydratedEmbeddings>0)) throw new Error("Secondary hydrated_embeddings is zero");
  if(!(totalBooks>0)) throw new Error("Secondary total_books is zero");

  const sourceSignature=signature.digest("hex");
  const promoted=await secondaryPost("mirror_manifest",{
    generation,
    expected_total:primaryTotal,
    source_signature:sourceSignature,
    metadata:[{source:"cloudflare-primary",verified:true}]
  });

  const manifest=promoted?.manifest||{};
  if(Number(manifest?.total_chunks||0)!==primaryTotal ||
     Number(manifest?.vector_count||0)<=0 ||
     Number(manifest?.total_books||0)<=0 ||
     String(manifest?.generation||"")!==generation){
    throw new Error("Manifest verification failed");
  }

  await writeStatus({
    state:"hydrated",
    primary_total:primaryTotal,
    mirrored_chunks:mirroredChunks,
    hydrated_embeddings:hydratedEmbeddings,
    total_books:totalBooks,
    generation,
    source_signature:sourceSignature,
    source:sourceMode,
    source_generation:sourceGeneration
  });
}catch(error){
  await writeStatus({
    state:"failed",
    primary_total:primaryTotal,
    generation,
    source:sourceMode,
    source_generation:sourceGeneration,
    reason:String(error?.message||error)
  });
  process.exitCode=1;
}
