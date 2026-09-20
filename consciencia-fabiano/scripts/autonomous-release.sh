#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "AUTONOMOUS_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${GROQ_API_KEY:?GROQ_API_KEY is required}"

GROQ_API_KEY_CLEAN=$(printf '%s' "$GROQ_API_KEY" | tr -d '\r\n' | sed -e 's/^[[:space:]"]*//' -e 's/[[:space:]"]*$//')

BASE="${EXPECTED_WORKERS_BASE:-https://consciencia-fabiano.focoeepoder2.workers.dev}"

log "== Consciência do Fabiano :: V7.2 GROUNDED HYBRID RAG release =="
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
EXPECTED_CF_EMAIL="${FABIANO_CLOUDFLARE_EMAIL:-focoeepoder2@gmail.com}"
grep -Fq "associated with the email $EXPECTED_CF_EMAIL" /tmp/whoami.txt || {
  cat /tmp/whoami.txt
  die "WRONG_CLOUDFLARE_ACCOUNT_EXPECTED_FABIANO"
}
log "FABIANO_CLOUDFLARE_IDENTITY_PASS=yes"

log "2.1/7 Discover authoritative Fabiano account ID from the authenticated token"
curl -fsS "https://api.cloudflare.com/client/v4/accounts?per_page=50" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" >/tmp/fabiano-accounts.json || die "FABIANO_ACCOUNT_DISCOVERY_FAILED"
jq -e '.success == true and (.result|type)=="array" and (.result|length)>=1' /tmp/fabiano-accounts.json >/dev/null || {
  cat /tmp/fabiano-accounts.json
  die "FABIANO_ACCOUNT_DISCOVERY_EMPTY"
}
DISCOVERED_ACCOUNT_ID=$(jq -r '.result[0].id // empty' /tmp/fabiano-accounts.json)
[ -n "$DISCOVERED_ACCOUNT_ID" ] || die "FABIANO_ACCOUNT_ID_EMPTY"
export CLOUDFLARE_ACCOUNT_ID="$DISCOVERED_ACCOUNT_ID"
log "FABIANO_ACCOUNT_ID_DISCOVERED=yes"

log "2.25/7 Ensure official R2 bucket exists before deploy"
set +e
npx wrangler r2 bucket create consciencia-fabiano-pdfs >/tmp/r2-bucket.log 2>&1
r2_rc=$?
set -e
if [ "$r2_rc" -ne 0 ] && ! grep -Eqi 'already exists|already been taken' /tmp/r2-bucket.log; then
  cat /tmp/r2-bucket.log
  die "FABIANO_R2_BUCKET_FAILED"
fi
log "FABIANO_R2_BUCKET_READY=yes"

log "2.5/7 Lightweight external AI key preflight"
curl -fsS "https://api.groq.com/openai/v1/chat/completions"   -H "Authorization: Bearer $GROQ_API_KEY_CLEAN"   -H 'Content-Type: application/json'   --data '{"model":"openai/gpt-oss-20b","messages":[{"role":"user","content":"Responda apenas OK"}],"max_completion_tokens":8,"temperature":0}'   >/tmp/groq-preflight.json || { cat /tmp/groq-preflight.json 2>/dev/null || true; die "GROQ_KEY_INVALID"; }
jq -e '.choices[0].message.content | type == "string"' /tmp/groq-preflight.json >/dev/null || { cat /tmp/groq-preflight.json; die "GROQ_PREFLIGHT_BAD_RESPONSE"; }
log "GROQ_PREFLIGHT_PASS=yes"

log "2.75/7 Build failover manifest and compressed static vault"
node scripts/build-failover-manifest.mjs
node scripts/build-static-vault.mjs
test -f public/failover-manifest.json || die "FAILOVER_MANIFEST_MISSING"
test -f public/steel/index.json || die "STEEL_INDEX_MISSING"
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("public/failover-manifest.json","utf8"));if(m.version!=="7.1.0")process.exit(1)'
node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync("public/steel/index.json","utf8"));if(s.version!=="7.1.0")process.exit(1)'
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

AUTOMATION_SECRET=$(openssl rand -hex 32)
printf '%s' "$AUTOMATION_SECRET" | npx wrangler secret put AUTOMATION_SECRET >/tmp/automation-secret.log 2>&1 || { cat /tmp/automation-secret.log; die "AUTOMATION_SECRET_FAILED"; }
log "AUTOMATION_SECRET_INSTALLED=yes"

