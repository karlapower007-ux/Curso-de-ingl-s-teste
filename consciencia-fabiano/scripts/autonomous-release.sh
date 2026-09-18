#!/usr/bin/env bash
set -euo pipefail

log(){ printf '%s\n' "$*"; }
die(){ log "AUTONOMOUS_RELEASE_BLOCKED=$*"; exit 78; }

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

log "== Consciência do Fabiano :: autonomous Durable Object native release =="
log "1/7 Validate source"
npm run check
! grep -q 'onrender.com' src/index.js
grep -q '@cf/baai/bge-m3' src/index.js
grep -q 'class LibraryDO' src/index.js
grep -q 'env.LIBRARY' src/index.js
grep -q 'durable_objects' wrangler.jsonc
grep -q 'new_sqlite_classes' wrangler.jsonc

log "2/7 Validate Worker authorization"
npx wrangler whoami >/tmp/whoami.txt 2>&1 || { cat /tmp/whoami.txt; die "WHOAMI_FAILED"; }
grep -E 'Account Name|Account ID|associated with the email' /tmp/whoami.txt || true

log "3/7 Deploy Worker with Durable Object alarm queue"
npx wrangler deploy | tee /tmp/deploy.log
log "DEPLOY_COMMAND=success"

log "4/7 Install rotating CI-only admin secret"
AUTOMATION_SECRET=$(openssl rand -hex 32)
printf '%s' "$AUTOMATION_SECRET" | npx wrangler secret put AUTOMATION_SECRET >/tmp/secret.log 2>&1 || { cat /tmp/secret.log; die "AUTOMATION_SECRET_FAILED"; }
log "AUTOMATION_SECRET_INSTALLED=yes"

BASE='https://consciencia-fabiano.karlapower007.workers.dev'
HDR=(-H "X-FNS-Automation: $AUTOMATION_SECRET")

log "Waiting for automation secret propagation"
for i in $(seq 1 12); do
  code=$(curl -sS -o /tmp/admin-probe.json -w '%{http_code}' "${HDR[@]}" "$BASE/api/admin/livros" || true)
  if [ "$code" = "200" ]; then
    log "AUTOMATION_SECRET_ACTIVE=yes"
    break
  fi
  [ "$i" = 12 ] && { cat /tmp/admin-probe.json || true; die "AUTOMATION_SECRET_NOT_ACTIVE"; }
  sleep 2
done

log "5/7 Production health"
for i in $(seq 1 15); do
  body=$(curl -fsS "$BASE/health" 2>/dev/null || true)
  if echo "$body" | jq -e '.ok == true and .architecture == "cloudflare-native" and .storage_backend == "durable-object-sqlite" and .render_dependency == false' >/dev/null 2>&1; then
    log "NATIVE_HEALTH_PASS=yes"
    break
  fi
  [ "$i" = 15 ] && { echo "$body"; die "NATIVE_HEALTH_FAILED"; }
  sleep 3
done

log "6/7 Multilingual PDF fire test"
python3 -m pip install --quiet reportlab
mkdir -p /tmp/fns-fire
python3 - <<'PY'
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

def make(path,title,author,pages):
    c=canvas.Canvas(path,pagesize=A4)
    c.setTitle(title)
    c.setAuthor(author)
    for i,lines in enumerate(pages,1):
        c.setFont("Helvetica-Bold",16)
        c.drawString(72,790,f"{title} - Page {i}")
        c.setFont("Helvetica",11)
        y=750
        for line in lines:
            c.drawString(72,y,line)
            y-=22
        c.showPage()
    c.save()

make("/tmp/fns-fire/teste-portugues.pdf","Caderno Ponte de Ambar","Equipe FNS",[[
    "Autor: Equipe FNS.",
    "O principio Ponte de Ambar afirma que conhecimento cresce quando fontes sao comparadas.",
    "Codigo documental exclusivo: AMBAR-2741.",
    "A finalidade deste documento e testar recuperacao semantica em portugues."
],[
    "Na segunda pagina, a metafora da ponte representa dialogo entre memoria e reflexao.",
    "A cor simbolica escolhida para a ponte e dourada."
]])

make("/tmp/fns-fire/teste-ingles.pdf","Orion Archive Notes","FNS Research Team",[[
    "Author: FNS Research Team.",
    "The Orion Archive principle states that careful comparison prevents false certainty.",
    "Exclusive document code: ORION-6382.",
    "This page exists to test cross-language semantic retrieval."
],[
    "The archive color is cobalt blue.",
    "In this document, cobalt blue represents disciplined curiosity and patient verification."
]])
PY

curl -fsS "${HDR[@]}" -F 'arquivo=@/tmp/fns-fire/teste-portugues.pdf;type=application/pdf' "$BASE/api/admin/upload-pdf" > /tmp/pt.json
curl -fsS "${HDR[@]}" -F 'arquivo=@/tmp/fns-fire/teste-ingles.pdf;type=application/pdf' "$BASE/api/admin/upload-pdf" > /tmp/en.json
cat /tmp/pt.json
cat /tmp/en.json
jq -e '.ok == true and .accepted == true and (.job_id|length) > 10' /tmp/pt.json >/dev/null
jq -e '.ok == true and .accepted == true and (.job_id|length) > 10' /tmp/en.json >/dev/null

