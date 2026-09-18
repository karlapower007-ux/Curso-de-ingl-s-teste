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

function makePdf(pageCount, paddingBytes, runCode) {
  const enc = new TextEncoder();
  const esc = s => String(s).replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)");
  const objects = [null];
  const pageObjectNumbers = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let i = 0; i < pageCount; i++) {
    const pageObj = 4 + (i * 2);
    const contentObj = pageObj + 1;
    pageObjectNumbers.push(pageObj);

    const text1 = "FNS Matrix 100 Turbines validation page " + (i + 1) + " of " + pageCount + ".";
    const text2 = "Verification code " + runCode + ". Parallel extraction and embedding validation.";
    const stream =
      "BT /F1 11 Tf 72 720 Td (" + esc(text1) + ") Tj " +
      "0 -22 Td (" + esc(text2) + ") Tj ET";

    objects[pageObj] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 3 0 R >> >> /Contents " + contentObj + " 0 R >>";
    objects[contentObj] =
      "<< /Length " + enc.encode(stream).length + " >>\nstream\n" + stream + "\nendstream";
  }

  objects[2] =
    "<< /Type /Pages /Kids [" + pageObjectNumbers.map(n => n + " 0 R").join(" ") + "] /Count " + pageCount + " >>";

  if (paddingBytes > 0) {
    const padObj = objects.length;
    const payload = "Z".repeat(paddingBytes);
    objects[padObj] = "<< /Length " + payload.length + " >>\nstream\n" + payload + "\nendstream";
  }

  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = enc.encode(out).length;
    out += i + " 0 obj\n" + objects[i] + "\nendobj\n";
  }

  const xref = enc.encode(out).length;
  out += "xref\n0 " + objects.length + "\n";
  out += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i++) {
    out += String(offsets[i]).padStart(10,"0") + " 00000 n \n";
  }
  out += "trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\n";
  out += "startxref\n" + xref + "\n%%EOF\n";
  return enc.encode(out);
}

async function admin(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-FNS-GitHub-OIDC", oidc);
  return request(path, { ...options, headers });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForIndex(documentId, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { body } = await admin("/api/status?document_id=" + encodeURIComponent(documentId));
    if (body.status === "ready" || body.status === "duplicate") return body;
    if (body.status === "error") throw new Error("background index error: " + (body.error || "unknown"));
    await sleep(1200);
  }
  throw new Error("background indexing timeout");
}

