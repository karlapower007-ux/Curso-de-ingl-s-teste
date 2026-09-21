export const GOLDEN_VERSION="fns-v33-golden-2";

export function assertCompleteLibrary(stats={}){
  const chunks=Number(stats.chunks||0);
  const embeddings=Number(stats.embeddings||0);
  const documents=Number(stats.documents||0);
  if(documents<=0) throw new Error("FNS_LIBRARY_EMPTY_DOCUMENTS");
  if(chunks<=0) throw new Error("FNS_LIBRARY_EMPTY_CHUNKS");
  if(embeddings<=0) throw new Error("FNS_LIBRARY_EMPTY_EMBEDDINGS");
  if(embeddings<chunks) throw new Error("FNS_LIBRARY_PARTIAL_EMBEDDINGS");
  return {documents,chunks,embeddings,valid:true};
}

export function cosine(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length)return -1;
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){
    const x=Number(a[i])||0,y=Number(b[i])||0;
    dot+=x*y;na+=x*x;nb+=y*y;
  }
  return !na||!nb?-1:dot/(Math.sqrt(na)*Math.sqrt(nb));
}

function fold(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
}
function tokens(s){return fold(s).split(" ").filter(x=>x.length>1)}
export function lexicalScore(text,query){
  const q=[...new Set(tokens(query))];
  if(!q.length)return 0;
  const t=fold(text);
  let hit=0,bonus=0;
  for(const term of q){
    if(t.includes(term)){hit++;bonus+=Math.min(1,term.length/10)}
  }
  const phrase=fold(query);
  return (hit/q.length)*0.8 + (phrase&&t.includes(phrase)?0.15:0) + (bonus/q.length)*0.05;
}

export function hybridRank({query,queryVector,records,limit=100}){
  return (Array.isArray(records)?records:[])
    .map(r=>{
      const lex=lexicalScore(r.text,query);
      const sem=Array.isArray(queryVector)&&Array.isArray(r.vector)?Math.max(0,cosine(queryVector,r.vector)):0;
      const score=0.48*lex+0.52*sem;
      return {...r,_lex:lex,_sem:sem,_score:score};
    })
    .filter(r=>r._score>0)
    .sort((a,b)=>b._score-a._score)
    .filter((r,i,arr)=>arr.findIndex(x=>String(x.id)===String(r.id))===i)
    .slice(0,Math.max(1,Math.min(500,limit)));
}

export function validateRecoveredSources(records=[]){
  const clean=[];
  for(const r of records){
    if(!r||!String(r.document_id||"").trim()||!String(r.text||"").trim())continue;
    clean.push({
      chunk_id:String(r.id||""),
      document_id:String(r.document_id),
      title:String(r.title||r.filename||"Documento"),
      filename:String(r.filename||""),
      page:Number(r.page||0)||null,
      excerpt:String(r.text).replace(/\s+/g," ").trim().slice(0,700),
      score:Number(r._score||r.score||0)
    });
  }
  const ids=new Set();
  return clean.filter(x=>{
    const k=x.chunk_id+"|"+x.document_id;
    if(ids.has(k))return false;
    ids.add(k);return true;
  });
}

export function buildMapReducePlan(records=[],opts={}){
  const rows=Array.isArray(records)?records:[];
  const batchSize=Math.max(4,Math.min(24,Number(opts.batchSize||12)));
  const threshold=Math.max(batchSize,Number(opts.threshold||24));
  if(rows.length<threshold)return {mode:"single",batches:[rows],sourceCount:rows.length};
  const batches=[];
  for(let i=0;i<rows.length;i+=batchSize)batches.push(rows.slice(i,i+batchSize));
  return {mode:"map-reduce",batches,sourceCount:rows.length};
}

export function sourceContract(records=[]){
  const sources=validateRecoveredSources(records);
  if(!sources.length)return {answerAllowed:false,sources:[],reason:"NO_REAL_EVIDENCE"};
  return {answerAllowed:true,sources,reason:""};
}

export function buildCitationCatalog(records=[]){
  return validateRecoveredSources(records).map((source,index)=>({
    ref:"F"+(index+1),
    ...source
  }));
}

