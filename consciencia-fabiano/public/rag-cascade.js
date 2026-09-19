const TOP_K=15;
const SEMANTIC_MIN_SCORE=0.38;
const RAM_LIMIT=1600;
const LEVELS=[
  [1,"RAM biblioteca.json"],
  [2,"IndexedDB vetorial"],
  [3,"OPFS SQLite WASM"],
  [4,"Localhost ChromaDB"],
  [5,"Cloudflare atual"],
  [6,"Supabase pgvector"],
  [7,"Pinecone Serverless"],
  [8,"MongoDB Atlas Vector Search"],
  [9,"DataStax Astra DB"],
  [10,"BM25 local bruto"],
];

const ramCorpus=[];
let seq=0;
const pending=new Map();
const searchWorker=new Worker("/rag-search-worker.js?v="+Date.now(),{type:"module"});
const opfsWorker=new Worker("/opfs-sqlite-worker.js?v="+Date.now(),{type:"module"});

function onWorkerMessage(event){
  const data=event.data || {};
  const p=pending.get(data.id);
  if(!p)return;
  pending.delete(data.id);
  data.ok===false?p.reject(new Error(data.error || "worker failed")):p.resolve(data);
}
searchWorker.onmessage=onWorkerMessage;
opfsWorker.onmessage=onWorkerMessage;

function rpc(worker,type,payload={},timeout=1800){
  const id="rag-"+(++seq)+"-"+Date.now();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("timeout"));},timeout);
    pending.set(id,{
      resolve:v=>{clearTimeout(timer);resolve(v);},
      reject:e=>{clearTimeout(timer);reject(e);}
    });
    worker.postMessage({id,type,...payload});
  });
}
function fold(text){return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();}
function terms(q){const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","um","uma","que","sobre","para","por","com","como","quero","versiculo","versículo","passagem","citacao","citação","referencia","referência"]);return [...new Set(fold(q).split(" ").filter(x=>x.length>=3&&!stop.has(x)))].slice(0,12);}
function normalizeMatch(x,mode){
  return {
    id:String(x.id || x.key || ""),
    document_id:String(x.document_id || x.doc_key || "local"),
    page:Number(x.page || 0) || null,
    text:String(x.text || "").slice(0,6000),
    filename:String(x.filename || x.title || "Documento local"),
    title:String(x.title || x.filename || "Documento local"),
    author:String(x.author || ""),
    language:String(x.language || "pt"),
    score:Number(x.score || 0),
    retrieval_mode:mode || x.retrieval_mode || "resilience"
  };
}
function ramSearch(question){
  const qs=terms(question);
  if(!qs.length || !ramCorpus.length)return [];
  const scored=[];
  for(const row of ramCorpus){
    const f=fold(row.text);
    let hit=0,freq=0;
    for(const t of qs){if(f.includes(t)){hit++;freq+=(f.split(t).length-1);}}
    if(!hit)continue;
    const coverage=hit/qs.length;
    const score=coverage*4+Math.min(2,freq*.2);
    scored.push({...row,score});
  }
  return scored.sort((a,b)=>b.score-a.score).slice(0,TOP_K).map(x=>normalizeMatch(x,"ram-static"));
}
function withTimeout(promise,ms){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),ms))]);}

async function preloadRam(){
  try{
    const res=await fetch("/biblioteca.json?v="+Date.now(),{cache:"no-store"});
    const data=await res.json();
    const chunks=Array.isArray(data?.chunks)?data.chunks:[];
    for(const c of chunks.slice(0,RAM_LIMIT))ramCorpus.push(normalizeMatch(c,"ram-static"));
  }catch{}
}
const ready=preloadRam();