EXPECT_R2=1
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  printf '%s' "$CLOUDFLARE_ACCOUNT_ID" | npx wrangler secret put R2_ACCOUNT_ID >/dev/null
  printf '%s' "$R2_ACCESS_KEY_ID" | npx wrangler secret put R2_ACCESS_KEY_ID >/dev/null
  printf '%s' "$R2_SECRET_ACCESS_KEY" | npx wrangler secret put R2_SECRET_ACCESS_KEY >/dev/null

  curl -fsS -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/consciencia-fabiano-pdfs/cors" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'Content-Type: application/json' \
    --data '{"rules":[{"allowed":{"origins":["https://consciencia-fabiano.focoeepoder2.workers.dev"],"methods":["PUT"],"headers":["Content-Type"]},"exposeHeaders":["ETag"],"maxAgeSeconds":3600}]}' >/tmp/r2-cors.json
  jq -e '.success == true' /tmp/r2-cors.json >/dev/null
  log "R2_DIRECT_ORIGINAL_PDF_UPLOAD=enabled"
else
  log "R2_DIRECT_ORIGINAL_PDF_UPLOAD=optional-credentials-not-installed"
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
    and .version == "7.2.0-grounded-hybrid-rag"
    and .architecture == "cloudflare-v7.1-fabiano-r2-cross-device"
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
    and .online_offline_search_symmetry == false
    and .hybrid_grounded_retrieval == true
    and .hybrid_context_limit == 120
    and .semantic_query_embedding_server_enabled == true
    and .semantic_multilingual_min_score == 0.62
    and .semantic_multilingual_strong_score == 0.72
    and .strict_exact_path_preserved == true
    and .same_paragraph_phrase_required_for_exact_mode == true
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
    and .agent_swarm_enabled == true
    and .agent_swarm_logical_nodes == 20
    and .agent_swarm_physical_worker_cap == 16
    and .agent1_literal_exact == true
    and .agent2_transformers_semantic == true
    and .agent10_bouncer == true
    and .agent11_short_entity_hunter == true
    and .agent12_long_form_explainer == true
    and .agent13_freshness_sentinel == true
    and .agent14_ocr_rescue == true
    and .agent15_definition_specialist == true
    and .agent16_chronology_mapper == true
    and .agent17_cross_library_balancer == true
    and .agent18_citation_specialist == true
    and .agent19_conflict_auditor == true
    and .agent20_mission_master == true
    and .semantic_fallback_after_literal_miss == true
    and .reference_queries_remain_exact == true
    and .phantom_daemon == true
    and .phantom_daemon_target_interval_ms == 180000
    and .phantom_daemon_service_worker == true
    and .phantom_daemon_periodic_sync_best_effort == true
    and .omni_sync_cloud_fingerprint == true
    and .omni_sync_generation_gc == true
    and .omni_sync_manual_button == false
    and .omni_sync_zero_touch_after_authorization == true
    and .cross_device_library_mirror == true
    and .cross_device_storage_backend == "cloudflare-r2"
    and .cross_device_r2_binding == "PDFS"
    and .cross_device_r2_bucket == "consciencia-fabiano-pdfs"
    and .cross_device_plaintext_chunk_sync == true
    and .cross_device_no_supabase_dependency == true
    and .cross_device_backfill_from_indexeddb == true
    and .cross_device_mobile_hydration == true
    and .cross_device_r2_generation_pointer == true
    and .cross_device_batch_size == 200
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
jq -e '.r2_direct_ready == true and .cross_device_storage == "r2-native-binding"' /tmp/health.json >/dev/null || die "R2_NATIVE_BINDING_NOT_READY"

log "5.5/7 V4 Omni Library asset probes"
curl -fsS "$BASE/failover-manifest.json" | tee /tmp/failover-manifest.json >/dev/null
jq -e '.version == "7.1.0"
  and .strategy == "A->B->C->D->E->F"
  and .plan_c.engine == "fabiano-r2-cross-device-v7.1"
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
  and .plan_c.card_gap_px == 40
  and .plan_c.logical_agent_count == 20
  and .plan_c.agent_physical_worker_cap == 16
  and .plan_c.agent2_transformers_semantic == true
  and .plan_c.agent10_bouncer == true
  and .plan_c.phantom_daemon == true
  and .plan_c.phantom_daemon_target_interval_ms == 180000
  and .plan_c.omni_sync_cloud_fingerprint == true
  and .plan_c.omni_sync_generation_gc == true
  and .plan_c.manual_sync_button == false
  and .plan_c.agent11_short_entity_hunter == true
  and .plan_c.agent12_long_form_explainer == true
  and .plan_c.agent13_freshness_sentinel == true
  and .plan_c.agent14_ocr_rescue == true
  and .plan_c.agent15_definition_specialist == true
  and .plan_c.agent16_chronology_mapper == true
  and .plan_c.agent17_cross_library_balancer == true
  and .plan_c.agent18_citation_specialist == true
  and .plan_c.agent19_conflict_auditor == true
  and .plan_c.agent20_mission_master == true
  and .plan_c.cross_device_library_mirror == true
  and .plan_c.cross_device_storage_backend == "cloudflare-r2"
  and .plan_c.cross_device_r2_bucket == "consciencia-fabiano-pdfs"
  and .plan_c.cross_device_mobile_hydration == true
  and .plan_c.cross_device_no_supabase_dependency == true
  and .plan_c.cross_device_batch_size == 200' /tmp/failover-manifest.json >/dev/null || die "FAILOVER_MANIFEST_BAD"
