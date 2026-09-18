import { AwsClient } from "aws4fetch";
import { getDocumentProxy } from "unpdf";

const VERSION = "1.3.0-matrix-100-turbines";
const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const TTS_MODEL = "@cf/myshell-ai/melotts";
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 250;
const TOP_K = 8;
const VECTOR_SCAN_LIMIT = 1800;
const MAX_SERVER_HISTORY = 40;
const EXTRACTION_TURBINES = 50;
const EMBEDDING_TURBINES = 50;
const EMBEDDING_RETRIES = 5;
const enc = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function securityHeaders(headers = new Headers()) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), geolocation=()");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function safeName(name) {
  return String(name || "documento.pdf")
    .replace(/[\\/]+/g, "-")
    .replace(/[^\p{L}\p{N}._()\- ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "documento.pdf";
}

function r2ObjectKey(documentId, filename) {
  return `pdfs/${String(documentId || "").trim()}/${safeName(filename)}`;
}

function uuidCompact() {
  return crypto.randomUUID().replace(/-/g, "");
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Buffer(buffer) {
  return hex(await crypto.subtle.digest("SHA-256", buffer));
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function assertBindings(env) {
  const missing = [];
  if (!env.AI) missing.push("AI");
  if (!env.LIBRARY) missing.push("LIBRARY");
  if (missing.length) {
    const err = new Error("Bindings ausentes: " + missing.join(", "));
    err.code = "BINDINGS_MISSING";
    throw err;
  }
}

function assertPdfStorage(env) {
  if (!env.PDFS) {
    const err = new Error("Binding R2 ausente: PDFS");
    err.code = "BINDINGS_MISSING";
    throw err;
  }
}

async function sha256Text(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(text || ""))));
}

function base64UrlBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseJwtJson(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));
}

async function githubActionsAuthorized(request) {
  const token = String(request.headers.get("X-FNS-GitHub-OIDC") || "").trim();
  if (!token) return false;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = parseJwtJson(parts[0]);
    const payload = parseJwtJson(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    const audienceOk = Array.isArray(payload.aud)
      ? payload.aud.includes("fns-consciencia-fabiano-e2e")
      : payload.aud === "fns-consciencia-fabiano-e2e";
    const allowedWorkflows = new Set([
      "karlapower007-ux/Curso-de-ingl-s-teste/.github/workflows/e2e-consciencia-fabiano-fabiano.yml@refs/heads/consciencia-fabiano-fabiano-cloudflare",
      "karlapower007-ux/Curso-de-ingl-s-teste/.github/workflows/e2e-ui-consciencia-fabiano.yml@refs/heads/consciencia-fabiano-fabiano-cloudflare",
    ]);

    if (
      header.alg !== "RS256" ||
      !header.kid ||
      payload.iss !== "https://token.actions.githubusercontent.com" ||
      !audienceOk ||
      payload.repository !== "karlapower007-ux/Curso-de-ingl-s-teste" ||
      payload.ref !== "refs/heads/consciencia-fabiano-fabiano-cloudflare" ||
      !allowedWorkflows.has(payload.workflow_ref) ||
      payload.runner_environment !== "github-hosted" ||
      Number(payload.exp || 0) < now ||
      Number(payload.nbf || 0) > now + 30
    ) return false;

    const jwksResponse = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", {
      cf: { cacheEverything: true, cacheTtl: 3600 },
    });
    if (!jwksResponse.ok) return false;
    const jwks = await jwksResponse.json();
    const jwk = Array.isArray(jwks.keys) ? jwks.keys.find(k => k.kid === header.kid) : null;
    if (!jwk) return false;

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = enc.encode(parts[0] + "." + parts[1]);
    const signature = base64UrlBytes(parts[2]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signed);
  } catch {
    return false;
  }
}

async function adminAuthorized(request, env) {
  if (await githubActionsAuthorized(request)) return true;

  const automation = (request.headers.get("X-FNS-Automation") || "").trim();
  if (env.AUTOMATION_SECRET && automation && automation === env.AUTOMATION_SECRET) return true;

  const password = String(request.headers.get("X-FNS-Admin-Password") || "");
  const expectedHash = String(env.ADMIN_PASSWORD_HASH || "").trim().toLowerCase();
  if (!password || !expectedHash || expectedHash.length !== 64) return false;

  const suppliedHash = await sha256Text(password);
  return suppliedHash === expectedHash;
}

function libraryStub(env) {
  return env.LIBRARY.get(env.LIBRARY.idFromName("main"));
}

async function libraryCall(env, path, options = {}) {
  const res = await libraryStub(env).fetch(new Request("https://library.internal" + path, options));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || ("LibraryDO " + res.status));
  return data;
}

async function indexJobStatus(env, documentId) {
  return libraryCall(env, "/job-status?document_id=" + encodeURIComponent(documentId));
}

async function triggerIndexBackground(request, env, ctx) {
  assertBindings(env);
  assertPdfStorage(env);

  const body = await request.json().catch(() => ({}));
  const documentId = String(body?.document_id || "").trim();
  const filename = safeName(body?.filename || "");
  const objectKey = String(body?.r2_key || "").trim();
  const sizeBytes = Number(body?.size_bytes || 0);

  if (!documentId || !filename || !/\.pdf$/i.test(filename)) {
    return json({ ok: false, message: "Dados do PDF inválidos." }, 400);
  }

  const expectedKey = r2ObjectKey(documentId, filename);
  if (objectKey !== expectedKey) {
    return json({ ok: false, message: "Chave R2 inválida para este documento." }, 400);
  }

  const queued = await libraryCall(env, "/queue-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: documentId,
      filename,
      r2_key: objectKey,
      size_bytes: sizeBytes,
    }),
  });

  const stub = libraryStub(env);
  const dispatch = stub.fetch(new Request("https://library.internal/process-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: documentId,
      filename,
      r2_key: objectKey,
      size_bytes: sizeBytes,
    }),
  }));

  if (ctx?.waitUntil) ctx.waitUntil(dispatch);
  else dispatch.catch(() => {});

  return json({
    ok: true,
    status: queued?.status || "processing",
    document_id: documentId,
    r2_key: objectKey,
    message: "Indexação iniciada em background.",
  }, 202);
}

async function memoryOwner(request, body = null) {
  const raw = String(
    body?.memory_key ||
    request.headers.get("X-FNS-Memory-Key") ||
    ""
  ).trim();
  if (raw.length < 32 || raw.length > 256) return null;
  return sha256Text(raw);
}

