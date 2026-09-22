const TOP_K=500;
const OFFLINE_TOP_K=1000;
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
let staticBackupHydrated=false;
let seq=0;
const pending=new Map();
const searchWorker=new Worker("/rag-search-worker.js?v="+Date.now(),{type:"module"});
const opfsWorker=new Worker("/opfs-sqlite-worker.js?v="+Date.now(),{type:"module"});

let semanticWorker=null;
function ensureSemanticWorker(){
  if(semanticWorker)return semanticWorker;
  semanticWorker=new Worker("/embedding-worker.js?v=7.2.0",{type:"module"});
  semanticWorker.onmessage=onWorkerMessage;
  return semanticWorker;
}

async function embedQuery(text){
  const q=String(text||"").trim();
  if(!q)return [];
  await ready;
  try{
    const ew=ensureSemanticWorker();
    const embedded=await rpc(ew,"embed-query",{text:q,priority:"high"},12000);
    const vector=Array.isArray(embedded?.vector)?embedded.vector.map(Number).filter(Number.isFinite):[];
    return vector.length>=64?vector:[];
  }catch{
    return [];
  }
}

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
function terms(q){const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre","para","por","com","como","quero","saber","saiba","conhecer","conheca","informacao","informação","versiculo","versículo","passagem","citacao","citação","referencia","referência"]);return [...new Set(fold(q).split(" ").filter(x=>x.length>=3&&!stop.has(x)))].slice(0,18);}
function normalizeMatch(x,mode){
  return {
    id:String(x.id || x.key || ""),
    document_id:String(x.document_id || x.doc_key || "local"),
    page:Number(x.page || 0) || null,
    chunk_index:Number(x.chunk_index || 0),
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

async function hydrateStaticBackup(force=false){
  if(staticBackupHydrated && !force) return {chunks:0,vectors:0};
  try{
    const res=await fetch("/biblioteca_backup.json?v=17",{cache:"no-store"});
    if(!res.ok) return {chunks:0,vectors:0};
    const manifest=await res.json();
    let totalChunks=0,totalVectors=0;
    const payloads=[];

    if(Array.isArray(manifest?.parts) && manifest.parts.length){
      for(const part of manifest.parts.slice(0,250)){
        try{
          const pRes=await fetch(String(part.url || part),{cache:"no-store"});
          if(pRes.ok) payloads.push(await pRes.json());
        }catch{}
      }
    }else{
      payloads.push(manifest);
    }

    for(const data of payloads){
      const chunks=Array.isArray(data?.chunks)?data.chunks:[];
      const vectors=Array.isArray(data?.vectors)?data.vectors:[];
      totalChunks+=chunks.length; totalVectors+=vectors.length;
      for(let i=0;i<chunks.length;i+=200){
        const batch=chunks.slice(i,i+200).map(c=>normalizeMatch(c,"static-backup"));
        if(batch.length){
          const stored=batch.map((c,j)=>({...c,key:String(c.id || c.document_id || "backup")+":"+String(c.page || (i+j))}));
          await rpc(searchWorker,"persist-chunks",{chunks:stored},5000);
          rpc(opfsWorker,"persist-chunks",{chunks:stored},5000).catch(()=>{});
          const room=Math.max(0,RAM_LIMIT-ramCorpus.length);
          if(room)ramCorpus.push(...batch.slice(0,room));
        }
      }
      for(let i=0;i<vectors.length;i+=200){
        const records=vectors.slice(i,i+200).filter(v=>Array.isArray(v?.vector) && v.vector.length>=64);
        if(records.length) await rpc(searchWorker,"persist-vectors",{records},8000);
      }
    }

    staticBackupHydrated=true;
    return {chunks:totalChunks,vectors:totalVectors};
  }catch{return {chunks:0,vectors:0};}
}
const ready=Promise.all([preloadRam(),hydrateStaticBackup(false)]);

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
  const local=await rpc(searchWorker,"persist-vectors",{records},8000);
  if(window.FNSRagMirrorBatch) window.FNSRagMirrorBatch(records).catch(()=>{});
  return local;
}

async function level2(question,queryEmbedding){
  if(!Array.isArray(queryEmbedding)||queryEmbedding.length<64)return [];
  const r=await rpc(searchWorker,"search-semantic",{query:queryEmbedding,top_k:TOP_K,min_score:SEMANTIC_MIN_SCORE},6000);
  return (r.matches||[]).map(x=>normalizeMatch(x,"indexeddb-semantic"));
}
async function level3(question){
  const r=await rpc(opfsWorker,"search",{question,top_k:TOP_K},5000);
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
  if(!res.ok){const error=new Error("cloudflare "+res.status);error.status=res.status;throw error;}
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
  const r=await rpc(searchWorker,"search-bm25",{question,top_k:TOP_K},8000);
  return (r.matches||[]).map(x=>normalizeMatch(x,"bm25-local"));
}

function mergeSearchMatches(...groups){
  const seen=new Set(),out=[];
  for(const group of groups){
    for(const row of (Array.isArray(group)?group:[])){
      const text=String(row?.text||"").trim();
      if(!text)continue;
      const key=String(row?.id||row?.key||"") || [row?.document_id||"",row?.page||0,row?.chunk_index||0,fold(text).slice(0,180)].join("|");
      if(seen.has(key))continue;
      seen.add(key);
      out.push(row);
    }
  }
  out.sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
  return out.slice(0,TOP_K);
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
    }catch(error){
      attempts.push({level,name,ok:false,count:0,status:Number(error?.status || 0),ms:Math.round(performance.now()-started)});
      return [];
    }
  };

  // Regra de tráfego V2.0: todas as fontes locais pesquisáveis participam antes
  // de qualquer rejeição. A malha pode liberar até 500 evidências para os nós assíncronos.
  const [ramHits,vectorHits,opfsHits,bm25Hits]=await Promise.all([
    run(1,LEVELS[0][1],()=>Promise.resolve(ramSearch(question))),
    run(2,LEVELS[1][1],()=>level2(question,queryEmbedding)),
    run(3,LEVELS[2][1],()=>level3(question)),
    run(10,LEVELS[9][1],()=>level10(question))
  ]);
  let localMatches=mergeSearchMatches(ramHits,vectorHits,opfsHits,bm25Hits);
  if(localMatches.length){
    return {matches:localMatches,level:10,name:"Malha local combinada (RAM + vetores + OPFS + BM25)",attempts};
  }

  const localhostHits=await run(4,LEVELS[3][1],()=>level4(question,queryEmbedding));
  if(localhostHits.length)return {matches:localhostHits,level:4,name:LEVELS[3][1],attempts};

  const cloudflareHits=await run(5,LEVELS[4][1],()=>level5(question,queryEmbedding));
  if(cloudflareHits.length)return {matches:cloudflareHits,level:5,name:LEVELS[4][1],attempts};

  await hydrateStaticBackup(true);
  const [rehydratedVector,rehydratedBm25]=await Promise.all([
    run(2,"IndexedDB reidratado",()=>level2(question,queryEmbedding)),
    run(10,"BM25 reidratado",()=>level10(question))
  ]);
  localMatches=mergeSearchMatches(rehydratedVector,rehydratedBm25);
  if(localMatches.length)return {matches:localMatches,level:10,name:"Backup local reidratado",attempts};

  for(const [level,provider] of [[6,"supabase"],[7,"pinecone"],[8,"mongodb"],[9,"astra"]]){
    const matches=await run(level,LEVELS[level-1][1],()=>cloudSlot(provider,question,queryEmbedding));
    if(matches.length)return {matches,level,name:LEVELS[level-1][1],attempts};
  }
  return {matches:[],level:0,name:"none",attempts};
}

