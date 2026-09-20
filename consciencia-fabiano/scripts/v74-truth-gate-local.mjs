import fs from "node:fs";
import {TURBINES,PERFORMANCE_GUARD,buildExecutionPlan,runCognitivePlan,catalogAudit} from "../src/cognitive-turbines-v74.js";

const normalize=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
const rows=[...TURBINES.values()];
const audit=catalogAudit();
const failures=[];
const passes=[];
const check=(name,cond,detail={})=>{(cond?passes:failures).push({name,detail});};

const unique=(arr)=>new Set(arr).size;
const nominalKeys=rows.map(t=>normalize(t.name));
const semanticKeys=rows.map(t=>[
  t.family,normalize(t.operation),t.profile,t.output_contract,
  [...t.intents].sort().join(","),[...t.objects].sort().join(","),t.handler
].join("|"));
const baseCapabilityKeys=rows.map(t=>t.family+"|"+normalize(t.operation));
const baseGroups=new Map();
for(const t of rows){
  const k=t.family+"|"+normalize(t.operation);
  const a=baseGroups.get(k)||[]; a.push(t); baseGroups.set(k,a);
}
const parameterizedClusters=[...baseGroups.entries()].filter(([,v])=>v.length>1).map(([k,v])=>({
  key:k,count:v.length,profiles:[...new Set(v.map(x=>x.profile))],outputs:[...new Set(v.map(x=>x.output_contract))],
  ids:v.map(x=>x.id)
}));
const semanticDuplicateGroups=new Map();
for(const t of rows){
  const k=[
    t.family,normalize(t.operation),t.profile,t.output_contract,t.handler,
    [...t.triggers].map(normalize).sort().join(","),
    [...t.intents].sort().join(","),[...t.objects].sort().join(",")
  ].join("|");
  const a=semanticDuplicateGroups.get(k)||[]; a.push(t.id); semanticDuplicateGroups.set(k,a);
}
const exactSemanticDuplicates=[...semanticDuplicateGroups.entries()].filter(([,ids])=>ids.length>1).map(([signature,ids])=>({signature,ids}));

check("CATALOG_TOTAL",audit.total===1000,{actual:audit.total});
check("CATALOG_UNIQUE_IDS",audit.unique_ids===1000,{actual:audit.unique_ids});
check("CATALOG_HANDLERS",rows.every(t=>String(t.handler||"").trim()),{missing:rows.filter(t=>!String(t.handler||"").trim()).map(t=>t.id)});
check("CATALOG_FAMILIES",rows.every(t=>String(t.family||"").trim()),{missing:rows.filter(t=>!String(t.family||"").trim()).map(t=>t.id)});
check("CATALOG_OUTPUT_CONTRACT",rows.every(t=>String(t.output_contract||"").trim()),{missing:rows.filter(t=>!String(t.output_contract||"").trim()).map(t=>t.id)});
check("CATALOG_NO_LLM",rows.every(t=>t.requires_llm===false),{violations:rows.filter(t=>t.requires_llm!==false).map(t=>t.id)});
check("CATALOG_NOMINAL_UNIQUENESS",unique(nominalKeys)===1000,{unique_names:unique(nominalKeys)});
check("CATALOG_EXACT_SEMANTIC_SIGNATURE_UNIQUENESS",exactSemanticDuplicates.length===0,{duplicate_groups:exactSemanticDuplicates.length});
check("CATALOG_BASE_CAPABILITY_DISTINCTNESS",unique(baseCapabilityKeys)===1000,{
  base_capabilities:unique(baseCapabilityKeys),
  parameterized_clusters:parameterizedClusters.length,
  interpretation:"Strict truth gate treats profile variants of the same operation as one base semantic capability."
});

const humanRoutingCases=[
  {name:"A_reference",q:"Me dê somente a referência.",mode:"reference_only",max:24,want:["F01","F14","F17"]},
  {name:"B_verse",q:"Qual é o capítulo e o versículo?",mode:"reference_only",max:24,want:["F03"]},
  {name:"C_quote",q:"Copie exatamente a citação e diga de qual livro ela veio.",mode:"quotation",max:24,want:["F05","F04"]},
  {name:"D_summary",q:"Faça um resumo do capítulo.",mode:"summary",max:24,want:["F06"]},
  {name:"E_fichamento",q:"Faça um fichamento completo.",mode:"fichamento",max:24,want:["F06","F07","F17"]},
  {name:"F_compare",q:"Compare o autor A com o autor B.",mode:"comparison",max:24,want:["F08"]},
  {name:"G_reflection",q:"O que você pensa sobre isso?",mode:"reflection",max:24,want:["F09","F16"]},
  {name:"H_whatif",q:"E se fosse exatamente o contrário?",mode:"hypothesis",max:24,want:["F10"]},
  {name:"I_doubts",q:"Quais dúvidas podem ser levantadas sobre esse argumento?",mode:"analysis",max:24,want:["F11"]},
  {name:"J_continue",q:"Continue.",mode:"factual",max:24,want:["F16"]},
  {name:"compound",q:"Localize a passagem, explique o contexto, compare com o outro autor e depois faça uma reflexão.",mode:"analysis",max:24,want:["F08","F09","F19"]},
  {name:"noise1",q:"onde ta aquele versiculo de cristo?",mode:"factual",max:24,want:["F03"]},
  {name:"noise2",q:"me da so a referencia",mode:"reference_only",max:24,want:["F17"]},
  {name:"noise3",q:"qual livro fala disso msm?",mode:"factual",max:24,want:["F04"]},
  {name:"noise4",q:"e se n fosse assim?",mode:"hypothesis",max:24,want:["F10"]},
  {name:"noise5",q:"o q vc acha?",mode:"reflection",max:24,want:["F09"]},
  {name:"noise6",q:"faz um fichamento disso ai",mode:"fichamento",max:24,want:["F17"]}
];

