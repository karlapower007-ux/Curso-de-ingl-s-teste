const V2_VECTOR_DB="fns_qwen_vectors_v2";
const V2_VECTOR_DB_VERSION=1;
const LEGACY_RAG_DB="fns_rag_resilience_v1";
const EMBED_MODEL="qwen3-embedding:0.6b";
const DEFAULT_BATCH=Number(navigator.deviceMemory||4)<=4?2:6;

function reqPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function openV2(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(V2_VECTOR_DB,V2_VECTOR_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("vectors")){
        const s=db.createObjectStore("vectors",{keyPath:"key"});
        s.createIndex("document_id","document_id",{unique:false});
      }
      if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta",{keyPath:"key"});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
function openLegacy(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(LEGACY_RAG_DB);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    req.onupgradeneeded=()=>{try{req.transaction.abort();}catch{}reject(new Error("Biblioteca local v10 ainda não existe neste aparelho."));};
  });
}
async function api(path,body){
  const res=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data?.ok===false)throw new Error(data?.error||("HTTP "+res.status));
  return data;
}
function cosine(a,b){
  const n=Math.min(a?.length||0,b?.length||0);if(!n)return 0;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<n;i++){const x=Number(a[i]||0),y=Number(b[i]||0);dot+=x*y;aa+=x*x;bb+=y*y;}
  return dot/((Math.sqrt(aa)||1)*(Math.sqrt(bb)||1));
}
async function existingKeys(){
  const db=await openV2();const tx=db.transaction("vectors","readonly");
  const keys=await reqPromise(tx.objectStore("vectors").getAllKeys());await txDone(tx).catch(()=>{});db.close();
  return new Set(keys.map(String));
}
async function readLegacyBatch(limit=DEFAULT_BATCH){
  const exists=await existingKeys();
  const db=await openLegacy();
  if(!db.objectStoreNames.contains("chunks")){db.close();throw new Error("Store de chunks local não encontrado.");}
  const tx=db.transaction("chunks","readonly"),store=tx.objectStore("chunks");
  const out=[];
  await new Promise((resolve,reject)=>{
    const req=store.openCursor();
    req.onsuccess=()=>{
      const c=req.result;if(!c||out.length>=limit){resolve();return;}
      const row=c.value||{},key=String(row.key||row.id||"");
      if(key&&!exists.has(key)&&String(row.text||"").trim())out.push({...row,key});
      c.continue();
    };
    req.onerror=()=>reject(req.error);
  });
  db.close();return out;
}
async function storeVectors(chunks,vectors){
  const db=await openV2(),tx=db.transaction(["vectors","meta"],"readwrite"),store=tx.objectStore("vectors");
  for(let i=0;i<chunks.length;i++){
    const r=chunks[i],vector=Array.isArray(vectors[i])?vectors[i]:[];
    if(!vector.length)continue;
    store.put({
      key:String(r.key),document_id:String(r.document_id||r.doc_key||""),
      title:String(r.title||""),page:Number(r.page||0)||null,chunk_index:Number(r.chunk_index||0),
      text:String(r.text||""),model:EMBED_MODEL,dimensions:vector.length,vector,updated_at:Date.now()
    });
  }
  tx.objectStore("meta").put({key:"model",value:EMBED_MODEL,updated_at:Date.now()});
  tx.objectStore("meta").put({key:"last_batch",value:Date.now(),updated_at:Date.now()});
  await txDone(tx);db.close();
}
async function counts(){
  let vectors=0,chunks=0;
  const vdb=await openV2();
  vectors=await reqPromise(vdb.transaction("vectors","readonly").objectStore("vectors").count()).catch(()=>0);vdb.close();
  try{
    const ldb=await openLegacy();
    if(ldb.objectStoreNames.contains("chunks"))chunks=await reqPromise(ldb.transaction("chunks","readonly").objectStore("chunks").count()).catch(()=>0);
    ldb.close();
  }catch{}
  return {chunks:Number(chunks||0),qwen_vectors:Number(vectors||0),pending:Math.max(0,Number(chunks||0)-Number(vectors||0)),model:EMBED_MODEL};
}
async function migrateOneBatch(limit=DEFAULT_BATCH){
  const chunks=await readLegacyBatch(limit);
  if(!chunks.length)return {ok:true,done:true,count:0,...await counts()};
  const data=await api("/api/v2/embed",{texts:chunks.map(x=>x.text),persist:false});
  await storeVectors(chunks,data.vectors||[]);
  return {ok:true,done:false,count:chunks.length,dimensions:Number(data.dimensions||0),...await counts()};
}
async function semanticSearch(question,topK=20){
  const data=await api("/api/v2/embed",{texts:[String(question||"")],persist:false});
  const qv=data.vectors?.[0]||[];if(!qv.length)return [];
  const db=await openV2(),tx=db.transaction("vectors","readonly"),store=tx.objectStore("vectors");
  const best=[];
  await new Promise((resolve,reject)=>{
    const req=store.openCursor();
    req.onsuccess=()=>{
      const c=req.result;if(!c){resolve();return;}
      const r=c.value||{},score=cosine(qv,r.vector||[]);
      if(Number.isFinite(score)){
        best.push({...r,score});
        best.sort((a,b)=>b.score-a.score);
        if(best.length>topK)best.length=topK;
      }
      c.continue();
    };
    req.onerror=()=>reject(req.error);
  });
  db.close();return best;
}
function opfsWorker(){
  if(!window.__fnsV2OpfsWorker){
    try{window.__fnsV2OpfsWorker=new Worker("/opfs-sqlite-worker.js",{type:"module"});}catch{return null;}
  }
  return window.__fnsV2OpfsWorker;
}
function workerCall(payload,timeout=30000){
  const worker=opfsWorker();if(!worker)return Promise.reject(new Error("OPFS indisponível."));
  const id="v2-"+Date.now()+"-"+Math.random().toString(36).slice(2);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.removeEventListener("message",onMessage);reject(new Error("Timeout OPFS."));},timeout);
    function onMessage(e){if(e.data?.id!==id)return;clearTimeout(timer);worker.removeEventListener("message",onMessage);e.data?.ok?resolve(e.data):reject(new Error(e.data?.error||"Falha OPFS"));}
    worker.addEventListener("message",onMessage);worker.postMessage({id,...payload});
  });
}
async function mirrorLegacyBatch(limit=250){
  const db=await openLegacy();
  const tx=db.transaction("chunks","readonly"),store=tx.objectStore("chunks");
  const rows=[];
  await new Promise((resolve,reject)=>{
    const req=store.openCursor();
    req.onsuccess=()=>{const c=req.result;if(!c||rows.length>=limit){resolve();return;}rows.push(c.value);c.continue();};
    req.onerror=()=>reject(req.error);
  });
  db.close();
  if(rows.length)await workerCall({type:"persist-chunks",chunks:rows},60000);
  return rows.length;
}
async function prepare({batches=1,batchSize=DEFAULT_BATCH,mirror=true,onProgress}={}){
  let last=await counts();
  if(mirror){try{await mirrorLegacyBatch(250);}catch{}}
  for(let i=0;i<Math.max(1,batches);i++){
    last=await migrateOneBatch(batchSize);
    if(typeof onProgress==="function")onProgress(last);
    if(last.done||last.pending===0)break;
    await new Promise(r=>setTimeout(r,0));
  }
  return last;
}
export const FNSV2LocalEngine={counts,migrateOneBatch,semanticSearch,prepare,model:EMBED_MODEL};
window.FNSV2LocalEngine=FNSV2LocalEngine;
