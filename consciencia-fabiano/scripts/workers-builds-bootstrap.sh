#!/usr/bin/env bash
set -euo pipefail

echo "== Consciência do Fabiano :: Cloudflare-native bootstrap =="

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found"
  exit 1
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Cloudflare build token is not available in this build environment."
  exit 2
fi

echo "Validating Cloudflare identity..."
npx wrangler whoami

echo "Ensuring R2 bucket..."
if npx wrangler r2 bucket list 2>/tmp/r2.err | grep -q 'consciencia-fabiano-pdfs'; then
  echo "R2 exists."
else
  cat /tmp/r2.err || true
  npx wrangler r2 bucket create consciencia-fabiano-pdfs
fi

echo "Ensuring Vectorize index..."
if npx wrangler vectorize get consciencia-fabiano-rag >/tmp/vectorize.out 2>/tmp/vectorize.err; then
  cat /tmp/vectorize.out
else
  cat /tmp/vectorize.err || true
  npx wrangler vectorize create consciencia-fabiano-rag --dimensions=1024 --metric=cosine
fi

echo "Ensuring D1 database..."
npx wrangler d1 list --json > /tmp/d1-list.json
DB_ID=$(jq -r '.[] | select(.name=="consciencia-fabiano-rag-db") | (.uuid // .id // empty)' /tmp/d1-list.json | head -1)

if [ -z "$DB_ID" ] || [ "$DB_ID" = "null" ]; then
  npx wrangler d1 create consciencia-fabiano-rag-db --json > /tmp/d1-create.json
  cat /tmp/d1-create.json
  DB_ID=$(jq -r '.uuid // .id // .database_id // .d1_databases[0].database_id // empty' /tmp/d1-create.json | head -1)
fi

if [ -z "$DB_ID" ] || [ "$DB_ID" = "null" ]; then
  echo "Unable to determine D1 database id."
  exit 3
fi

echo "Patching transient wrangler.jsonc with D1 id: $DB_ID"
python3 - "$DB_ID" <<'PY'
import json,sys
from pathlib import Path
p=Path("wrangler.jsonc")
data=json.loads(p.read_text())
data["d1_databases"][0]["database_id"]=sys.argv[1]
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n")
PY

echo "Applying D1 schema..."
npx wrangler d1 execute consciencia-fabiano-rag-db --remote --file=./migrations/0001_init.sql

echo "Validating architecture..."
npm run check
grep -q '"binding": "PDFS"' wrangler.jsonc
grep -q '"binding": "VECTORIZE"' wrangler.jsonc
grep -q '"binding": "DB"' wrangler.jsonc
! grep -q '00000000-0000-0000-0000-000000000000' wrangler.jsonc
! grep -q 'onrender.com' src/index.js

echo "CLOUDFLARE_NATIVE_BOOTSTRAP=ready"