async function offlineSearch(question){
  await ready;
  try{
    const r=await rpc(searchWorker,"search-strict",{question:String(question||""),top_k:OFFLINE_TOP_K},30000);
    const matches=(r.matches||[]).slice(0,OFFLINE_TOP_K).map(x=>normalizeMatch(x,"indexeddb-strict-phrase-v4"));
    return {
      matches,level:10,name:"IndexedDB strict phrase full-library",
      logical_capacity:OFFLINE_TOP_K,
      strict_phrase:String(r.target||""),
      scanned:Number(r.scanned||0),
      exact_hits:Number(r.exact_hits||0),
      documents_hit:Number(r.documents_hit||0),
      fuzzy_disabled:true,or_disabled:true
    };
  }catch(error){
    return {matches:[],level:0,name:"offline-unavailable",logical_capacity:OFFLINE_TOP_K,error:String(error?.message||error)};
  }
}

async function omniAgentSearch(question,{onProgress}={}){
  await ready;
  const q=String(question||"").trim();
  if(!q)return {ok:false,cards:[],strict_empty:true,zero_noise:true,logical_agents:10,physical_workers:0};

  let localStrict={matches:[],scanned:0,exact_hits:0,documents_hit:0};
  try{
    localStrict=await rpc(searchWorker,"search-strict",{question:q,top_k:OFFLINE_TOP_K},30000);
  }catch{}

  let cloudRows=[],cloudReadable=false;
  if(typeof navigator==="undefined" || navigator.onLine){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),4500);
    try{
      const res=await fetch("/api/rag/search",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({question:q}),
        signal:controller.signal
      });
      const data=await res.json().catch(()=>({}));
      if(res.ok&&data?.ok===true){
        cloudReadable=true;
        cloudRows=Array.isArray(data.matches)?data.matches:[];
      }
    }catch{}finally{clearTimeout(timer);}
  }

  const seen=new Set(),literalMatches=[];
  for(const row of [...(localStrict.matches||[]),...cloudRows]){
    const item=normalizeMatch(row,String(row?.retrieval_mode||"v6-literal"));
    const key=item.id||[item.document_id,item.chunk_index,item.page,fold(item.text).slice(0,180)].join("|");
    if(seen.has(key))continue;
    seen.add(key);literalMatches.push(item);
    if(literalMatches.length>=OFFLINE_TOP_K)break;
  }

  // Bugfix V7.4: o Agent 2 semântico não é mais desligado quando há hit literal.
  // A mesma malha existente cruza vetores + BM25 local, permitindo recuperar outros
  // livros mesmo quando a vetorização de um PDF ainda não terminou por completo.
  let semanticMatches=[];
  let bm25Matches=[];
  try{
    const ew=ensureSemanticWorker();
    const [embeddedResult,bm25Result]=await Promise.allSettled([
      rpc(ew,"embed-query",{text:q,priority:"high"},30000),
      rpc(searchWorker,"search-bm25",{question:q,top_k:OFFLINE_TOP_K},12000)
    ]);
    const embedded=embeddedResult.status==="fulfilled"?embeddedResult.value:null;
    const bm25=bm25Result.status==="fulfilled"?bm25Result.value:{matches:[]};
    bm25Matches=(bm25.matches||[]).slice(0,OFFLINE_TOP_K).map(x=>normalizeMatch(x,"v7.4-bm25-expansion"));
    let vectorMatches=[];
    if(Array.isArray(embedded?.vector)&&embedded.vector.length>=64){
      const semantic=await rpc(searchWorker,"search-semantic",{
        query:embedded.vector,top_k:OFFLINE_TOP_K,min_score:0.62
      },20000).catch(()=>({matches:[]}));
      vectorMatches=(semantic.matches||[]).slice(0,OFFLINE_TOP_K).map(x=>normalizeMatch(x,"v7.4-transformers-semantic-expansion"));
    }
    semanticMatches=mergeSearchMatches(vectorMatches,bm25Matches);
  }catch{}

  const swarm=await import("/agent-swarm.js?v=7.4.2");
  const result=await swarm.runAgentSwarm({
    question:q,literalMatches,semanticMatches,onProgress
  });
  return {
    ...result,
    provider:"omni-agent-swarm-v6",
    literal_sources:"IndexedDB+Cloudflare+Supabase strict",
    local_scanned:Number(localStrict.scanned||0),
    local_exact_hits:Number(localStrict.exact_hits||0),
    local_documents_hit:Number(localStrict.documents_hit||0),
    cloud_readable:cloudReadable,
    cloud_literal_hits:cloudRows.length,
    semantic_expansion_used:semanticMatches.length>0,
    semantic_expansion_hits:semanticMatches.length,
    bm25_expansion_hits:bm25Matches.length,
    library_coverage_known:Boolean(cloudReadable||Number(localStrict.scanned||0)>0||literalMatches.length||semanticMatches.length),
    logical_capacity:OFFLINE_TOP_K
  };
}

