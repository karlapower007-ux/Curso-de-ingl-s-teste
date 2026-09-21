import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const BASE=String(process.env.FNS_BASE_URL || "https://consciencia-fabiano.focoeepoder2.workers.dev").replace(/\/$/,"");
const SECONDARY=String(process.env.FNS_SECONDARY_URL || "https://bfctgmtidroczuwzhqkg.supabase.co/functions/v1/fns-resilience-secondary").replace(/\/$/,"");
const OWNER=String(process.env.FNS_OWNER_TOKEN || "").trim();
const STATUS_PATH=path.resolve(process.env.ETL_STATUS_PATH || ".ci-results/v75-secondary-hydration.json");
const PAGE_SIZE=200;
const UPSERT_BATCH=200;
const EMBEDDING_BATCH=Math.max(1,Math.min(32,Number(process.env.FNS_EMBEDDING_BATCH || 16)));
const MAX_FETCH_RETRIES=4;
const EMBEDDING_MODEL="Xenova/paraphrase-multilingual-MiniLM-L12-v2";

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
    cursor_id:String(data.cursor_id||""),
    embedding_cursor_id:String(data.embedding_cursor_id||""),
    reason:String(data.reason||"")
  };
  await fs.writeFile(STATUS_PATH,JSON.stringify(safe,null,2)+"\n");
  console.log("FNS_ETL_STATE="+safe.state+
    " mirrored="+safe.mirrored_chunks+
    " embeddings="+safe.hydrated_embeddings+
    " primary="+safe.primary_total);
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
      last=new Error("Secondary "+action+" HTTP "+res.status+" "+String(data?.code||data?.message||text).slice(0,500));
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
    original_r2_key:String(raw?.original_r2_key||raw?.r2_key||raw?.metadata?.original_r2_key||"").slice(0,700),
    embedding_model:String(raw?.embedding_model||raw?.metadata?.embedding_model||EMBEDDING_MODEL).slice(0,180)
  };
}

let extractorPromise=null;
async function getExtractor(){
  if(!extractorPromise){
    extractorPromise=(async()=>{
      const mod=await import("@xenova/transformers");
      mod.env.allowLocalModels=false;
      mod.env.allowRemoteModels=true;
      mod.env.cacheDir=String(process.env.TRANSFORMERS_CACHE || ".cache/transformers");
      console.log("FNS_EMBEDDING_MODEL_LOAD="+EMBEDDING_MODEL);
      return mod.pipeline("feature-extraction",EMBEDDING_MODEL,{quantized:true});
    })();
  }
  return extractorPromise;
}

function tensorRows(output,expected){
  const list=typeof output?.tolist==="function" ? output.tolist() : [];
  if(!Array.isArray(list)) return [];
  if(expected===1 && list.length===384 && list.every(Number.isFinite)) return [list];
  if(list.length===expected && list.every(row=>Array.isArray(row))) return list;
  return [];
}

