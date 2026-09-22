#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "V10_SAFE_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

BASE="${EXPECTED_WORKERS_BASE:-https://consciencia-fabiano.focoeepoder2.workers.dev}"

log "== Consciência do Fabiano :: v10 safe release =="
log "1/5 Validate source"
npm run check
npm run test:adaptive-v80
grep -q 'const VERSION = "10.0.0-zero-cost-private-offline-online"' src/index.js
grep -q 'const DEEP_CHAT_MODEL = "openai/gpt-oss-120b"' src/index.js
grep -q 'WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash"' src/index.js
grep -q 'function zeroCostReasoningCompletion' src/index.js
grep -q 'offlineDictionarySearch' public/rag-cascade.js
grep -q 'offlineHybridSearch' public/rag-cascade.js
grep -q 'OPERATING_MODE_KEY = "fns_operating_mode_v10"' public/app.js
! grep -qi 'gemini' src/index.js
! grep -qi 'api.x.ai' src/index.js

log "2/5 Discover authoritative Cloudflare account"
ACCOUNTS="$(curl -fsS "https://api.cloudflare.com/client/v4/accounts?per_page=50"   -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"   -H "Content-Type: application/json")"
DISCOVERED_ACCOUNT_ID="$(printf '%s' "$ACCOUNTS" | jq -r '.result[0].id // empty')"
[ -n "$DISCOVERED_ACCOUNT_ID" ] || die "ACCOUNT_DISCOVERY_FAILED"
export CLOUDFLARE_ACCOUNT_ID="$DISCOVERED_ACCOUNT_ID"
log "CLOUDFLARE_ACCOUNT_DISCOVERY=pass"

log "3/5 Deploy existing Worker only"
npx wrangler deploy
log "DEPLOY_COMMAND=success"

log "4/5 Install current secret and remove retired providers"
if [ -n "${GROQ_API_KEY:-}" ]; then
  printf '%s' "$GROQ_API_KEY" | npx wrangler secret put GROQ_API_KEY >/dev/null
  log "GROQ_SECRET_INSTALLED=yes"
fi
printf '%s' '{"GEMINI_API_KEY":null,"GOOGLE_API_KEY":null,"XAI_API_KEY":null,"GROK_API_KEY":null}'   | npx wrangler secret bulk >/dev/null || true
log "RETIRED_PROVIDER_SECRETS_REMOVAL_ATTEMPTED=yes"

log "5/5 Verify production without touching library contents"
HEALTH="$(curl -fsS --max-time 30 "$BASE/health/deploy")"
printf '%s' "$HEALTH" | jq -e '
  .ok == true and
  .version == "10.0.0-zero-cost-private-offline-online" and
  .zero_cost_guard == true and
  .external_privacy_gate == true and
  .external_models_receive_original_files == false and
  .external_models_receive_full_library == false and
  .full_offline_mode_supported == true and
  .workers_ai_used == true
' >/dev/null || die "HEALTH_CONTRACT_FAILED"

DICT="$(curl -fsS --max-time 30 -X POST "$BASE/api/dictionary/search"   -H 'Content-Type: application/json'   --data '{"query":"Adão","page":1,"page_size":50}')"
printf '%s' "$DICT" | jq -e '
  .ok == true and
  .strict_focus_lock == true and
  .intent_lock == true and
  .evidence_lock == true and
  .encyclopedia_index == "sqlite-fts5" and
  (.matches|type=="array") and
  (.total > 0)
' >/dev/null || die "ENCYCLOPEDIA_ACCEPTANCE_FAILED"

if printf '%s' "$DICT" | grep -Eqi '"(filename|document_id|chunk_index)"[[:space:]]*:|Standard Works|Obras Padrão'; then
  die "TECHNICAL_METADATA_LEAK"
fi

log "V10_SAFE_RELEASE=pass"
