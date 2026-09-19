#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "AUTONOMOUS_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${GROQ_API_KEY:?GROQ_API_KEY is required}"

GROQ_API_KEY_CLEAN=$(printf '%s' "$GROQ_API_KEY" | tr -d '\r\n' | sed -e 's/^[[:space:]"]*//' -e 's/[[:space:]"]*$//')

BASE='https://consciencia-fabiano.karlapower007.workers.dev'

log "== Consciência do Fabiano :: V4.0 OMNI LIBRARY SYMMETRY release =="
log "1/7 Validate source"
npm run check
node --check scripts/browser-voice-smoke.mjs
node --check scripts/browser-ingest-smoke.mjs
! grep -q 'AI.toMarkdown' src/index.js
! grep -q 'request.formData' src/index.js
! grep -q 'readPdfBuffer' src/index.js
grep -q 'CHUNK_CONCURRENCY = 50' src/index.js
grep -q 'EMBED_CONCURRENCY = 50' src/index.js
grep -q 'pdfjs-dist@4.10.38' public/app.js
grep -q 'api.groq.com/openai/v1/chat/completions' src/index.js
! grep -q 'generativelanguage.googleapis.com' src/index.js
grep -q 'text/event-stream' src/index.js
! grep -q 'env.AI' src/index.js
! grep -q '@cf/' src/index.js

log "2/7 Validate Worker authorization"
npx wrangler whoami >/tmp/whoami.txt 2>&1 || { cat /tmp/whoami.txt; die "WHOAMI_FAILED"; }
grep -E 'Account Name|Account ID|associated with the email' /tmp/whoami.txt || true

log "2.5/7 Lightweight external AI key preflight"
curl -fsS "https://api.groq.com/openai/v1/chat/completions"   -H "Authorization: Bearer $GROQ_API_KEY_CLEAN"   -H 'Content-Type: application/json'   --data '{"model":"openai/gpt-oss-20b","messages":[{"role":"user","content":"Responda apenas OK"}],"max_completion_tokens":8,"temperature":0}'   >/tmp/groq-preflight.json || { cat /tmp/groq-preflight.json 2>/dev/null || true; die "GROQ_KEY_INVALID"; }
jq -e '.choices[0].message.content | type == "string"' /tmp/groq-preflight.json >/dev/null || { cat /tmp/groq-preflight.json; die "GROQ_PREFLIGHT_BAD_RESPONSE"; }
log "GROQ_PREFLIGHT_PASS=yes"

log "2.75/7 Build failover manifest and compressed static vault"
node scripts/build-failover-manifest.mjs
node scripts/build-static-vault.mjs
test -f public/failover-manifest.json || die "FAILOVER_MANIFEST_MISSING"
test -f public/steel/index.json || die "STEEL_INDEX_MISSING"
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("public/failover-manifest.json","utf8"));if(m.version!=="4.0.0")process.exit(1)'
node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync("public/steel/index.json","utf8"));if(s.version!=="4.0.0")process.exit(1)'
log "RESILIENCE_ASSETS_BUILT=yes"

log "3/7 Deploy Worker"
npx wrangler deploy | tee /tmp/deploy.log
log "DEPLOY_COMMAND=success"

log "4/7 Install runtime secrets"
printf '%s' "$GROQ_API_KEY_CLEAN" | npx wrangler secret put GROQ_API_KEY >/dev/null
log "GROQ_SECRET_INSTALLED=yes"

put_optional_secret(){
  local name="$1"
  local value="${!name:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null
    log "${name}_INSTALLED=yes"
  else
    log "${name}_INSTALLED=no"
  fi
}

put_optional_secret SUPABASE_URL
put_optional_secret SUPABASE_SERVICE_ROLE_KEY
put_optional_secret SUPABASE_RAG_SEARCH_URL
put_optional_secret PINECONE_API_KEY
put_optional_secret PINECONE_UPSERT_URL
put_optional_secret PINECONE_QUERY_URL

AUTOMATION_SECRET=$(openssl rand -hex 32)
printf '%s' "$AUTOMATION_SECRET" | npx wrangler secret put AUTOMATION_SECRET >/tmp/automation-secret.log 2>&1 || { cat /tmp/automation-secret.log; die "AUTOMATION_SECRET_FAILED"; }
log "AUTOMATION_SECRET_INSTALLED=yes"

