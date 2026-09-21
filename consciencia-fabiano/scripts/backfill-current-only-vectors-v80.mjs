
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE="https://consciencia-fabiano.focoeepoder2.workers.dev";
const SECONDARY="https://bfctgmtidroczuwzhqkg.supabase.co/functions/v1/fns-resilience-secondary";
const BUCKET="consciencia-fabiano-pdfs";
const OWNER=String(process.env.FNS_OWNER_TOKEN||"").trim();
const ACCOUNT=String(process.env.CLOUDFLARE_ACCOUNT_ID||"").trim();
const CF_TOKEN=String(process.env.CLOUDFLARE_API_TOKEN||"").trim();

const EXPECTED_TOTAL=28636;
const EXPECTED_BASELINE=25199;
const EXPECTED_MISSING=3437;
const EMBEDDING_MODEL="Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const EMBEDDING_DIMS=384;
const EMBEDDING_BATCH=Math.max(1,Math.min(24,Number(process.env.FNS_EMBEDDING_BATCH||12)));
const REPORT_PATH=path.resolve(".ci-results/v80-missing-vector-backfill.json");
const IDS_PATH=path.resolve(".ci-results/v80-current-only-missing-ids.json");

for(const [name,value] of Object.entries({
  FNS_OWNER_TOKEN:OWNER,CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_API_TOKEN:CF_TOKEN
})){
  if(!value) throw new Error(name+" is required");
}

const R2_API="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/r2/buckets/"+BUCKET;

const report={
  ok:false,state:"starting",started_at:new Date().toISOString(),
  expected:{chunks:EXPECTED_TOTAL,baseline_vectors:EXPECTED_BASELINE,missing:EXPECTED_MISSING},
  generated_new_embeddings:0,staged_new_rows:0,patched_shards:0,
  tests:[],notes:[]
};

function iso(){return new Date().toISOString();}
function sha256(v){return crypto.createHash("sha256").update(String(v??"")).digest("hex");}
function filenameNorm(v){return String(v||"").normalize("NFC").trim().toLocaleLowerCase("und");}
function textNorm(v){return String(v||"");}
function fingerprint(r){
  return sha256(filenameNorm(r?.filename||r?.title)+"\n"+String(Number(r?.page||0))+"\n"+sha256(textNorm(r?.text)));
}
function vectorOf(r){
  let v=Array.isArray(r?.vector)?r.vector:(Array.isArray(r?.embedding)?r.embedding:null);
  if(!v && typeof r?.embedding==="string"){
    try{v=JSON.parse(r.embedding);}catch{}
  }
  if(!Array.isArray(v))return null;
  const clean=v.map(Number);
  return clean.length===EMBEDDING_DIMS && clean.every(Number.isFinite)?clean:null;
}
function chunkId(r){return String(r?.id||r?.key||"");}
function docId(r){return String(r?.document_id||r?.doc_key||"");}
function contentHash(r){return String(r?.content_hash||r?.content_sha256||sha256(r?.text||"")).toLowerCase();}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function saveReport(){
  await fs.mkdir(path.dirname(REPORT_PATH),{recursive:true});
  report.updated_at=iso();
  await fs.writeFile(REPORT_PATH,JSON.stringify(report,null,2)+"\n");
}
async function fail(message){
  report.ok=false; report.state="failed"; report.error=String(message);
  await saveReport();
  throw new Error(String(message));
}
function quotaLike(error){
  const s=String(error?.name||"")+" "+String(error?.Code||"")+" "+String(error?.message||"");
  return /429|quota|rate.?limit|SlowDown|TooManyRequests|free tier|exceeded/i.test(s);
}
function keyPath(key){
  return String(key||"").split("/").map(encodeURIComponent).join("/");
}
function authHeaders(extra={}){
  return {Authorization:"Bearer "+CF_TOKEN,...extra};
}
async function getObject(key,allowMissing=false){
  const res=await fetch(R2_API+"/objects/"+keyPath(key),{
    headers:authHeaders({Accept:"application/octet-stream"})
  });
  if(res.status===404 && allowMissing)return null;
  if(!res.ok){
    const t=await res.text().catch(()=>"");
    const e=new Error("R2 GET "+res.status+" "+key+" "+t.slice(0,300));
    e.status=res.status; throw e;
  }
  return {
    key,text:await res.text(),metadata:{},
    contentType:res.headers.get("content-type")||"application/json"
  };
}
async function getJson(key,allowMissing=false){
  const o=await getObject(key,allowMissing);
  if(!o)return null;
  return {...o,json:JSON.parse(o.text||"{}")};
}
async function putJson(key,data,metadata={}){
  const res=await fetch(R2_API+"/objects/"+keyPath(key),{
    method:"PUT",
    headers:authHeaders({"Content-Type":"application/json"}),
    body:JSON.stringify(data)
  });
  const text=await res.text().catch(()=>"");
  let parsed={};try{parsed=JSON.parse(text||"{}");}catch{}
  if(!res.ok || parsed?.success===false){
    const e=new Error("R2 PUT "+res.status+" "+key+" "+text.slice(0,400));
    e.status=res.status; throw e;
  }
  return parsed;
}
async function listKeys(prefix){
  const out=[]; let cursor="";
  do{
    const u=new URL(R2_API+"/objects");
    u.searchParams.set("prefix",prefix);
    u.searchParams.set("per_page","1000");
    if(cursor)u.searchParams.set("cursor",cursor);
    const res=await fetch(u,{headers:authHeaders({Accept:"application/json"})});
    const text=await res.text();
    let data={};try{data=JSON.parse(text||"{}");}catch{}
    if(!res.ok || data?.success===false){
      const e=new Error("R2 LIST "+res.status+" "+text.slice(0,400));
      e.status=res.status;throw e;
    }
    for(const x of (Array.isArray(data?.result)?data.result:[])) if(x?.key)out.push(String(x.key));
    cursor=data?.result_info?.is_truncated?String(data?.result_info?.cursor||""):"";
  }while(cursor);
  return out.sort();
}

