#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "AUTONOMOUS_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${GROQ_API_KEY:?GROQ_API_KEY is required}"
: "${COHERE_API_KEY:?COHERE_API_KEY is required}"

GROQ_API_KEY_CLEAN=$(printf '%s' "$GROQ_API_KEY" | tr -d '\r\n' | sed -e 's/^[[:space:]"]*//' -e 's/[[:space:]"]*$//')
COHERE_API_KEY_CLEAN=$(printf '%s' "$COHERE_API_KEY" | tr -d '\r\n' | sed -e 's/^[[:space:]"]*//' -e 's/[[:space:]"]*$//')
log "COHERE_KEY_LENGTH=${#COHERE_API_KEY_CLEAN}"
if [ "${#COHERE_API_KEY_CLEAN}" -lt 20 ]; then
  die "COHERE_SECRET_TRUNCATED_OR_WRONG_VALUE"
fi

BASE='https://consciencia-fabiano.karlapower007.workers.dev'

log "== Consciência do Fabiano :: Groq + Cohere external AI bypass release =="
log "1/7 Validate source"
npm run check
node --check scripts/browser-voice-smoke.mjs
node --check scripts/browser-ingest-smoke.mjs
! grep -q 'AI.toMarkdown' src/index.js
! grep -q 'request.formData' src/index.js
! grep -q 'readPdfBuffer' src/index.js
grep -q 'CHUNK_CONCURRENCY = 50' src/index.js
grep -q 'EMBED_CONCURRENCY = 50' src/index.js
grep -q 'pdfjs-dist@4.10.38' public/index.html
grep -q 'api.groq.com/openai/v1/chat/completions' src/index.js
grep -q 'api.cohere.com/v2/embed' src/index.js
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

cohere_code=$(curl -sS -o /tmp/cohere-preflight.json -w '%{http_code}' "https://api.cohere.com/v2/embed" \
  -H "Authorization: Bearer $COHERE_API_KEY_CLEAN" \
  -H 'Content-Type: application/json' \
  --data '{"model":"embed-multilingual-v3.0","texts":["ping"],"input_type":"search_document","embedding_types":["float"],"truncate":"END"}')
if [ "$cohere_code" != "200" ]; then
  cat /tmp/cohere-preflight.json || true
  die "COHERE_PREFLIGHT_HTTP_$cohere_code"
fi
jq -e '((.embeddings.float // .embeddings.float_ // .embeddings) | type == "array" and length > 0)' /tmp/cohere-preflight.json >/dev/null || { cat /tmp/cohere-preflight.json; die "COHERE_PREFLIGHT_BAD_RESPONSE"; }
log "COHERE_PREFLIGHT_PASS=yes"

log "3/7 Deploy Worker"
npx wrangler deploy | tee /tmp/deploy.log
log "DEPLOY_COMMAND=success"

log "4/7 Install runtime secrets"
printf '%s' "$GROQ_API_KEY_CLEAN" | npx wrangler secret put GROQ_API_KEY >/dev/null
printf '%s' "$COHERE_API_KEY_CLEAN" | npx wrangler secret put COHERE_API_KEY >/dev/null
log "EXTERNAL_AI_SECRETS_INSTALLED=yes"
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
  code=$(curl -sS -o /tmp/admin-probe.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/livros" || true)
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
  body=$(curl -fsS "$BASE/health" 2>/dev/null || true)
  if echo "$body" | jq -e '.ok == true and .architecture == "cloudflare-router-external-ai" and .storage_backend == "durable-object-sqlite" and .workers_ai_used == false and .llm_provider == "groq" and .embedding_provider == "cohere" and .server_pdf_parsing == false and .chunk_concurrency_limit == 50 and .embedding_concurrency_limit == 50' >/dev/null 2>&1; then
    echo "$body" | tee /tmp/health.json
    log "NATIVE_HEALTH_PASS=yes"
    break
  fi
  [ "$i" = 15 ] && { echo "$body"; die "NATIVE_HEALTH_FAILED"; }
  sleep 3
done
if [ "$EXPECT_R2" = "1" ]; then jq -e '.r2_direct_ready == true' /tmp/health.json >/dev/null; fi

log "DEPLOY_ONLY_PROTOCOL=success"
log "AUTONOMOUS_RELEASE=success"