EXPECT_R2=0
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  log "R2 credentials found: provisioning direct browser vault"
  set +e
  npx wrangler r2 bucket create consciencia-fabiano-pdfs >/tmp/r2-bucket.log 2>&1
  rc=$?
  set -e
  if [ "$rc" -ne 0 ] && ! grep -Eqi 'already exists|already been taken' /tmp/r2-bucket.log; then
    cat /tmp/r2-bucket.log
    die "R2_BUCKET_FAILED"
  fi

  printf '%s' "$CLOUDFLARE_ACCOUNT_ID" | npx wrangler secret put R2_ACCOUNT_ID >/dev/null
  printf '%s' "$R2_ACCESS_KEY_ID" | npx wrangler secret put R2_ACCESS_KEY_ID >/dev/null
  printf '%s' "$R2_SECRET_ACCESS_KEY" | npx wrangler secret put R2_SECRET_ACCESS_KEY >/dev/null

  curl -fsS -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/consciencia-fabiano-pdfs/cors" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' \
    --data '{"rules":[{"allowed":{"origins":["https://consciencia-fabiano.karlapower007.workers.dev"],"methods":["PUT"],"headers":["Content-Type"]},"exposeHeaders":["ETag"],"maxAgeSeconds":3600}]}' >/tmp/r2-cors.json
  jq -e '.success == true' /tmp/r2-cors.json >/dev/null
  EXPECT_R2=1
  log "R2_DIRECT_VAULT=enabled"
else
  log "R2_DIRECT_VAULT=not-configured"
fi