async function persistExtracted(extracted){
  await ready;
  const docKey=String(extracted?.content_sha256 || extracted?.filename || Date.now());
  const pages=(extracted?.pages || []).filter(x=>String(x?.text||"").trim()).map(p=>({
    key:docKey+":"+Number(p.page||0),
    doc_key:docKey,
    document_id:docKey,
    filename:String(extracted.filename || "Documento local"),
    title:String(extracted.title || extracted.filename || "Documento local"),
    author:String(extracted.author || ""),
    language:"pt",
    page:Number(p.page||0),
    text:String(p.text||""),
    updated_at:Date.now()
  }));
  if(!pages.length)return {ok:true,count:0};
  const room=Math.max(0,RAM_LIMIT-ramCorpus.length);
  if(room)ramCorpus.push(...pages.slice(0,room));
  for(let i=0;i<pages.length;i+=80){
    await rpc(searchWorker,"persist-chunks",{chunks:pages.slice(i,i+80)},5000);
  }
  // OPFS runs as a mirror. Failure never blocks IndexedDB/local lexical.
  (async()=>{for(let i=0;i<pages.length;i+=80){try{await rpc(opfsWorker,"persist-chunks",{chunks:pages.slice(i,i+80)},5000);}catch{break;}}})().catch(()=>{});
  return {ok:true,count:pages.length};
}

async function persistVectors(payload){
  const chunks=Array.isArray(payload?.chunks)?payload.chunks:[];
  const vectors=Array.isArray(payload?.vectors)?payload.vectors:[];
  const records=chunks.map((c,i)=>({
    key:String(c.id || (payload.document_id+":"+i)),
    id:String(c.id || ""),
    document_id:String(payload.document_id || ""),
    filename:String(payload.filename || "Documento local"),
    title:String(payload.title || payload.filename || "Documento local"),
    author:String(payload.author || ""),
    language:"pt",
    page:Number(c.page || 0),
    text:String(c.text || ""),
    vector:Array.from(vectors[i] || []),
    updated_at:Date.now()
  })).filter(r=>r.vector.length>=64);
  if(!records.length)return {ok:true,count:0};
  return rpc(searchWorker,"persist-vectors",{records},8000);
}

async function level2(question,queryEmbedding){
  if(!Array.isArray(queryEmbedding)||queryEmbedding.length<64)return [];
  const r=await rpc(searchWorker,"search-semantic",{query:queryEmbedding,top_k:TOP_K,min_score:SEMANTIC_MIN_SCORE},1800);
  return (r.matches||[]).map(x=>normalizeMatch(x,"indexeddb-semantic"));
}
async function level3(question){
  const r=await rpc(opfsWorker,"search",{question,top_k:TOP_K},1300);
  return (r.matches||[]).map(x=>normalizeMatch(x,"opfs-sqlite"));
}
async function level4(question,queryEmbedding){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),350);
  try{
    const res=await fetch("http://127.0.0.1:8000/api/rag/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question,query_embedding:queryEmbedding,top_k:TOP_K}),signal:controller.signal});
    if(!res.ok)throw new Error("localhost "+res.status);
    const data=await res.json();
    return (data.matches||[]).map(x=>normalizeMatch(x,"localhost"));
  }finally{clearTimeout(timer);}
}
async function cacheRecoveredMatches(matches){
  const rows=(matches||[]).map((m,i)=>({
    key:String(m.id || m.document_id || "recovered")+":"+String(m.page || i),
    doc_key:String(m.document_id || "recovered"),
    document_id:String(m.document_id || "recovered"),
    filename:String(m.filename || m.title || "Documento recuperado"),
    title:String(m.title || m.filename || "Documento recuperado"),
    author:String(m.author || ""),
    language:String(m.language || "pt"),
    page:Number(m.page || 0),
    text:String(m.text || ""),
    updated_at:Date.now()
  })).filter(r=>r.text);
  if(!rows.length)return;
  const room=Math.max(0,RAM_LIMIT-ramCorpus.length);
  if(room)ramCorpus.push(...rows.slice(0,room));
  try{await rpc(searchWorker,"persist-chunks",{chunks:rows},3500);}catch{}
  rpc(opfsWorker,"persist-chunks",{chunks:rows},3500).catch(()=>{});
}