async function secondary(action,payload={}){
  let last;
  for(let attempt=0;attempt<5;attempt++){
    try{
      const res=await fetch(SECONDARY+"?action="+encodeURIComponent(action),{
        method:"POST",
        headers:{
          "X-FNS-Owner-Token":OWNER,
          "Content-Type":"application/json",
          "Accept":"application/json",
          "User-Agent":"curl/8.5.0"
        },
        body:JSON.stringify(payload)
      });
      const text=await res.text();
      let data={}; try{data=JSON.parse(text||"{}");}catch{}
      if(res.ok && data?.ok!==false) return data;
      const err=new Error("secondary "+action+" HTTP "+res.status+" "+String(data?.code||data?.message||text).slice(0,500));
      err.status=res.status;
      if(res.status===429 || res.status>=500) throw err;
      throw err;
    }catch(e){
      last=e;
      if(attempt===4)break;
      await sleep(Math.min(10000,800*(2**attempt)));
    }
  }
  throw last||new Error("secondary request failed");
}
async function exportGeneration(generation,targetIds=null){
  const rows=new Map();
  let after=""; let seen=0;
  while(true){
    const page=await secondary("export_generation",{generation,after_id:after,limit:100});
    const recs=Array.isArray(page?.records)?page.records:[];
    for(const r of recs){
      seen++;
      const id=chunkId(r);
      if(!targetIds || targetIds.has(id)) rows.set(id,r);
    }
    if(page?.done===true || !recs.length)break;
    const next=String(page?.next_id||"");
    if(!next || next===after) throw new Error("secondary export cursor stalled");
    after=next;
  }
  return {rows,seen};
}

