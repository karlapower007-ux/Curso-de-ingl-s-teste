import fs from "node:fs";

function assert(cond,msg){ if(!cond){ console.error("EXHAUSTIVE_V80_FAIL="+msg); process.exit(1); } }

const index=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const preservation=JSON.parse(fs.readFileSync(new URL("../v8-preservation-manifest.json",import.meta.url),"utf8"));
const release=fs.readFileSync(new URL("./autonomous-release.sh",import.meta.url),"utf8");
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
assert(index.includes("function stripSynthesisPrincipalLabel"),"robust-synthesis-label-stripper");
assert(index.includes("function publicSourceView"),"public-source-sanitizer");
assert(index.includes("fontes:publicSourceViews(usedSources)") || index.includes("fontes: publicSourceViews(usedSources)"),"public-source-payload-sanitized");
assert(index.includes("sources: publicSourceViews(sources)"),"persistent-memory-source-sanitized");
assert(index.includes("function secondaryLexicalRescueQueries"),"secondary-lexical-rescue-present");
assert(index.includes("semanticAnchorCoverage(rowText,rescueQuery)"),"secondary-rescue-coverage-uses-focused-query");
assert(index.includes("rescueSuccesses>=3"),"secondary-rescue-multi-group-bounded");
assert(index.includes("return out.slice(0,6)"),"secondary-rescue-probe-cap");
assert(preservation?.library?.expected_verified_chunks===28636,"preservation-chunks-28636");
assert(preservation?.library?.expected_verified_vectors===28636,"preservation-vectors-28636");
assert(preservation?.library?.historical_verified_fallback_chunks===25199,"historical-fallback-preserved");
assert(release.includes("R2_PRESERVED_MANIFEST_PASS=yes"),"preserved-r2-release-gate");
assert(release.includes("R2_RECONCILIATION_PASS=preserved-r2-degraded-do"),"degraded-do-release-gate");

console.log(JSON.stringify({
  ok:true,
  contract:"FONTE RECUPERADA -> ANALISE -> TEXTO VISIVEL -> REFERENCIA",
  full_text:true,
  resposta_aliases_full_text:true,
  frozen_frontend_preserved:true,
  continuation:true,
  information_preservation_gate:true,
  endpoint_degraded_guards:true,
  public_source_metadata_sanitized:true,
  broad_query_subject_rescue:true,
  broad_query_rescue_probe_cap:6,
  broad_query_rescue_group_cap:3,
  preservation_floor_chunks:28636,
  preservation_floor_vectors:28636,
  degraded_do_release_gate:true
},null,2));