poll_job() {
  local file="$1"
  local job
  job=$(jq -r '.job_id' "$file")
  for i in $(seq 1 120); do
    curl -fsS "${HDR[@]}" "$BASE/api/index-status?job_id=$job" > "$file.status"
    cat "$file.status"
    status=$(jq -r '.status // "unknown"' "$file.status")
    if [ "$status" = "ready" ] || [ "$status" = "duplicate" ]; then return 0; fi
    if [ "$status" = "failed" ]; then return 1; fi
    sleep 2
  done
  return 1
}
poll_job /tmp/pt.json
poll_job /tmp/en.json
jq -e '.ok == true and (.chunks|tonumber) > 0 and (.paginas|tonumber) >= 1' /tmp/pt.json.status >/dev/null
jq -e '.ok == true and (.chunks|tonumber) > 0 and (.paginas|tonumber) >= 1' /tmp/en.json.status >/dev/null

curl -fsS "$BASE/api/chat" -H 'Content-Type: application/json' \
  --data '{"pergunta":"Segundo a biblioteca, o que afirma o principio Ponte de Ambar e qual e o codigo documental? Responda em portugues e cite a fonte.","historico":[]}' \
  > /tmp/chat-pt.json
cat /tmp/chat-pt.json
jq -e '.ok == true and (.resposta|length) > 20 and ([.fontes[] | select(.arquivo=="teste-portugues.pdf" and (.pagina|tonumber)>=1)] | length > 0)' /tmp/chat-pt.json >/dev/null

curl -fsS "$BASE/api/chat" -H 'Content-Type: application/json' \
  --data '{"pergunta":"No documento em ingles, qual e a cor do arquivo Orion e o que essa cor representa? Explique em portugues e cite a fonte.","historico":[]}' \
  > /tmp/chat-en.json
cat /tmp/chat-en.json
jq -e '.ok == true and (.resposta|length) > 20 and ([.fontes[] | select(.arquivo=="teste-ingles.pdf" and (.pagina|tonumber)>=1)] | length > 0)' /tmp/chat-en.json >/dev/null

curl -fsS "$BASE/api/tts" -H 'Content-Type: application/json' \
  --data '{"text":"A Consciencia do Fabiano esta funcionando em portugues."}' \
  -D /tmp/tts.headers -o /tmp/tts.audio || true
if [ -s /tmp/tts.audio ]; then
  log "TTS_NATIVE_RESPONSE=yes"
else
  log "TTS_NATIVE_RESPONSE=fallback-browser-available"
fi

log "Persistent backend memory test"
MEMORY_SECRET=$(openssl rand -hex 32)
MEMHDR=(-H "X-FNS-Memory-Key: $MEMORY_SECRET")

curl -fsS "${MEMHDR[@]}" "$BASE/api/chat"   -H 'Content-Type: application/json'   --data '{"pergunta":"Responda apenas com a frase MEMORIA-PERSISTENTE-OK.","turn_id":"fire-memory-1","historico":[]}'   > /tmp/memory-chat.json
jq -e '.ok == true and .memory_persisted == true' /tmp/memory-chat.json >/dev/null

curl -fsS "${MEMHDR[@]}" "$BASE/api/memory" > /tmp/memory-list.json
jq -e '.ok == true and .persistent == true and (.total >= 2) and ([.messages[] | select(.content | contains("MEMORIA-PERSISTENTE-OK"))] | length >= 1)' /tmp/memory-list.json >/dev/null

curl -fsS "${MEMHDR[@]}" "$BASE/api/memory/clear"   -H 'Content-Type: application/json'   --data '{}' > /tmp/memory-clear.json
jq -e '.ok == true and (.cleared >= 2)' /tmp/memory-clear.json >/dev/null

curl -fsS "${MEMHDR[@]}" "$BASE/api/memory" > /tmp/memory-empty.json
jq -e '.ok == true and .total == 0' /tmp/memory-empty.json >/dev/null
log "PERSISTENT_MEMORY_PASS=yes"

log "7/7 Library validation and fixture cleanup"
curl -fsS "${HDR[@]}" "$BASE/api/admin/livros" > /tmp/books.json
cat /tmp/books.json
jq -e '.ok == true and ([.livros[] | select(.arquivo=="teste-portugues.pdf" or .arquivo=="teste-ingles.pdf")] | length >= 2)' /tmp/books.json >/dev/null

for id in $(jq -r '.livros[] | select(.arquivo=="teste-portugues.pdf" or .arquivo=="teste-ingles.pdf") | .id' /tmp/books.json); do
  curl -fsS "${HDR[@]}" "$BASE/api/admin/delete-pdf" \
    -H 'Content-Type: application/json' \
    --data "{\"document_id\":\"$id\"}" >/dev/null || true
done

curl -fsS "$BASE/api/status" | tee /tmp/status.json
jq -e '.ok == true and .render_dependency == false and .storage_backend == "durable-object-sqlite"' /tmp/status.json >/dev/null

log "FIRE_TEST_PT_EN=pass"
log "AUTONOMOUS_RELEASE=success"
