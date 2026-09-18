#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "MIGRATION_BLOCKED=$*"; exit 78; }

: "${FABIANO_CLOUDFLARE_API_TOKEN:?FABIANO_CLOUDFLARE_API_TOKEN is required}"
: "${FABIANO_CLOUDFLARE_ACCOUNT_ID:?FABIANO_CLOUDFLARE_ACCOUNT_ID is required}"

CF_API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $FABIANO_CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

log "== Consciência do Fabiano :: migration to Fabiano Cloudflare account =="

log "1/6 Verify token"
curl -sS -o /tmp/cf-verify.json "$CF_API/user/tokens/verify" "${AUTH[@]}"
jq -e '.success == true and .result.status == "active"' /tmp/cf-verify.json >/dev/null || { cat /tmp/cf-verify.json; die "TOKEN_NOT_ACTIVE"; }
log "TOKEN_ACTIVE=yes"

log "2/6 Resolve target account safely"
curl -sS -o /tmp/cf-accounts.json "$CF_API/accounts?per_page=50" "${AUTH[@]}"
jq -e '.success == true and (.result|type)=="array" and (.result|length) >= 1' /tmp/cf-accounts.json >/dev/null || { cat /tmp/cf-accounts.json; die "NO_ACCOUNT_VISIBLE_TO_TOKEN"; }

EXPECTED_ID=$(printf '%s' "$FABIANO_CLOUDFLARE_ACCOUNT_ID" | tr -d '[:space:]')
VISIBLE_COUNT=$(jq -r '.result|length' /tmp/cf-accounts.json)
MATCH_ID=$(jq --arg id "$EXPECTED_ID" -r '.result[]? | select(.id==$id) | .id' /tmp/cf-accounts.json | head -1)

if [ -n "$MATCH_ID" ]; then
  TARGET_ACCOUNT_ID="$MATCH_ID"
  log "TARGET_ACCOUNT_MATCH=yes"
elif [ "$VISIBLE_COUNT" = "1" ]; then
  TARGET_ACCOUNT_ID=$(jq -r '.result[0].id' /tmp/cf-accounts.json)
  log "TARGET_ACCOUNT_RESOLVED_FROM_TOKEN=yes"
else
  die "ACCOUNT_ID_MISMATCH_MULTIPLE_VISIBLE_ACCOUNTS"
fi

export CLOUDFLARE_API_TOKEN="$FABIANO_CLOUDFLARE_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$TARGET_ACCOUNT_ID"

log "3/6 Ensure R2 bucket"
R2_BUCKET="consciencia-fabiano-pdfs"
r2_code=$(curl -sS -o /tmp/r2-bucket.json -w '%{http_code}' "$CF_API/accounts/$TARGET_ACCOUNT_ID/r2/buckets/$R2_BUCKET" "${AUTH[@]}")
if [ "$r2_code" = "200" ]; then
  log "R2_BUCKET_EXISTS=yes"
else
  create_code=$(curl -sS -o /tmp/r2-create.json -w '%{http_code}' -X POST "$CF_API/accounts/$TARGET_ACCOUNT_ID/r2/buckets" "${AUTH[@]}" --data "{\"name\":\"$R2_BUCKET\",\"storageClass\":\"Standard\"}")
  jq -e '.success == true' /tmp/r2-create.json >/dev/null || { cat /tmp/r2-create.json; die "R2_BUCKET_CREATE_FAILED_HTTP_$create_code"; }
  log "R2_BUCKET_CREATED=yes"
fi

log "4/6 Ensure workers.dev subdomain and deploy Worker"
sub_code=$(curl -sS -o /tmp/subdomain.json -w '%{http_code}' "$CF_API/accounts/$TARGET_ACCOUNT_ID/workers/subdomain" "${AUTH[@]}")
SUBDOMAIN=""
if [ "$sub_code" = "200" ]; then
  SUBDOMAIN=$(jq -r '.result.subdomain // empty' /tmp/subdomain.json)
fi

if [ -z "$SUBDOMAIN" ]; then
  for candidate in focoeepoder2 fabiano-fns consciencia-fabiano-fns; do
    put_code=$(curl -sS -o /tmp/subdomain-put.json -w '%{http_code}' -X PUT "$CF_API/accounts/$TARGET_ACCOUNT_ID/workers/subdomain" "${AUTH[@]}" --data "{\"subdomain\":\"$candidate\"}")
    if jq -e '.success == true' /tmp/subdomain-put.json >/dev/null 2>&1; then
      SUBDOMAIN=$(jq -r '.result.subdomain // empty' /tmp/subdomain-put.json)
      log "WORKERS_SUBDOMAIN_CREATED=$SUBDOMAIN"
      break
    fi
  done
fi
[ -n "$SUBDOMAIN" ] || { cat /tmp/subdomain-put.json 2>/dev/null || cat /tmp/subdomain.json; die "WORKERS_SUBDOMAIN_CREATE_FAILED"; }

log "4a/6 Configure secure direct-to-R2 browser upload"
PARENT_ACCESS_KEY_ID=$(jq -r '.result.id // empty' /tmp/cf-verify.json)
[ -n "$PARENT_ACCESS_KEY_ID" ] || die "R2_PARENT_ACCESS_KEY_ID_MISSING"

printf '%s' "$FABIANO_CLOUDFLARE_API_TOKEN" | npx wrangler secret put R2_PARENT_API_TOKEN >/tmp/r2-parent-token.log
printf '%s' "$PARENT_ACCESS_KEY_ID" | npx wrangler secret put R2_PARENT_ACCESS_KEY_ID >/tmp/r2-parent-key.log
log "R2_SIGNING_SECRETS_READY=yes"

CORS_BODY='{"rules":[{"allowed":{"origins":["https://consciencia-fabiano.focoeepoder2.workers.dev"],"methods":["PUT"],"headers":["Content-Type"]},"exposeHeaders":["ETag"],"maxAgeSeconds":3600}]}'
cors_code=$(curl -sS -o /tmp/r2-cors.json -w '%{http_code}' -X PUT   "$CF_API/accounts/$TARGET_ACCOUNT_ID/r2/buckets/$R2_BUCKET/cors"   "${AUTH[@]}" --data "$CORS_BODY")
if [ "$cors_code" != "200" ]; then
  cat /tmp/r2-cors.json || true
  die "R2_CORS_CONFIG_FAILED_HTTP_$cors_code"
fi
log "R2_DIRECT_UPLOAD_CORS_READY=yes"

npm run check
npx wrangler whoami
npx wrangler deploy | tee /tmp/fabiano-deploy.log
log "WORKER_DEPLOY=success"

log "5/6 Resolve Fabiano workers.dev URL"
BASE="https://consciencia-fabiano.$SUBDOMAIN.workers.dev"
log "NEW_BASE_URL=$BASE"

log "6/6 Smoke test"
for i in $(seq 1 15); do
  if curl -fsS "$BASE/health" >/tmp/health.json 2>/dev/null && jq -e '.ok == true' /tmp/health.json >/dev/null 2>&1; then
    log "NEW_ACCOUNT_HEALTH_PASS=yes"
    break
  fi
  [ "$i" = 15 ] && { cat /tmp/health.json 2>/dev/null || true; die "NEW_ACCOUNT_HEALTH_FAILED"; }
  sleep 3
done

log "MIGRATION_STAGE_1=success"
log "R2_BUCKET=$R2_BUCKET"
log "SITE_URL=$BASE"
