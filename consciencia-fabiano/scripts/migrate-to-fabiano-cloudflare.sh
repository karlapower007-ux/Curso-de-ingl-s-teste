#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "MIGRATION_BLOCKED=$*"; exit 78; }

: "${FABIANO_CLOUDFLARE_API_TOKEN:?FABIANO_CLOUDFLARE_API_TOKEN is required}"
: "${FABIANO_CLOUDFLARE_ACCOUNT_ID:?FABIANO_CLOUDFLARE_ACCOUNT_ID is required}"

CF_API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $FABIANO_CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
export CLOUDFLARE_API_TOKEN="$FABIANO_CLOUDFLARE_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$FABIANO_CLOUDFLARE_ACCOUNT_ID"

log "== Consciência do Fabiano :: migration to Fabiano Cloudflare account =="

log "1/6 Verify token"
code=$(curl -sS -o /tmp/cf-verify.json -w '%{http_code}' "$CF_API/user/tokens/verify" "${AUTH[@]}")
jq -e '.success == true and .result.status == "active"' /tmp/cf-verify.json >/dev/null || { cat /tmp/cf-verify.json; die "TOKEN_NOT_ACTIVE"; }
log "TOKEN_ACTIVE=yes"

log "2/6 Verify target account"
code=$(curl -sS -o /tmp/cf-accounts.json -w '%{http_code}' "$CF_API/accounts?per_page=50" "${AUTH[@]}")
jq --arg id "$FABIANO_CLOUDFLARE_ACCOUNT_ID" -e '.success == true and any(.result[]?; .id == $id)' /tmp/cf-accounts.json >/dev/null || { cat /tmp/cf-accounts.json; die "ACCOUNT_NOT_VISIBLE_TO_TOKEN"; }
log "TARGET_ACCOUNT_MATCH=yes"

log "3/6 Ensure R2 bucket"
R2_BUCKET="consciencia-fabiano-pdfs"
r2_code=$(curl -sS -o /tmp/r2-bucket.json -w '%{http_code}' "$CF_API/accounts/$FABIANO_CLOUDFLARE_ACCOUNT_ID/r2/buckets/$R2_BUCKET" "${AUTH[@]}")
if [ "$r2_code" = "200" ]; then
  log "R2_BUCKET_EXISTS=yes"
else
  create_code=$(curl -sS -o /tmp/r2-create.json -w '%{http_code}' -X POST "$CF_API/accounts/$FABIANO_CLOUDFLARE_ACCOUNT_ID/r2/buckets" "${AUTH[@]}" --data "{\"name\":\"$R2_BUCKET\",\"storageClass\":\"Standard\"}")
  jq -e '.success == true' /tmp/r2-create.json >/dev/null || { cat /tmp/r2-create.json; die "R2_BUCKET_CREATE_FAILED_HTTP_$create_code"; }
  log "R2_BUCKET_CREATED=yes"
fi

log "4/6 Validate and deploy Worker"
npm run check
npx wrangler whoami
npx wrangler deploy | tee /tmp/fabiano-deploy.log
log "WORKER_DEPLOY=success"

log "5/6 Resolve Fabiano workers.dev URL"
sub_code=$(curl -sS -o /tmp/subdomain.json -w '%{http_code}' "$CF_API/accounts/$FABIANO_CLOUDFLARE_ACCOUNT_ID/workers/subdomain" "${AUTH[@]}")
if [ "$sub_code" != "200" ]; then
  cat /tmp/subdomain.json || true
  die "WORKERS_SUBDOMAIN_NOT_CONFIGURED"
fi
SUBDOMAIN=$(jq -r '.result.subdomain // empty' /tmp/subdomain.json)
[ -n "$SUBDOMAIN" ] || die "WORKERS_SUBDOMAIN_EMPTY"
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