const routing=[];
for(const tc of humanRoutingCases){
  const t0=performance.now();
  const plan=buildExecutionPlan(tc.q,{mode:tc.mode,language:"pt",use_history:/isso|continue|disso|aquele/.test(normalize(tc.q))});
  const router_ms=performance.now()-t0;
  const families=[...new Set(plan.selected.map(t=>t.family))];
  const missing=tc.want.filter(x=>!families.includes(x));
  const rejected=1000-plan.selected_count;
  check("ROUTER_"+tc.name,plan.selected_count>0 && plan.selected_count<=tc.max && plan.selected_count<1000 && missing.length===0,{
    selected_count:plan.selected_count,active_limit:plan.activeLimit,families,missing_expected_families:missing
  });
  routing.push({name:tc.name,query:tc.q,intents:plan.intents,objects:plan.objects,output:plan.output,selected_count:plan.selected_count,selected_ids:plan.selected_ids,rejected_count:rejected,router_ms:Number(router_ms.toFixed(3)),families});
}

const restrictive=[
  ["Somente uma frase.","factual","one_sentence"],
  ["Não explique.","factual",null],
  ["Somente a fonte.","reference_only","reference_only"],
  ["Sem resumo.","factual",null],
  ["Resposta completa.","analysis",null],
  ["Explique profundamente.","analysis","deep_answer"],
  ["Explique como se eu tivesse 10 anos.","analysis",null],
  ["Use linguagem acadêmica.","analysis",null],
  ["Liste apenas as citações.","quotation",null]
];
const restrictiveResults=[];
for(const [q,mode,expectedOutput] of restrictive){
  const plan=buildExecutionPlan(q,{mode,language:"pt",use_history:false});
  const ok=!expectedOutput || plan.output===expectedOutput;
  check("RESTRICTIVE_"+normalize(q),ok,{output:plan.output,expectedOutput});
  restrictiveResults.push({q,mode,output:plan.output,selected_count:plan.selected_count,selected_ids:plan.selected_ids});
}

const load=[];
for(const requested of [5,20,50,64,96]){
  const plan=buildExecutionPlan("Faça análise profunda comparativa com fontes e validação epistemológica.",{mode:"analysis",language:"pt",use_history:false},{activeLimit:requested,deepResearch:requested>24});
  // Force the exact requested number from the catalog only for isolated load testing; no production router override.
  const isolated={...plan,selected:rows.slice(0,requested),selected_count:requested,selected_ids:rows.slice(0,requested).map(t=>t.id),concurrency:8,epistemicMode:"analysis"};
  const samples=[];
  for(let i=0;i<30;i++){
    const start=performance.now();
    const run=await runCognitivePlan(isolated,{sources:[{document_id:"synthetic",titulo:"Synthetic acceptance evidence",pagina:1,trecho:"Evidence"}],contract:{mode:"analysis",language:"pt"}});
    samples.push(performance.now()-start);
    check("LOAD_INVARIANTS_"+requested+"_"+i,run.executed_count===requested && run.concurrency<=8 && run.llm_calls===0,{run});
  }
  samples.sort((a,b)=>a-b);
  const pct=p=>samples[Math.min(samples.length-1,Math.floor((samples.length-1)*p))];
  load.push({requested,physical_concurrency:8,p50_ms:Number(pct(.50).toFixed(3)),p95_ms:Number(pct(.95).toFixed(3)),p99_ms:Number(pct(.99).toFixed(3)),timeouts:0,llm_calls:0});
}

const report={
  schema:"fns-v74-truth-gate-local",
  generated_at:new Date().toISOString(),
  frozen_architecture:true,
  audit:{
    ...audit,
    unique_nominal_names:unique(nominalKeys),
    exact_semantic_duplicate_groups:exactSemanticDuplicates,
    base_semantic_capabilities:unique(baseCapabilityKeys),
    parameterized_variant_clusters:parameterizedClusters
  },
  routing,
  restrictive:restrictiveResults,
  load,
  passes,
  failures,
  local_gate_pass:failures.length===0
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/v74-truth-gate-local.json",JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify({ok:report.local_gate_pass,pass_count:passes.length,failure_count:failures.length,failures,audit:report.audit,load},null,2));
if(failures.length) process.exitCode=2;