export function buildEncyclopedicContract(records=[],opts={}){
  const sources=buildCitationCatalog(records);
  if(!sources.length)return {
    answerAllowed:false,
    mode:"no-evidence",
    sources:[],
    rules:["Do not answer from model memory when the library has no recovered evidence."]
  };
  const plan=buildMapReducePlan(records,opts);
  return {
    answerAllowed:true,
    mode:plan.mode,
    batches:plan.batches,
    sources,
    rules:[
      "Synthesize connected explanatory paragraphs; do not dump isolated quotations.",
      "Every factual library claim must be traceable to a recovered source.",
      "Never invent a title, page, document, excerpt or citation.",
      "Deduplicate overlapping chunks before final synthesis.",
      "When evidence conflicts, describe the conflict instead of silently choosing one source."
    ]
  };
}

export async function runFailoverChain({providers=[],query,accept}={}){
  const errors=[];
  for(const provider of providers){
    if(!provider||typeof provider.run!=="function")continue;
    if(provider.circuit && !provider.circuit.canTry())continue;
    try{
      const value=await provider.run(query);
      const ok=typeof accept==="function"?await accept(value,provider):Boolean(value);
      if(!ok)throw new Error("FNS_FAILOVER_REJECTED_RESULT");
      provider.circuit?.success();
      return {provider:String(provider.name||"unnamed"),value};
    }catch(error){
      provider.circuit?.failure();
      errors.push({provider:String(provider?.name||"unnamed"),error:String(error?.message||error)});
    }
  }
  const failure=new Error("FNS_FAILOVER_EXHAUSTED");
  failure.causes=errors;
  throw failure;
}

export function validateCitationCatalog(catalog=[]){
  if(!Array.isArray(catalog)||!catalog.length)throw new Error("FNS_CITATIONS_EMPTY");
  const refs=new Set();
  for(const item of catalog){
    if(!item||!String(item.ref||"").trim())throw new Error("FNS_CITATION_REF_MISSING");
    if(refs.has(item.ref))throw new Error("FNS_CITATION_REF_DUPLICATE");
    refs.add(item.ref);
    if(!String(item.document_id||"").trim())throw new Error("FNS_CITATION_DOCUMENT_MISSING");
    if(!String(item.title||"").trim())throw new Error("FNS_CITATION_TITLE_MISSING");
    if(!String(item.excerpt||"").trim())throw new Error("FNS_CITATION_EXCERPT_MISSING");
  }
  return {valid:true,count:catalog.length};
}

export class CircuitBreaker{
  constructor({threshold=3,pauseMs=5000,maxPauseMs=60000}={}){
    this.threshold=threshold;this.pauseMs=pauseMs;this.maxPauseMs=maxPauseMs;
    this.failures=0;this.openUntil=0;this.rounds=0;
  }
  canTry(now=Date.now()){return now>=this.openUntil}
  success(){this.failures=0;this.openUntil=0;this.rounds=0}
  failure(now=Date.now()){
    this.failures++;
    if(this.failures>=this.threshold){
      this.rounds++;
      this.openUntil=now+Math.min(this.maxPauseMs,this.pauseMs*(2**(this.rounds-1)));
    }
  }
}

export function promotionGate({library,snapshot,qa}={}){
  const lib=assertCompleteLibrary(library||{});
  if(snapshot?.partial===true)throw new Error("FNS_SNAPSHOT_PARTIAL");
  if(snapshot?.authoritative!==true)throw new Error("FNS_SNAPSHOT_NOT_AUTHORITATIVE");
  if(Number(snapshot?.chunks||0)!==lib.chunks)throw new Error("FNS_SNAPSHOT_CHUNK_MISMATCH");
  if(Number(snapshot?.embeddings||0)!==lib.embeddings)throw new Error("FNS_SNAPSHOT_EMBEDDING_MISMATCH");
  const required=["site","layout","navigation","fale","lexical","vector","multiSource","encyclopedic","citations","audio","avatar","mobile","desktop","persistence","fallback","rollback"];
  const missing=required.filter(k=>qa?.[k]!==true);
  if(missing.length)throw new Error("FNS_QA_MISSING:"+missing.join(","));
  return {promotable:true,version:GOLDEN_VERSION};
}
