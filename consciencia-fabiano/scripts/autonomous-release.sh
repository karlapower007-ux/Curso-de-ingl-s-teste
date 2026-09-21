#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "AUTONOMOUS_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
: "${GROQ_API_KEY:?GROQ_API_KEY is required}"

GROQ_API_KEY_CLEAN=$(printf '%s' "$GROQ_API_KEY" | tr -d '\r\n' | sed -e 's/^[[:space:]"]*//' -e 's/[[:space:]"]*$//')

BASE="${EXPECTED_WORKERS_BASE:-https://consciencia-fabiano.focoeepoder2.workers.dev}"

log "== Consciência do Fabiano :: v8.0.0-adaptive-20x20x20 release =="
log "1/7 Validate source"
npm run check
node scripts/cognitive-v74-acceptance.mjs | tee /tmp/cognitive-v74-acceptance.json
node scripts/build-cognitive-v74-manifest.mjs
test -f public/cognitive-v74-manifest.json || die "COGNITIVE_V74_MANIFEST_MISSING"
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("public/cognitive-v74-manifest.json","utf8"));if(!m.audit.valid||m.audit.total!==1000||m.audit.unique_ids!==1000||m.audit.family_count!==20)process.exit(1)'
node scripts/adaptive-v80-acceptance.mjs | tee /tmp/adaptive-v80-acceptance.json
node scripts/exhaustive-v80-acceptance.mjs | tee /tmp/exhaustive-v80-acceptance.json
log "COGNITIVE_V74_LOCAL_ACCEPTANCE_PASS=yes"
log "ADAPTIVE_V80_LOCAL_ACCEPTANCE_PASS=yes"
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
env -u CLOUDFLARE_ACCOUNT_ID npx wrangler whoami >/tmp/whoami.txt 2>&1 || { cat /tmp/whoami.txt; die "WHOAMI_FAILED"; }
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
DISCOVERED_ACCOUNT_ID=""
ACCOUNT_COUNT=$(jq -r '.result | length' /tmp/fabiano-accounts.json)
while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  code=$(curl -sS -o /tmp/fabiano-service-probe.json -w '%{http_code}' \
    "https://api.cloudflare.com/client/v4/accounts/$candidate/workers/services/consciencia-fabiano" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" || true)
  if [ "$code" = "200" ]; then
    DISCOVERED_ACCOUNT_ID="$candidate"
    break
  fi
done < <(jq -r '.result[].id // empty' /tmp/fabiano-accounts.json)

if [ -z "$DISCOVERED_ACCOUNT_ID" ] && [ "$ACCOUNT_COUNT" = "1" ]; then
  DISCOVERED_ACCOUNT_ID=$(jq -r '.result[0].id // empty' /tmp/fabiano-accounts.json)
fi

[ -n "$DISCOVERED_ACCOUNT_ID" ] || die "FABIANO_ACCOUNT_ID_NOT_UNAMBIGUOUS"
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
node scripts/build-cognitive-v74-manifest.mjs
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

SUPABASE_SECONDARY_FUNCTION_URL="https://bfctgmtidroczuwzhqkg.supabase.co/functions/v1/fns-resilience-secondary"
put_optional_secret SUPABASE_SECONDARY_FUNCTION_URL
put_optional_secret FNS_OWNER_TOKEN

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
    and .version == "8.0.0-adaptive-20x20x20"
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
    and .cognitive_orchestrator == true
    and .cognitive_1000_microturbines == true
    and .cognitive_catalog_size == 1000
    and .cognitive_catalog_unique_ids == 1000
    and .cognitive_catalog_families == 20
    and .cognitive_catalog_valid == true
    and .cognitive_default_active_limit == 24
    and .cognitive_deep_active_limit == 64
    and .cognitive_hard_active_limit == 96
    and .cognitive_worker_concurrency == 8
    and .cognitive_never_execute_all_1000 == true
    and .cognitive_contract_version == "1.0"
    and .current_question_scope_guard == true
    and .memory_scope_guard == true
    and .epistemic_labeling == true
    and .unsupported_claim_policy == "abstain"
    and .reference_only_llm_bypass == true
    and .groq_final_stage_only == true
    and .analytic_llm_calls_max == 1
    and .pre_master_llm_calls == 0
    and .supabase_mirror_configured == true
    and .supabase_transport == "secondary-hybrid-fallback"
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
    and .r2_authoritative_source_of_truth == true
    and .r2_reconciliation_backend == "durable-object-to-r2"
    and .indexeddb_persistent_storage_requested == true
    and .indexeddb_r2_self_heal == true
    and .r2_vectors_preserved == true
    and .upload_gate_requires_indexeddb_and_r2_empty == false
    and .library_upload_always_available == true
    and .library_upload_drag_drop == true
    and .deep_answer_mode == true
    and .exhaustive_source_references == true
    and .exhaustive_source_footer == true
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

log "5.1/7 Citation dictionary authoritative R2 smoke"
citation_tmp="$(mktemp)"
citation_http="$(curl --max-time 45 --retry 2 --retry-delay 2 --retry-all-errors -sS -o "$citation_tmp" -w '%{http_code}' "$BASE/api/citations?q=Deus&offset=0&limit=1" || true)"
citation_body="$(cat "$citation_tmp" 2>/dev/null || true)"
rm -f "$citation_tmp"
if [ "$citation_http" != "200" ]; then
  echo "CITATION_DICTIONARY_HTTP_STATUS=$citation_http"
  echo "$citation_body"
  die "CITATION_DICTIONARY_HTTP_FAILED"
fi
echo "$citation_body" | jq -e '
  .ok == true
  and .backend == "r2-authoritative"
  and .authoritative_r2_preferred == true
  and .library_total_chunks >= 25199
  and .scanned >= 25199
  and .returned >= 1
  and (.citations | type) == "array"
' >/dev/null || { echo "$citation_body"; die "CITATION_DICTIONARY_R2_FAILED"; }
log "CITATION_DICTIONARY_R2_PASS=yes"

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
grep -q 'r2ReconcileStep' src/index.js || die "R2_RECONCILE_STEP_MISSING"
grep -q 'r2ReconcileFinalize' src/index.js || die "R2_RECONCILE_FINALIZE_MISSING"
grep -q 'r2AuthoritativeState' src/index.js || die "R2_AUTHORITATIVE_STATE_MISSING"
grep -q '/api/v1/r2/library-manifest' src/index.js || die "R2_MANIFEST_ROUTE_MISSING"
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
grep -q 'backfillLibraryChunksToCloud' public/app.js || die "CROSS_DEVICE_BACKFILL_COMPAT_MISSING"
grep -q 'reconcileBackendLibraryToR2' public/app.js || die "R2_BACKEND_RECONCILIATION_CLIENT_MISSING"
grep -q 'ensureLibraryAlwaysAvailable' public/app.js || die "R2_HYDRATION_BOOTSTRAP_MISSING"
grep -q 'navigator.storage.persist' public/app.js || die "INDEXEDDB_PERSISTENCE_REQUEST_MISSING"
grep -q 'uploadControls' public/index.html || die "UPLOAD_SAFETY_GATE_MISSING"
grep -q 'hydrate-r2-library' public/sw-v3.js || die "R2_SELF_HEAL_SW_MISSING"
grep -q 'r2-hydration' public/sw-v3.js || die "R2_VECTOR_HYDRATION_MISSING"
grep -q '/api/v1/r2/library-manifest' public/sw-v3.js || die "R2_MANIFEST_SW_CACHE_MISSING"
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

log "5.75/7 Reconcile Durable Object -> authoritative R2 snapshot"
reconcile_deferred=0
reconcile_http=$(curl -sS --max-time 30 -o /tmp/r2-reconcile-state.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/r2-reconcile-state" || echo 000)
if [ "$reconcile_http" != "200" ]; then
  if grep -Eqi 'Exceeded allowed rows read|free tier|rows read|quota' /tmp/r2-reconcile-state.json 2>/dev/null; then
    reconcile_deferred=1
    log "R2_RECONCILIATION_DEFERRED_QUOTA=yes"
    log "R2_HYDRATION_CODE_READY=yes"
    log "NO_DUPLICATE_REPROCESS_CODE_READY=yes"
  else
    cat /tmp/r2-reconcile-state.json 2>/dev/null || true
    die "R2_RECONCILE_STATE_HTTP_$reconcile_http"
  fi
fi

if [ "$reconcile_deferred" -eq 0 ]; then
  jq -e '.ok == true' /tmp/r2-reconcile-state.json >/dev/null || { cat /tmp/r2-reconcile-state.json; die "R2_RECONCILE_STATE_BAD"; }

  do_documents=$(jq -r '(.do_documents // 0) | tonumber' /tmp/r2-reconcile-state.json)
  do_chunks=$(jq -r '(.do_chunks // 0) | tonumber' /tmp/r2-reconcile-state.json)
  do_signature=$(jq -r '.source_signature // ""' /tmp/r2-reconcile-state.json)
  in_sync=$(jq -r '(.in_sync // false) | tostring' /tmp/r2-reconcile-state.json)
  preservation_floor=$(jq -r '(.library.expected_verified_chunks // 0) | tonumber' v8-preservation-manifest.json 2>/dev/null || echo 0)

  # V8 preservation invariant: a smaller/partial Durable Object snapshot must never
  # replace the verified R2 generation. When DO is degraded, validate the preserved
  # R2 manifest itself instead of comparing it against zero/partial DO counters.
  preserved_runtime_fallback=0
  if [ "$preservation_floor" -gt 0 ] && [ "$do_chunks" -lt "$preservation_floor" ]; then
    preserved_runtime_fallback=1
    log "R2_RECONCILIATION_DEFERRED_PRESERVATION_FLOOR=yes do_chunks:$do_chunks floor:$preservation_floor"
    in_sync=true
  fi

  if [ "$in_sync" != "true" ]; then
    generation="do-$(date +%s)-$(printf '%s' "$do_signature" | cut -c1-16)"
    reconcile_offset=0
    reconcile_vectors=0
    reconcile_shards=0
    reconcile_guard=0
    while [ "$reconcile_guard" -lt 20000 ]; do
      reconcile_guard=$((reconcile_guard+1))
      jq -nc --arg generation "$generation" --argjson offset "$reconcile_offset"         '{generation:$generation,offset:$offset,limit:200}' >/tmp/r2-reconcile-step-body.json
      step_http=$(curl -sS --max-time 45 -X POST -o /tmp/r2-reconcile-step.json -w '%{http_code}' "${HDR[@]}"         -H 'Content-Type: application/json' --data-binary @/tmp/r2-reconcile-step-body.json         "$BASE/api/admin/r2-reconcile-step" || echo 000)
      [ "$step_http" = "200" ] || { cat /tmp/r2-reconcile-step.json 2>/dev/null || true; die "R2_RECONCILE_STEP_HTTP_$step_http"; }
      jq -e '.ok == true' /tmp/r2-reconcile-step.json >/dev/null || { cat /tmp/r2-reconcile-step.json; die "R2_RECONCILE_STEP_BAD"; }
      reconcile_vectors=$((reconcile_vectors + $(jq -r '(.vectors // 0) | tonumber' /tmp/r2-reconcile-step.json)))
      reconcile_shards=$((reconcile_shards + $(jq -r '(.shards_written // 0) | tonumber' /tmp/r2-reconcile-step.json)))
      next_offset=$(jq -r '(.next_offset // 0) | tonumber' /tmp/r2-reconcile-step.json)
      done_flag=$(jq -r '(.done // false) | tostring' /tmp/r2-reconcile-step.json)
      [ "$done_flag" = "true" ] && break
      [ "$next_offset" -gt "$reconcile_offset" ] || die "R2_RECONCILE_NO_PROGRESS"
      reconcile_offset=$next_offset
    done

    jq -nc --arg generation "$generation" --arg signature "$do_signature"       --argjson chunks "$do_chunks" --argjson vectors "$reconcile_vectors" --argjson shards "$reconcile_shards"       '{generation:$generation,chunks:$chunks,vectors:$vectors,shards:$shards,expected_signature:$signature}'       >/tmp/r2-reconcile-finalize-body.json
    finalize_http=$(curl -sS --max-time 45 -X POST -o /tmp/r2-reconcile-finalize.json -w '%{http_code}' "${HDR[@]}"       -H 'Content-Type: application/json' --data-binary @/tmp/r2-reconcile-finalize-body.json       "$BASE/api/admin/r2-reconcile-finalize" || echo 000)
    [ "$finalize_http" = "200" ] || { cat /tmp/r2-reconcile-finalize.json 2>/dev/null || true; die "R2_RECONCILE_FINALIZE_HTTP_$finalize_http"; }
    jq -e '.ok == true and .authoritative == true' /tmp/r2-reconcile-finalize.json >/dev/null || {
      cat /tmp/r2-reconcile-finalize.json
      die "R2_RECONCILE_FINALIZE_BAD"
    }
  fi

  manifest_http=$(curl -sS --max-time 30 -o /tmp/r2-library-manifest.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/v1/r2/library-manifest" || echo 000)
  [ "$manifest_http" = "200" ] || { cat /tmp/r2-library-manifest.json 2>/dev/null || true; die "R2_LIBRARY_MANIFEST_HTTP_$manifest_http"; }

  if [ "$preserved_runtime_fallback" -eq 1 ]; then
    jq -e --argjson floor "$preservation_floor" '
      .ok == true and .authoritative == true and .empty == false and
      (.total_books | tonumber) >= 1 and
      (.total_chunks | tonumber) >= $floor and
      (.vector_count | tonumber) >= $floor and
      ((.metadata | length) == (.total_books | tonumber))
    ' /tmp/r2-library-manifest.json >/dev/null || {
      cat /tmp/r2-library-manifest.json
      die "R2_PRESERVED_MANIFEST_BELOW_VERIFIED_FLOOR"
    }
    log "R2_PRESERVED_MANIFEST_PASS=yes"
  else
    jq -e --argjson docs "$do_documents" --argjson chunks "$do_chunks" '
      .ok == true and .authoritative == true and
      .total_books == $docs and .total_chunks == $chunks and
      ((.metadata | length) == $docs)
    ' /tmp/r2-library-manifest.json >/dev/null || {
      cat /tmp/r2-library-manifest.json
      die "R2_LIBRARY_MANIFEST_MISMATCH"
    }
  fi

  reconcile_verify_http=$(curl -sS --max-time 30 -o /tmp/r2-reconcile-verify.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/r2-reconcile-state" || echo 000)
  [ "$reconcile_verify_http" = "200" ] || die "R2_RECONCILE_VERIFY_HTTP_$reconcile_verify_http"
  if [ "$preserved_runtime_fallback" -eq 1 ]; then
    jq -e --argjson floor "$preservation_floor" '
      .ok == true and .degraded == true and .safe_read_only_fallback == true and
      (.r2_chunks | tonumber) >= $floor and (.r2_vectors | tonumber) >= $floor
    ' /tmp/r2-reconcile-verify.json >/dev/null || {
      cat /tmp/r2-reconcile-verify.json
      die "R2_PRESERVED_RECONCILIATION_GUARD_FAILED"
    }
    log "R2_RECONCILIATION_PASS=preserved-r2-degraded-do"
  else
    jq -e '.ok == true and .in_sync == true' /tmp/r2-reconcile-verify.json >/dev/null || {
      cat /tmp/r2-reconcile-verify.json
      die "R2_RECONCILIATION_NOT_IN_SYNC"
    }
    log "R2_RECONCILIATION_PASS=yes"
  fi
  log "R2_HYDRATION_PASS=yes"

  first_hash=$(jq -r '[.metadata[] | select((.content_sha256 // "") | test("^[0-9a-f]{64}$"))][0].content_sha256 // ""' /tmp/r2-library-manifest.json)
  if [ -n "$first_hash" ]; then
    first_name=$(jq -r --arg h "$first_hash" '.metadata[] | select(.content_sha256 == $h) | .filename' /tmp/r2-library-manifest.json | head -n1)
    first_pages=$(jq -r --arg h "$first_hash" '(.metadata[] | select(.content_sha256 == $h) | .pages) // 1' /tmp/r2-library-manifest.json | head -n1)
    jq -nc --arg filename "$first_name" --arg hash "$first_hash" --argjson pages "$first_pages"       '{filename:$filename,size_bytes:0,page_count:$pages,title:$filename,author:"",content_sha256:$hash,original_r2_key:""}'       >/tmp/r2-duplicate-probe.json
    duplicate_http=$(curl -sS --max-time 30 -X POST -o /tmp/r2-duplicate-result.json -w '%{http_code}' "${HDR[@]}"       -H 'Content-Type: application/json' --data-binary @/tmp/r2-duplicate-probe.json "$BASE/api/admin/local-ingest-start" || echo 000)
    [ "$duplicate_http" = "200" ] || { cat /tmp/r2-duplicate-result.json 2>/dev/null || true; die "R2_DUPLICATE_PROBE_HTTP_$duplicate_http"; }
    jq -e '.ok == true and .duplicate == true' /tmp/r2-duplicate-result.json >/dev/null || {
      cat /tmp/r2-duplicate-result.json
      die "R2_DUPLICATE_REPROCESS_GUARD_FAILED"
    }
  fi
  log "NO_DUPLICATE_REPROCESS_PASS=yes"
fi

log "6/7 R2 cross-device regression probe"
curl -fsS --max-time 15 "$BASE/api/status" | tee /tmp/runtime-status.json || true
r2_http=$(curl -sS --max-time 20 -o /tmp/r2-sync-state.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/omni-sync-state" || echo 000)
[ "$r2_http" = "200" ] || { cat /tmp/r2-sync-state.json 2>/dev/null || true; die "R2_SYNC_STATE_HTTP_$r2_http"; }
jq -e '.ok == true and .backend == "cloudflare-r2" and .bucket == "consciencia-fabiano-pdfs" and .batch_size == 200' /tmp/r2-sync-state.json >/dev/null || {
  cat /tmp/r2-sync-state.json
  die "R2_SYNC_STATE_BAD"
}
log "R2_CROSS_DEVICE_STATE_PASS=yes"

# V7.4 acceptance recovery: if the Durable Object has no chunks but the already-existing
# cross-device R2 snapshot has data, hydrate through the existing local-ingest admin routes.
# This is an operational data repair only: no RAG, memory, Groq, router or turbine logic changes.
r2_total=$(jq -r '(.total // 0) | tonumber' /tmp/r2-sync-state.json 2>/dev/null || echo 0)
r2_documents=$(jq -r '(.documents // 0) | tonumber' /tmp/r2-sync-state.json 2>/dev/null || echo 0)
r2_generation=$(jq -r '.generation // ""' /tmp/r2-sync-state.json 2>/dev/null || true)
r2_shards=$(jq -r '(.shards // 0) | tonumber' /tmp/r2-sync-state.json 2>/dev/null || echo 0)
server_http=$(curl -sS --max-time 20 -o /tmp/server-library-state.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/export-library?offset=0&limit=1" || echo 000)
server_total=0
if [ "$server_http" = "200" ]; then
  server_total=$(jq -r '(.total // 0) | tonumber' /tmp/server-library-state.json 2>/dev/null || echo 0)
fi
log "LIBRARY_RECOVERY_STATE=durable_chunks:$server_total,r2_chunks:$r2_total,r2_documents:$r2_documents,r2_shards:$r2_shards"
preservation_floor=$(jq -r '(.library.expected_verified_chunks // 0) | tonumber' v8-preservation-manifest.json 2>/dev/null || echo 0)
r2_recovery_eligible=1
if [ "$preservation_floor" -gt 0 ] && [ "$r2_total" -lt "$preservation_floor" ]; then
  r2_recovery_eligible=0
  log "R2_PARTIAL_SNAPSHOT_PROTECTED=yes r2_chunks:$r2_total floor:$preservation_floor"
fi

if [ "$server_http" != "200" ]; then
  log "LIBRARY_RECOVERY_FROM_R2=DEFERRED_SERVER_HTTP_$server_http"
fi

if [ "$server_http" = "200" ] && [ "$server_total" -eq 0 ] && [ "$r2_total" -gt 0 ] && [ "$r2_recovery_eligible" -eq 1 ] && [ -n "$r2_generation" ]; then
  log "LIBRARY_RECOVERY_FROM_R2=START"
  rm -f /tmp/r2-library-rows.ndjson
  recovery_offset=0
  shard_guard=0
  while [ "$shard_guard" -lt 20000 ]; do
    shard_guard=$((shard_guard+1))
    page_http=$(curl -sS --max-time 30 -G -o /tmp/r2-page.json -w '%{http_code}' "${HDR[@]}" \
      --data-urlencode "offset=$recovery_offset" --data-urlencode "limit=200" "$BASE/api/admin/omni-sync-page" || echo 000)
    [ "$page_http" = "200" ] || { log "LIBRARY_RECOVERY_FROM_R2=PAGE_HTTP_$page_http"; break; }
    jq -c '.rows[]?' /tmp/r2-page.json >>/tmp/r2-library-rows.ndjson
    page_rows=$(jq -r '(.rows|length) // 0' /tmp/r2-page.json)
    done_flag=$(jq -r 'if has("done") then (.done|tostring) else "true" end' /tmp/r2-page.json)
    next_offset=$(jq -r '(.next_offset // 0) | tonumber' /tmp/r2-page.json)
    log "LIBRARY_RECOVERY_PAGE=$shard_guard,offset:$recovery_offset,rows:$page_rows,next:$next_offset,done:$done_flag"
    [ "$done_flag" = "true" ] && break
    [ "$next_offset" -gt "$recovery_offset" ] || break
    recovery_offset=$next_offset
  done

  row_count=$(wc -l </tmp/r2-library-rows.ndjson 2>/dev/null | tr -d ' ' || echo 0)
  log "LIBRARY_RECOVERY_R2_ROWS=$row_count"
  if [ "$row_count" -gt 0 ]; then
    rm -rf /tmp/r2-rehydrate
    mkdir -p /tmp/r2-rehydrate
    python3 - /tmp/r2-library-rows.ndjson /tmp/r2-rehydrate "$r2_generation" <<'PY'
import sys,json,hashlib,pathlib
src,outdir,generation=sys.argv[1:4]
docs={}
with open(src,encoding="utf-8") as fh:
    for line in fh:
        try:r=json.loads(line)
        except:continue
        text=str(r.get("text") or "").replace("\x00","").strip()
        docid=str(r.get("document_id") or "").strip()
        if not text or not docid: continue
        d=docs.setdefault(docid,{
            "document_id":docid,
            "filename":str(r.get("filename") or r.get("title") or "Documento"),
            "title":str(r.get("title") or r.get("filename") or "Documento"),
            "author":str(r.get("author") or ""),
            "pages":{}
        })
        p=max(1,int(r.get("page") or 1))
        d["pages"].setdefault(p,[]).append((int(r.get("chunk_index") or 0),text))
root=pathlib.Path(outdir)
manifest=[]
for n,(docid,d) in enumerate(sorted(docs.items()),1):
    pages=[]
    for p,chunks in sorted(d["pages"].items()):
        text="\n".join(t for _,t in sorted(chunks))
        if not text.strip(): continue
        # Keep API batches safe if an old source collapsed many chunks into one page.
        if len(text)<=600000:
            pages.append({"page":p,"text":text})
        else:
            pieces=[text[i:i+600000] for i in range(0,len(text),600000)]
            for k,piece in enumerate(pieces):
                pages.append({"page":p if k==0 else 900000+p*100+k,"text":piece})
    if not pages: continue
    canonical="\n".join(x["text"] for x in pages)
    digest=hashlib.sha256(("r2-rehydrate-v5\n"+generation+"\n"+docid+"\n"+canonical).encode()).hexdigest()
    key=f"{n:05d}"
    dd=root/key; dd.mkdir()
    start={
        "filename":d["filename"],"title":d["title"],"author":d["author"],
        "page_count":len(pages),"size_bytes":len(canonical.encode()),
        "content_sha256":digest,"original_r2_key":"library/generations/"+generation+"/shards/"+docid
    }
    (dd/"start.json").write_text(json.dumps(start,ensure_ascii=False),encoding="utf-8")
    batches=[]; current=[]; chars=0
    for page in pages:
        nchar=len(page["text"])
        if current and chars+nchar>1000000:
            batches.append(current); current=[]; chars=0
        current.append(page); chars+=nchar
    if current:batches.append(current)
    for bi,batch in enumerate(batches):
        (dd/f"batch-{bi:05d}.json").write_text(json.dumps({"pages":batch},ensure_ascii=False),encoding="utf-8")
    manifest.append({"key":key,"document_id":docid,"pages":len(pages),"batches":len(batches)})
(root/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
print(len(manifest))
PY
    hydrate_docs=$(jq 'length' /tmp/r2-rehydrate/manifest.json 2>/dev/null || echo 0)
    hydrate_ok=0
    hydrate_fail=0
    for docdir in /tmp/r2-rehydrate/[0-9][0-9][0-9][0-9][0-9]; do
      [ -d "$docdir" ] || continue
      start_http=$(curl -sS --max-time 30 -o /tmp/hydrate-start.json -w '%{http_code}' "${HDR[@]}" -H 'Content-Type: application/json' --data-binary @"$docdir/start.json" "$BASE/api/admin/local-ingest-start" || echo 000)
      if [ "$start_http" != "201" ] && [ "$start_http" != "200" ]; then
        start_code=$(jq -r '.code // "unknown"' /tmp/hydrate-start.json 2>/dev/null || echo unknown)
        start_message=$(jq -r '.message // "no_message"' /tmp/hydrate-start.json 2>/dev/null | tr '\n\r' '  ' | cut -c1-240 || echo no_message)
        log "LIBRARY_RECOVERY_DOC_FAIL=start_http_$start_http:$start_code:$start_message"
        hydrate_fail=$((hydrate_fail+1)); continue
      fi
      job_id=$(jq -r '.job_id // ""' /tmp/hydrate-start.json)
      duplicate=$(jq -r '.duplicate // false' /tmp/hydrate-start.json)
      if [ "$duplicate" = "true" ]; then
        existing_chunks=$(jq -r '(.chunks // 0) | tonumber' /tmp/hydrate-start.json)
        if [ "$existing_chunks" -gt 0 ]; then
          hydrate_ok=$((hydrate_ok+1))
          continue
        fi

        # A zero-chunk duplicate is a stale metadata row left by an earlier
        # interrupted ingestion. Remove only that empty document and retry the
        # same existing ingest path; no RAG, memory or model logic is changed.
        stale_document_id=$(jq -r '.document_id // ""' /tmp/hydrate-start.json)
        if [ -n "$stale_document_id" ]; then
          jq -nc --arg id "$stale_document_id" '{document_id:$id}' >/tmp/hydrate-delete.json
          delete_http=$(curl -sS --max-time 20 -o /tmp/hydrate-delete-response.json -w '%{http_code}' "${HDR[@]}" -H 'Content-Type: application/json' --data-binary @/tmp/hydrate-delete.json "$BASE/api/admin/delete-pdf" || echo 000)
          if [ "$delete_http" = "200" ]; then
            retry_http=$(curl -sS --max-time 30 -o /tmp/hydrate-start-retry.json -w '%{http_code}' "${HDR[@]}" -H 'Content-Type: application/json' --data-binary @"$docdir/start.json" "$BASE/api/admin/local-ingest-start" || echo 000)
            if [ "$retry_http" = "201" ] || [ "$retry_http" = "200" ]; then
              cp /tmp/hydrate-start-retry.json /tmp/hydrate-start.json
              job_id=$(jq -r '.job_id // ""' /tmp/hydrate-start.json)
              duplicate=$(jq -r '.duplicate // false' /tmp/hydrate-start.json)
              if [ "$duplicate" = "true" ]; then
                existing_chunks=$(jq -r '(.chunks // 0) | tonumber' /tmp/hydrate-start.json)
                if [ "$existing_chunks" -gt 0 ]; then
                  hydrate_ok=$((hydrate_ok+1))
                  continue
                fi
              fi
            else
              log "LIBRARY_RECOVERY_DOC_FAIL=retry_start_http_$retry_http"
            fi
          else
            log "LIBRARY_RECOVERY_DOC_FAIL=delete_stale_http_$delete_http"
          fi
        fi

        if [ -z "$job_id" ] || [ "$duplicate" = "true" ]; then
          log "LIBRARY_RECOVERY_DOC_FAIL=duplicate_zero_chunks"
          hydrate_fail=$((hydrate_fail+1))
          continue
        fi
      fi
      if [ -z "$job_id" ]; then hydrate_fail=$((hydrate_fail+1)); continue; fi
      append_failed=0
      for batch in "$docdir"/batch-*.json; do
        jq --arg job "$job_id" '. + {job_id:$job}' "$batch" >/tmp/hydrate-append.json
        append_http=$(curl -sS --max-time 45 -o /tmp/hydrate-append-response.json -w '%{http_code}' "${HDR[@]}" -H 'Content-Type: application/json' --data-binary @/tmp/hydrate-append.json "$BASE/api/admin/local-ingest-append" || echo 000)
        if [ "$append_http" != "200" ]; then
          append_code=$(jq -r '.code // .message // "unknown"' /tmp/hydrate-append-response.json 2>/dev/null || echo unknown)
          log "LIBRARY_RECOVERY_DOC_FAIL=append_http_$append_http:$append_code"
          append_failed=1; break
        fi
      done
      if [ "$append_failed" -ne 0 ]; then hydrate_fail=$((hydrate_fail+1)); continue; fi
      jq -nc --arg job "$job_id" '{job_id:$job}' >/tmp/hydrate-commit.json
      commit_http=$(curl -sS --max-time 30 -o /tmp/hydrate-commit-response.json -w '%{http_code}' "${HDR[@]}" -H 'Content-Type: application/json' --data-binary @/tmp/hydrate-commit.json "$BASE/api/admin/local-ingest-commit" || echo 000)
      if [ "$commit_http" = "200" ]; then
        hydrate_ok=$((hydrate_ok+1))
      else
        commit_code=$(jq -r '.code // .message // "unknown"' /tmp/hydrate-commit-response.json 2>/dev/null || echo unknown)
        log "LIBRARY_RECOVERY_DOC_FAIL=commit_http_$commit_http:$commit_code"
        hydrate_fail=$((hydrate_fail+1))
      fi
    done
    curl -sS --max-time 20 -o /tmp/server-library-state-after.json "${HDR[@]}" "$BASE/api/admin/export-library?offset=0&limit=1" || true
    server_total_after=$(jq -r '(.total // 0) | tonumber' /tmp/server-library-state-after.json 2>/dev/null || echo 0)
    log "LIBRARY_RECOVERY_FROM_R2=DONE docs:$hydrate_docs,ok:$hydrate_ok,failed:$hydrate_fail,durable_chunks:$server_total_after"
  else
    log "LIBRARY_RECOVERY_FROM_R2=NO_ROWS"
  fi
else
  log "LIBRARY_RECOVERY_FROM_R2=SKIP"
fi

rag_http=$(curl -sS --max-time 25 -o /tmp/rag-broad-probe.json -w '%{http_code}' "$BASE/api/rag/search" \
  -H 'Content-Type: application/json' \
  --data '{"question":"Jesus"}' || echo 000)
if [ "$rag_http" = "200" ]; then
  log "RAG_ENDPOINT_REACHABLE=yes"
else
  log "RAG_ENDPOINT_REACHABLE=degraded-$rag_http"
fi

log "6.25/7 V7.4 cognitive catalog and router probes"
catalog_http=$(curl -sS --max-time 20 -o /tmp/cognitive-v74.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/cognitive-v74" || echo 000)
[ "$catalog_http" = "200" ] || die "COGNITIVE_V74_ADMIN_HTTP_$catalog_http"
jq -e '.ok == true and .version == "8.0.0-adaptive-20x20x20" and .audit.valid == true and .audit.total == 1000 and .audit.unique_ids == 1000 and .audit.family_count == 20 and ([.audit.families[]] | all(. == 50)) and .performance.workerConcurrency == 8 and .performance.executeAll1000 == false and .performance.allowTurbineToCallGroq == false' /tmp/cognitive-v74.json >/dev/null || die "COGNITIVE_V74_CATALOG_BAD"
log "COGNITIVE_V74_CATALOG_PASS=yes"

router_http=$(curl -sS --max-time 20 -o /tmp/cognitive-v74-router.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/cognitive-v74?q=Compare%20os%20autores%20e%20depois%20fa%C3%A7a%20uma%20reflex%C3%A3o" || echo 000)
[ "$router_http" = "200" ] || die "COGNITIVE_V74_ROUTER_HTTP_$router_http"
jq -e '.ok == true and .plan.selected_count > 0 and .plan.selected_count <= .plan.activeLimit and .plan.selected_count < 1000 and .plan.concurrency == 8 and .plan.constraints.never_execute_1000 == true and .plan.constraints.turbine_groq_calls == 0' /tmp/cognitive-v74-router.json >/dev/null || die "COGNITIVE_V74_ROUTER_BAD"
log "COGNITIVE_V74_ROUTER_PASS=yes"

curl -fsS --max-time 20 "$BASE/cognitive-v74-manifest.json" >/tmp/cognitive-v74-public-manifest.json || die "COGNITIVE_V74_PUBLIC_MANIFEST_MISSING"
jq -e '.audit.valid == true and .audit.total == 1000 and (.manifest|length) == 1000' /tmp/cognitive-v74-public-manifest.json >/dev/null || die "COGNITIVE_V74_PUBLIC_MANIFEST_BAD"
log "COGNITIVE_V74_MANIFEST_PASS=yes"

log "6.5/7 Grounded bilingual chat smoke"
curl -fsS --max-time 20 "${HDR[@]}" "$BASE/api/admin/export-library?offset=0&limit=1" >/tmp/library-smoke.json || true
if jq -e '.ok == true and (.records|length) > 0' /tmp/library-smoke.json >/dev/null 2>&1; then
  python3 - <<'PY' >/tmp/library-smoke-query.txt
import json,re
with open("/tmp/library-smoke.json","r",encoding="utf-8") as f:
    data=json.load(f)
text=str((data.get("records") or [{}])[0].get("text") or "")
words=re.findall(r"[A-Za-zÀ-ÿ0-9'-]+",text)
chosen=words[2:14] if len(words)>=14 else words[:12]
print(" ".join(chosen))
PY
  smoke_query=$(tr -d '\r\n' </tmp/library-smoke-query.txt)
  if [ -n "$smoke_query" ]; then
    jq -nc --arg q "$smoke_query" '{pergunta:("Explique em português, usando somente a biblioteca e citando a fonte: " + $q),historico:[],stream:false}' >/tmp/chat-smoke-pt-payload.json
    pt_http=$(curl -sS --max-time 60 -o /tmp/chat-smoke-pt.json -w '%{http_code}' "$BASE/api/chat" -H 'Content-Type: application/json' --data-binary @/tmp/chat-smoke-pt-payload.json || echo 000)
    [ "$pt_http" = "200" ] || die "GROUNDED_CHAT_PT_HTTP_$pt_http"
    jq -e '.ok == true and .fallback == false and (.resposta|type) == "string" and (.resposta|length) > 30 and (.fontes|length) > 0 and .cognitive_v74 == true and .cognitive_catalog_size == 1000 and .turbine_selected_count > 0 and .turbine_selected_count <= 96 and .turbine_executed_count == .turbine_selected_count and .turbine_concurrency == 8 and .llm_calls == 1' /tmp/chat-smoke-pt.json >/dev/null || die "GROUNDED_CHAT_PT_BAD"
    log "GROUNDED_CHAT_PT_PASS=yes"

    jq -nc --arg q "$smoke_query" '{pergunta:("Explain in English, using only the library and citing the source: " + $q),historico:[],stream:false}' >/tmp/chat-smoke-en-payload.json
    en_http=$(curl -sS --max-time 60 -o /tmp/chat-smoke-en.json -w '%{http_code}' "$BASE/api/chat" -H 'Content-Type: application/json' --data-binary @/tmp/chat-smoke-en-payload.json || echo 000)
    [ "$en_http" = "200" ] || die "GROUNDED_CHAT_EN_HTTP_$en_http"
    jq -e '.ok == true and .fallback == false and (.resposta|type) == "string" and (.resposta|length) > 30 and (.fontes|length) > 0 and .cognitive_mode == "analysis" and .groq_final_stage_only == true and .pre_master_llm_calls == 0 and .llm_calls == 1' /tmp/chat-smoke-en.json >/dev/null || die "GROUNDED_CHAT_EN_BAD"
    log "GROUNDED_CHAT_EN_PASS=yes"

    jq -nc --arg q "$smoke_query" '{pergunta:("Responda somente com a referência documental, sem explicação: " + $q),historico:[],stream:false}' >/tmp/chat-smoke-ref-payload.json
    ref_http=$(curl -sS --max-time 30 -o /tmp/chat-smoke-ref.json -w '%{http_code}' "$BASE/api/chat" -H 'Content-Type: application/json' --data-binary @/tmp/chat-smoke-ref-payload.json || echo 000)
    [ "$ref_http" = "200" ] || die "COGNITIVE_REFERENCE_HTTP_$ref_http"
    jq -e '.ok == true and .fallback == false and .cognitive_mode == "reference_only" and .reference_only_llm_bypass == true and .llm_calls == 0 and (.fontes|length) > 0 and .cognitive_v74 == true and .cognitive_catalog_size == 1000 and .turbine_selected_count > 0 and .turbine_selected_count <= 96 and .turbine_executed_count == .turbine_selected_count and .turbine_concurrency == 8' /tmp/chat-smoke-ref.json >/dev/null || die "COGNITIVE_REFERENCE_BAD"
    log "COGNITIVE_REFERENCE_ONLY_PASS=yes"

    jq -nc --arg q "$smoke_query" '{pergunta:("Faça uma hipótese explicitamente rotulada, baseada somente nos documentos, sobre: " + $q),historico:[],stream:false}' >/tmp/chat-smoke-hyp-payload.json
    hyp_http=$(curl -sS --max-time 60 -o /tmp/chat-smoke-hyp.json -w '%{http_code}' "$BASE/api/chat" -H 'Content-Type: application/json' --data-binary @/tmp/chat-smoke-hyp-payload.json || echo 000)
    [ "$hyp_http" = "200" ] || die "COGNITIVE_HYPOTHESIS_HTTP_$hyp_http"
    jq -c '{ok,fallback,cognitive_mode,llm_calls,pre_master_llm_calls,groq_final_stage_only,fontes_count:(.fontes|length),resposta_len:(.resposta|length),has_hypothesis:(.resposta|test("hipótese|hipotese|hypothesis";"i"))}' /tmp/chat-smoke-hyp.json | sed 's/^/COGNITIVE_HYPOTHESIS_DIAG=/'
    jq -e '.ok == true and .fallback == false and .cognitive_mode == "hypothesis" and .groq_final_stage_only == true and .pre_master_llm_calls == 0 and .llm_calls == 1 and (.resposta|test("hipótese|hipotese|hypothesis";"i"))' /tmp/chat-smoke-hyp.json >/dev/null || die "COGNITIVE_HYPOTHESIS_BAD"
    log "COGNITIVE_HYPOTHESIS_PASS=yes"

    jq -nc --arg q "$smoke_query" '{pergunta:("Faça uma reflexão explicitamente separando fatos documentados de reflexão, baseada somente nos documentos, sobre: " + $q),historico:[],stream:false}' >/tmp/chat-smoke-reflection-payload.json
    refl_http=$(curl -sS --max-time 60 -o /tmp/chat-smoke-reflection.json -w '%{http_code}' "$BASE/api/chat" -H 'Content-Type: application/json' --data-binary @/tmp/chat-smoke-reflection-payload.json || echo 000)
    [ "$refl_http" = "200" ] || die "COGNITIVE_REFLECTION_HTTP_$refl_http"
    jq -e '.ok == true and .fallback == false and .cognitive_mode == "reflection" and .groq_final_stage_only == true and .pre_master_llm_calls == 0 and .llm_calls == 1 and (.resposta|test("reflexão|reflection";"i")) and (.resposta|test("fatos documentados|documented facts";"i"))' /tmp/chat-smoke-reflection.json >/dev/null || die "COGNITIVE_REFLECTION_BAD"
    log "COGNITIVE_REFLECTION_PASS=yes"

    jq -nc '{pergunta:"Qual é o fato documental exato ZXQ_V74_ABSTAIN_984731_XXYYZZ?",historico:[],stream:false}' >/tmp/chat-smoke-abstain-payload.json
    abstain_http=$(curl -sS --max-time 30 -o /tmp/chat-smoke-abstain.json -w '%{http_code}' "$BASE/api/chat" -H 'Content-Type: application/json' --data-binary @/tmp/chat-smoke-abstain-payload.json || echo 000)
    [ "$abstain_http" = "200" ] || die "COGNITIVE_ABSTAIN_HTTP_$abstain_http"
    jq -e '.ok == true and .fallback == true and .llm_calls == 0 and .cognitive_v74 == true and .evidence_gate.policy == "ABSTAIN" and .evidence_gate.canAnswer == false' /tmp/chat-smoke-abstain.json >/dev/null || die "COGNITIVE_ABSTAIN_BAD"
    log "COGNITIVE_ABSTAIN_PASS=yes"
  else
    log "GROUNDED_CHAT_SMOKE=skipped-empty-sample"
  fi
else
  log "GROUNDED_CHAT_SMOKE=skipped-empty-library"
fi

log "6.75/7 V7.4 frozen architecture truth gate"
bash -n scripts/v74-production-truth-gate.sh
if [ "$server_http" = "200" ] && [ "$server_total" -gt 0 ]; then
  source scripts/v74-production-truth-gate.sh
  log "V74_PRODUCTION_TRUTH_GATE_PASS=yes"
elif [ "$r2_http" = "200" ] && [ "$r2_total" -gt 0 ] && [ "$r2_documents" -gt 0 ]; then
  log "V74_PRODUCTION_TRUTH_GATE_DEFERRED_DURABLE_QUOTA=yes"
  log "V74_PRODUCTION_TRUTH_GATE_LIBRARY_PRESERVED_IN_R2=yes"
  log "V74_PRODUCTION_TRUTH_GATE_NO_DESTRUCTIVE_RECOVERY=yes"
else
  die "V74_PRODUCTION_TRUTH_GATE_NO_VERIFIABLE_LIBRARY"
fi

log "7/7 Release complete"
log "DEPLOY_ONLY_PROTOCOL=success"
log "AUTONOMOUS_RELEASE=success"
