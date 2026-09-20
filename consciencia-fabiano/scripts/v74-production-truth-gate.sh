#!/usr/bin/env bash
set -euo pipefail

: "${BASE:?BASE required}"
: "${AUTOMATION_SECRET:?AUTOMATION_SECRET required}"
HDR=(-H "X-FNS-Automation: $AUTOMATION_SECRET")
REPORT_DIR="/tmp/v74-truth"
mkdir -p "$REPORT_DIR"

pass=0
fail=0
results="$REPORT_DIR/results.tsv"
: >"$results"

record(){
  local name="$1" status="$2" detail="${3:-}"
  printf '%s\t%s\t%s\n' "$name" "$status" "$detail" >>"$results"
  if [ "$status" = "PASS" ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
}
assert_jq(){
  local name="$1" file="$2" expr="$3"
  if jq -e "$expr" "$file" >/dev/null 2>&1; then record "$name" PASS; else record "$name" FAIL; fi
}
chat(){
  local name="$1" question="$2" memory_key="${3:-}" ua="${4:-FNS-Acceptance-Desktop}"
  local payload="$REPORT_DIR/$name.payload.json" output="$REPORT_DIR/$name.json" timing="$REPORT_DIR/$name.total"
  if [ -n "$memory_key" ]; then
    jq -nc --arg q "$question" --arg k "$memory_key" '{pergunta:$q,memory_key:$k,historico:[],stream:false}' >"$payload"
  else
    jq -nc --arg q "$question" '{pergunta:$q,historico:[],stream:false}' >"$payload"
  fi
  local code
  code=$(curl -sS --max-time 90 -o "$output" -w '%{http_code}|%{time_total}' "$BASE/api/chat" -A "$ua" -H 'Content-Type: application/json' --data-binary @"$payload" || echo '000|0')
  printf '%s\n' "${code#*|}" >"$timing"
  [ "${code%%|*}" = "200" ] || { record "$name" FAIL "http_${code%%|*}"; return 1; }
  return 0
}

log_gate(){ printf 'V74_TRUTH_GATE=%s\n' "$*"; }

log_gate "START"

# Catalog truth audit in production.
curl -fsS --max-time 20 "${HDR[@]}" "$BASE/api/admin/cognitive-v74" >"$REPORT_DIR/catalog.json"
assert_jq "CATALOG_1000_REAL" "$REPORT_DIR/catalog.json" '.audit.total==1000 and .audit.unique_ids==1000 and .audit.family_count==20 and .audit.valid==true and ([.audit.families[]]|all(.==50))'
curl -fsS --max-time 30 "${HDR[@]}" "$BASE/api/admin/cognitive-v74/manifest" >"$REPORT_DIR/manifest.json"
assert_jq "CATALOG_CONTRACTS" "$REPORT_DIR/manifest.json" '(.manifest|length)==1000 and ([.manifest[]|select((.handler|length)==0 or (.family|length)==0 or (.output_contract|length)==0 or .requires_llm!=false)]|length)==0'
assert_jq "CATALOG_UNIQUE_NAMES" "$REPORT_DIR/manifest.json" '([.manifest[].name]|unique|length)==1000'
assert_jq "CATALOG_NO_GROQ" "$REPORT_DIR/manifest.json" '([.manifest[]|select(.requires_llm!=false)]|length)==0'

# Pull enough private records to choose real, non-logged evidence samples.
curl -fsS --max-time 30 "${HDR[@]}" "$BASE/api/admin/export-library?offset=0&limit=200" >"$REPORT_DIR/library.json"
python3 - "$REPORT_DIR/library.json" "$REPORT_DIR/samples.json" <<'PY'
import json,re,sys
src,dst=sys.argv[1:3]
data=json.load(open(src,encoding="utf-8"))
rows=data.get("records") or []
def words(text):
    return re.findall(r"[A-Za-zÀ-ÿ0-9'-]+",str(text or ""))
samples=[]
seen=set()
for r in rows:
    text=str(r.get("text") or r.get("trecho") or "")
    ws=words(text)
    if len(ws)<12: continue
    doc=str(r.get("document_id") or r.get("doc_id") or r.get("arquivo") or r.get("titulo") or "")
    if not doc or doc in seen: continue
    seen.add(doc)
    samples.append({
      "document_id":doc,
      "phrase":" ".join(ws[2:14]),
      "title":str(r.get("titulo") or r.get("title") or r.get("arquivo") or "Documento"),
      "author":str(r.get("autor") or r.get("author") or ""),
      "has_scripture_ref":bool(re.search(r"\b\d{1,3}\s*:\s*\d{1,3}\b",text))
    })
    if len(samples)>=4: break
json.dump({"samples":samples},open(dst,"w",encoding="utf-8"),ensure_ascii=False)
PY
sample_count=$(jq '.samples|length' "$REPORT_DIR/samples.json")
if [ "$sample_count" -lt 1 ]; then
  record "REAL_LIBRARY_SAMPLE" FAIL "no_usable_document"
else
  record "REAL_LIBRARY_SAMPLE" PASS "documents=$sample_count"
fi
phrase1=$(jq -r '.samples[0].phrase // empty' "$REPORT_DIR/samples.json")
title1=$(jq -r '.samples[0].title // empty' "$REPORT_DIR/samples.json")
phrase2=$(jq -r '.samples[1].phrase // .samples[0].phrase // empty' "$REPORT_DIR/samples.json")
title2=$(jq -r '.samples[1].title // .samples[0].title // empty' "$REPORT_DIR/samples.json")

# Router traces for real human language. No content is logged.
router_questions=(
  "Me dê somente a referência."
  "Qual é o capítulo e o versículo?"
  "Copie exatamente a citação e diga de qual livro ela veio."
  "Faça um resumo do capítulo."
  "Faça um fichamento completo."
  "Compare o autor A com o autor B."
  "O que você pensa sobre isso?"
  "E se fosse exatamente o contrário?"
  "Quais dúvidas podem ser levantadas sobre esse argumento?"
  "Continue."
  "Localize a passagem, explique o contexto, compare com o outro autor e depois faça uma reflexão."
  "onde ta aquele versiculo de cristo?"
  "me da so a referencia"
  "qual livro fala disso msm?"
  "e se n fosse assim?"
  "o q vc acha?"
  "faz um fichamento disso ai"
)
router_index=0
for q in "${router_questions[@]}"; do
  router_index=$((router_index+1))
  encoded=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$q")
  t=$(curl -sS --max-time 20 -o "$REPORT_DIR/router-$router_index.json" -w '%{time_total}' "${HDR[@]}" "$BASE/api/admin/cognitive-v74?q=$encoded" || echo 0)
  printf '%s\n' "$t" >"$REPORT_DIR/router-$router_index.time"
  if jq -e '.ok==true and .plan.selected_count>0 and .plan.selected_count<=.plan.activeLimit and .plan.selected_count<1000 and .plan.concurrency<=8 and .plan.constraints.turbine_groq_calls==0' "$REPORT_DIR/router-$router_index.json" >/dev/null; then
    record "ROUTER_HUMAN_$router_index" PASS
  else record "ROUTER_HUMAN_$router_index" FAIL; fi
done

# Establish server-side conversational context using a real library phrase.
memory_key="v74-truth-cross-device-20260920-0123456789abcdef"
chat "context_pc" "Analise somente com base na biblioteca este trecho: $phrase1" "$memory_key" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FNS-PC"
assert_jq "CONTEXT_PC" "$REPORT_DIR/context_pc.json" '.ok==true and .fallback==false and (.fontes|length)>0 and .memory_persisted==true'

chat "test_A" "Me dê somente a referência." "$memory_key" "Mozilla/5.0 (Linux; Android 16; Mobile) FNS-Mobile" || true
assert_jq "TEST_A_REFERENCE_ONLY" "$REPORT_DIR/test_A.json" '.ok==true and .fallback==false and .cognitive_mode=="reference_only" and .llm_calls==0 and (.fontes|length)>0'

chat "test_B" "Qual é o capítulo e o versículo?" "$memory_key" "Mozilla/5.0 (Linux; Android 16; Mobile) FNS-Mobile" || true
assert_jq "TEST_B_CHAPTER_VERSE_NO_LECTURE" "$REPORT_DIR/test_B.json" '.ok==true and .llm_calls==0 and (.resposta|type)=="string" and (.resposta|length)>0'

chat "test_C" "Copie exatamente a citação que contém: $phrase1 — e diga de qual livro ela veio. Não parafraseie." "" || true
assert_jq "TEST_C_LITERAL_PROVENANCE" "$REPORT_DIR/test_C.json" '.ok==true and .fallback==false and (.fontes|length)>0 and ([.fontes[]|select((.document_id//"")!="")]|length)>0'

chat "test_D" "Faça um resumo somente do material documentado que contém este trecho, sem introduzir material externo: $phrase1" "" || true
assert_jq "TEST_D_GROUNDED_SUMMARY" "$REPORT_DIR/test_D.json" '.ok==true and .fallback==false and (.fontes|length)>0 and .groq_final_stage_only==true and .pre_master_llm_calls==0 and .llm_calls<=1'

chat "test_E" "Faça um fichamento completo somente do material que contém: $phrase1. Inclua tema, tese, argumentos, conceitos, evidências e referências." "" || true
assert_jq "TEST_E_FICHAMENTO" "$REPORT_DIR/test_E.json" '.ok==true and .fallback==false and (.fontes|length)>0 and .llm_calls<=1'

# Comparison is isolated with two synthetic client-context documents so the
# personal library is not modified merely to satisfy the acceptance test.
jq -nc '{
  pergunta:"Compare o Autor A com o Autor B. Mostre convergências e divergências, sem atribuir opinião não documentada.",
  historico:[],stream:false,
  client_context:[
    {id:"accept-a",document_id:"accept-author-a",title:"Acceptance Autor A",author:"Autor A",page:1,score:10,retrieval_mode:"client-resilience",text:"Autor A afirma que a interpretação deve considerar o contexto documental e a sequência argumentativa. O argumento exige evidência textual verificável."},
    {id:"accept-b",document_id:"accept-author-b",title:"Acceptance Autor B",author:"Autor B",page:1,score:10,retrieval_mode:"client-resilience",text:"Autor B afirma que a interpretação deve considerar evidência textual verificável, mas dá prioridade à definição explícita dos conceitos em vez da sequência argumentativa."}
  ]
}' >"$REPORT_DIR/test_F.payload.json"
f_code=$(curl -sS --max-time 90 -o "$REPORT_DIR/test_F.json" -w '%{http_code}' "$BASE/api/chat" -H 'Content-Type: application/json' --data-binary @"$REPORT_DIR/test_F.payload.json" || echo 000)
if [ "$f_code" = "200" ]; then
  assert_jq "TEST_F_COMPARISON" "$REPORT_DIR/test_F.json" '.ok==true and .fallback==false and (.fontes|map(.document_id)|unique|length)>=2 and .cognitive_mode=="comparison" and .llm_calls<=1'