HDR=(-H "X-FNS-Automation: $AUTOMATION_SECRET")
log "Waiting for secret propagation"
stable=0
for i in $(seq 1 30); do
  code=$(curl -sS -o /tmp/admin-probe.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/ping" || true)
  if [ "$code" = "200" ]; then
    stable=$((stable+1))
    if [ "$stable" -ge 3 ]; then
      log "AUTOMATION_SECRET_ACTIVE=yes"
      break
    fi
  else
    stable=0
  fi
  [ "$i" = 30 ] && { cat /tmp/admin-probe.json || true; die "AUTOMATION_SECRET_NOT_ACTIVE"; }
  sleep 2
done
sleep 3

log "5/7 Production health"
for i in $(seq 1 15); do
  body=$(curl -fsS "$BASE/health/deploy" 2>/dev/null || true)
  if echo "$body" | jq -e '.ok == true
    and .version == "4.0.0-omni-library-symmetry"
    and .architecture == "cloudflare-v4-omni-library-symmetry"
    and .storage_backend == "durable-object-sqlite"
    and .workers_ai_used == false
    and .llm_provider == "groq"
    and .provider_auth_surface == "server-side-secrets-only"
    and .client_provider_keys_exposed == false
    and .server_pdf_parsing == false
    and .exact_match_llm_bypass == true
    and .exact_swarm_logical_nodes == 1000
    and .strict_lazy_local_engines == true
    and .universal_strict_match_core == "strict-match-core-v4"
    and .online_offline_search_symmetry == true
    and .same_paragraph_phrase_required == true
    and .fuzzy_matching_disabled == true
    and .or_matching_disabled == true
    and .omni_library_sync == true
    and .omni_sync_batch_size == 200
    and .omni_sync_worker == true
    and .omni_sync_memory_flush == true
    and .omni_search_all_documents == true
    and .omni_logical_task_capacity == 1000
    and .omni_physical_worker_cap == 16
    and .omni_virtual_scroller == true
    and .omni_card_gap_px == 40
    and .plan_c_worker_count_source == "navigator.hardwareConcurrency"
    and .plan_c_main_thread_extraction == false
    and .plan_c_offline_intelligence == "strict-same-paragraph-phrase-v4"
    and .plan_c_virtualized_result_cards == true
    and .plan_c_card_gap_px == 40
    and .chunk_concurrency_limit == 50
    and .embedding_concurrency_limit == 50' >/dev/null 2>&1; then
    echo "$body" | tee /tmp/health.json
    log "DEPLOY_HEALTH_PASS=yes"
    break
  fi
  [ "$i" = 15 ] && { echo "$body"; die "DEPLOY_HEALTH_FAILED"; }
  sleep 3
done
if [ "$EXPECT_R2" = "1" ]; then jq -e '.r2_direct_ready == true' /tmp/health.json >/dev/null; fi

log "5.5/7 V4 Omni Library asset probes"
curl -fsS "$BASE/failover-manifest.json" | tee /tmp/failover-manifest.json >/dev/null
jq -e '.version == "4.0.0"
  and .strategy == "A->B->C->D->E->F"
  and .plan_c.engine == "omni-library-strict-v4"
  and .plan_c.logical_task_capacity == 1000
  and .plan_c.physical_worker_cap == 16
  and .plan_c.strict_match_core == "strict-match-core-v4"
  and .plan_c.same_paragraph_phrase_required == true
  and .plan_c.fuzzy_matching_disabled == true
  and .plan_c.or_matching_disabled == true
  and .plan_c.omni_sync_batch_size == 200
  and .plan_c.omni_sync_memory_flush == true
  and .plan_c.omni_search_all_documents == true
  and .plan_c.virtualized_cards == true
  and .plan_c.card_gap_px == 40' /tmp/failover-manifest.json >/dev/null || die "FAILOVER_MANIFEST_BAD"
curl -fsS "$BASE/steel/index.json" | tee /tmp/steel-index.json >/dev/null
jq -e '.version == "4.0.0" and (.shards|type) == "array"' /tmp/steel-index.json >/dev/null || die "STEEL_INDEX_BAD"
curl -fsS "$BASE/sw-v3.js" >/tmp/sw-v3.js || die "SERVICE_WORKER_MISSING"
curl -fsS "$BASE/strict-match-core.js" >/tmp/strict-match-core.js || die "STRICT_MATCH_CORE_MISSING"
curl -fsS "$BASE/omni-sync-worker.js" >/tmp/omni-sync-worker.js || die "OMNI_SYNC_WORKER_MISSING"
curl -fsS "$BASE/local-turbine-pool.js" >/tmp/local-turbine-pool.js || die "LOCAL_TURBINE_POOL_MISSING"
curl -fsS "$BASE/local-turbine-worker.js" >/tmp/local-turbine-worker.js || die "LOCAL_TURBINE_WORKER_MISSING"

grep -q 'strictParagraphMatch' /tmp/strict-match-core.js || die "STRICT_MATCH_FUNCTION_MISSING"
grep -q 'deriveStrictPhrase' /tmp/strict-match-core.js || die "STRICT_PHRASE_FUNCTION_MISSING"
grep -q 'paragraphBlocks' /tmp/strict-match-core.js || die "STRICT_PARAGRAPH_FUNCTION_MISSING"
grep -q 'STRICT_LOGICAL_TASK_CAP=1000' /tmp/strict-match-core.js || die "STRICT_TASK_CAP_BAD"

grep -q 'BATCH_SIZE=200' /tmp/omni-sync-worker.js || die "OMNI_BATCH_SIZE_BAD"
grep -q 'rows.length=0' /tmp/omni-sync-worker.js || die "OMNI_ROWS_FLUSH_MISSING"
grep -q 'rows=null' /tmp/omni-sync-worker.js || die "OMNI_ROWS_RELEASE_MISSING"
grep -q 'payload=null' /tmp/omni-sync-worker.js || die "OMNI_PAYLOAD_RELEASE_MISSING"

grep -q 'navigator.hardwareConcurrency' /tmp/local-turbine-pool.js || die "LOCAL_CPU_GOVERNOR_MISSING"
grep -q 'LOGICAL_NODE_CAPACITY=1000' /tmp/local-turbine-pool.js || die "LOCAL_LOGICAL_CAPACITY_BAD"
grep -q 'MAX_PHYSICAL_WORKERS=16' /tmp/local-turbine-pool.js || die "LOCAL_PHYSICAL_CAP_BAD"
grep -q 'strictParagraphMatch' /tmp/local-turbine-worker.js || die "LOCAL_STRICT_MATCH_MISSING"
grep -q 'STRICT_PHRASE_MISS' /tmp/local-turbine-worker.js || die "LOCAL_STRICT_REJECTION_MISSING"

grep -q '/search-strict' src/index.js || die "CLOUD_STRICT_ROUTE_MISSING"
grep -q 'retrieveSupabaseStrictContext' src/index.js || die "SUPABASE_STRICT_RETRIEVAL_MISSING"
grep -q 'retrieveContextV4Strict' src/index.js || die "V4_STRICT_RETRIEVAL_MISSING"
grep -q '/api/admin/omni-sync-page' src/index.js || die "OMNI_SYNC_API_MISSING"
grep -q 'strictParagraphMatch' src/index.js || die "SERVER_SHARED_MATCH_CORE_MISSING"

grep -q 'omniSyncBtn' public/app.js || die "OMNI_SYNC_BUTTON_WIRING_MISSING"
grep -q 'new Worker("/omni-sync-worker.js?v=4.0.0")' public/app.js || die "OMNI_SYNC_CLIENT_WORKER_MISSING"
grep -q 'maybeAutoOmniSync' public/app.js || die "OMNI_AUTO_SYNC_MISSING"
grep -q 'Nenhuma correspondência exata encontrada na biblioteca total.' public/app.js || die "V4_ELEGANT_SILENCE_MISSING"
grep -q 'offline-turbine-source-subtitle' public/app.js || die "SEMANTIC_SUBTITLE_MISSING"
grep -q 'white-space:pre-wrap' public/style.css || die "OFFLINE_PRE_WRAP_MISSING"
grep -q 'margin-bottom:2.5rem' public/style.css || die "OFFLINE_CARD_GAP_BAD"
grep -q 'offline-turbine-viewport' public/style.css || die "VIRTUAL_SCROLLER_STYLE_MISSING"

grep -q 'FNS_DESKTOP_FALLBACK' scripts/local-fallback-server.mjs || die "DESKTOP_FALLBACK_SOURCE_MISSING"
log "V4_OMNI_LIBRARY_ASSETS_PASS=yes"

log "6/7 Broad-term RAG regression probe"
curl -fsS --max-time 15 "$BASE/api/status" | tee /tmp/runtime-status.json || true
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  SUPABASE_BASE=$(printf '%s' "$SUPABASE_URL" | sed 's:/*$::')
  supa_rows=$(curl -fsS --max-time 15 \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_BASE/rest/v1/rag_embeddings?select=id&limit=1" | jq 'length' || echo 0)
  supa_jesus=$(curl -fsS --max-time 15 \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_BASE/rest/v1/rag_embeddings?select=id&text=ilike.*Jesus*&limit=1" | jq 'length' || echo 0)
  log "SUPABASE_RAG_ANY_ROW=$supa_rows"
  log "SUPABASE_RAG_JESUS_ROW=$supa_jesus"
fi
rag_http=$(curl -sS --max-time 25 -o /tmp/rag-broad-probe.json -w '%{http_code}' "$BASE/api/rag/search" \
  -H 'Content-Type: application/json' \
  --data '{"question":"Jesus"}' || echo 000)

rag_count=$(jq -r 'if (.matches|type)=="array" then (.matches|length) else 0 end' /tmp/rag-broad-probe.json 2>/dev/null || echo 0)
runtime_ok=$(jq -r '.ok // false' /tmp/runtime-status.json 2>/dev/null || echo false)
supa_rows=${supa_rows:-0}

if [ "$rag_http" != "200" ] && { [ "$runtime_ok" = "true" ] || [ "$supa_rows" -gt 0 ]; }; then
  cat /tmp/rag-broad-probe.json 2>/dev/null || true
  die "RAG_BROAD_PROBE_HTTP_$rag_http"
fi

if [ "$rag_count" -gt 0 ]; then
  jq -e '[.matches[] | select((.text // "") | test("Jesus"; "i"))] | length > 0' /tmp/rag-broad-probe.json >/dev/null || {
    cat /tmp/rag-broad-probe.json
    die "RAG_BROAD_TERM_MISSING_ANCHOR"
  }
  log "RAG_BROAD_TERM_PROBE_PASS=yes"
elif [ "$runtime_ok" = "true" ] || [ "$supa_rows" -gt 0 ]; then
  cat /tmp/rag-broad-probe.json
  die "RAG_BROAD_TERM_FALSE_NEGATIVE"
else
  log "RAG_BROAD_TERM_PROBE_DEFERRED=cloud-index-unreadable-and-mirror-empty"
  log "RAG_BROWSER_LOCAL_RECOVERY_REQUIRED=yes"
fi

log "7/7 Release complete"
log "DEPLOY_ONLY_PROTOCOL=success"
log "AUTONOMOUS_RELEASE=success"