async function readPersistentHistory(env, ownerId, limit = MAX_SERVER_HISTORY) {
  if (!ownerId) return [];
  const data = await libraryCall(
    env,
    "/memory/list?owner_id=" + encodeURIComponent(ownerId) + "&limit=" + Math.max(1, Math.min(MAX_SERVER_HISTORY, Number(limit) || MAX_SERVER_HISTORY))
  );
  return Array.isArray(data.messages) ? data.messages : [];
}

async function appendPersistentMessage(env, payload) {
  if (!payload?.owner_id) return;
  await libraryCall(env, "/memory/append", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function clearPersistentHistory(env, ownerId) {
  if (!ownerId) return { ok: true, cleared: 0 };
  return libraryCall(env, "/memory/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_id: ownerId }),
  });
}

function splitPages(markdown) {
  const text = String(markdown || "").replace(/\r/g, "");
  const pageRegex = /^###\s+Page\s+(\d+)\s*$/gim;
  const markers = [];
  let match;
  while ((match = pageRegex.exec(text)) !== null) {
    markers.push({ page: Number(match[1]), start: match.index, contentStart: pageRegex.lastIndex });
  }

  if (!markers.length) {
    return [{ page: 1, text: text.trim() }];
  }

  const pages = [];
  for (let i = 0; i < markers.length; i++) {
    const current = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].start : text.length;
    const pageText = text.slice(current.contentStart, end).trim();
    if (pageText) pages.push({ page: current.page, text: pageText });
  }
  return pages.length ? pages : [{ page: 1, text: text.trim() }];
}

function chunkText(text, maxChars = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const out = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const windowStart = Math.max(start + Math.floor(maxChars * 0.55), end - 350);
      const tail = clean.slice(windowStart, end);
      const cut = Math.max(tail.lastIndexOf("\n\n"), tail.lastIndexOf(". "), tail.lastIndexOf("? "), tail.lastIndexOf("! "));
      if (cut > 0) end = windowStart + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece.length >= 80) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return out;
}

function parsePdfMetadata(markdown, filename) {
  const text = String(markdown || "");
  const metadataBlock = text.match(/##\s+Metadata\s*\n([\s\S]*?)(?=\n##\s+|\n###\s+Page\s+|$)/i)?.[1] || "";
  const fields = {};
  for (const line of metadataBlock.split("\n")) {
    const m = line.match(/^[-*]\s*([^=:\n]+)[=:]\s*(.+)$/);
    if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const title = fields.title || fields.subject || filename.replace(/\.pdf$/i, "");
  const author = fields.author || fields.creator || "";
  return { title: String(title).slice(0, 300), author: String(author).slice(0, 300) };
}

function detectLanguage(text) {
  const sample = (" " + String(text || "").toLowerCase().slice(0, 12000) + " ")
    .replace(/[^\p{L}\s]/gu, " ");
  const scores = {
    pt: [" de "," que "," e "," o "," a "," para "," com "," uma "," não "," por "," os "," as "," em "],
    en: [" the "," and "," of "," to "," in "," is "," that "," for "," with "," a "," an "," on "],
    es: [" de "," que "," y "," el "," la "," para "," con "," una "," no "," por "," los "," las "],
    fr: [" de "," et "," le "," la "," les "," des "," pour "," avec "," une "," est "," dans "],
    it: [" di "," e "," il "," la "," che "," per "," con "," una "," non "," del "," della "],
    de: [" der "," die "," das "," und "," ist "," mit "," für "," ein "," eine "," nicht "," von "],
  };
  let best = "unknown";
  let bestScore = 0;
  for (const [lang, words] of Object.entries(scores)) {
    const score = words.reduce((n, w) => n + (sample.split(w).length - 1), 0);
    if (score > bestScore) { best = lang; bestScore = score; }
  }
  return bestScore >= 4 ? best : "unknown";
}

function embeddingData(result) {
  if (Array.isArray(result?.data) && Array.isArray(result.data[0])) return result.data;
  if (Array.isArray(result?.result?.data) && Array.isArray(result.result.data[0])) return result.result.data;
  throw new Error("Workers AI não retornou embeddings no formato esperado.");
}

async function embedTexts(env, texts) {
  const result = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  return embeddingData(result);
}

async function convertPdf(env, filename, buffer) {
  const converted = await env.AI.toMarkdown(
    { name: filename, blob: new Blob([buffer], { type: "application/pdf" }) },
    { conversionOptions: { pdf: { metadata: true }, output: { format: "markdown" } } },
  );
  const result = Array.isArray(converted) ? converted[0] : converted;
  if (!result || result.format === "error" || !result.data) {
    throw new Error(result?.error || "Falha ao converter PDF para texto.");
  }
  return String(result.data);
}

async function indexPdfBuffer(env, {
  filename,
  buffer,
  sizeBytes,
  documentId = uuidCompact(),
  objectKey = null,
  objectAlreadyStored = false,
}) {
  const digest = await sha256Buffer(buffer);
  const duplicate = await libraryCall(env, "/duplicate?sha=" + encodeURIComponent(digest));
  if (duplicate.document) {
    const duplicateKey = r2ObjectKey(duplicate.document.id, duplicate.document.arquivo);
    const existingObject = await env.PDFS.head(duplicateKey);
    if (!existingObject) {
      await env.PDFS.put(duplicateKey, buffer, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { document_id: duplicate.document.id, sha256: digest },
      });
    }
    if (objectAlreadyStored && objectKey && objectKey !== duplicateKey) {
      await env.PDFS.delete(objectKey).catch(() => {});
    }
    return {
      ok: true,
      duplicate: true,
      ...duplicate.document,
      storage: "r2-original+durable-object-sqlite-index",
      r2_key: duplicateKey,
      r2_backfilled: !existingObject,
      message: "Este PDF já existe na biblioteca.",
    };
  }

  const markdown = await convertPdf(env, filename, buffer);
  const pages = splitPages(markdown);
  const metadata = parsePdfMetadata(markdown, filename);
  const language = detectLanguage(markdown);
  const chunks = [];
  let globalIndex = 0;

  for (const page of pages) {
    for (const piece of chunkText(page.text)) {
      chunks.push({ id: uuidCompact(), page: page.page, chunk_index: globalIndex++, text: piece });
    }
  }
  if (!chunks.length) throw new Error("Nenhum texto útil foi extraído do PDF.");

  for (let i = 0; i < chunks.length; i += 12) {
    const group = chunks.slice(i, i + 12);
    const vectors = await embedTexts(env, group.map(item => item.text));
    if (vectors.length !== group.length) {
      throw new Error("Quantidade de embeddings diferente da quantidade de trechos.");
    }
    group.forEach((item, idx) => { item.embedding = vectors[idx]; });
  }

  const finalKey = objectKey || r2ObjectKey(documentId, filename);
  const document = {
    id: documentId,
    filename,
    title: metadata.title,
    author: metadata.author,
    language,
    sha256: digest,
    size_bytes: Number(sizeBytes || buffer.byteLength || 0),
    page_count: pages.length,
    chunk_count: chunks.length,
    status: "ready",
  };

  if (!objectAlreadyStored) {
    await env.PDFS.put(finalKey, buffer, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { document_id: documentId, sha256: digest },
    });
  }

  try {
    await libraryCall(env, "/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, chunks }),
    });
  } catch (error) {
    await env.PDFS.delete(finalKey).catch(() => {});
    throw error;
  }

  return {
    ok: true,
    document_id: documentId,
    arquivo: filename,
    titulo: metadata.title,
    autor: metadata.author,
    idioma: language,
    paginas: pages.length,
    chunks: chunks.length,
    storage: "r2-original+durable-object-sqlite-index",
    r2_key: finalKey,
  };
}