async function level5(question,queryEmbedding){
  const res=await withTimeout(fetch("/api/rag/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question,query_embedding:queryEmbedding})}),1800);
  if(!res.ok)throw new Error("cloudflare "+res.status);
  const data=await res.json();
  const matches=(data.matches||[]).map(x=>normalizeMatch(x,"cloudflare-current"));
  cacheRecoveredMatches(matches).catch(()=>{});
  return matches;
}
async function cloudSlot(provider,question,queryEmbedding){
  const res=await withTimeout(fetch("/api/rag/provider-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider,question,query_embedding:queryEmbedding})}),1000);
  if(!res.ok)throw new Error(provider+" unavailable");
  const data=await res.json();
  const matches=(data.matches||[]).map(x=>normalizeMatch(x,provider));
  cacheRecoveredMatches(matches).catch(()=>{});
  return matches;
}
async function level10(question){
  const r=await rpc(searchWorker,"search-bm25",{question,top_k:TOP_K},2200);
  return (r.matches||[]).map(x=>normalizeMatch(x,"bm25-local"));
}

async function search(question,queryEmbedding){
  await ready;
  const attempts=[];
  const run=async(level,name,fn)=>{
    const started=performance.now();
    try{
      const matches=await fn();
      attempts.push({level,name,ok:true,count:matches.length,ms:Math.round(performance.now()-started)});
      return matches;
    }catch{
      attempts.push({level,name,ok:false,count:0,ms:Math.round(performance.now()-started)});
      return [];
    }
  };
  let matches=await run(1,LEVELS[0][1],()=>Promise.resolve(ramSearch(question)));
  if(matches.length)return {matches,level:1,name:LEVELS[0][1],attempts};
  matches=await run(2,LEVELS[1][1],()=>level2(question,queryEmbedding));
  if(matches.length)return {matches,level:2,name:LEVELS[1][1],attempts};
  matches=await run(3,LEVELS[2][1],()=>level3(question));
  if(matches.length)return {matches,level:3,name:LEVELS[2][1],attempts};
  matches=await run(4,LEVELS[3][1],()=>level4(question,queryEmbedding));
  if(matches.length)return {matches,level:4,name:LEVELS[3][1],attempts};
  matches=await run(5,LEVELS[4][1],()=>level5(question,queryEmbedding));
  if(matches.length)return {matches,level:5,name:LEVELS[4][1],attempts};
  for(const [level,provider] of [[6,"supabase"],[7,"pinecone"],[8,"mongodb"],[9,"astra"]]){
    matches=await run(level,LEVELS[level-1][1],()=>cloudSlot(provider,question,queryEmbedding));
    if(matches.length)return {matches,level,name:LEVELS[level-1][1],attempts};
  }
  matches=await run(10,LEVELS[9][1],()=>level10(question));
  return {matches,level:matches.length?10:0,name:matches.length?LEVELS[9][1]:"none",attempts};
}

async function listDocuments(){
  await ready;
  try{
    const r=await rpc(searchWorker,"list-documents",{},3000);
    return Array.isArray(r.documents)?r.documents:[];
  }catch{return [];}
}
async function deleteDocument(documentId){
  const id=String(documentId||"");
  if(!id)return false;
  for(let i=ramCorpus.length-1;i>=0;i--){
    if(String(ramCorpus[i].document_id||ramCorpus[i].doc_key||"")===id) ramCorpus.splice(i,1);
  }
  try{await rpc(searchWorker,"delete-document",{document_id:id},4000);}catch{}
  try{await rpc(opfsWorker,"delete-document",{document_id:id},4000);}catch{}
  return true;
}

window.FNSRagCascade={ready,search,persistExtracted,persistVectors,listDocuments,deleteDocument,levels:LEVELS};
export {ready,search,persistExtracted,persistVectors,listDocuments,deleteDocument,LEVELS};