curl -fsS "$BASE/steel/index.json" | tee /tmp/steel-index.json >/dev/null
jq -e '.version == "7.1.0" and (.shards|type) == "array"' /tmp/steel-index.json >/dev/null || die "STEEL_INDEX_BAD"
curl -fsS "$BASE/sw-v3.js" >/tmp/sw-v3.js || die "SERVICE_WORKER_MISSING"
curl -fsS "$BASE/agent-swarm.js" >/tmp/agent-swarm.js || die "AGENT_SWARM_ASSET_MISSING"
curl -fsS "$BASE/agent-node-worker.js" >/tmp/agent-node-worker.js || die "AGENT_NODE_ASSET_MISSING"
grep -q 'DAEMON_INTERVAL_MS=3\*60\*1000' /tmp/sw-v3.js || die "PHANTOM_DAEMON_INTERVAL_BAD"
grep -q 'periodicsync' /tmp/sw-v3.js || die "PHANTOM_PERIODIC_SYNC_MISSING"
grep -q '/api/admin/omni-sync-state' /tmp/sw-v3.js || die "PHANTOM_CLOUD_FINGERPRINT_MISSING"
grep -q 'sync_generation' /tmp/sw-v3.js || die "PHANTOM_GENERATION_GC_MISSING"
grep -q 'rows.length=0' /tmp/sw-v3.js || die "PHANTOM_ROWS_FLUSH_MISSING"
grep -q 'rows=null' /tmp/sw-v3.js || die "PHANTOM_ROWS_RELEASE_MISSING"
grep -q 'payload=null' /tmp/sw-v3.js || die "PHANTOM_PAYLOAD_RELEASE_MISSING"
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
grep -q 'retrieveContextV4Strict' src/index.js || die "V4_STRICT_RETRIEVAL_MISSING"
grep -q '/api/admin/omni-sync-page' src/index.js || die "OMNI_SYNC_API_MISSING"
grep -q '/api/admin/omni-sync-state' src/index.js || die "OMNI_SYNC_STATE_API_MISSING"
grep -q 'r2OmniSyncState' src/index.js || die "R2_OMNI_SYNC_STATE_MISSING"
grep -q 'r2OmniSyncPage' src/index.js || die "R2_OMNI_SYNC_PAGE_MISSING"
grep -q 'r2LibraryShardUpsert' src/index.js || die "R2_LIBRARY_SHARD_UPSERT_MISSING"
grep -q 'r2LibraryFinalize' src/index.js || die "R2_LIBRARY_FINALIZE_MISSING"
grep -q 'strictParagraphMatch' src/index.js || die "SERVER_SHARED_MATCH_CORE_MISSING"