async function uploadPdf(request, env) {
  assertBindings(env);
  assertPdfStorage(env);
  const form = await request.formData();
  const file = form.get("arquivo");
  if (!(file instanceof File)) return json({ ok: false, message: "PDF não enviado." }, 400);

  const filename = safeName(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(filename);
  if (!isPdf) return json({ ok: false, message: "Envie um arquivo PDF." }, 415);
  if (file.size <= 0) return json({ ok: false, message: "PDF vazio." }, 400);

  const buffer = await file.arrayBuffer();
  const result = await indexPdfBuffer(env, {
    filename,
    buffer,
    sizeBytes: file.size,
  });
  return json(result, result.duplicate ? 200 : 201);
}

function encodedR2Key(key) {
  return String(key || "").split("/").map(segment => encodeURIComponent(segment)).join("/");
}

async function createDirectUploadTicket(request, env) {
  assertBindings(env);
  assertPdfStorage(env);

  const body = await request.json().catch(() => ({}));
  const filename = safeName(body?.filename || "");
  const contentType = "application/pdf";
  if (!filename || !/\.pdf$/i.test(filename)) {
    return json({ ok: false, message: "Envie um arquivo PDF." }, 415);
  }

  const accountId = String(env.R2_ACCOUNT_ID || "").trim();
  const bucket = String(env.R2_BUCKET_NAME || "consciencia-fabiano-pdfs").trim();
  const parentToken = String(env.R2_PARENT_API_TOKEN || "").trim();
  const parentAccessKeyId = String(env.R2_PARENT_ACCESS_KEY_ID || "").trim();
  if (!accountId || !bucket || !parentToken || !parentAccessKeyId) {
    const err = new Error("Credenciais internas para upload direto ao R2 não estão configuradas.");
    err.code = "BINDINGS_MISSING";
    throw err;
  }

  const documentId = uuidCompact();
  const objectKey = r2ObjectKey(documentId, filename);

  const tempResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/temp-access-credentials`,
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + parentToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bucket,
        parentAccessKeyId,
        permission: "object-read-write",
        ttlSeconds: 900,
        objects: [objectKey],
      }),
    },
  );

  const temp = await tempResponse.json().catch(() => ({}));
  if (!tempResponse.ok || temp?.success !== true) {
    throw new Error(temp?.errors?.[0]?.message || "Não foi possível gerar credenciais temporárias do R2.");
  }

  const credentials = temp.result || {};
  const signer = new AwsClient({
    service: "s3",
    region: "auto",
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
  });

  const target = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodedR2Key(objectKey)}`,
  );
  target.searchParams.set("X-Amz-Expires", "900");

  const signed = await signer.sign(
    new Request(target.toString(), {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    { aws: { signQuery: true } },
  );

  return json({
    ok: true,
    direct: true,
    upload_url: signed.url.toString(),
    document_id: documentId,
    r2_key: objectKey,
    filename,
    content_type: contentType,
    expires_in: 900,
  });
}

async function indexDirectUpload(request, env) {
  assertBindings(env);
  assertPdfStorage(env);

  const body = await request.json().catch(() => ({}));
  const documentId = String(body?.document_id || "").trim();
  const filename = safeName(body?.filename || "");
  const objectKey = String(body?.r2_key || "").trim();

  if (!documentId || !filename || !/\.pdf$/i.test(filename)) {
    return json({ ok: false, message: "Dados do PDF inválidos." }, 400);
  }

  const expectedKey = r2ObjectKey(documentId, filename);
  if (objectKey !== expectedKey) {
    return json({ ok: false, message: "Chave R2 inválida para este documento." }, 400);
  }

  const object = await env.PDFS.get(objectKey);
  if (!object) {
    return json({ ok: false, message: "O upload direto ainda não apareceu no R2." }, 404);
  }

  const buffer = await object.arrayBuffer();
  const result = await indexPdfBuffer(env, {
    filename,
    buffer,
    sizeBytes: object.size,
    documentId,
    objectKey,
    objectAlreadyStored: true,
  });

  return json(result, result.duplicate ? 200 : 201);
}
async function listBooks(env) {
  assertBindings(env);
  return libraryCall(env, "/docs");
}

async function r2ObjectStatus(request, env, url) {
  assertBindings(env);
  assertPdfStorage(env);
  const documentId = String(url.searchParams.get("document_id") || "").trim();
  const arquivo = String(url.searchParams.get("arquivo") || "").trim();
  if (!documentId && !arquivo) return json({ ok: false, message: "Informe document_id ou arquivo." }, 400);

  const docs = await listBooks(env);
  const row = (docs.livros || []).find(d =>
    (documentId && d.id === documentId) || (!documentId && arquivo && d.arquivo === arquivo)
  );
  if (!row) return json({ ok: false, message: "Documento não encontrado no índice." }, 404);

  const key = r2ObjectKey(row.id, row.arquivo);
  const head = await env.PDFS.head(key);
  return json({
    ok: true,
    exists: Boolean(head),
    document_id: row.id,
    arquivo: row.arquivo,
    r2_key: key,
    size: head?.size ?? null,
    etag: head?.etag ?? null,
    storage_class: head?.storageClass ?? null,
  });
}

async function deletePdf(request, env) {
  assertBindings(env);
  assertPdfStorage(env);
  const body = await request.json().catch(() => ({}));
  const deleted = await libraryCall(env, "/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: String(body?.document_id || ""),
      arquivo: String(body?.arquivo || ""),
    }),
  });
  const key = r2ObjectKey(deleted.document_id, deleted.arquivo);
  let r2Deleted = true;
  let warning = null;
  try {
    await env.PDFS.delete(key);
  } catch (error) {
    r2Deleted = false;
    warning = "Índice removido; limpeza do objeto R2 deverá ser repetida.";
  }
  return json({ ...deleted, r2_deleted: r2Deleted, r2_key: key, warning });
}

