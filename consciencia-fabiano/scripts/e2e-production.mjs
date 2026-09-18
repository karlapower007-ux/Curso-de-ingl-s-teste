import fs from "node:fs/promises";

const base = process.env.BASE_URL || "https://consciencia-fabiano.focoeepoder2.workers.dev";
const oidc = process.env.OIDC_TOKEN || "";
if (!oidc) throw new Error("OIDC_TOKEN ausente");

const memoryKey = "fns-e2e-" + crypto.randomUUID().replaceAll("-","") + crypto.randomUUID().replaceAll("-","");
let documentId = "";

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const res = await fetch(base + path, { ...options, headers });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.arrayBuffer();
  if (!res.ok) {
    const message = body && typeof body === "object" && !(body instanceof ArrayBuffer)
      ? JSON.stringify(body)
      : "HTTP " + res.status;
    throw new Error(path + " -> " + message);
  }
  return { res, body };
}

function makePdf(lines) {
  const esc = s => s.replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)");
  let text = "BT /F1 14 Tf 72 720 Td ";
  lines.forEach((line, i) => {
    if (i) text += "0 -26 Td ";
    text += "(" + esc(line) + ") Tj ";
  });
  text += "ET";
  const enc = new TextEncoder();
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + enc.encode(text).length + " >>\nstream\n" + text + "\nendstream",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i=0;i<objs.length;i++) {
    offsets.push(enc.encode(out).length);
    out += (i+1) + " 0 obj\n" + objs[i] + "\nendobj\n";
  }
  const xref = enc.encode(out).length;
  out += "xref\n0 " + (objs.length+1) + "\n0000000000 65535 f \n";
  for (const off of offsets.slice(1)) out += String(off).padStart(10,"0") + " 00000 n \n";
  out += "trailer\n<< /Size " + (objs.length+1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return enc.encode(out);
}

async function admin(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-FNS-GitHub-OIDC", oidc);
  return request(path, { ...options, headers });
}

async function cleanup() {
  try {
    if (documentId) {
      await admin("/api/admin/delete-pdf", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({document_id:documentId}),
      });
    }
  } catch {}
  try {
    await request("/api/memory/clear", {
      method:"POST",
      headers:{"Content-Type":"application/json","X-FNS-Memory-Key":memoryKey},
      body:"{}",
    });
  } catch {}
}

