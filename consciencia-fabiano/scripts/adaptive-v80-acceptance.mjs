import assert from "node:assert/strict";
import {
  ADAPTIVE_V80_VERSION,
  buildAdaptiveV80Plan,
  buildQueryVariantsV80,
  adaptiveFuseAndRerankV80,
  adaptiveEvidenceGateV80,
  v80RuntimeSummary
} from "../src/adaptive-rag-v80.js";

const fast=buildAdaptiveV80Plan("O que é dízimo?",{mode:"definition"});
assert.equal(fast.mode,"FAST");
assert.ok(fast.memory_perspectives.length<=5);
assert.ok(fast.query_limit<=4);
assert.ok(fast.search_limit<=4);
assert.equal(fast.constraints.llm_calls_before_final,0);
assert.equal(fast.constraints.preserve_legacy_pipeline,true);
assert.equal(fast.constraints.preserve_ui,true);
assert.equal(fast.constraints.preserve_library,true);

const normal=buildAdaptiveV80Plan(
  "Explique a relação entre estes dois conceitos e mostre as fontes.",
  {mode:"analysis"}
);
assert.ok(["NORMAL","DEEP"].includes(normal.mode));
assert.ok(normal.memory_perspectives.length<=20);

const deep=buildAdaptiveV80Plan(
  "Faça uma pesquisa profunda e exaustiva, compare múltiplas fontes, contexto histórico, cronologia, contrapontos e consequências.",
  {mode:"analysis"},
  {deepResearch:true}
);
assert.equal(deep.mode,"DEEP");
assert.equal(deep.memory_perspectives.length,20);
assert.equal(deep.query_limit,20);
assert.equal(deep.search_limit,20);
assert.ok(deep.cognitive_active_limit<1000);

const protectedLoad=buildAdaptiveV80Plan(
  "Faça uma pesquisa profunda com múltiplas fontes.",
  {mode:"analysis"},
  {deepResearch:true,loadLevel:"high"}
);
assert.equal(protectedLoad.mode,"NORMAL");

const variants=buildQueryVariantsV80(
  "O que Joseph Smith ensinou sobre revelação?",
  "O que Joseph Smith ensinou sobre revelação?",
  deep
);
assert.ok(variants.length>0);
assert.ok(variants.length<=20);
assert.equal(new Set(variants.map(v=>v.query)).size,variants.length);

const rows=[
  {id:"a",trecho:"Joseph Smith ensinou sobre revelação e profetas.",lexical_score:0.90,semantic_score:0.70,score:0.80,document_id:"doc1"},
  {id:"b",trecho:"História geral sem relação direta.",lexical_score:0.10,semantic_score:0.20,score:0.15,document_id:"doc2"},
  {id:"c",trecho:"Revelação por meio de profetas e ensinamentos de Joseph Smith.",lexical_score:0.75,semantic_score:0.93,score:0.88,document_id:"doc3"}
];
const snapshot=JSON.stringify(rows);
const ranked=adaptiveFuseAndRerankV80(rows,"Joseph Smith revelação",variants,deep);
assert.equal(JSON.stringify(rows),snapshot,"V8 reranking must not mutate legacy retrieval rows");
assert.equal(ranked.length,3);
assert.notEqual(ranked[0].id,"b");

const blocked=adaptiveEvidenceGateV80(deep,rows,{canAnswer:false,reason:"legacy-block"});
assert.equal(blocked.canAnswer,false);
assert.equal(blocked.policy,"ABSTAIN");

const allowed=adaptiveEvidenceGateV80(deep,rows,{canAnswer:true,reason:"evidence_gate_pass"});
assert.equal(allowed.canAnswer,true);
assert.ok(allowed.independent_documents>=1);

const summary=v80RuntimeSummary(deep,variants,ranked);
assert.equal(summary.version,ADAPTIVE_V80_VERSION);
assert.equal(summary.llm_calls_before_final,0);
assert.equal(summary.preserve_legacy_pipeline,true);

console.log(JSON.stringify({
  ok:true,
  version:ADAPTIVE_V80_VERSION,
  fast:{memory:fast.memory_perspectives.length,query:fast.query_limit,search:fast.search_limit},
  deep:{memory:deep.memory_perspectives.length,query:deep.query_limit,search:deep.search_limit},
  overload_downgrade:protectedLoad.mode,
  legacy_gate_preserved:true,
  input_mutation:false,
  llm_calls_before_final:0
},null,2));