async function reindexLibrary(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const onlyId = String(body?.document_id || "").trim();
  const data = await libraryCall(env, "/chunks" + (onlyId ? ("?document_id=" + encodeURIComponent(onlyId)) : ""));
  const chunks = Array.isArray(data.chunks) ? data.chunks : [];
  for (let i = 0; i < chunks.length; i += 12) {
    const group = chunks.slice(i, i + 12);
    const vectors = await embedTexts(env, group.map(c => c.text));
    await libraryCall(env, "/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: group.map((c, idx) => ({ id: c.id, embedding: vectors[idx] })) }),
    });
  }
  const docs = await listBooks(env);
  const resultados = (docs.livros || [])
    .filter(d => !onlyId || d.id === onlyId)
    .map(d => ({ ok: true, document_id: d.id, arquivo: d.arquivo }));
  return json({ ok: true, resultados });
}

async function retrieveContext(env, question) {
  assertBindings(env);
  const qEmbedding = await embedTexts(env, [question]);
  const data = await libraryCall(env, "/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embedding: qEmbedding[0], top_k: TOP_K, scan_limit: VECTOR_SCAN_LIMIT }),
  });
  return Array.isArray(data.matches) ? data.matches : [];
}

function uniqueSources(context) {
  const seen = new Set();
  const sources = [];
  for (const item of context) {
    const key = `${item.document_id}:${item.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      document_id: item.document_id,
      arquivo: item.filename,
      titulo: item.title || item.filename,
      autor: item.author || "",
      idioma: item.language || "unknown",
      pagina: item.page || null,
      trecho: String(item.text || "").slice(0, 650),
      score: Math.round(item.score * 10000) / 10000,
    });
  }
  return sources.slice(0, 8);
}

function extractAiStreamText(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(
    payload.response ??
    payload.delta?.content ??
    payload.choices?.[0]?.delta?.content ??
    payload.choices?.[0]?.text ??
    payload.result?.response ??
    ""
  );
}

async function collectAiSseText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  const consume = eventBlock => {
    const lines = String(eventBlock || "").split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        answer += extractAiStreamText(JSON.parse(raw));
      } catch {}
    }
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
  return answer.trim();
}

function prependSseMeta(aiStream, meta) {
  const reader = aiStream.getReader();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(
        "event: fns-meta\n" +
        "data: " + JSON.stringify(meta) + "\n\n"
      ));
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function chat(request, env, ctx) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const question = String(body?.pergunta || "").trim();
  if (question.length < 2) return json({ ok: false, message: "Pergunta vazia." }, 400);

  const ownerId = await memoryOwner(request, body);
  const clientHistory = Array.isArray(body?.historico) ? body.historico.slice(-20) : [];
  let storedHistory = [];
  try {
    storedHistory = await readPersistentHistory(env, ownerId, 20);
  } catch {}
  const history = storedHistory.length
    ? storedHistory.slice(-20).map(x => ({ role: x.role, content: x.content }))
    : clientHistory;

  let context = [];
  try {
    context = await retrieveContext(env, question);
  } catch {
    context = [];
  }

  const contextText = context.length
    ? context.map((item, i) =>
        `[F${i + 1}] ${item.title || item.filename}${item.author ? " — " + item.author : ""}, página ${item.page || "não informada"}\n${item.text}`
      ).join("\n\n")
    : "(Nenhum trecho da biblioteca foi recuperado para esta pergunta.)";

  const messages = [
    {
      role: "system",
      content:
        "Você é a Consciência do Fabiano: uma consciência intelectual ampliada, enciclopédica, crítica e respeitosa. " +
        "Responda SEMPRE em português brasileiro, mesmo quando a fonte estiver em inglês ou outro idioma. " +
        "Quando usar uma fonte estrangeira, traduza ou parafraseie em português preservando o sentido. " +
        "As fontes recuperadas aparecem como [F1], [F2] etc. Cite esses marcadores quando fundamentarem uma afirmação. " +
        "Nunca invente livro, autor, página, capítulo ou citação. Se a biblioteca não tiver evidência suficiente, diga isso. " +
        "Diferencie documento, interpretação e hipótese. Você pode conversar sobre religião, filosofia, maçonaria, história, arte, ciência, literatura e qualquer outro assunto. " +
        "Se não houver fonte documental suficiente, ainda pode usar conhecimento geral, mas declare claramente que essa parte não veio dos PDFs. " +
        "Use o histórico persistente apenas como contexto de conversa; não o trate como fonte documental."
    },
    ...history.map(x => ({
      role: x.role === "assistant" ? "assistant" : "user",
      content: String(x.content || "").slice(0, 2200),
    })),
    {
      role: "user",
      content: `BIBLIOTECA RECUPERADA:\n${contextText}\n\nPERGUNTA:\n${question}`,
    },
  ];

  const aiResult = await env.AI.run(CHAT_MODEL, {
    messages,
    temperature: 0.35,
    max_tokens: 1100,
    stream: true,
  });

  const upstream =
    aiResult instanceof ReadableStream ? aiResult :
    aiResult instanceof Response ? aiResult.body :
    aiResult?.body instanceof ReadableStream ? aiResult.body :
    null;

  if (!upstream) {
    throw new Error("Workers AI não retornou um stream SSE.");
  }

  const sources = uniqueSources(context);
  const fallback = context.length === 0;
  const turnId = String(body?.turn_id || crypto.randomUUID()).slice(0, 120);
  const [clientBranch, memoryBranch] = upstream.tee();

  if (ownerId) {
    const persist = (async () => {
      try {
        await appendPersistentMessage(env, {
          id: turnId + ":u",
          owner_id: ownerId,
          role: "user",
          content: question.slice(0, 8000),
          sources: [],
          fallback: false,
        });
        const answer = await collectAiSseText(memoryBranch);
        if (answer) {
          await appendPersistentMessage(env, {
            id: turnId + ":a",
            owner_id: ownerId,
            role: "assistant",
            content: answer.slice(0, 12000),
            sources,
            fallback,
          });
        }
      } catch {}
    })();
    if (ctx?.waitUntil) ctx.waitUntil(persist);
  } else {
    memoryBranch.cancel().catch(() => {});
  }

  const responseStream = prependSseMeta(clientBranch, {
    ok: true,
    fontes: sources,
    fallback,
    provider: "cloudflare-native-do-rag-stream",
    embedding_model: EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
  });

  return new Response(responseStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
async function stt(request, env) {
  assertBindings(env);
  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) return json({ ok: false, message: "Áudio vazio." }, 400);
  const result = await env.AI.run(STT_MODEL, {
    audio: toBase64(buffer),
    task: "transcribe",
    language: "pt",
    vad_filter: true,
    condition_on_previous_text: false,
  });
  const text = String(result?.text || result?.transcription_info?.text || "").trim();
  return json({ ok: true, text, language: "pt-BR", model: STT_MODEL });
}

async function tts(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const text = String(body?.text || "").trim().slice(0, 5000);
  if (!text) return json({ ok: false, message: "Texto vazio." }, 400);

  // Explicit Portuguese target. Cloudflare's MeloTTS schema uses "lang".
  // We do NOT fall back to Aura-1 here because an English-only/English-accent
  // server fallback is worse than the browser's native pt-BR voice.
  try {
    const raw = await env.AI.run(
      TTS_MODEL,
      { prompt: text, lang: "pt" },
      { returnRawResponse: true },
    );

    if (raw instanceof Response && raw.ok && raw.body) {
      const headers = new Headers(raw.headers);
      if (!headers.get("Content-Type")) headers.set("Content-Type", "audio/mpeg");
      headers.set("Cache-Control", "no-store");
      headers.set("X-FNS-TTS-Provider", "melotts");
      headers.set("X-FNS-TTS-Language", "pt-BR");
      return new Response(raw.body, { status: 200, headers });
    }
  } catch {}

  return json({
    ok: false,
    browser_fallback: true,
    language: "pt-BR",
    message: "TTS do servidor sem voz portuguesa confiável; usar voz natural pt-BR do navegador.",
  }, 503, {
    "X-FNS-TTS-Language": "pt-BR",
    "X-FNS-TTS-Provider": "browser-pt-BR",
  });
}
async function status(env) {
  const missing = [];
  if (!env.AI) missing.push("AI");
  if (!env.LIBRARY) missing.push("LIBRARY");
  if (!env.PDFS) missing.push("PDFS");
  let documents = null, chunks = null, memoryMessages = null, ready = false;
  if (!missing.length) {
    try {
      const st = await libraryCall(env, "/status");
      documents = Number(st.documents || 0);
      chunks = Number(st.chunks || 0);
      memoryMessages = Number(st.memory_messages || 0);
      ready = st.ok === true;
    } catch {}
  }
  return {
    ok: ready,
    service: "Consciência do Fabiano",
    version: VERSION,
    architecture: "cloudflare-native",
    storage_backend: "r2-originals+durable-object-sqlite",
    pdf_storage: "r2",
    r2_binding: "PDFS",
    vector_backend: "durable-object-cosine",
    render_dependency: false,
    bindings_missing: missing,
    documents, chunks, memory_messages: memoryMessages,
    embedding_model: EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
    stt_model: null,
    tts_model: null,
    voice_stack: "web-speech-api",
    voice_language: "pt-BR",
    backend_stt_tts_enabled: false,
    rag_streaming: "sse",
    asynchronous_indexing: true,
    background_executor: "durable-object-alarm",
    trigger_index_route: "/api/trigger-index",
    admin_auth: "native-password",
    direct_r2_upload: true,
    upload_body_limit_bypassed: true,
  };
}

async function handleApi(request, env, url, ctx) {
  try {
    const privateStatus = url.pathname === "/api/status" && Boolean(url.searchParams.get("document_id"));
    if ((url.pathname.startsWith("/api/admin/") || url.pathname === "/api/trigger-index" || privateStatus) && !(await adminAuthorized(request, env))) {
      return json({ ok: false, code: "AUTH_REQUIRED", message: "Acesso administrativo privado." }, 401);
    }
    if (url.pathname === "/api/status" && request.method === "GET") {
      const documentId = String(url.searchParams.get("document_id") || "").trim();
      if (documentId) return json(await indexJobStatus(env, documentId));
      return json(await status(env));
    }
    if (url.pathname === "/api/admin/session" && request.method === "GET") {
      return json({ ok: true, auth: "native-password" });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return chat(request, env, ctx);
    if (url.pathname === "/api/memory" && request.method === "GET") {
      const ownerId = await memoryOwner(request);
      if (!ownerId) return json({ ok: false, message: "Chave de memória ausente." }, 400);
      const messages = await readPersistentHistory(env, ownerId, MAX_SERVER_HISTORY);
      return json({ ok: true, messages, total: messages.length, persistent: true });
    }
    if (url.pathname === "/api/memory/clear" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const ownerId = await memoryOwner(request, body);
      if (!ownerId) return json({ ok: false, message: "Chave de memória ausente." }, 400);
      return json(await clearPersistentHistory(env, ownerId));
    }
    if ((url.pathname === "/api/stt" || url.pathname === "/api/tts") && request.method === "POST") {
      return json({
        ok: false,
        code: "CLIENT_SIDE_VOICE_ONLY",
        message: "STT e TTS rodam no navegador via Web Speech API.",
        language: "pt-BR",
      }, 410);
    }

    if (url.pathname === "/api/admin/direct-upload-ticket" && request.method === "POST") {
      return await createDirectUploadTicket(request, env);
    }
    if (url.pathname === "/api/trigger-index" && request.method === "POST") {
      return await triggerIndexBackground(request, env, ctx);
    }
    if (url.pathname === "/api/admin/index-r2" && request.method === "POST") {
      return await indexDirectUpload(request, env);
    }
    if (url.pathname === "/api/admin/upload-pdf" && request.method === "POST") {
      return await uploadPdf(request, env);
    }
    if (url.pathname === "/api/admin/livros" && request.method === "GET") {
      return json(await listBooks(env));
    }
    if (url.pathname === "/api/admin/r2-object" && request.method === "GET") {
      return await r2ObjectStatus(request, env, url);
    }
    if (url.pathname === "/api/admin/delete-pdf" && request.method === "POST") {
      return await deletePdf(request, env);
    }
    if (url.pathname === "/api/admin/reindex" && request.method === "POST") {
      return await reindexLibrary(request, env);
    }

    return json({ ok: false, message: "Rota não encontrada." }, 404);
  } catch (error) {
    return json({
      ok: false,
      code: error?.code || "INTERNAL_ERROR",
      message: String(error?.message || error),
    }, error?.code === "BINDINGS_MISSING" ? 503 : 500);
  }
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0, y = Number(b[i]) || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return (!na || !nb) ? -1 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

class AsyncItemQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) throw new Error("Fila de chunks já encerrada.");
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  async take() {
    if (this.items.length) return this.items.shift();
    if (this.closed) return null;
    return new Promise(resolve => this.waiters.push(resolve));
  }

  close() {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()(null);
  }
}

async function embedOneWithRetry(env, text) {
  let lastError = null;
  for (let attempt = 0; attempt < EMBEDDING_RETRIES; attempt++) {
    try {
      const vectors = await embedTexts(env, [text]);
      const vector = vectors?.[0];
      if (!Array.isArray(vector) || !vector.length) throw new Error("Embedding vazio.");
      return vector;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= EMBEDDING_RETRIES) break;
      const backoff = Math.min(2400, 150 * (2 ** attempt)) + Math.floor(Math.random() * 120);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw lastError || new Error("Falha ao gerar embedding.");
}

async function extractPdfPageText(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items || []) {
      if (!item || typeof item.str !== "string") continue;
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    try { page.cleanup?.(); } catch {}
  }
}

export class LibraryDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, title TEXT, author TEXT, language TEXT,
          sha256 TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL DEFAULT 0,
          page_count INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ready', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY, document_id TEXT NOT NULL, page INTEGER, chunk_index INTEGER NOT NULL,
          text TEXT NOT NULL, embedding TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS conversation_messages (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          sources TEXT NOT NULL DEFAULT '[]',
          fallback INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS index_jobs (
          document_id TEXT PRIMARY KEY,
          r2_key TEXT NOT NULL,
          filename TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'processing',
          chunks INTEGER NOT NULL DEFAULT 0,
          page_count INTEGER NOT NULL DEFAULT 0,
          duplicate_of TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_document_page ON chunks(document_id, page);
        CREATE INDEX IF NOT EXISTS idx_memory_owner_created ON conversation_messages(owner_id, created_at);
      `);

      for (const statement of [
        "ALTER TABLE index_jobs ADD COLUMN extracted_pages INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE index_jobs ADD COLUMN produced_chunks INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE index_jobs ADD COLUMN duration_ms INTEGER",
        "ALTER TABLE index_jobs ADD COLUMN started_at TEXT",
        "ALTER TABLE index_jobs ADD COLUMN finished_at TEXT"
      ]) {
        try { this.sql.exec(statement); } catch {}
      }
    });
  }

  async processPdfJob(payload) {
    const documentId = String(payload?.document_id || "").trim();
    const filename = safeName(payload?.filename || "");
    const objectKey = String(payload?.r2_key || "").trim();
    const expectedKey = r2ObjectKey(documentId, filename);
    const now = () => new Date().toISOString();

    const fail = async error => {
      const message = String(error?.message || error).slice(0, 1800);
      try {
        this.sql.exec("DELETE FROM chunks WHERE document_id = ?", documentId);
        this.sql.exec("UPDATE documents SET status = 'error', chunk_count = 0 WHERE id = ?", documentId);
        this.sql.exec(
          "UPDATE index_jobs SET status='error', error_message=?, updated_at=? WHERE document_id=?",
          message, now(), documentId
        );
      } catch {}
      return { ok: false, status: "error", message };
    };

    try {
      if (!documentId || !filename || !/\.pdf$/i.test(filename) || objectKey !== expectedKey) {
        throw new Error("Job de indexação inválido.");
      }

      this.sql.exec(
        "UPDATE index_jobs SET status='processing', error_message=NULL, updated_at=? WHERE document_id=?",
        now(), documentId
      );

      const object = await this.env.PDFS.get(objectKey);
      if (!object) throw new Error("O PDF não foi encontrado no R2.");

      const buffer = await object.arrayBuffer();
      const digest = await sha256Buffer(buffer);

      const duplicate = [...this.sql.exec(
        "SELECT id,filename,title,author,language,page_count,chunk_count FROM documents WHERE sha256=? AND status='ready' AND id<>? LIMIT 1",
        digest, documentId
      )][0] || null;

      if (duplicate) {
        await this.env.PDFS.delete(objectKey).catch(() => {});
        this.sql.exec("DELETE FROM chunks WHERE document_id = ?", documentId);
        this.sql.exec("DELETE FROM documents WHERE id = ?", documentId);
        this.sql.exec(
          "UPDATE index_jobs SET status='duplicate', duplicate_of=?, chunks=?, page_count=?, error_message=NULL, updated_at=? WHERE document_id=?",
          duplicate.id, Number(duplicate.chunk_count || 0), Number(duplicate.page_count || 0), now(), documentId
        );
        return { ok: true, status: "duplicate", duplicate_of: duplicate.id };
      }

      const existingDoc = [...this.sql.exec("SELECT id FROM documents WHERE id=? LIMIT 1", documentId)][0];
      if (existingDoc) {
        this.sql.exec("DELETE FROM chunks WHERE document_id = ?", documentId);
        this.sql.exec(
          "UPDATE documents SET filename=?, title='', author='', language='unknown', sha256=?, size_bytes=?, page_count=0, chunk_count=0, status='processing' WHERE id=?",
          filename, digest, Number(object.size || payload?.size_bytes || buffer.byteLength || 0), documentId
        );
      } else {
        this.sql.exec(
          "INSERT INTO documents (id,filename,title,author,language,sha256,size_bytes,page_count,chunk_count,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          documentId, filename, "", "", "unknown", digest,
          Number(object.size || payload?.size_bytes || buffer.byteLength || 0), 0, 0, "processing", now()
        );
      }

      const markdown = await convertPdf(this.env, filename, buffer);
      const pages = splitPages(markdown);
      const metadata = parsePdfMetadata(markdown, filename);
      const language = detectLanguage(markdown);

      const chunkRows = [];
      let chunkIndex = 0;
      for (const page of pages) {
        for (const piece of chunkText(page.text)) {
          chunkRows.push({
            id: uuidCompact(),
            page: Number(page.page || 1),
            chunk_index: chunkIndex++,
            text: piece,
          });
        }
      }
      if (!chunkRows.length) throw new Error("Nenhum texto útil foi extraído do PDF.");

      const createdAt = now();
      let inserted = 0;
      const EMBED_BATCH = 8;
      for (let i = 0; i < chunkRows.length; i += EMBED_BATCH) {
        const group = chunkRows.slice(i, i + EMBED_BATCH);
        const vectors = await embedTexts(this.env, group.map(item => item.text));
        if (vectors.length !== group.length) {
          throw new Error("Quantidade de embeddings diferente da quantidade de trechos.");
        }

        for (let j = 0; j < group.length; j++) {
          const item = group[j];
          this.sql.exec(
            "INSERT INTO chunks (id,document_id,page,chunk_index,text,embedding,created_at) VALUES (?,?,?,?,?,?,?)",
            item.id, documentId, item.page, item.chunk_index, item.text,
            JSON.stringify(vectors[j] || []), createdAt
          );
          inserted++;
        }

        this.sql.exec(
          "UPDATE index_jobs SET chunks=?, page_count=?, updated_at=? WHERE document_id=?",
          inserted, pages.length, now(), documentId
        );
      }

      this.sql.exec(
        "UPDATE documents SET title=?, author=?, language=?, page_count=?, chunk_count=?, status='ready' WHERE id=?",
        metadata.title || filename, metadata.author || "", language || "unknown",
        pages.length, inserted, documentId
      );
      this.sql.exec(
        "UPDATE index_jobs SET status='ready', chunks=?, page_count=?, error_message=NULL, updated_at=? WHERE document_id=?",
        inserted, pages.length, now(), documentId
      );

      return {
        ok: true,
        status: "ready",
        document_id: documentId,
        arquivo: filename,
        chunks: inserted,
        paginas: pages.length,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async alarm() {
    const row = [...this.sql.exec(
      "SELECT document_id,r2_key,filename,size_bytes FROM index_jobs WHERE status='processing' ORDER BY updated_at DESC LIMIT 1"
    )][0] || null;

    if (!row) return;

    await this.processPdfJob({
      document_id: row.document_id,
      r2_key: row.r2_key,
      filename: row.filename,
      size_bytes: Number(row.size_bytes || 0),
    });

    const pending = [...this.sql.exec(
      "SELECT document_id FROM index_jobs WHERE status='processing' ORDER BY updated_at DESC LIMIT 1"
    )][0] || null;
    if (pending) await this.ctx.storage.setAlarm(Date.now() + 250);
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/queue-pdf" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const documentId = String(body?.document_id || "").trim();
        const filename = safeName(body?.filename || "");
        const r2Key = String(body?.r2_key || "").trim();
        if (!documentId || !filename || r2Key !== r2ObjectKey(documentId, filename)) {
          return json({ ok: false, message: "Job de indexação inválido." }, 400);
        }
        const now = new Date().toISOString();
        const existing = [...this.sql.exec("SELECT document_id,status FROM index_jobs WHERE document_id=? LIMIT 1", documentId)][0] || null;
        if (existing) {
          this.sql.exec(
            "UPDATE index_jobs SET r2_key=?, filename=?, size_bytes=?, status='processing', chunks=0, page_count=0, duplicate_of=NULL, error_message=NULL, updated_at=? WHERE document_id=?",
            r2Key, filename, Number(body?.size_bytes || 0), now, documentId
          );
        } else {
          this.sql.exec(
            "INSERT INTO index_jobs (document_id,r2_key,filename,size_bytes,status,chunks,page_count,duplicate_of,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            documentId, r2Key, filename, Number(body?.size_bytes || 0), "processing", 0, 0, null, null, now, now
          );
        }
        return json({ ok: true, status: "processing", document_id: documentId });
      }
      if (url.pathname === "/process-pdf" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const documentId = String(body?.document_id || "").trim();
        if (!documentId) return json({ ok: false, message: "document_id ausente." }, 400);
        await this.ctx.storage.setAlarm(Date.now() + 50);
        return json({
          ok: true,
          status: "processing",
          document_id: documentId,
          execution: "durable-object-alarm"
        }, 202);
      }
      if (url.pathname === "/job-status" && request.method === "GET") {
        const documentId = String(url.searchParams.get("document_id") || "").trim();
        const row = [...this.sql.exec(
          "SELECT document_id,r2_key,filename,size_bytes,status,chunks,page_count,duplicate_of,error_message,created_at,updated_at FROM index_jobs WHERE document_id=? LIMIT 1",
          documentId
        )][0] || null;
        if (!row) return json({ ok: false, status: "not_found", message: "Job de indexação não encontrado." }, 404);
        return json({
          ok: true,
          document_id: row.document_id,
          r2_key: row.r2_key,
          arquivo: row.filename,
          size_bytes: Number(row.size_bytes || 0),
          status: row.status,
          chunks: Number(row.chunks || 0),
          paginas: Number(row.page_count || 0),
          duplicate_of: row.duplicate_of || null,
          error: row.error_message || null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }
      if (url.pathname === "/status") {
        const d = [...this.sql.exec("SELECT COUNT(*) AS n FROM documents WHERE status='ready'")][0]?.n || 0;
        const c = [...this.sql.exec("SELECT COUNT(*) AS n FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.status='ready'")][0]?.n || 0;
        const m = [...this.sql.exec("SELECT COUNT(*) AS n FROM conversation_messages")][0]?.n || 0;
        return json({ ok: true, documents: Number(d), chunks: Number(c), memory_messages: Number(m) });
      }
      if (url.pathname === "/duplicate") {
        const sha = String(url.searchParams.get("sha") || "");
        const row = [...this.sql.exec("SELECT id, filename AS arquivo, status FROM documents WHERE sha256 = ? AND status='ready' LIMIT 1", sha)][0] || null;
        return json({ ok: true, document: row });
      }
      if (url.pathname === "/docs") {
        const rows = [...this.sql.exec(`
          SELECT id, filename AS arquivo, title AS titulo, author AS autor, language AS idioma,
                 page_count AS paginas, chunk_count AS chunks, size_bytes, status, created_at
          FROM documents WHERE status='ready' ORDER BY created_at DESC
        `)];
        return json({ ok: true, livros: rows, total: rows.length });
      }
      if (url.pathname === "/ingest" && request.method === "POST") {
        const body = await request.json();
        const d = body.document || {};
        const chunks = Array.isArray(body.chunks) ? body.chunks : [];
        const now = new Date().toISOString();
        this.sql.exec(
          "INSERT INTO documents (id,filename,title,author,language,sha256,size_bytes,page_count,chunk_count,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          d.id, d.filename, d.title || "", d.author || "", d.language || "unknown", d.sha256,
          Number(d.size_bytes || 0), Number(d.page_count || 0), Number(d.chunk_count || chunks.length), d.status || "ready", now
        );
        try {
          for (const c of chunks) {
            this.sql.exec(
              "INSERT INTO chunks (id,document_id,page,chunk_index,text,embedding,created_at) VALUES (?,?,?,?,?,?,?)",
              c.id, d.id, Number(c.page || 1), Number(c.chunk_index || 0), String(c.text || ""),
              JSON.stringify(c.embedding || []), now
            );
          }
        } catch (error) {
          this.sql.exec("DELETE FROM chunks WHERE document_id = ?", d.id);
          this.sql.exec("DELETE FROM documents WHERE id = ?", d.id);
          throw error;
        }
        return json({ ok: true, document_id: d.id, chunks: chunks.length });
      }
      if (url.pathname === "/delete" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const id = String(body.document_id || "").trim();
        const filename = String(body.arquivo || "").trim();
        let row = null;
        if (id) row = [...this.sql.exec("SELECT id, filename FROM documents WHERE id = ? LIMIT 1", id)][0] || null;
        if (!row && filename) row = [...this.sql.exec("SELECT id, filename FROM documents WHERE filename = ? LIMIT 1", filename)][0] || null;
        if (!row) return json({ ok: false, message: "Documento não encontrado." }, 404);
        this.sql.exec("DELETE FROM chunks WHERE document_id = ?", row.id);
        this.sql.exec("DELETE FROM documents WHERE id = ?", row.id);
        this.sql.exec("DELETE FROM index_jobs WHERE document_id = ?", row.id);
        return json({ ok: true, document_id: row.id, arquivo: row.filename });
      }
      if (url.pathname === "/chunks") {
        const id = String(url.searchParams.get("document_id") || "").trim();
        const rows = id
          ? [...this.sql.exec("SELECT id,document_id,page,chunk_index,text FROM chunks WHERE document_id = ? ORDER BY chunk_index", id)]
          : [...this.sql.exec("SELECT id,document_id,page,chunk_index,text FROM chunks ORDER BY created_at,chunk_index")];
        return json({ ok: true, chunks: rows });
      }
      if (url.pathname === "/embeddings" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const updates = Array.isArray(body.updates) ? body.updates : [];
        for (const u of updates) this.sql.exec("UPDATE chunks SET embedding = ? WHERE id = ?", JSON.stringify(u.embedding || []), u.id);
        return json({ ok: true, updated: updates.length });
      }
      if (url.pathname === "/memory/list" && request.method === "GET") {
        const ownerId = String(url.searchParams.get("owner_id") || "").trim();
        const limit = Math.max(1, Math.min(MAX_SERVER_HISTORY, Number(url.searchParams.get("limit") || MAX_SERVER_HISTORY)));
        if (!ownerId) return json({ ok: true, messages: [], total: 0 });
        const rows = [...this.sql.exec(
          "SELECT id, role, content, sources, fallback, created_at FROM conversation_messages WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
          ownerId, limit
        )].reverse().map(row => {
          let sources = [];
          try { sources = JSON.parse(row.sources || "[]"); } catch {}
          return {
            id: row.id,
            role: row.role,
            content: row.content,
            sources,
            fallback: Number(row.fallback || 0) === 1,
            ts: row.created_at,
          };
        });
        return json({ ok: true, messages: rows, total: rows.length });
      }
      if (url.pathname === "/memory/append" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const id = String(body.id || "").slice(0, 160);
        const ownerId = String(body.owner_id || "").slice(0, 128);
        const role = body.role === "assistant" ? "assistant" : "user";
        const content = String(body.content || "").slice(0, 12000);
        if (!id || !ownerId || !content) return json({ ok: false, message: "Mensagem de memória inválida." }, 400);
        this.sql.exec(
          "INSERT OR IGNORE INTO conversation_messages (id,owner_id,role,content,sources,fallback,created_at) VALUES (?,?,?,?,?,?,?)",
          id, ownerId, role, content, JSON.stringify(Array.isArray(body.sources) ? body.sources : []),
          body.fallback ? 1 : 0, new Date().toISOString()
        );
        this.sql.exec(
          "DELETE FROM conversation_messages WHERE owner_id = ? AND id NOT IN (SELECT id FROM conversation_messages WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?)",
          ownerId, ownerId, MAX_SERVER_HISTORY
        );
        return json({ ok: true });
      }
      if (url.pathname === "/memory/clear" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const ownerId = String(body.owner_id || "").slice(0, 128);
        if (!ownerId) return json({ ok: true, cleared: 0 });
        const before = [...this.sql.exec("SELECT COUNT(*) AS n FROM conversation_messages WHERE owner_id = ?", ownerId)][0]?.n || 0;
        this.sql.exec("DELETE FROM conversation_messages WHERE owner_id = ?", ownerId);
        return json({ ok: true, cleared: Number(before) });
      }
      if (url.pathname === "/search" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const query = Array.isArray(body.embedding) ? body.embedding : [];
        const topK = Math.max(1, Math.min(20, Number(body.top_k || 8)));
        const scanLimit = Math.max(50, Math.min(3000, Number(body.scan_limit || VECTOR_SCAN_LIMIT)));
        const rows = [...this.sql.exec(`
          SELECT c.id,c.document_id,c.page,c.chunk_index,c.text,c.embedding,
                 d.filename,d.title,d.author,d.language
          FROM chunks c JOIN documents d ON d.id=c.document_id
          WHERE d.status='ready' ORDER BY c.created_at DESC LIMIT ?
        `, scanLimit)];
        const matches = [];
        for (const row of rows) {
          let emb = [];
          try { emb = JSON.parse(row.embedding); } catch {}
          const score = cosine(query, emb);
          if (score > -1) matches.push({ ...row, embedding: undefined, score });
        }
        matches.sort((a,b) => b.score - a.score);
        return json({ ok: true, matches: matches.slice(0, topK), scanned: rows.length });
      }
      return json({ ok: false, message: "Rota interna não encontrada." }, 404);
    } catch (error) {
      return json({ ok: false, message: String(error?.message || error) }, 500);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json(await status(env));
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url, ctx);
    }

    if (url.pathname === "/" || url.pathname === "/admin") {
      const assetUrl = new URL("/index.html", request.url);
      const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
      const headers = securityHeaders(new Headers(response.headers));
      return new Response(response.body, { status: response.status, headers });
    }

    return env.ASSETS.fetch(request);
  }
};