async function embedRecords(records){
  const rows=records.map(r=>({...r}));
  const pending=[];
  for(let i=0;i<rows.length;i++){
    if(!normalizeVector(rows[i])) pending.push(i);
  }
  if(!pending.length) return rows;

  const extractor=await getExtractor();
  for(let p=0;p<pending.length;p+=EMBEDDING_BATCH){
    const indexes=pending.slice(p,p+EMBEDDING_BATCH);
    const texts=indexes.map(i=>{
      const t=String(rows[i].text||"").replace(/\s+/g," ").trim();
      return t.slice(0,2400);
    });
    let vectors=[];
    try{
      const out=await extractor(texts,{pooling:"mean",normalize:true});
      vectors=tensorRows(out,texts.length);
    }catch(error){
      console.log("FNS_EMBEDDING_BATCH_FALLBACK="+String(error?.message||error).slice(0,180));
    }

    if(vectors.length!==texts.length){
      vectors=[];
      for(const text of texts){
        const out=await extractor(text,{pooling:"mean",normalize:true});
        const one=tensorRows(out,1);
        if(one.length!==1) throw new Error("Local embedding model returned invalid tensor");
        vectors.push(one[0]);
      }
    }

    for(let j=0;j<indexes.length;j++){
      const vec=(vectors[j]||[]).map(Number);
      if(vec.length!==384 || !vec.every(Number.isFinite)){
        throw new Error("Local embedding dimension mismatch");
      }
      rows[indexes[j]].vector=vec;
      rows[indexes[j]].embedding_model=EMBEDDING_MODEL;
    }
  }
  return rows;
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

let generation="v75-etl-"+Date.now().toString(36);
let cursorId="";
let exported=0;
let resumeVectors=0;
let totalBooks=0;

try{
  const resume=await secondaryPost("resume_state",{});
  const resumable=String(resume?.generation||"") &&
    Number(resume?.total_chunks||0)>0 &&
    Number(resume?.total_chunks||0)<=primaryTotal;

  if(resumable){
    generation=String(resume.generation);
    const existingChunks=Number(resume.total_chunks||0);
    resumeVectors=Number(resume.vector_count||0);
    totalBooks=Number(resume.total_books||0);

    if(existingChunks===primaryTotal){
      exported=primaryTotal;
      cursorId=String(resume.last_id||"");
      console.log("FNS_ETL_RESUME=complete-text generation="+generation+
        " mirrored="+existingChunks+
        " vectors="+resumeVectors);
    }else if(sourceMode==="durable-object"){
      // The existing 2,200-row generation was produced from an older R2 snapshot.
      // A DO keyset cursor cannot safely continue from the R2 offset ordering.
      // Re-scan the authoritative DO cursor from the beginning, but keep the
      // same generation and idempotently upsert by chunk id. Existing rows are
      // reused rather than deleted/recreated; this prevents gaps/duplication.
      exported=0;
      cursorId="";
      console.log("FNS_ETL_RESUME=cross-source-idempotent-revalidation generation="+generation+
        " existing="+existingChunks+
        " primary="+primaryTotal+
        " vectors="+resumeVectors);
    }else{
      exported=existingChunks;
      cursorId=String(resume.last_id||"");
      console.log("FNS_ETL_RESUME=yes generation="+generation+
        " mirrored="+exported+
        " vectors="+resumeVectors+
        " after_id="+cursorId);
    }
  }else{
    console.log("FNS_ETL_RESUME=no generation="+generation);
  }

  if(sourceMode==="durable-object"){
    while(exported<primaryTotal){
      const params=new URLSearchParams({
        mode:"cursor",
        limit:String(PAGE_SIZE)
      });
      if(cursorId) params.set("after_id",cursorId);

      const page=await adminGet(BASE+"/api/admin/export-library?"+params.toString());
      if(page.waiting){
        const stats=await secondaryPost("generation_stats",{generation}).catch(()=>({}));
        await writeStatus({
          state:"waiting",
          primary_total:primaryTotal,
          mirrored_chunks:Number(stats?.total_chunks||exported),
          hydrated_embeddings:Number(stats?.vector_count||resumeVectors),
          total_books:Number(stats?.total_books||totalBooks),
          generation,source:sourceMode,cursor_id:cursorId,
          reason:"quota returned during cursor ETL; resume cursor preserved"
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
      for(let i=0;i<records.length;i+=UPSERT_BATCH){
        const batch=records.slice(i,i+UPSERT_BATCH);
        const mirrored=await secondaryPost("mirror_chunks",{generation,records:batch});
        if(Number(mirrored?.records||0)!==batch.length){
          throw new Error("Secondary batch count mismatch after "+exported+" records");
        }
      }

      exported+=records.length;
      const next=page.data?.next_cursor||null;
      if(next?.id) cursorId=String(next.id);

      if(exported%2000===0 || exported===primaryTotal){
        const stats=await secondaryPost("generation_stats",{generation}).catch(()=>({}));
        await writeStatus({
          state:"loading",
          primary_total:primaryTotal,
          mirrored_chunks:Number(stats?.total_chunks||exported),
          hydrated_embeddings:Number(stats?.vector_count||resumeVectors),
          total_books:Number(stats?.total_books||totalBooks),
          generation,source:sourceMode,cursor_id:cursorId,
          reason:"resumable cursor ETL in progress"
        });
      }

      if(page.data?.done===true) break;
      if(!next?.id) throw new Error("Primary cursor missing next_cursor");
    }
  }else{
    let offset=exported;
    while(exported<primaryTotal){
      const page=await adminGet(
        BASE+"/api/admin/omni-sync-page?offset="+encodeURIComponent(offset)+"&limit="+encodeURIComponent(PAGE_SIZE)
      );
      if(page.waiting){
        const stats=await secondaryPost("generation_stats",{generation}).catch(()=>({}));
        await writeStatus({
          state:"waiting",primary_total:primaryTotal,
          mirrored_chunks:Number(stats?.total_chunks||exported),
          hydrated_embeddings:Number(stats?.vector_count||resumeVectors),
          total_books:Number(stats?.total_books||totalBooks),
          generation,source:sourceMode,source_generation:sourceGeneration,
          reason:"R2 snapshot temporarily unavailable during resumable ETL"
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

  const textStats=await secondaryPost("generation_stats",{generation});
  if(Number(textStats?.total_chunks||0)!==primaryTotal){
    throw new Error("Secondary generation count mismatch after resume: mirrored="+Number(textStats?.total_chunks||0)+" primary="+primaryTotal);
  }
  console.log("FNS_ETL_TEXT_MIRROR_COMPLETE="+primaryTotal);

  let embeddingCursor="";
  let embeddingsAdded=Number(textStats?.vector_count||0);
  while(embeddingsAdded<primaryTotal){
    const missing=await secondaryPost("missing_embeddings",{
      generation,
      after_id:embeddingCursor,
      limit:EMBEDDING_BATCH
    });
    const rows=Array.isArray(missing?.records)?missing.records:[];
    if(!rows.length) break;

    const normalized=rows.map(r=>normalizeRecord(r,generation));
    const embedded=await embedRecords(normalized);
    const mirrored=await secondaryPost("mirror_embeddings",{generation,records:embedded});
    if(Number(mirrored?.embeddings||0)!==embedded.length){
      throw new Error("Embedding mirror count mismatch at cursor "+embeddingCursor);
    }

    embeddingCursor=String(embedded[embedded.length-1]?.id||embeddingCursor);
    embeddingsAdded+=embedded.length;

    if(embeddingsAdded%512===0 || embeddingsAdded>=primaryTotal){
      const stats=await secondaryPost("generation_stats",{generation});
      embeddingsAdded=Number(stats?.vector_count||embeddingsAdded);
      await writeStatus({
        state:"embedding",
        primary_total:primaryTotal,
        mirrored_chunks:Number(stats?.total_chunks||primaryTotal),
        hydrated_embeddings:embeddingsAdded,
        total_books:Number(stats?.total_books||0),
        generation,source:sourceMode,source_generation:sourceGeneration,
        cursor_id:cursorId,embedding_cursor_id:embeddingCursor,
        reason:"local free-tier embedding backfill in progress"
      });
    }
  }

  const stats=await secondaryPost("generation_stats",{generation});
  const mirroredChunks=Number(stats?.total_chunks||0);
  const hydratedEmbeddings=Number(stats?.vector_count||0);
  totalBooks=Number(stats?.total_books||0);

  if(mirroredChunks!==primaryTotal) throw new Error("Secondary generation count mismatch");
  if(hydratedEmbeddings!==primaryTotal) throw new Error("Secondary embedding count mismatch: vectors="+hydratedEmbeddings+" primary="+primaryTotal);
  if(!(totalBooks>0)) throw new Error("Secondary total_books is zero");

  const sig=await secondaryPost("generation_signature",{generation});
  const sourceSignature=String(sig?.source_signature||"");
  if(!/^[a-f0-9]{64}$/i.test(sourceSignature)) throw new Error("Secondary generation signature invalid");

  const promoted=await secondaryPost("mirror_manifest",{
    generation,
    expected_total:primaryTotal,
    source_signature:sourceSignature,
    metadata:[{
      source:"cloudflare-primary",
      verified:true,
      embedding_model:EMBEDDING_MODEL,
      embedding_dimensions:384,
      resumed_from_existing_chunks:true
    }]
  });

  const manifest=promoted?.manifest||{};
  if(Number(manifest?.total_chunks||0)!==primaryTotal ||
     Number(manifest?.vector_count||0)!==primaryTotal ||
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
    source_generation:sourceGeneration,
    cursor_id:cursorId,
    embedding_cursor_id:"",
    reason:""
  });
}catch(error){
  const stats=await secondaryPost("generation_stats",{generation}).catch(()=>({}));
  await writeStatus({
    state:"failed",
    primary_total:primaryTotal,
    mirrored_chunks:Number(stats?.total_chunks||exported),
    hydrated_embeddings:Number(stats?.vector_count||resumeVectors),
    total_books:Number(stats?.total_books||totalBooks),
    generation,
    source:sourceMode,
    source_generation:sourceGeneration,
    cursor_id:cursorId,
    reason:String(error?.message||error)
  });
  process.exitCode=1;
}