async function offlineDictionarySearch(question,page=1,pageSize=50){
  await ready;
  const safePage=Math.max(1,Number(page||1));
  const safeSize=Math.max(1,Math.min(100,Number(pageSize||50)));
  const offset=(safePage-1)*safeSize;
  try{
    const r=await rpc(searchWorker,"search-strict-page",{
      question:String(question||""),offset,limit:safeSize
    },45000);
    return {
      ok:true,
      matches:Array.isArray(r.matches)?r.matches:[],
      scanned:Number(r.scanned||0),
      total:Number(r.total||0),
      page:safePage,
      page_size:safeSize,
      pages:Math.ceil(Number(r.total||0)/safeSize),
      target:String(r.target||""),
      mode:"offline-encyclopedia-v10",
      local_only:true
    };
  }catch(error){
    return {ok:false,matches:[],scanned:0,total:0,page:safePage,page_size:safeSize,pages:0,error:String(error?.message||error),local_only:true};
  }
}

async function getDocumentChunks(documentId,offset=0,limit=20){
  await ready;
  try{
    const r=await rpc(searchWorker,"get-document-chunks",{document_id:String(documentId||""),offset:Number(offset||0),limit:Math.max(1,Math.min(1000,Number(limit||20)))},12000);
    return Array.isArray(r.chunks)?r.chunks:[];
  }catch{return [];}
}