async function readSse(res) {
  if (!(res.headers.get("content-type") || "").includes("text/event-stream")) throw new Error("chat não retornou SSE");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", answer = "", meta = null;
  const pieceFrom = p => String(p?.response ?? p?.delta?.content ?? p?.choices?.[0]?.delta?.content ?? p?.choices?.[0]?.text ?? p?.result?.response ?? "");
  const consume = block => {
    const lines = String(block || "").split(/\r?\n/);
    let eventName = "message";
    const data = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    const raw = data.join("\n");
    if (!raw || raw === "[DONE]") return;
    try {
      const parsed = JSON.parse(raw);
      if (eventName === "fns-meta") meta = parsed;
      else answer += pieceFrom(parsed);
    } catch {}
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || "";
    for (const part of parts) consume(part);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  return { answer: answer.trim(), meta };
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
  if (!(health.ok && health.pdf_storage === "r2" && health.r2_binding === "PDFS" && health.direct_r2_upload === true && health.upload_body_limit_bypassed === true && health.trigger_index_route === "/api/trigger-index" && health.asynchronous_indexing === true && health.rag_streaming === "sse" && health.voice_stack === "web-speech-api" && health.backend_stt_tts_enabled === false && health.ingestion_matrix?.extraction_turbines === 50 && health.ingestion_matrix?.embedding_turbines === 50 && health.ingestion_matrix?.total_turbines === 100 && health.ingestion_matrix?.pipelined === true && Array.isArray(health.bindings_missing) && health.bindings_missing.length === 0)) {
    throw new Error("health R2 inválido: " + JSON.stringify(health));
  }
  console.log("HEALTH_R2_PASS=yes");

  const runCode = "ORION-" + crypto.randomUUID().slice(0, 8).toUpperCase();
  const testFilename = "fns-r2-e2e-" + runCode.toLowerCase() + ".pdf";
  const pdf = makePdf(100, 8 * 1024 * 1024, runCode);
  console.log("HEAVY_PDF_BYTES=" + pdf.byteLength);
  const ticket = (await admin("/api/admin/direct-upload-ticket", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      filename:testFilename,
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

  const triggerStarted = Date.now();
  const triggerResult = await admin("/api/trigger-index", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      document_id:ticket.document_id,
      r2_key:ticket.r2_key,
      filename:ticket.filename,
      size_bytes:pdf.byteLength
    }),
  });
  const triggerMs = Date.now() - triggerStarted;
  if (!(triggerResult.res.status === 202 && triggerResult.body.ok && triggerResult.body.status === "processing")) {
    throw new Error("trigger assíncrono inválido: HTTP " + triggerResult.res.status + " " + JSON.stringify(triggerResult.body));
  }
  if (triggerMs > 5000) throw new Error("trigger-index demorou demais: " + triggerMs + "ms");
  console.log("ASYNC_TRIGGER_202_PASS=yes");
  console.log("ASYNC_TRIGGER_MS=" + triggerMs);

  const upload = await waitForIndex(ticket.document_id);
  const backgroundMs = Date.now() - triggerStarted;
  if (!(upload.status === "ready" &&
        Number(upload.paginas) === 100 &&
        Number(upload.extracted_pages) === 100 &&
        Number(upload.produced_chunks) >= 100 &&
        Number(upload.embedded_chunks) === Number(upload.produced_chunks) &&
        Number(upload.extraction_turbines) === 50 &&
        Number(upload.embedding_turbines) === 50 &&
        Number(upload.total_turbines) === 100)) {
    throw new Error("Matriz 100 Turbinas incompleta: " + JSON.stringify(upload));
  }
  console.log("BACKGROUND_INDEX_READY_PASS=yes");
  console.log("MATRIX_50_EXTRACTION_PASS=yes");
  console.log("MATRIX_50_EMBEDDING_PASS=yes");
  console.log("MATRIX_PIPELINE_100_PASS=yes");
  console.log("MATRIX_100_PAGES_PASS=yes");
  console.log("BACKGROUND_INDEX_MS=" + backgroundMs);
  const afterIndex = (await request("/health")).body;
  if (Number(afterIndex.documents || 0) < docsBefore + 1) {
    throw new Error("catálogo não refletiu o novo PDF: antes=" + docsBefore + " depois=" + afterIndex.documents);
  }
  console.log("CATALOG_COUNTER_INCREMENT_PASS=yes");

  const r2 = (await admin("/api/admin/r2-object?document_id=" + encodeURIComponent(documentId))).body;
  if (!(r2.ok && r2.exists === true && Number(r2.size) > 0)) throw new Error("objeto R2 ausente");
  console.log("R2_OBJECT_PASS=yes");

  const appJs = await fetch(base + "/app.js?v=10").then(r => r.text());
  if (!appJs.includes('Accept": "text/event-stream"') && !appJs.includes('text/event-stream')) {
    throw new Error("frontend sem consumo SSE");
  }
  if (!appJs.includes("SpeechRecognition") || !appJs.includes('recognition.lang = "pt-BR"') || !appJs.includes("SpeechSynthesisUtterance")) {
    throw new Error("frontend sem Web Speech API pt-BR");
  }
  if (!appJs.includes("/api/status?document_id=")) {
    throw new Error("frontend sem polling de indexação");
  }
  if (!appJs.includes("Matriz 100 Turbinas") || !appJs.includes("Extração 50 + Memória 50")) {
    throw new Error("frontend sem telemetria visual da Matriz 100 Turbinas");
  }
  console.log("FRONTEND_MATRIX_100_CODE_PASS=yes");
  const del = (await admin("/api/admin/delete-pdf", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({document_id:documentId}),
  })).body;
  if (!(del.ok && del.r2_deleted === true)) throw new Error("delete falhou: " + JSON.stringify(del));
  documentId = "";
  console.log("DELETE_R2_PASS=yes");

  const books = (await admin("/api/admin/livros")).body;
  if ((books.livros || []).some(x => x.id === documentId || x.arquivo === testFilename)) throw new Error("PDF de teste ficou no índice");
  console.log("LIBRARY_CLEAN_PASS=yes");
  const afterCleanup = (await request("/health")).body;
  if (Number(afterCleanup.documents || 0) < docsBefore) {
    throw new Error("catálogo ficou abaixo do total inicial após limpeza: antes=" + docsBefore + " depois=" + afterCleanup.documents);
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