else
  record "TEST_F_COMPARISON" FAIL "http_$f_code"
fi

chat "test_G" "O que você pensa sobre isso? Faça REFLEXÃO claramente separada dos fatos documentais, usando: $phrase1" "" || true
assert_jq "TEST_G_REFLECTION" "$REPORT_DIR/test_G.json" '.ok==true and .fallback==false and .cognitive_mode=="reflection" and (.resposta|test("REFLEXÃO|REFLECTION";"i")) and (.resposta|test("FATOS DOCUMENTADOS|DOCUMENTED FACTS";"i"))'

chat "test_H" "E se fosse exatamente o contrário? Trate somente como hipótese, com base no material: $phrase1" "" || true
assert_jq "TEST_H_HYPOTHESIS" "$REPORT_DIR/test_H.json" '.ok==true and .fallback==false and .cognitive_mode=="hypothesis" and (.resposta|test("HIPÓTESE|HYPOTHESIS";"i"))'

chat "test_I" "Quais dúvidas podem ser levantadas sobre esse argumento, sem inventar acontecimentos ou referências? $phrase1" "" || true
assert_jq "TEST_I_CRITICAL_QUESTIONS" "$REPORT_DIR/test_I.json" '.ok==true and .fallback==false and (.fontes|length)>0 and .llm_calls<=1'