let extractorPromise=null;
async function getExtractor(){
  if(!extractorPromise){
    extractorPromise=(async()=>{
      const mod=await import("@xenova/transformers");
      mod.env.allowLocalModels=false;
      mod.env.allowRemoteModels=true;
      mod.env.cacheDir=".cache/transformers";
      return mod.pipeline("feature-extraction",EMBEDDING_MODEL,{quantized:true});
    })();
  }
  return extractorPromise;
}
function tensorRows(output,expected){
  const list=typeof output?.tolist==="function"?output.tolist():[];
  if(expected===1 && Array.isArray(list) && list.length===EMBEDDING_DIMS && list.every(Number.isFinite))return [list];
  if(Array.isArray(list) && list.length===expected && list.every(x=>Array.isArray(x)&&x.length===EMBEDDING_DIMS))return list;
  return [];
}
async function embedTexts(texts){
  const extractor=await getExtractor();
  let rows=[];
  try{
    const out=await extractor(texts,{pooling:"mean",normalize:true});
    rows=tensorRows(out,texts.length);
  }catch{}
  if(rows.length!==texts.length){
    rows=[];
    for(const text of texts){
      const out=await extractor(text,{pooling:"mean",normalize:true});
      const one=tensorRows(out,1);
      if(one.length!==1) throw new Error("invalid embedding tensor");
      rows.push(one[0]);
    }
  }
  for(const v of rows){
    if(!Array.isArray(v)||v.length!==EMBEDDING_DIMS||!v.every(Number.isFinite)){
      throw new Error("embedding dimension mismatch");
    }
  }
  return rows;
}
function normalizedMirrorRow(r,vector=null,generation=""){
  const row={
    id:chunkId(r),document_id:docId(r),
    filename:String(r?.filename||r?.title||"Documento"),
    title:String(r?.title||r?.filename||"Documento"),
    author:String(r?.author||""),
    language:String(r?.language||"pt"),
    page:Number(r?.page||0)||0,chunk_index:Number(r?.chunk_index||0)||0,
    text:String(r?.text||""),
    content_hash:contentHash(r),
    source_generation:generation,
    original_r2_key:String(r?.original_r2_key||r?.r2_key||r?.metadata?.original_r2_key||""),
    embedding_model:EMBEDDING_MODEL
  };
  if(vector)row.vector=vector;
  return row;
}

function querySlices(text){
  const words=String(text||"").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  const slices=[];
  if(words.length>=12){
    slices.push(words.slice(0,Math.min(18,words.length)).join(" "));
    const mid=Math.max(0,Math.floor(words.length/2)-8);
    slices.push(words.slice(mid,Math.min(words.length,mid+16)).join(" "));
    slices.push(words.slice(Math.max(0,words.length-18)).join(" "));
  }else if(words.length>=5) slices.push(words.join(" "));
  return [...new Set(slices.map(x=>x.slice(0,500)).filter(x=>x.length>=20))];
}
async function ragSearch(question,embedding){
  const res=await fetch(BASE+"/api/rag/search",{
    method:"POST",
    headers:{"Content-Type":"application/json","User-Agent":"curl/8.5.0"},
    body:JSON.stringify({question,query_embedding:embedding})
  });
  const text=await res.text();
  let data={}; try{data=JSON.parse(text||"{}");}catch{}
  if(!res.ok) throw new Error("RAG HTTP "+res.status+" "+text.slice(0,400));
  return data;
}

