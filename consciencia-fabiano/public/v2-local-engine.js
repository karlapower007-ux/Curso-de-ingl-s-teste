import {deriveStrictPhrase,extractSemanticReference} from "/strict-match-core.js";

const V2_VECTOR_DB="fns_qwen_vectors_v2";
const V2_VECTOR_DB_VERSION=1;
const LEGACY_RAG_DB="fns_rag_resilience_v1";
const EMBED_MODEL="qwen3-embedding:0.6b";
const DEFAULT_BATCH=Number(navigator.deviceMemory||4)<=4?8:24;
const STOPWORDS=new Set("a o as os um uma uns umas de da do das dos e em no na nos nas por para com sem sobre que qual quais como quando onde porque pois ser estar foi eram is the an of to in on for with about what which how when where why me mostre mostrar busque buscar encontre encontrar diga explique".split(/\s+/));
let aliasPromise=null;

function reqPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function fold(text){
  return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[“”„‟«»"'’]/g,"").replace(/[^\p{L}\p{N}\s:+-]/gu," ").replace(/\s+/g," ").trim();
}
function cleanTitle(row={}){
  const raw=String(row.title||row.source_title||row.filename||"").replace(/\.pdf$/i,"");
  if(/standard\s*works|obras[-_ ]?padrao/i.test(fold(raw)))return "";
  const cleaned=raw.replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  if(/^(documento|fonte)$/i.test(cleaned))return "";
  return cleaned;
}
function publicReference(row={},text=""){
  const canonical=String(row.reference||row.canonical_reference||extractSemanticReference(text||row.text||"")||"").trim();
  if(canonical)return canonical;
  const title=cleanTitle(row),page=Number(row.page||0);
  if(title&&page)return title+" • página "+page;
  if(title)return title;
  if(page)return "página "+page;
  return "Fonte local";
}
function paragraphBlocks(text){
  const raw=String(text||"").replace(/\r\n?/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
  if(!raw)return [];
  const explicit=raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
  if(explicit.length>1)return explicit;
  const sentences=raw.split(/(?<=[.!?;:])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])/u).map(x=>x.trim()).filter(Boolean);
  if(sentences.length<=4)return [raw];
  const out=[];for(let i=0;i<sentences.length;i+=4)out.push(sentences.slice(i,i+4).join(" "));
  return out;
}
async function aliases(){
  if(!aliasPromise)aliasPromise=fetch("/v2-aliases.json",{cache:"force-cache"}).then(r=>r.ok?r.json():{}).catch(()=>({}));
  return aliasPromise;
}
function splitConcepts(query,aliasObject={}){
  let phrase=deriveStrictPhrase(query)||String(query||"").trim();
  let parts=phrase.split(/\s+(?:AND|E|Y)\s+|\s*\+\s*|\s*;\s*/iu).map(x=>x.trim()).filter(Boolean);
  if(parts.length===1&&/\s+e\s+/iu.test(phrase)){
    const c=phrase.split(/\s+e\s+/iu).map(x=>x.trim()).filter(Boolean);if(c.length<=4)parts=c;
  }
  const map=new Map();
  for(const [key,value] of Object.entries(aliasObject||{})){
    const k=fold(key);map.set(k,[...new Set([key,...(Array.isArray(value)?value:[])].map(fold).filter(Boolean))]);
  }
  return parts.map(label=>{const key=fold(label);return {label,key,aliases:map.get(key)||[key]};}).filter(x=>x.key);
}
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
async function metaGet(key){
  const db=await openV2(),tx=db.transaction("meta","readonly");
  const row=await reqPromise(tx.objectStore("meta").get(key)).catch(()=>null);db.close();return row?.value;
}
async function metaPut(key,value){
  const db=await openV2(),tx=db.transaction("meta","readwrite");
  tx.objectStore("meta").put({key,value,updated_at:Date.now()});await txDone(tx);db.close();
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
async function readLegacyBatch(limit=DEFAULT_BATCH,{allowReset=true}={}){
  const db=await openLegacy();
  if(!db.objectStoreNames.contains("chunks")){db.close();throw new Error("Store de chunks local não encontrado.");}
  const cursorKey=String(await metaGet("legacy_migration_cursor")||"");
  const tx=db.transaction("chunks","readonly"),store=tx.objectStore("chunks");
  const out=[];let lastKey=cursorKey,exhausted=false;
  await new Promise((resolve,reject)=>{
    const range=cursorKey?IDBKeyRange.lowerBound(cursorKey,true):undefined;
    const req=store.openCursor(range);
    req.onsuccess=()=>{
      const c=req.result;
      if(!c){exhausted=true;resolve();return;}
      lastKey=String(c.key);
      const row=c.value||{},key=String(row.key||row.id||c.key||"");
      if(key&&String(row.text||"").trim())out.push({...row,key});
      if(out.length>=Math.max(1,limit)){resolve();return;}
      c.continue();
    };
    req.onerror=()=>reject(req.error);
  });
  db.close();
  if(!out.length&&exhausted&&allowReset){
    const state=await counts();
    if(state.pending>0&&cursorKey){await metaPut("legacy_migration_cursor","");return readLegacyBatch(limit,{allowReset:false});}
  }
  return {rows:out,exhausted,lastKey,cursorKey};
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
async function migrateOneBatch(limit=DEFAULT_BATCH,{mirror=true}={}){
  const batch=await readLegacyBatch(limit),chunks=batch.rows;
  if(!chunks.length)return {ok:true,done:true,count:0,...await counts()};
  const data=await api("/api/v2/embed",{texts:chunks.map(x=>x.text),persist:false});
  await storeVectors(chunks,data.vectors||[]);
  if(batch.lastKey!==batch.cursorKey)await metaPut("legacy_migration_cursor",batch.lastKey);
  if(mirror){try{await workerCall({type:"persist-chunks",chunks},60000);}catch{}}
  const state=await counts();
  return {ok:true,done:state.pending===0,count:chunks.length,dimensions:Number(data.dimensions||0),...state};
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
        best.push({...r,reference:publicReference(r),score});
        best.sort((a,b)=>b.score-a.score);
        if(best.length>topK)best.length=topK;
      }
      c.continue();
    };
    req.onerror=()=>reject(req.error);
  });
  db.close();return best;
}
function queryTerms(question){
  return [...new Set(fold(deriveStrictPhrase(question)||question).split(/\s+/).filter(x=>x.length>=3&&!STOPWORDS.has(x)))].slice(0,24);
}
async function lexicalSearch(question,topK=70){
  const terms=queryTerms(question);if(!terms.length)return [];
  const merged=new Map();

  try{
    const fts=await workerCall({type:"search-fts",question,top_k:Math.max(20,topK)},20000);
    for(const row of (fts.matches||[])){
      const key=String(row?.key||row?.document_id+":"+String(row?.page||0)+":"+String(row?.text||"").slice(0,48));
      if(!key)continue;
      merged.set(key,{...row,reference:publicReference(row),coverage:1,lexical_score:10+Number(row?.score||0),search_backend:"opfs-sqlite-fts5"});
    }
  }catch{}

  const db=await openLegacy();
  if(db.objectStoreNames.contains("chunks")){
    const store=db.transaction("chunks","readonly").objectStore("chunks"),best=[];
    await new Promise((resolve,reject)=>{
      const req=store.openCursor();
      req.onsuccess=()=>{
        const c=req.result;if(!c){resolve();return;}
        const r=c.value||{},hay=fold(r.text||"");let matched=0,freq=0;
        for(const t of terms){if(!hay.includes(t))continue;matched++;let at=0,n=0;while((at=hay.indexOf(t,at))>=0&&n<8){n++;at+=t.length;}freq+=n;}
        if(matched){
          const coverage=matched/terms.length,score=coverage*8+Math.min(2,freq*.12);
          best.push({...r,reference:publicReference(r),coverage,lexical_score:score,search_backend:"indexeddb-lexical"});
          best.sort((a,b)=>b.lexical_score-a.lexical_score||b.coverage-a.coverage);
          if(best.length>Math.max(1,topK))best.length=Math.max(1,topK);
        }
        c.continue();
      };
      req.onerror=()=>reject(req.error);
    });
    for(const row of best){
      const key=String(row?.key||row?.id||row?.document_id+":"+String(row?.chunk_index||0));
      if(!key)continue;
      const existing=merged.get(key);
      if(!existing||Number(row.lexical_score||0)>Number(existing.lexical_score||0))merged.set(key,row);
    }
  }
  db.close();
  return [...merged.values()].sort((a,b)=>Number(b.lexical_score||0)-Number(a.lexical_score||0)).slice(0,Math.max(1,topK));
}
async function exactSearch(query,{page=1,pageSize=50}={}){
  const aliasObject=await aliases(),concepts=splitConcepts(query,aliasObject);
  const state=await counts();
  if(!concepts.length||state.chunks===0)return {ok:true,local_only:true,library_available:state.chunks>0,query,concepts:[],total:0,page:1,page_size:pageSize,pages:0,matches:[]};
  const db=await openLegacy(),store=db.transaction("chunks","readonly").objectStore("chunks"),hits=[];
  await new Promise((resolve,reject)=>{
    const req=store.openCursor();
    req.onsuccess=()=>{
      const c=req.result;if(!c){resolve();return;}
      const r=c.value||{};
      for(const block of paragraphBlocks(r.text||"")){
        const hay=fold(block),matched=[];
        let accepted=true;
        for(const concept of concepts){
          const alias=concept.aliases.find(a=>a&&hay.includes(a));
          if(!alias){accepted=false;break;}matched.push(alias);
        }
        if(accepted)hits.push({
          id:String(r.id||r.key||c.key),document_id:String(r.document_id||r.doc_key||""),
          title:cleanTitle(r),page:Number(r.page||0)||null,chunk_index:Number(r.chunk_index||0),
          text:block,reference:publicReference(r,block),aliases:matched,concepts:concepts.map(x=>x.label),score:1
        });
      }
      c.continue();
    };
    req.onerror=()=>reject(req.error);
  });
  db.close();
  hits.sort((a,b)=>String(a.reference||"").localeCompare(String(b.reference||""))||a.chunk_index-b.chunk_index);
  const safePage=Math.max(1,Number(page)||1),safeSize=Math.min(100,Math.max(1,Number(pageSize)||50)),start=(safePage-1)*safeSize;
  return {
    ok:true,local_only:true,library_available:true,unlimited_logical_results:true,query,
    concepts:concepts.map(x=>({label:x.label,aliases:x.aliases})),
    total:hits.length,page:safePage,page_size:safeSize,pages:Math.ceil(hits.length/safeSize),
    matches:hits.slice(start,start+safeSize)
  };
}
function formatExact(matches=[]){
  if(!matches.length)return "Nenhuma citação exata foi encontrada para todos os conceitos solicitados no mesmo bloco.";
  return matches.map((r,i)=>"["+(i+1)+"] "+String(r.reference||"Fonte local")+"\n"+String(r.text||"").trim()).join("\n\n");
}
async function prepare({batches=1,batchSize=DEFAULT_BATCH,mirror=true,onProgress}={}){
  let last=await counts();
  for(let i=0;i<Math.max(1,batches);i++){
    last=await migrateOneBatch(batchSize,{mirror});
    if(typeof onProgress==="function")onProgress(last);
    if(last.done||last.pending===0)break;
    await new Promise(r=>setTimeout(r,0));
  }
  return last;
}
export const FNSV2LocalEngine={counts,migrateOneBatch,semanticSearch,lexicalSearch,exactSearch,formatExact,prepare,model:EMBED_MODEL};
window.FNSV2LocalEngine=FNSV2LocalEngine;