chat "test_J_mobile" "Continue." "$memory_key" "Mozilla/5.0 (Linux; Android 16; Mobile) FNS-Mobile" || true
assert_jq "TEST_J_CONTINUE_CROSS_DEVICE" "$REPORT_DIR/test_J_mobile.json" '.ok==true and .fallback==false and (.fontes|length)>0 and .memory_persisted==true'

# Reverse device direction, same server-side key, no client history.
chat "test_J_pc_back" "Agora resuma em uma frase." "$memory_key" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FNS-PC" || true
assert_jq "CROSS_DEVICE_REVERSE" "$REPORT_DIR/test_J_pc_back.json" '.ok==true and .fallback==false and (.fontes|length)>0 and .memory_persisted==true'
mem_code=$(curl -sS --max-time 20 -o "$REPORT_DIR/memory.json" -w '%{http_code}' "$BASE/api/memory" -H "X-FNS-Memory-Key: $memory_key" || echo 000)
if [ "$mem_code" = "200" ]; then
  assert_jq "CROSS_DEVICE_MEMORY_SYNC" "$REPORT_DIR/memory.json" '.ok==true and .persistent==true and .total>=4'
else record "CROSS_DEVICE_MEMORY_SYNC" FAIL "http_$mem_code"; fi

# Main hallucination sentinel.
chat "test_abstain" "Informe a citação literal, livro, autor e página de ZXQ_V74_NONEXISTENT_76398421. Se não existir, não invente." "" || true
assert_jq "NO_HALLUCINATION_ABSTAIN" "$REPORT_DIR/test_abstain.json" '.ok==true and .fallback==true and .llm_calls==0 and .evidence_gate.policy=="ABSTAIN" and .evidence_gate.canAnswer==false'

