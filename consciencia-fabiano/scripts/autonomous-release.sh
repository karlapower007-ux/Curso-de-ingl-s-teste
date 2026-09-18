#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "AUTONOMOUS_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required by Cloudflare API}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required by Cloudflare API}"

log "== Consciência do Fabiano :: autonomous native release =="
log "ACCOUNT_ID_PRESENT=yes"

log "1/8 Validate source"
npm run check
! grep -q 'onrender.com' src/index.js
grep -q '@cf/baai/bge-m3' src/index.js
grep -q 'env.PDFS' src/index.js
grep -q 'env.VECTORIZE' src/index.js
grep -q 'env.DB' src/index.js

log "2/8 Validate authenticated account"
npx wrangler whoami >/tmp/whoami.txt 2>&1 || { cat /tmp/whoami.txt; die "WHOAMI_FAILED"; }
grep -E 'Account Name|Account ID|associated with the email' /tmp/whoami.txt || true

log "3/8 Capability gate: D1"
if ! npx wrangler d1 list --json >/tmp/d1.json 2>/tmp/d1.err; then
  cat /tmp/d1.err
  die "D1_PERMISSION_OR_ACCOUNT_MISMATCH"
fi

log "4/8 Capability gate: R2"
if ! npx wrangler r2 bucket list >/tmp/r2.txt 2>/tmp/r2.err; then
  cat /tmp/r2.err
  die "R2_PERMISSION_OR_ACCOUNT_MISMATCH"
fi

log "5/8 Capability gate: Vectorize"
# Listing isn't required if a named index already exists; use get then create only after D1/R2 gates pass.
if npx wrangler vectorize get consciencia-fabiano-rag >/tmp/vectorize.txt 2>/tmp/vectorize.err; then
  log "VECTORIZE_EXISTS=yes"
else
  log "VECTORIZE_EXISTS=no"
fi

log "6/8 Provision Cloudflare-native resources"
if ! grep -q 'consciencia-fabiano-pdfs' /tmp/r2.txt; then
  npx wrangler r2 bucket create consciencia-fabiano-pdfs
fi

if ! npx wrangler vectorize get consciencia-fabiano-rag >/dev/null 2>&1; then
  npx wrangler vectorize create consciencia-fabiano-rag --dimensions=1024 --metric=cosine
fi

DB_ID=$(jq -r '.[]? | select(.name=="consciencia-fabiano-rag-db") | (.uuid // .id // empty)' /tmp/d1.json | head -1)
if [ -z "$DB_ID" ]; then
  npx wrangler d1 create consciencia-fabiano-rag-db --json >/tmp/d1-create.json
  DB_ID=$(jq -r '.uuid // .id // .database_id // .d1_databases[0].database_id // empty' /tmp/d1-create.json | head -1)
fi
[ -n "$DB_ID" ] || die "D1_ID_NOT_RESOLVED"

python3 - "$DB_ID" <<'PY'
import json,sys
from pathlib import Path
p=Path("wrangler.jsonc")
data=json.loads(p.read_text())
data["d1_databases"][0]["database_id"]=sys.argv[1]
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n")
PY

npx wrangler d1 execute consciencia-fabiano-rag-db --remote --file=./migrations/0001_init.sql

log "7/8 Deploy production"
npx wrangler deploy

log "8/8 Production smoke"
BASE='https://consciencia-fabiano.karlapower007.workers.dev'
for i in $(seq 1 12); do
  body=$(curl -fsS "$BASE/health" 2>/dev/null || true)
  if echo "$body" | jq -e '.ok == true and .architecture == "cloudflare-native" and .render_dependency == false' >/dev/null 2>&1; then
    log "NATIVE_HEALTH_PASS=yes"
    break
  fi
  [ "$i" = 12 ] && die "NATIVE_HEALTH_FAILED"
  sleep 3
done

curl -fsS "$BASE/api/status" >/tmp/status.json
jq -e '.ok == true and .render_dependency == false' /tmp/status.json >/dev/null
log "AUTONOMOUS_RELEASE=success"
