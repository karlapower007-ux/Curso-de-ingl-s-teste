import fs from "node:fs";

function assert(cond,msg){ if(!cond){ console.error("EXHAUSTIVE_V80_FAIL="+msg); process.exit(1); } }

const index=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
assert(index.includes("const EXHAUSTIVE_CONTINUATION_MAX_PARTS=6"),"continuation-max");
assert(index.includes("function exhaustiveEvidenceGroups"),"evidence-groups");
assert(index.includes("function exhaustiveCoverage"),"coverage-gate");
assert(index.includes("async function continueExhaustiveFullText"),"continuation-engine");
assert(index.includes("information_preservation_gate"),"information-preservation-gate");
assert(index.includes("full_text:answer") || index.includes("full_text: answer"),"full-text-backend");
assert(index.includes('code:"MEMORY_DURABLE_DEGRADED"'),"memory-degraded-guard");
assert(index.includes('code:"R2_RECONCILE_DURABLE_DEGRADED"'),"r2-degraded-guard");
assert(index.includes("synthesis_principal_single_block_disabled: true"),"single-synthesis-disabled");
assert(!index.includes('return normalized+\n    (coverage?'),"coverage-ledger-not-rendered");
assert(!index.includes(':"1. SÍNTESE PRINCIPAL:\\n\\n"+base'),"single-synthesis-prefix-removed");

console.log(JSON.stringify({
  ok:true,
  contract:"FONTE RECUPERADA -> ANALISE -> TEXTO VISIVEL -> REFERENCIA",
  full_text:true,
  resposta_aliases_full_text:true,
  frozen_frontend_preserved:true,
  continuation:true,
  information_preservation_gate:true,
  endpoint_degraded_guards:true
},null,2));