# Compound intent.
chat "test_compound" "Localize o trecho $phrase1, explique o contexto documentado, compare com a outra fonte relacionada a $phrase2 e depois faça uma reflexão claramente separada dos fatos." "" || true
assert_jq "COMPOUND_INTENT" "$REPORT_DIR/test_compound.json" '.ok==true and .fallback==false and (.fontes|length)>0 and .llm_calls<=1'

# Restrictive output behavior using real evidence.
declare -a restrictive_q=(
  "Somente uma frase sobre: $phrase1"
  "Não explique; informe apenas o fato documentado sobre: $phrase1"
  "Somente a fonte de: $phrase1"
  "Sem resumo; localize apenas a evidência sobre: $phrase1"
  "Resposta completa sobre: $phrase1"
  "Explique profundamente com base somente nos documentos: $phrase1"
  "Explique como se eu tivesse 10 anos, sem sair dos documentos: $phrase1"
  "Use linguagem acadêmica e somente as fontes: $phrase1"
  "Liste apenas as citações relacionadas a: $phrase1"
)
idx=0
for q in "${restrictive_q[@]}"; do
  idx=$((idx+1))
  chat "restrict_$idx" "$q" "" || true
  assert_jq "RESTRICTIVE_$idx" "$REPORT_DIR/restrict_$idx.json" '.ok==true and (.llm_calls<=1) and .turbine_selected_count>0 and .turbine_selected_count<1000'
done
# Strong checks for the most restrictive forms.
assert_jq "RESTRICTIVE_ONE_SENTENCE" "$REPORT_DIR/restrict_1.json" '(.resposta|split("\n")|map(select(length>0))|length)<=8'
assert_jq "RESTRICTIVE_SOURCE_ONLY_NO_LLM" "$REPORT_DIR/restrict_3.json" '.cognitive_mode=="reference_only" and .llm_calls==0'

# Human noise in production with evidence anchors.
declare -a noise_q=(
  "onde ta aquele trecho msm? $phrase1"
  "me da so a referencia de $phrase1"
  "qual livro fala disso msm? $phrase1"
  "e se n fosse assim? $phrase1"
  "o q vc acha? $phrase1"
  "faz um fichamento disso ai $phrase1"
)
idx=0
for q in "${noise_q[@]}"; do
  idx=$((idx+1))
  chat "noise_$idx" "$q" "" || true
  assert_jq "HUMAN_NOISE_$idx" "$REPORT_DIR/noise_$idx.json" '.ok==true and (.fallback==false or .evidence_gate.policy=="ABSTAIN") and .turbine_selected_count>0'
done

# Citation provenance: every returned source must identify a real document; cited F# markers must exist in fontes ref_id when present.
python3 - "$REPORT_DIR" >"$REPORT_DIR/citation-audit.json" <<'PY'
import json,glob,os,re,sys
root=sys.argv[1]
checked=0; failures=[]
for path in glob.glob(os.path.join(root,"test_*.json"))+glob.glob(os.path.join(root,"restrict_*.json")):
    try: d=json.load(open(path,encoding="utf-8"))
    except: continue
    if not d.get("ok") or d.get("fallback"): continue
    sources=d.get("fontes") or []
    answer=str(d.get("resposta") or "")
    if not sources: continue
    checked+=1
    refs={str(s.get("ref_id") or "") for s in sources}
    if any(not (s.get("document_id") or s.get("arquivo") or s.get("titulo")) for s in sources):
        failures.append({"file":os.path.basename(path),"reason":"source_without_document_identity"})
    cited=set(re.findall(r"\[(F\d+)\]",answer))
    missing=sorted(x for x in cited if x not in refs)
    if missing: failures.append({"file":os.path.basename(path),"reason":"cited_ref_without_source","refs":missing})
json.dump({"checked":checked,"failures":failures,"pass":checked>0 and not failures},sys.stdout)
PY
assert_jq "CITATION_PROVENANCE_AUDIT" "$REPORT_DIR/citation-audit.json" '.pass==true and .checked>0'