try {
  const health = (await request("/health")).body;
  const docsBefore = Number(health.documents || 0);
  if (!(health.ok && health.pdf_storage === "r2" && health.r2_binding === "PDFS" && health.direct_r2_upload === true && health.upload_body_limit_bypassed === true && health.trigger_index_route === "/api/trigger-index" && health.tts_language === "pt-BR" && health.tts_english_fallback_disabled === true && Array.isArray(health.bindings_missing) && health.bindings_missing.length === 0)) {
    throw new Error("health R2 inválido: " + JSON.stringify(health));
  }
  console.log("HEALTH_R2_PASS=yes");

  const pdf = makePdf([
    "FNS Cloudflare R2 end-to-end validation document.",
    "The secret verification code is ORION-6382.",
    "This file validates multilingual retrieval and is deleted automatically."
  ]);
  const ticket = (await admin("/api/admin/direct-upload-ticket", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      filename:"fns-r2-e2e.pdf",
      content_type:"application/pdf",
      size_bytes:pdf.byteLength
    }),
  })).body;
  if (!(ticket.ok && ticket.direct === true && ticket.upload_url && ticket.document_id && ticket.r2_key)) {
    throw new Error("ticket direto inválido: " + JSON.stringify(ticket));
  }
  documentId = ticket.document_id;
  console.log("DIRECT_UPLOAD_TICKET_PASS=yes");

  const preflight = await fetch(ticket.upload_url, {
    method:"OPTIONS",
    headers:{
      "Origin":base,
      "Access-Control-Request-Method":"PUT",
      "Access-Control-Request-Headers":"content-type",
    },
  });
  const corsOrigin = preflight.headers.get("access-control-allow-origin") || "";
  const corsMethods = preflight.headers.get("access-control-allow-methods") || "";
  if (!preflight.ok || corsOrigin !== base || !corsMethods.includes("PUT")) {
    throw new Error("CORS direto inválido HTTP " + preflight.status + " origin=" + corsOrigin + " methods=" + corsMethods);
  }
  console.log("DIRECT_R2_CORS_PASS=yes");

  const directPut = await fetch(ticket.upload_url, {
    method:"PUT",
    headers:{"Content-Type":"application/pdf","Origin":base},
    body:pdf,
  });
  if (!directPut.ok) throw new Error("PUT direto R2 falhou HTTP " + directPut.status + " " + await directPut.text());
  console.log("DIRECT_R2_PUT_PASS=yes");

  const upload = (await admin("/api/trigger-index", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      document_id:ticket.document_id,
      r2_key:ticket.r2_key,
      filename:ticket.filename,
      size_bytes:pdf.byteLength
    }),
  })).body;
  if (!(upload.ok && upload.storage === "r2-original+durable-object-sqlite-index" && upload.r2_key && Number(upload.chunks) > 0)) {
    throw new Error("indexação após upload direto inválida: " + JSON.stringify(upload));
  }
  console.log("UPLOAD_R2_PASS=yes");

  const afterIndex = (await request("/health")).body;
  if (Number(afterIndex.documents || 0) !== docsBefore + 1) {
    throw new Error("catálogo não incrementou após trigger-index: antes=" + docsBefore + " depois=" + afterIndex.documents);
  }
  console.log("CATALOG_COUNTER_INCREMENT_PASS=yes");

  const r2 = (await admin("/api/admin/r2-object?document_id=" + encodeURIComponent(documentId))).body;
  if (!(r2.ok && r2.exists === true && Number(r2.size) > 0)) throw new Error("objeto R2 ausente");
  console.log("R2_OBJECT_PASS=yes");

  const chat = (await request("/api/chat", {
    method:"POST",
    headers:{"Content-Type":"application/json","X-FNS-Memory-Key":memoryKey},
    body:JSON.stringify({
      pergunta:"Qual é o código secreto informado no documento de validação? Responda em português e cite a fonte.",
      memory_key:memoryKey,
      turn_id:"e2e-r2-rag"
    }),
  })).body;
  if (!(chat.ok && chat.fallback === false && chat.memory_persisted === true && Array.isArray(chat.fontes) && chat.fontes.length >= 1 && String(chat.resposta).includes("ORION-6382"))) {
    throw new Error("RAG falhou: " + JSON.stringify(chat));
  }
  console.log("RAG_PT_EN_PASS=yes");

  const memory = (await request("/api/memory", {headers:{"X-FNS-Memory-Key":memoryKey}})).body;
  if (!(memory.ok && memory.persistent === true && Number(memory.total) >= 2)) throw new Error("memória não persistiu");
  console.log("MEMORY_PASS=yes");

  const ttsRes = await fetch(base + "/api/tts", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      text:"Teste de voz em português brasileiro. Código Orion seis três oito dois.",
      language:"pt-BR"
    }),
  });
  const ttsLanguage = ttsRes.headers.get("x-fns-tts-language") || "";
  const ttsProvider = ttsRes.headers.get("x-fns-tts-provider") || "";
  if (ttsLanguage !== "pt-BR") throw new Error("TTS sem tag pt-BR: " + ttsLanguage);

  if (ttsRes.ok) {
    const audio = new Uint8Array(await ttsRes.arrayBuffer());
    if (!(ttsRes.headers.get("content-type") || "").startsWith("audio/") || audio.byteLength <= 100) {
      throw new Error("TTS de áudio inválido");
    }
    console.log("TTS_PTBR_BACKEND_PASS=yes");

    const stt = (await request("/api/stt", {
      method:"POST",
      headers:{"Content-Type":ttsRes.headers.get("content-type") || "audio/mpeg"},
      body:audio,
    })).body;
    if (!(stt.ok && String(stt.text || "").trim().length >= 3)) throw new Error("STT inválido: " + JSON.stringify(stt));
    console.log("STT_PASS=yes");
  } else {
    const fallback = await ttsRes.json().catch(() => ({}));
    if (!(ttsRes.status === 503 && fallback.browser_fallback === true && fallback.language === "pt-BR" && ttsProvider === "browser-pt-BR")) {
      throw new Error("fallback pt-BR inválido: HTTP " + ttsRes.status + " " + JSON.stringify(fallback));
    }
    const appJs = await fetch(base + "/app.js?v=8").then(r => r.text());
    if (!appJs.includes('u.lang = "pt-BR"') || !appJs.includes("/api/trigger-index") || !appJs.includes("voiceschanged")) {
      throw new Error("frontend pt-BR/trigger-index não está publicado");
    }
    console.log("TTS_PTBR_BROWSER_FALLBACK_PASS=yes");
    console.log("STT_PASS=skipped_no_server_audio");
  }

  const del = (await admin("/api/admin/delete-pdf", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({document_id:documentId}),
  })).body;
  if (!(del.ok && del.r2_deleted === true)) throw new Error("delete falhou: " + JSON.stringify(del));
  documentId = "";
  console.log("DELETE_R2_PASS=yes");

  const books = (await admin("/api/admin/livros")).body;
  if ((books.livros || []).some(x => x.arquivo === "fns-r2-e2e.pdf")) throw new Error("PDF de teste ficou no índice");
  console.log("LIBRARY_CLEAN_PASS=yes");
  const afterCleanup = (await request("/health")).body;
  if (Number(afterCleanup.documents || 0) !== docsBefore) {
    throw new Error("catálogo não retornou ao total inicial: antes=" + docsBefore + " depois=" + afterCleanup.documents);
  }
  console.log("CATALOG_COUNTER_CLEANUP_PASS=yes");

  await request("/api/memory/clear", {
    method:"POST",
    headers:{"Content-Type":"application/json","X-FNS-Memory-Key":memoryKey},
    body:"{}",
  });
  console.log("E2E_FABIANO_CLOUDFLARE=success");
} catch (e) {
  console.error(e);
  await cleanup();
  process.exit(1);
} finally {
  await cleanup();
}
