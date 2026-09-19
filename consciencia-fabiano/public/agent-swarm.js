// V6.0 OMNI AGENT SWARM — 10 logical agents, CPU-governed physical Web Workers.
const LOGICAL_AGENT_COUNT=10;
const MAX_PHYSICAL_AGENT_WORKERS=10;
const CARD_LIMIT=1000;

function physicalCount(){
  const hc=Math.max(1,Number(navigator.hardwareConcurrency||4));
  return Math.max(1,Math.min(MAX_PHYSICAL_AGENT_WORKERS,hc>2?hc-1:1));
}
function keyOf(row){
  return String(row?.id||row?.key||"")||[row?.document_id||"",row?.chunk_index||0,String(row?.text||"").slice(0,180)].join("|");
}
function mergeRows(...groups){
  const seen=new Set(),out=[];
  for(const group of groups)for(const row of (Array.isArray(group)?group:[])){
    const key=keyOf(row);if(!key||seen.has(key))continue;seen.add(key);out.push(row);
  }
  return out.slice(0,CARD_LIMIT);
}
function toCard(row,index){
  return {
    id:String(row?.id||row?.key||("agent-"+index)),
    node:index+1,
    score:Number(row?.score||0),
    coverage:Number(row?.coverage||0),
    text:String(row?.text||"").trim(),
    title:String(row?.semantic_title||row?.canonical_reference||row?.title||row?.filename||"Documento"),
    semantic_title:String(row?.semantic_title||""),
    canonical_reference:String(row?.canonical_reference||""),
    filename:String(row?.filename||""),
    source_title:String(row?.title||row?.filename||"Documento"),
    author:String(row?.author||""),
    page:Number(row?.page||0)||null,
    chunk_index:Number(row?.chunk_index||0),
    document_id:String(row?.document_id||row?.doc_key||""),
    context_window_start:Number(row?.context_window_start||0),
    context_window_end:Number(row?.context_window_end||0),
    full_chunk_fallback:Boolean(row?.full_chunk_fallback),
    exact_match:Boolean(row?.exact_match),
    semantic_fallback:Boolean(row?.semantic_fallback),
    bouncer_reason:String(row?.bouncer_reason||""),
    agent_votes:Array.isArray(row?.agent_votes)?row.agent_votes:[]
  };
}
export async function runAgentSwarm({question,literalMatches=[],semanticMatches=[],onProgress}){
  const workerCount=physicalCount();
  const workers=Array.from({length:workerCount},()=>new Worker("/agent-node-worker.js?v=6.0.0",{type:"module"}));
  const pending=new Map();let seq=0,cursor=0;
  for(const worker of workers){
    worker.onmessage=event=>{
      const d=event.data||{};if(d.type!=="result")return;
      const p=pending.get(d.request_id);if(!p)return;
      pending.delete(d.request_id);p.resolve(d);
    };
    worker.onerror=error=>{
      for(const [id,p] of pending){if(p.worker!==worker)continue;pending.delete(id);p.resolve({rows:[],error:String(error?.message||"worker error")});}
    };
  }
  const run=(role,payload)=>new Promise(resolve=>{
    const worker=workers[(cursor++)%workers.length],request_id=++seq;
    pending.set(request_id,{resolve,worker});
    worker.postMessage({type:"run",request_id,role,question,...payload});
  });
  try{
    const a1=await run(1,{literal:literalMatches,candidates:literalMatches});
    onProgress?.({agent:1,name:"Literal",count:a1.rows?.length||0});
    const literal=Array.isArray(a1.rows)?a1.rows:[];

    let semantic=[];
    if(!literal.length){
      const a2=await run(2,{semantic:semanticMatches});
      semantic=Array.isArray(a2.rows)?a2.rows:[];
      onProgress?.({agent:2,name:"Semantic",count:semantic.length});
    }else onProgress?.({agent:2,name:"Semantic",count:0,skipped:true});

    const seed=literal.length?literal:semantic;
    if(!seed.length)return {
      ok:false,cards:[],strict_empty:true,zero_noise:true,
      logical_agents:LOGICAL_AGENT_COUNT,physical_workers:workerCount,literal_hits:0,semantic_candidates:0
    };

    const a3=await run(3,{candidates:seed});
    onProgress?.({agent:3,name:"Contextualizer",count:a3.rows?.length||0});
    const a4=await run(4,{candidates:a3.rows||[]});
    onProgress?.({agent:4,name:"Reference Judge",count:a4.rows?.length||0});
    const judged=Array.isArray(a4.rows)?a4.rows:[];

    const sweep=await Promise.all([5,6,7,8,9].map(role=>run(role,{candidates:judged})));
    sweep.forEach((r,i)=>onProgress?.({agent:i+5,name:"Sweeper "+(i+5),count:r.rows?.length||0}));
    const swept=mergeRows(...sweep.map(x=>x.rows||[]));
    const a10=await run(10,{candidates:swept,literal_exists:literal.length>0});
    onProgress?.({agent:10,name:"Bouncer",count:a10.rows?.length||0});
    const finalRows=Array.isArray(a10.rows)?a10.rows:[];
    const cards=finalRows.slice(0,CARD_LIMIT).map(toCard);
    return {
      ok:cards.length>0,cards,
      strict_empty:cards.length===0,zero_noise:true,
      logical_agents:LOGICAL_AGENT_COUNT,
      physical_workers:workerCount,
      hardware_concurrency:Number(navigator.hardwareConcurrency||0)||null,
      literal_hits:literal.length,
      semantic_candidates:semantic.length,
      semantic_fallback_used:literal.length===0&&semantic.length>0,
      agent_2_engine:"Transformers.js MiniLM q8 via embedding-worker",
      final_gate:"Agent 10 Bouncer",
      main_thread_analysis:false
    };
  }finally{
    for(const w of workers)try{w.terminate();}catch{}
  }
}
