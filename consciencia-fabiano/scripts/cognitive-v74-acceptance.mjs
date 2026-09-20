import {
  TURBINES,PERFORMANCE_GUARD,buildExecutionPlan,runCognitivePlan,evidenceGateV74,catalogAudit
} from "../src/cognitive-turbines-v74.js";

const assert=(cond,msg)=>{if(!cond) throw new Error(msg);};
const audit=catalogAudit();
assert(audit.valid,"CATALOG_COUNT/UNIQUE/FAMILY invariant failed");
assert(audit.total===1000,"CATALOG_COUNT");
assert(audit.unique_ids===1000,"CATALOG_UNIQUE_IDS");
assert(audit.family_count===20,"CATALOG_FAMILY_COUNT");
assert(Object.values(audit.families).every(n=>n===50),"CATALOG_20x50");
assert([...TURBINES.values()].every(t=>t.requires_llm===false),"TURBINE_LLM_FORBIDDEN");

const cases=[
  ["reference_only","Me dê somente a referência documental de Alma 32:21.",24],
  ["summary","Faça um resumo em cinco linhas deste capítulo.",24],
  ["comparison","Compare os autores e diga onde discordam.",24],
  ["reflection","O que você pensa sobre isso? Faça uma reflexão separada dos fatos.",24],
  ["hypothesis","E se fosse o contrário? Trate como hipótese.",24],
  ["deep","Faça uma análise profunda e comparativa em múltiplas fontes.",64]
];

for(const [name,q,limit] of cases){
  const mode=name==="deep"?"analysis":name;
  const plan=buildExecutionPlan(q,{mode,language:"pt",use_history:false},{activeLimit:limit,deepResearch:name==="deep"});
  assert(plan.selected_count>0,"ROUTER_EMPTY_"+name);
  assert(plan.selected_count<=limit,"BOUND_ACTIVE_"+name);
  assert(plan.selected_count<1000,"NEVER_EXECUTE_1000_"+name);
  assert(plan.concurrency===8,"BOUND_CONCURRENCY_"+name);
  if(name==="reference_only"){
    assert(plan.constraints.groq_calls_max===1,"GROQ_GLOBAL_MAX");
    assert(plan.constraints.turbine_groq_calls===0,"REFERENCE_ONLY_NO_TURBINE_LLM");
  }
}

const fakeSource={document_id:"d1",titulo:"Documento Teste",arquivo:"teste.pdf",pagina:1,trecho:"Trecho documental de teste.",score:1};
const perf={};
for(const size of [5,20,50,64]){
  const selected=[...TURBINES.values()].slice(0,size);
  const plan={
    selected,selected_count:selected.length,selected_ids:selected.map(t=>t.id),
    concurrency:PERFORMANCE_GUARD.workerConcurrency,output:"balanced_answer",
    epistemicMode:"analysis",deepResearch:size>24
  };
  const timings=[];
  for(let i=0;i<5;i++){
    const t0=performance.now();
    const result=await runCognitivePlan(plan,{sources:[fakeSource],contract:{mode:"analysis",language:"pt"}});
    timings.push(performance.now()-t0);
    assert(result.llm_calls===0,"MICROTURBINE_LLM_CALL");
    assert(result.executed_count===size,"PERF_EXECUTED_"+size);
  }
  timings.sort((a,b)=>a-b);
  perf[size]={p50_ms:Number(timings[Math.floor(timings.length*.5)].toFixed(3)),p95_ms:Number(timings[Math.min(timings.length-1,Math.floor(timings.length*.95))].toFixed(3))};
}

const noEvidencePlan=buildExecutionPlan("Qual é a frase exata do autor sobre ZXQ_NOT_IN_LIBRARY?",{mode:"factual",language:"pt",use_history:false});
const noEvidenceRun=await runCognitivePlan(noEvidencePlan,{sources:[],contract:{mode:"factual",language:"pt"}});
const gate=evidenceGateV74(noEvidencePlan,[],noEvidenceRun);
assert(gate.canAnswer===false && gate.policy==="ABSTAIN","ABSTAIN_NO_EVIDENCE");

console.log(JSON.stringify({
  ok:true,
  tests:[
    "CATALOG_COUNT","CATALOG_UNIQUE_IDS","CATALOG_20x50","REFERENCE_ONLY_NO_LLM",
    "ANALYTIC_MAX_ONE_LLM_CONTRACT","ROUTER_MINIMALITY","NEVER_EXECUTE_1000",
    "BOUND_CONCURRENCY","ABSTAIN_NO_EVIDENCE"
  ],
  audit,performance:perf
},null,2));