async function directRetrieve(question){
  await ready;
  try{
    return await rpc(searchWorker,"direct-retrieve",{question:String(question||"")},20000);
  }catch(error){
    return {ok:false,direct:true,code:"LOCAL_DIRECT_RETRIEVAL_FAILED",message:String(error?.message||error)};
  }
}

async function listDocuments(){
  await ready;
  try{
    const r=await rpc(searchWorker,"list-documents",{},3000);
    return Array.isArray(r.documents)?r.documents:[];
  }catch{return [];}
}
async function localStats(){
  await ready;
  try{return await rpc(searchWorker,"local-stats",{},4000);}
  catch{return {ok:false,chunks:0,vectors:0};}
}
async function exportVectors(offset=0,limit=50){
  await ready;
  try{
    return await rpc(searchWorker,"export-vectors",{offset:Number(offset||0),limit:Math.max(1,Math.min(100,Number(limit||50)))},8000);
  }catch{return {ok:false,total:0,records:[],done:true};}
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

window.FNSRagCascade={ready,search,offlineSearch,offlineDictionarySearch,omniAgentSearch,embedQuery,directRetrieve,persistExtracted,persistVectors,getDocumentChunks,listDocuments,localStats,exportVectors,deleteDocument,hydrateStaticBackup,levels:LEVELS};
export {ready,search,offlineSearch,offlineDictionarySearch,omniAgentSearch,embedQuery,directRetrieve,persistExtracted,persistVectors,getDocumentChunks,listDocuments,localStats,exportVectors,deleteDocument,hydrateStaticBackup,LEVELS};