grep -q 'configurePhantomDaemon' public/app.js || die "PHANTOM_DAEMON_CLIENT_CONFIG_MISSING"
grep -q 'PHANTOM_DAEMON_INTERVAL_MS=3\*60\*1000' public/app.js || die "PHANTOM_DAEMON_HEARTBEAT_BAD"
grep -q 'omni-daemon-tick' public/app.js || die "PHANTOM_DAEMON_TICK_MISSING"
if grep -q 'id="omniSyncBtn"' public/index.html; then die "MANUAL_SYNC_BUTTON_STILL_PRESENT"; fi
grep -q 'Nenhuma correspondência exata encontrada na biblioteca total.' public/app.js || die "V7_ELEGANT_SILENCE_MISSING"
grep -q 'omniAgentSearch' public/rag-cascade.js || die "V7_AGENT_SEARCH_MISSING"
grep -q 'runAgentSwarm' public/agent-swarm.js || die "V7_AGENT_SWARM_MISSING"
grep -q 'LOGICAL_AGENT_COUNT=20' public/agent-swarm.js || die "V7_AGENT_COUNT_BAD"
grep -q 'navigator.hardwareConcurrency' public/agent-swarm.js || die "V7_AGENT_CPU_GOVERNOR_MISSING"
grep -q 'agent_2_engine:"Transformers.js MiniLM q8 via embedding-worker"' public/agent-swarm.js || die "V7_TRANSFORMERS_AGENT_MISSING"
grep -q 'The Bouncer' public/agent-node-worker.js || die "V7_BOUNCER_MISSING"
grep -q 'Short Entity Hunter' public/agent-node-worker.js || die "V7_AGENT11_MISSING"
grep -q 'Long Form Explainer' public/agent-node-worker.js || die "V7_AGENT12_MISSING"
grep -q 'Freshness Sentinel' public/agent-node-worker.js || die "V7_AGENT13_MISSING"
grep -q 'OCR Rescue' public/agent-node-worker.js || die "V7_AGENT14_MISSING"
grep -q 'Definition Specialist' public/agent-node-worker.js || die "V7_AGENT15_MISSING"
grep -q 'Chronology Mapper' public/agent-node-worker.js || die "V7_AGENT16_MISSING"
grep -q 'Cross Library Balancer' public/agent-node-worker.js || die "V7_AGENT17_MISSING"
grep -q 'Citation Specialist' public/agent-node-worker.js || die "V7_AGENT18_MISSING"
grep -q 'Conflict and Duplicate Auditor' public/agent-node-worker.js || die "V7_AGENT19_MISSING"
grep -q 'Mission Master' public/agent-node-worker.js || die "V7_AGENT20_MISSING"
grep -q 'backfillLibraryChunksToCloud' public/app.js || die "CROSS_DEVICE_BACKFILL_MISSING"
grep -q '/api/admin/r2-library-shard' public/app.js || die "R2_CROSS_DEVICE_UPLOAD_ROUTE_MISSING"
grep -q '/api/admin/r2-library-finalize' public/app.js || die "R2_CROSS_DEVICE_FINALIZE_ROUTE_MISSING"
grep -q '/api/admin/r2-library-shard' src/index.js || die "R2_CROSS_DEVICE_SERVER_ROUTE_MISSING"
grep -q 'consciencia-fabiano-pdfs' src/index.js || die "R2_CROSS_DEVICE_BUCKET_MISSING"
grep -q 'env.PDFS' src/index.js || die "R2_NATIVE_BINDING_MISSING"
grep -q 'The Sweeper' public/agent-node-worker.js || die "V7_SWEEPERS_MISSING"
grep -q 'offline-turbine-source-subtitle' public/app.js || die "SEMANTIC_SUBTITLE_MISSING"
grep -q 'white-space:pre-wrap' public/style.css || die "OFFLINE_PRE_WRAP_MISSING"
grep -q 'margin-bottom:2.5rem' public/style.css || die "OFFLINE_CARD_GAP_BAD"
grep -q 'offline-turbine-viewport' public/style.css || die "VIRTUAL_SCROLLER_STYLE_MISSING"

grep -q 'FNS_DESKTOP_FALLBACK' scripts/local-fallback-server.mjs || die "DESKTOP_FALLBACK_SOURCE_MISSING"
log "V4_OMNI_LIBRARY_ASSETS_PASS=yes"

log "6/7 R2 cross-device regression probe"
curl -fsS --max-time 15 "$BASE/api/status" | tee /tmp/runtime-status.json || true
r2_http=$(curl -sS --max-time 20 -o /tmp/r2-sync-state.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/omni-sync-state" || echo 000)
[ "$r2_http" = "200" ] || { cat /tmp/r2-sync-state.json 2>/dev/null || true; die "R2_SYNC_STATE_HTTP_$r2_http"; }
jq -e '.ok == true and .backend == "cloudflare-r2" and .bucket == "consciencia-fabiano-pdfs" and .batch_size == 200' /tmp/r2-sync-state.json >/dev/null || {
  cat /tmp/r2-sync-state.json
  die "R2_SYNC_STATE_BAD"
}
log "R2_CROSS_DEVICE_STATE_PASS=yes"

rag_http=$(curl -sS --max-time 25 -o /tmp/rag-broad-probe.json -w '%{http_code}' "$BASE/api/rag/search" \
  -H 'Content-Type: application/json' \
  --data '{"question":"Jesus"}' || echo 000)
if [ "$rag_http" = "200" ]; then
  log "RAG_ENDPOINT_REACHABLE=yes"
else
  log "RAG_ENDPOINT_REACHABLE=degraded-$rag_http"
fi

log "7/7 Release complete"
log "DEPLOY_ONLY_PROTOCOL=success"
log "AUTONOMOUS_RELEASE=success"