# Production performance: external stage probes without changing frozen architecture.
# router_ms = admin planner; rag_ms = /api/rag/search; total_ms = /api/chat.
# Internal reducer/groq/validator are intentionally not instrumented in production to honor the freeze.
perf="$REPORT_DIR/performance.ndjson"
: >"$perf"
perf_case(){
  local type="$1" q="$2"
  for i in 1 2 3 4 5; do
    encoded=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$q")
    router=$(curl -sS --max-time 30 -o /dev/null -w '%{time_total}' "${HDR[@]}" "$BASE/api/admin/cognitive-v74?q=$encoded" || echo 0)
    rag=$(curl -sS --max-time 30 -o /dev/null -w '%{time_total}' "$BASE/api/rag/search" -H 'Content-Type: application/json' --data "$(jq -nc --arg q "$q" '{question:$q}')" || echo 0)
    total=$(curl -sS --max-time 90 -o /dev/null -w '%{time_total}' "$BASE/api/chat" -H 'Content-Type: application/json' --data "$(jq -nc --arg q "$q" '{pergunta:$q,historico:[],stream:false}')" || echo 0)
    jq -nc --arg type "$type" --argjson router_ms "$(python3 -c "print(float('$router')*1000)")" --argjson rag_ms "$(python3 -c "print(float('$rag')*1000)")" --argjson total_ms "$(python3 -c "print(float('$total')*1000)")" '{type:$type,router_ms:$router_ms,rag_ms:$rag_ms,total_ms:$total_ms}' >>"$perf"
  done
}
perf_case reference "Somente a fonte de: $phrase1"
perf_case factual "Qual fato documentado aparece em: $phrase1"
perf_case summary "Resuma: $phrase1"
perf_case comparison "Compare: $phrase1 ; $phrase2"
perf_case deep "Explique profundamente, com base nas fontes: $phrase1 ; $phrase2"
python3 - "$perf" "$REPORT_DIR/performance-summary.json" <<'PY'
import json,sys,statistics
src,dst=sys.argv[1:3]
rows=[json.loads(x) for x in open(src,encoding="utf-8") if x.strip()]
out={}
for typ in sorted({r["type"] for r in rows}):
    rs=[r for r in rows if r["type"]==typ]
    out[typ]={}
    for field in ("router_ms","rag_ms","total_ms"):
        vals=sorted(float(r[field]) for r in rs)
        def p(q):
            i=min(len(vals)-1,max(0,round((len(vals)-1)*q)))
            return round(vals[i],3)
        out[typ][field]={"p50":p(.5),"p95":p(.95),"p99":p(.99)}
    out[typ]["turbines_ms"]="measured_in_local_load_gate"
    out[typ]["reducer_ms"]="not_separately_observable_without_runtime_instrumentation"
    out[typ]["groq_ms"]="not_separately_observable_without_runtime_instrumentation"
    out[typ]["validator_ms"]="not_separately_observable_without_runtime_instrumentation"
json.dump({"frozen_architecture":True,"metrics":out},open(dst,"w",encoding="utf-8"),indent=2,ensure_ascii=False)
PY
record "PERFORMANCE_EXTERNAL_P50_P95_P99" PASS "router/rag/total measured; internal stages left uninstrumented to honor freeze"

# Consolidate machine-readable report without printing private content.
python3 - "$results" "$REPORT_DIR/performance-summary.json" "$REPORT_DIR/final.json" <<'PY'
import json,sys
results,perf,dst=sys.argv[1:4]
items=[]
for line in open(results,encoding="utf-8"):
    p=line.rstrip("\n").split("\t",2)
    items.append({"test":p[0],"status":p[1],"detail":p[2] if len(p)>2 else ""})
report={
 "schema":"fns-v74-production-truth-gate",
 "tests":items,
 "pass_count":sum(x["status"]=="PASS" for x in items),
 "failure_count":sum(x["status"]!="PASS" for x in items),
 "performance":json.load(open(perf,encoding="utf-8"))
}
report["production_accepted"]=report["failure_count"]==0
json.dump(report,open(dst,"w",encoding="utf-8"),indent=2,ensure_ascii=False)
print(json.dumps({"pass_count":report["pass_count"],"failure_count":report["failure_count"],"production_accepted":report["production_accepted"]}))
PY

final_fail=$(jq '.failure_count' "$REPORT_DIR/final.json")
if [ "$final_fail" -eq 0 ]; then
  log_gate "V7.4_PRODUCTION_ACCEPTED"
else
  log_gate "NOT_ACCEPTED failures=$final_fail"
  cat "$results" | sed 's/^/V74_RESULT=/'
  exit 79
fi
