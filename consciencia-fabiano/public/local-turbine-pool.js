// V3.3 STRICT PRECISION — pool CPU-aware com corte rígido e silêncio elegante.
const LOGICAL_NODE_CAPACITY=1000;
const MAX_PHYSICAL_WORKERS=16;
const MIN_RESULT_SCORE=3.25;
const HARD_MIN_COVERAGE=0.50;

function fold(text){
  return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu," ").replace(/\s+/g," ").trim();
}
function candidateTasks(matches,question){
  const tasks=[];let logical=1;
  for(const row of Array.from(matches||[]).slice(0,LOGICAL_NODE_CAPACITY)){
    tasks.push({
      id:String(row?.id||row?.key||((row?.document_id||row?.doc_key||"doc")+":"+(row?.chunk_index||logical))),
      logical_node:logical++,question,
      text:String(row?.text||row?.trecho||""),
      source:{
        document_id:String(row?.document_id||row?.doc_key||""),
        filename:String(row?.filename||row?.arquivo||""),
        title:String(row?.title||row?.titulo||row?.filename||row?.arquivo||"Documento"),
        author:String(row?.author||row?.autor||""),
        page:Number(row?.page||row?.pagina||0)||null,
        chunk_index:Number(row?.chunk_index||0),
        language:String(row?.language||row?.idioma||"")
      }
    });
  }
  return tasks.filter(task=>task.text.trim().length>=24);
}
function physicalWorkerCount(){
  const hc=Math.max(1,Number(navigator.hardwareConcurrency||4));
  return Math.max(1,Math.min(MAX_PHYSICAL_WORKERS,hc>2?hc-1:1));
}
function dedupeCards(results){
  const seen=new Set(),cards=[];
  for(const r of results.sort((a,b)=>Number(b.score||0)-Number(a.score||0))){
    if(!r?.ok)continue;
    const isBooleanExact=r.strict_mode==="boolean-exact"&&r.exact_match===true;
    if(!isBooleanExact&&(Number(r.score||0)<MIN_RESULT_SCORE||Number(r.coverage||0)<HARD_MIN_COVERAGE))continue;
    const fingerprint=[String(r.source?.document_id||""),String(r.source?.chunk_index||0),fold(r.text).slice(0,320)].join("|");
    if(!r.text||seen.has(fingerprint))continue;
    seen.add(fingerprint);
    cards.push({
      id:String(r.id||("card-"+cards.length)),
      node:Number(r.logical_node||0),
      score:Number(r.score||0),
      coverage:Number(r.coverage||0),
      text:String(r.text||"").trim(),
      title:String(r.semantic_title||r.source?.title||r.source?.filename||"Documento"),
      semantic_title:String(r.semantic_title||""),
      canonical_reference:String(r.canonical_reference||""),
      filename:String(r.source?.filename||""),
      source_title:String(r.source?.title||r.source?.filename||"Documento"),
      author:String(r.source?.author||""),
      page:r.source?.page||null,
      chunk_index:Number(r.source?.chunk_index||0),
      document_id:String(r.source?.document_id||""),
      context_window_start:Number(r.context_window_start||0),
      context_window_end:Number(r.context_window_end||0),
      context_before:Number(r.context_before||2),
      context_after:Number(r.context_after||4),
      full_chunk_fallback:Boolean(r.full_chunk_fallback)
,      strict_mode:String(r.strict_mode||"hard-threshold"),
      exact_match:Boolean(r.exact_match),
      exact_target:String(r.exact_target||""),
      hard_threshold:Number(r.hard_threshold||MIN_RESULT_SCORE),
      min_coverage:Number(r.min_coverage||HARD_MIN_COVERAGE)
    });
    if(cards.length>=160)break;
  }
  return cards;
}
export async function runLocalTurbines({question,matches,onProgress}){
  const tasks=candidateTasks(matches,question);
  if(!tasks.length)return {ok:false,cards:[],logical_capacity:LOGICAL_NODE_CAPACITY,logical_tasks:0,physical_workers:0};
  const workerCount=Math.min(physicalWorkerCount(),tasks.length),workers=[],pending=new Map(),results=new Array(tasks.length);
  let requestSeq=0,cursor=0,completed=0;
  const makeWorker=()=>{
    const worker=new Worker("/local-turbine-worker.js?v=3.3.0");
    worker.onmessage=event=>{
      const data=event.data||{};if(data.type!=="result")return;
      const slot=pending.get(data.request_id);if(!slot)return;
      pending.delete(data.request_id);slot.resolve(data.result);
    };
    worker.onerror=error=>{
      for(const [id,slot] of pending){
        if(slot.worker!==worker)continue;
        pending.delete(id);slot.resolve({ok:false,error:String(error?.message||"worker error")});
      }
    };
    return worker;
  };
  for(let i=0;i<workerCount;i++)workers.push(makeWorker());
  const dispatch=(worker,task)=>new Promise(resolve=>{
    const request_id=++requestSeq;
    pending.set(request_id,{resolve,worker});
    worker.postMessage({type:"extract",request_id,task});
  });
  try{
    await Promise.all(workers.map(async worker=>{
      while(true){
        const index=cursor++;if(index>=tasks.length)return;
        results[index]=await dispatch(worker,tasks[index]);completed++;
        if(typeof onProgress==="function"&&(completed===tasks.length||completed%10===0)){
          try{onProgress({completed,total:tasks.length,logical_capacity:LOGICAL_NODE_CAPACITY,physical_workers:workerCount});}catch{}
        }
      }
    }));
  }finally{for(const worker of workers)try{worker.terminate();}catch{}}
  const resolved=results.filter(Boolean);
  const cards=dedupeCards(resolved);
  const exactTarget=resolved.find(r=>r?.exact_target)?.exact_target||"";
  const booleanExact=resolved.some(r=>r?.strict_mode==="boolean-exact");
  const thresholdRejected=resolved.filter(r=>r?.reject_reason==="HARD_THRESHOLD_REJECT").length;
  const booleanRejected=resolved.filter(r=>r?.reject_reason==="BOOLEAN_EXACT_MISS").length;
  return {
    ok:cards.length>0,cards,
    strict_empty:cards.length===0,
    zero_noise:true,
    strict_mode:booleanExact?"boolean-exact":"hard-threshold",
    exact_target:String(exactTarget||""),
    hard_threshold:MIN_RESULT_SCORE,
    min_coverage:HARD_MIN_COVERAGE,
    rejected_by_threshold:thresholdRejected,
    rejected_by_boolean:booleanRejected,
    logical_capacity:LOGICAL_NODE_CAPACITY,
    logical_tasks:tasks.length,
    physical_workers:workerCount,
    hardware_concurrency:Number(navigator.hardwareConcurrency||0)||null,
    scoring:"worker-side-boolean-exact-or-bm25-hard-threshold",
    context_window:{before:2,after:4},
    canonical_reference_parser:true,
    main_thread_extraction:false
  };
}