async function main(){
  await saveReport();

  const pointerObj=await getJson("library/current.json");
  const pointer=pointerObj.json||{};
  const generation=String(pointer.generation||"");
  if(!generation) return fail("R2 current generation missing");
  if(Number(pointer.chunks||0)!==EXPECTED_TOTAL) return fail("R2 chunks must be 28636");
  if(!["recovery-merge-v8"].includes(String(pointer.source||""))) return fail("unexpected R2 source "+String(pointer.source||""));

  report.r2_before={
    generation,chunks:Number(pointer.chunks||0),vectors:Number(pointer.vectors||0),
    documents:Number(pointer.documents||0),shards:Number(pointer.shards||0)
  };

  const manifestKey=String(pointer.manifest_key||("library/generations/"+generation+"/manifest.json"));
  const manifestObj=await getJson(manifestKey);
  const manifest=manifestObj.json||{};

  const shardPrefix="library/generations/"+generation+"/shards/";
  const keys=(await listKeys(shardPrefix)).filter(k=>k.endsWith(".json"));
  if(keys.length!==Number(pointer.shards||0)) return fail("R2 shard count mismatch");

  const shardMap=new Map();
  const rowRefs=new Map();
  let totalRows=0, vectorRows=0;
  for(const key of keys){
    const obj=await getJson(key);
    const payload=obj.json||{};
    const rows=Array.isArray(payload.rows)?payload.rows:[];
    shardMap.set(key,{...obj,payload,rows});
    for(let i=0;i<rows.length;i++){
      const r=rows[i],id=chunkId(r);
      if(!id||!docId(r)||!String(r?.text||"")) return fail("invalid R2 row in "+key);
      if(rowRefs.has(id)) return fail("duplicate R2 chunk id "+id);
      rowRefs.set(id,{key,index:i,row:r});
      totalRows++;
      if(vectorOf(r))vectorRows++;
    }
  }
  if(totalRows!==EXPECTED_TOTAL)return fail("R2 row audit mismatch "+totalRows);

  const checkpointKey="library/vector-backfill-checkpoints/"+generation+".json";
  let checkpoint=(await getJson(checkpointKey,true))?.json||null;
  let targets=[];

  if(checkpoint?.target_ids?.length){
    targets=checkpoint.target_ids.map(x=>String(x));
    if(targets.length!==EXPECTED_MISSING)return fail("checkpoint target count mismatch");
  }else{
    if(vectorRows!==EXPECTED_BASELINE || Number(pointer.vectors||0)!==EXPECTED_BASELINE){
      return fail("first-run vector baseline must be exactly 25199");
    }

    const sm=await secondary("manifest",{});
    const baseGeneration=String(sm?.generation||"");
    if(!baseGeneration)return fail("secondary manifest generation missing");
    if(Number(sm?.total_chunks||0)!==EXPECTED_BASELINE || Number(sm?.vector_count||0)!==EXPECTED_BASELINE){
      return fail("secondary baseline must be 25199/25199 before target-list creation");
    }

    const exported=await exportGeneration(baseGeneration,null);
    if(exported.seen!==EXPECTED_BASELINE)return fail("baseline export count mismatch "+exported.seen);
    const baseFingerprints=new Set();
    for(const r of exported.rows.values()){
      if(!vectorOf(r))return fail("baseline row without vector "+chunkId(r));
      baseFingerprints.add(fingerprint(r));
    }

    const missing=[];
    for(const {row} of rowRefs.values()) if(!vectorOf(row)) missing.push(row);
    missing.sort((a,b)=>chunkId(a).localeCompare(chunkId(b)));
    if(missing.length!==EXPECTED_MISSING)return fail("missing-vector target count "+missing.length+" != 3437");

    for(const r of missing){
      if(baseFingerprints.has(fingerprint(r))){
        return fail("vectorless row overlaps verified baseline: "+chunkId(r));
      }
    }
    targets=missing.map(chunkId);

    const listPayload={
      version:1,generation,created_at:iso(),
      invariant:"current_only && has_vector=false",
      count:targets.length,
      rows:missing.map(r=>({
        chunk_id:chunkId(r),document_id:docId(r),filename:String(r?.filename||""),
        page:Number(r?.page||0),chunk_index:Number(r?.chunk_index||0),
        content_hash:contentHash(r),fingerprint:fingerprint(r)
      }))
    };
    await fs.mkdir(path.dirname(IDS_PATH),{recursive:true});
    await fs.writeFile(IDS_PATH,JSON.stringify(listPayload,null,2)+"\n");
    checkpoint={
      version:1,generation,state:"targets-frozen",created_at:iso(),
      target_ids:targets,target_list_sha256:sha256(JSON.stringify(listPayload.rows)),
      generated_new_embeddings:0,completed_shards:[],last_update:iso()
    };
    await putJson(checkpointKey,checkpoint,{kind:"vector-backfill-checkpoint",generation});
  }

  const targetSet=new Set(targets);
  report.target_count=targets.length;
  report.target_list_sha256=String(checkpoint.target_list_sha256||"");

  for(const id of targets){
    if(!rowRefs.has(id))return fail("target missing from current R2 "+id);
  }

  const sm=await secondary("manifest",{});
  const activeGeneration=String(sm?.generation||"");
  if(!activeGeneration)return fail("active secondary generation missing");

  // Inspect only target IDs in the active secondary generation.
  let targetSecondary=(await exportGeneration(activeGeneration,targetSet)).rows;

  const absent=[];
  for(const id of targets) if(!targetSecondary.has(id)) absent.push(id);
  for(let i=0;i<absent.length;i+=200){
    const ids=absent.slice(i,i+200);
    const recs=ids.map(id=>normalizedMirrorRow(rowRefs.get(id).row,null,activeGeneration));
    const out=await secondary("mirror_chunks",{generation:activeGeneration,records:recs});
    if(Number(out?.records||0)!==recs.length)return fail("secondary text staging mismatch");
    report.staged_new_rows+=recs.length;
  }

  let stats=await secondary("generation_stats",{generation:activeGeneration});
  if(Number(stats?.total_chunks||0)!==EXPECTED_TOTAL){
    return fail("secondary chunk total after staging is "+Number(stats?.total_chunks||0));
  }

  // Refresh target rows so resume/idempotency can reuse already-persisted vectors.
  targetSecondary=(await exportGeneration(activeGeneration,targetSet)).rows;
  const vectorMap=new Map();
  for(const id of targets){
    const v=vectorOf(targetSecondary.get(id));
    if(v)vectorMap.set(id,v);
  }

  const needGenerate=targets.filter(id=>!vectorMap.has(id));
  report.missing_before_generation=needGenerate.length;

  for(let i=0;i<needGenerate.length;i+=EMBEDDING_BATCH){
    const ids=needGenerate.slice(i,i+EMBEDDING_BATCH);
    const rows=ids.map(id=>rowRefs.get(id).row);
    const texts=rows.map(r=>String(r.text||"").replace(/\s+/g," ").trim().slice(0,2400));
    const vectors=await embedTexts(texts);

    const payload=rows.map((r,j)=>normalizedMirrorRow(r,vectors[j],activeGeneration));
    const out=await secondary("mirror_embeddings",{generation:activeGeneration,records:payload});
    if(Number(out?.embeddings||0)!==payload.length)return fail("secondary embedding batch mismatch");

    for(let j=0;j<ids.length;j++)vectorMap.set(ids[j],vectors[j]);
    report.generated_new_embeddings+=ids.length;

    const after=await secondary("generation_stats",{generation:activeGeneration});
    const expectedMin=EXPECTED_BASELINE+vectorMap.size;
    if(Number(after?.vector_count||0)<expectedMin){
      return fail("secondary vector persistence did not advance after batch");
    }

    checkpoint.generated_new_embeddings=Number(checkpoint.generated_new_embeddings||0)+ids.length;
    checkpoint.last_embedding_id=ids[ids.length-1];
    checkpoint.last_update=iso();
    checkpoint.state="embedding";
    await putJson(checkpointKey,checkpoint,{kind:"vector-backfill-checkpoint",generation});
  }

  if(vectorMap.size!==EXPECTED_MISSING)return fail("not all target vectors available after embedding phase");

  stats=await secondary("generation_stats",{generation:activeGeneration});
  if(Number(stats?.total_chunks||0)!==EXPECTED_TOTAL || Number(stats?.vector_count||0)!==EXPECTED_TOTAL){
    return fail("secondary must be 28636/28636 before R2 patch");
  }

  // Patch only shards containing target IDs whose R2 row still lacks a vector.
  const affectedKeys=new Set();
  for(const id of targets){
    const ref=rowRefs.get(id);
    if(!vectorOf(ref.row))affectedKeys.add(ref.key);
  }

  for(const key of [...affectedKeys].sort()){
    const shard=shardMap.get(key);
    const before=shard.rows.map(r=>({
      id:chunkId(r),document_id:docId(r),content_hash:contentHash(r),text_hash:sha256(r?.text||"")
    }));
    let changed=0;
    for(const r of shard.rows){
      const id=chunkId(r);
      if(!targetSet.has(id) || vectorOf(r))continue;
      const v=vectorMap.get(id);
      if(!v)return fail("missing vector for R2 patch "+id);
      r.vector=v;
      r.embedding_model=EMBEDDING_MODEL;
      changed++;
    }
    if(!changed)continue;

    const afterInvariant=shard.rows.map(r=>({
      id:chunkId(r),document_id:docId(r),content_hash:contentHash(r),text_hash:sha256(r?.text||"")
    }));
    if(JSON.stringify(before)!==JSON.stringify(afterInvariant)){
      return fail("chunk identity/content mutation detected in "+key);
    }

    shard.payload.rows=shard.rows;
    shard.payload.count=shard.rows.length;
    shard.payload.updated_at=iso();

    await putJson(key,shard.payload);

    const verify=await getJson(key);
    const verifiedRows=Array.isArray(verify.json?.rows)?verify.json.rows:[];
    if(verifiedRows.length!==shard.rows.length)return fail("R2 shard length changed "+key);
    for(let i=0;i<verifiedRows.length;i++){
      const a=before[i],r=verifiedRows[i];
      if(chunkId(r)!==a.id || docId(r)!==a.document_id ||
         contentHash(r)!==a.content_hash || sha256(r?.text||"")!==a.text_hash){
        return fail("R2 shard identity/hash verification failed "+key);
      }
      if(targetSet.has(a.id) && !vectorOf(r))return fail("R2 vector not persisted "+a.id);
    }

    report.patched_shards++;
    checkpoint.completed_shards=[...new Set([...(checkpoint.completed_shards||[]),key])].sort();
    checkpoint.last_update=iso();
    checkpoint.state="r2-patching";
    await putJson(checkpointKey,checkpoint,{kind:"vector-backfill-checkpoint",generation});
  }

  // Full R2 audit after patching.
  let fullVectorCount=0;
  for(const key of keys){
    const verify=await getJson(key);
    for(const r of (Array.isArray(verify.json?.rows)?verify.json.rows:[])){
      if(vectorOf(r))fullVectorCount++;
    }
  }
  if(fullVectorCount!==EXPECTED_TOTAL)return fail("R2 full vector count "+fullVectorCount+" != 28636");

  // Preserve previous metadata before updating only vector counters.
  const backupPrefix="library/vector-backfill-checkpoints/"+generation;
  await putJson(backupPrefix+".previous-pointer.json",pointerObj.json,{kind:"vector-backfill-previous-pointer",generation});
  await putJson(backupPrefix+".previous-manifest.json",manifestObj.json,{kind:"vector-backfill-previous-manifest",generation});

  const now=iso();
  const newManifest={...manifest,vector_count:EXPECTED_TOTAL,total_chunks:EXPECTED_TOTAL,updated_at:now,
    vector_backfill:{completed_at:now,target_count:EXPECTED_MISSING,model:EMBEDDING_MODEL,dimensions:EMBEDDING_DIMS,reindex:false}};
  const newPointer={...pointer,vectors:EXPECTED_TOTAL,chunks:EXPECTED_TOTAL,updated_at:now};

  await putJson(manifestKey,newManifest,manifestObj.metadata||{generation,source:String(pointer.source||"")});
  await putJson("library/current.json",newPointer,pointerObj.metadata||{generation,source:String(pointer.source||"")});

  const verifyPointer=(await getJson("library/current.json")).json;
  const verifyManifest=(await getJson(manifestKey)).json;
  if(Number(verifyPointer?.chunks||0)!==EXPECTED_TOTAL || Number(verifyPointer?.vectors||0)!==EXPECTED_TOTAL ||
     Number(verifyManifest?.total_chunks||0)!==EXPECTED_TOTAL || Number(verifyManifest?.vector_count||0)!==EXPECTED_TOTAL){
    return fail("R2 pointer/manifest final vector counters invalid");
  }

  // Promote secondary manifest only after both stores have 28,636 vectors.
  const sig=await secondary("generation_signature",{generation:activeGeneration});
  const sourceSignature=String(sig?.source_signature||"");
  if(!/^[0-9a-f]{64}$/i.test(sourceSignature))return fail("secondary source signature invalid");
  const promoted=await secondary("mirror_manifest",{
    generation:activeGeneration,expected_total:EXPECTED_TOTAL,source_signature:sourceSignature,
    metadata:[{source:"v8-current-only-vector-backfill",verified:true,
      generated_only_missing:true,target_count:EXPECTED_MISSING,
      embedding_model:EMBEDDING_MODEL,embedding_dimensions:EMBEDDING_DIMS,reindex:false}]
  });
  if(Number(promoted?.manifest?.total_chunks||0)!==EXPECTED_TOTAL ||
     Number(promoted?.manifest?.vector_count||0)!==EXPECTED_TOTAL){
    return fail("secondary manifest final gate failed");
  }

  // Directed RAG tests: use only target chunks and require current_only target IDs to be returned.
  const candidateTargets=targets.map(id=>rowRefs.get(id).row)
    .filter(r=>String(r?.text||"").replace(/\s+/g," ").trim().length>=120)
    .sort((a,b)=>{
      const d=docId(a).localeCompare(docId(b)); if(d)return d;
      return chunkId(a).localeCompare(chunkId(b));
    });

  const selected=[];
  const usedDocs=new Set();
  for(const r of candidateTargets){
    if(!usedDocs.has(docId(r))){selected.push(r);usedDocs.add(docId(r));}
    if(selected.length>=5)break;
  }
  for(const r of candidateTargets){
    if(selected.length>=5)break;
    if(!selected.some(x=>chunkId(x)===chunkId(r)))selected.push(r);
  }

  let successes=0;
  for(const target of selected){
    const targetId=chunkId(target);
    let hit=null,usedQuery="";
    for(const q of querySlices(target.text)){
      const [qv]=await embedTexts([q]);
      const rag=await ragSearch(q,qv);
      const matches=Array.isArray(rag?.matches)?rag.matches:[];
      const idx=matches.findIndex(m=>String(m?.id||m?.chunk_id||"")===targetId);
      if(idx>=0){
        hit=matches[idx];
        usedQuery=q;
        report.tests.push({
          query:q,chunk_id:targetId,document_id:docId(target),
          score:Number(hit?.score||0),lexical_score:Number(hit?.lexical_score||0),
          semantic_score:Number(hit?.semantic_score||0),
          retrieval_mode:String(hit?.retrieval_mode||""),
          origin:"current_only",formerly_without_vector:true,
          r2_generation:generation,rank:idx+1,
          embedding_present:true,content_hash:contentHash(target)
        });
        successes++;
        break;
      }
    }
    if(!hit){
      report.tests.push({
        query:querySlices(target.text)[0]||String(target.text).slice(0,300),
        chunk_id:targetId,document_id:docId(target),origin:"current_only",
        formerly_without_vector:true,embedding_present:true,returned:false,
        content_hash:contentHash(target)
      });
    }
  }
  if(successes<3)return fail("directed RAG proof insufficient: "+successes+" current_only hits");

  const finalStats=await secondary("generation_stats",{generation:activeGeneration});
  if(Number(finalStats?.total_chunks||0)!==EXPECTED_TOTAL || Number(finalStats?.vector_count||0)!==EXPECTED_TOTAL){
    return fail("secondary final stats regressed");
  }

  checkpoint.state="completed";
  checkpoint.completed_at=iso();
  checkpoint.r2_vectors=EXPECTED_TOTAL;
  checkpoint.secondary_vectors=EXPECTED_TOTAL;
  checkpoint.last_update=iso();
  await putJson(checkpointKey,checkpoint,{kind:"vector-backfill-checkpoint",generation});

  report.ok=true;
  report.state="completed";
  report.result="28636-chunks-28636-vectors";
  report.r2_after={generation,chunks:EXPECTED_TOTAL,vectors:EXPECTED_TOTAL,shards:keys.length};
  report.secondary_after={generation:activeGeneration,chunks:Number(finalStats.total_chunks||0),vectors:Number(finalStats.vector_count||0)};
  report.directed_rag_successes=successes;
  await saveReport();

  console.log("V80_VECTOR_BACKFILL_SUCCESS=yes");
  console.log("V80_VECTOR_BACKFILL_GENERATED_NEW="+report.generated_new_embeddings);
  console.log("V80_VECTOR_BACKFILL_TARGETS="+targets.length);
  console.log("V80_VECTOR_BACKFILL_R2_VECTORS="+EXPECTED_TOTAL);
  console.log("V80_VECTOR_BACKFILL_SECONDARY_VECTORS="+EXPECTED_TOTAL);
  console.log("V80_VECTOR_BACKFILL_RAG_SUCCESSES="+successes);
}

main().catch(async e=>{
  if(quotaLike(e)){
    report.ok=false;report.state="waiting-quota";report.error=String(e?.message||e);
    report.notes.push("Checkpoint preserved; rerun resumes without recalculating persisted vectors.");
    await saveReport();
    console.log("V80_VECTOR_BACKFILL_WAITING_QUOTA=yes");
    process.exit(0);
  }
  if(report.state!=="failed"){
    report.ok=false;report.state="failed";report.error=String(e?.stack||e?.message||e);
    await saveReport().catch(()=>{});
  }
  console.error(e);
  process.exit(1);
});
