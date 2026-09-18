#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "AUTONOMOUS_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

BASE='https://consciencia-fabiano.karlapower007.workers.dev'

log "== Consciência do Fabiano :: Client PDF.js + Matrix 50x50 release =="
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

log "2/7 Validate Worker authorization"
npx wrangler whoami >/tmp/whoami.txt 2>&1 || { cat /tmp/whoami.txt; die "WHOAMI_FAILED"; }
grep -E 'Account Name|Account ID|associated with the email' /tmp/whoami.txt || true

log "3/7 Deploy Worker"
npx wrangler deploy | tee /tmp/deploy.log
log "DEPLOY_COMMAND=success"

log "4/7 Install runtime secrets"
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
for i in $(seq 1 15); do
  code=$(curl -sS -o /tmp/admin-probe.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/livros" || true)
  if [ "$code" = "200" ]; then log "AUTOMATION_SECRET_ACTIVE=yes"; break; fi
  [ "$i" = 15 ] && { cat /tmp/admin-probe.json || true; die "AUTOMATION_SECRET_NOT_ACTIVE"; }
  sleep 2
done

log "5/7 Production health"
for i in $(seq 1 15); do
  body=$(curl -fsS "$BASE/health" 2>/dev/null || true)
  if echo "$body" | jq -e '.ok == true and .architecture == "cloudflare-native" and .storage_backend == "durable-object-sqlite" and .server_pdf_parsing == false and .chunk_concurrency_limit == 50 and .embedding_concurrency_limit == 50' >/dev/null 2>&1; then
    echo "$body" | tee /tmp/health.json
    log "NATIVE_HEALTH_PASS=yes"
    break
  fi
  [ "$i" = 15 ] && { echo "$body"; die "NATIVE_HEALTH_FAILED"; }
  sleep 3
done
if [ "$EXPECT_R2" = "1" ]; then jq -e '.r2_direct_ready == true' /tmp/health.json >/dev/null; fi

log "6/7 Text-only RAG fire test"
PT_SHA=$(printf 'pt-client-fixture-v13' | sha256sum | cut -d' ' -f1)
EN_SHA=$(printf 'en-client-fixture-v13' | sha256sum | cut -d' ' -f1)
PT_BODY=$(jq -nc --arg sha "$PT_SHA" '{mode:"inline",filename:"teste-portugues-client.pdf",size_bytes:12345,content_sha256:$sha,pages:[{page:1,text:"Caderno Ponte de Ambar. Autor Equipe FNS. O principio Ponte de Ambar afirma que conhecimento cresce quando fontes sao comparadas. Codigo documental exclusivo AMBAR-2741."},{page:2,text:"A metafora da ponte representa dialogo entre memoria e reflexao. A cor simbolica escolhida para a ponte e dourada."}]}')
EN_BODY=$(jq -nc --arg sha "$EN_SHA" '{mode:"inline",filename:"teste-ingles-client.pdf",size_bytes:12345,content_sha256:$sha,pages:[{page:1,text:"Orion Archive Notes. The Orion Archive principle states that careful comparison prevents false certainty. Exclusive document code ORION-6382."},{page:2,text:"The archive color is cobalt blue. Cobalt blue represents disciplined curiosity and patient verification."}]}')

curl -fsS "${HDR[@]}" "$BASE/api/trigger-index" -H 'Content-Type: application/json' --data "$PT_BODY" > /tmp/pt.json
curl -fsS "${HDR[@]}" "$BASE/api/trigger-index" -H 'Content-Type: application/json' --data "$EN_BODY" > /tmp/en.json
jq -e '.ok == true and .client_extraction == true and (.job_id|length) > 10' /tmp/pt.json >/dev/null
jq -e '.ok == true and .client_extraction == true and (.job_id|length) > 10' /tmp/en.json >/dev/null

poll_job() {
  local file="$1"
  local job
  job=$(jq -r '.job_id' "$file")
  for i in $(seq 1 120); do
    curl -fsS "${HDR[@]}" "$BASE/api/index-status?job_id=$job" > "$file.status"
    status=$(jq -r '.status // "unknown"' "$file.status")
    if [ "$status" = "ready" ] || [ "$status" = "duplicate" ]; then return 0; fi
    if [ "$status" = "failed" ]; then cat "$file.status"; return 1; fi
    sleep 2
  done
  return 1
}
poll_job /tmp/pt.json
poll_job /tmp/en.json

curl -fsS "$BASE/api/chat" -H 'Content-Type: application/json' \
  --data '{"pergunta":"Segundo a biblioteca, o que afirma o principio Ponte de Ambar e qual e o codigo documental?","historico":[]}' > /tmp/chat-pt.json
jq -e '.ok == true and ([.fontes[] | select(.arquivo=="teste-portugues-client.pdf")] | length > 0)' /tmp/chat-pt.json >/dev/null

code=$(curl -sS -o /tmp/binary-disabled.json -w '%{http_code}' "${HDR[@]}" -F 'arquivo=@/etc/hosts;filename=nao-pode.pdf;type=application/pdf' "$BASE/api/admin/upload-pdf")
[ "$code" = "410" ] || { cat /tmp/binary-disabled.json; die "BINARY_PDF_ROUTE_STILL_ACTIVE"; }
log "SERVER_BINARY_PDF_DISABLED=yes"

log "7/7 Real production browser test with large PDF"
python3 -m pip install --quiet reportlab pillow
mkdir -p /tmp/fns-fire
python3 - <<'PY'
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from PIL import Image
import os, io

path="/tmp/fns-fire/grande-client-side.pdf"
c=canvas.Canvas(path,pagesize=A4,pageCompression=0)
for i in range(1,61):
    raw=os.urandom(320*320*3)
    img=Image.frombytes("RGB",(320,320),raw)
    bio=io.BytesIO()
    img.save(bio,format="JPEG",quality=90,optimize=False)
    bio.seek(0)
    c.setFont("Helvetica-Bold",14)
    c.drawString(50,800,f"Documento Grande Client-Side - pagina {i}")
    c.setFont("Helvetica",10)
    c.drawString(50,780,f"Turbina pagina {i}. Conteudo textual exclusivo FNS-MATRIX-{i:03d}.")
    c.drawImage(ImageReader(bio),50,390,width=500,height=360)
    c.showPage()
c.save()
print(os.path.getsize(path))
PY
BIG_BYTES=$(stat -c%s /tmp/fns-fire/grande-client-side.pdf)
[ "$BIG_BYTES" -gt 5000000 ] || die "BIG_PDF_NOT_LARGE_ENOUGH"
log "BIG_PDF_BYTES=$BIG_BYTES"

npm install --no-save --no-package-lock playwright-core@1.55.0 >/tmp/playwright-install.log 2>&1
FNS_AUTOMATION_SECRET="$AUTOMATION_SECRET" EXPECT_R2="$EXPECT_R2" node ./scripts/browser-ingest-smoke.mjs "$BASE" /tmp/fns-fire/grande-client-side.pdf | tee /tmp/browser-ingest.json
jq -e '.ok == true and .binary_pdf_requests_to_worker == 0 and .trigger_index_requests >= 1 and .pdf_file_bytes > 5000000' /tmp/browser-ingest.json >/dev/null
log "CLIENT_SIDE_PDFJS_BROWSER_PASS=yes"

curl -fsS "$BASE/api/chat" -H 'Content-Type: application/json' \
  --data '{"pergunta":"Na biblioteca, qual e o codigo textual da pagina 55 do Documento Grande Client-Side?","historico":[]}' > /tmp/chat-big.json
jq -e '.ok == true and ([.fontes[] | select(.arquivo=="grande-client-side.pdf")] | length > 0)' /tmp/chat-big.json >/dev/null
log "LARGE_PDF_RAG_PASS=yes"

log "Native STT/TTS + persistent memory"
python3 - <<'PY'
import wave
with wave.open("/tmp/fns-stt-silence.wav","wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b"\x00\x00"*16000)
PY
curl -fsS "$BASE/api/stt" -H 'Content-Type: audio/wav' --data-binary '@/tmp/fns-stt-silence.wav' > /tmp/stt.json
jq -e '.ok == true and (.text|type) == "string"' /tmp/stt.json >/dev/null
curl -fsS "$BASE/api/tts" -H 'Content-Type: application/json' --data '{"text":"Consciência do Fabiano em produção."}' -o /tmp/tts.audio
[ -s /tmp/tts.audio ] || die "TTS_EMPTY"

MEMORY_SECRET=$(openssl rand -hex 32)
MEMHDR=(-H "X-FNS-Memory-Key: $MEMORY_SECRET")
curl -fsS "${MEMHDR[@]}" "$BASE/api/chat" -H 'Content-Type: application/json' --data '{"pergunta":"Responda apenas MEMORIA-MATRIX-OK.","turn_id":"matrix-memory-1","historico":[]}' > /tmp/memory-chat.json
jq -e '.ok == true and .memory_persisted == true' /tmp/memory-chat.json >/dev/null
curl -fsS "${MEMHDR[@]}" "$BASE/api/memory" > /tmp/memory-list.json
jq -e '.ok == true and .total >= 2' /tmp/memory-list.json >/dev/null
curl -fsS "${MEMHDR[@]}" "$BASE/api/memory/clear" -H 'Content-Type: application/json' --data '{}' >/dev/null
log "VOICE_AND_MEMORY_PASS=yes"

log "Fixture cleanup"
curl -fsS "${HDR[@]}" "$BASE/api/admin/livros" > /tmp/books.json
for id in $(jq -r '.livros[] | select(.arquivo=="teste-portugues-client.pdf" or .arquivo=="teste-ingles-client.pdf" or .arquivo=="grande-client-side.pdf") | .id' /tmp/books.json); do
  curl -fsS "${HDR[@]}" "$BASE/api/admin/delete-pdf" -H 'Content-Type: application/json' --data "{\"document_id\":\"$id\"}" >/dev/null || true
done

FNS_AUTOMATION_SECRET="$AUTOMATION_SECRET" node ./scripts/browser-voice-smoke.mjs "$BASE" >/tmp/browser-voice.json
log "BROWSER_VOICE_LOOP_PASS=yes"
log "MATRIX_50X50=pass"
log "AUTONOMOUS_RELEASE=success"
