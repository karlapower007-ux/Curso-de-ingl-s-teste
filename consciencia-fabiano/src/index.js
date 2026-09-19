const VERSION = "1.5.0-external-ai-groq-cohere";
// External AI bypass activation: Groq chat/STT + Cohere multilingual embeddings.
const EMBEDDING_MODEL = "embed-multilingual-v3.0";
const CHAT_MODEL = "openai/gpt-oss-20b";
const STT_MODEL = "whisper-large-v3-turbo";
const TTS_MODEL = "browser-local-pt-BR";
const MAX_TEXT_CHARS = 30_000_000;
const MAX_TEXT_BATCH_CHARS = 1_250_000;
const CHUNK_CONCURRENCY = 50;
const EMBED_CONCURRENCY = 50;
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 250;
const TOP_K = 8;
const VECTOR_SCAN_LIMIT = 1800;
const MAX_SERVER_HISTORY = 40;
const OWNER_TOKEN_HASH = "8205541ffbdb2d6ee4d000427b0d8a0bc70f657087ba43d95712eeef0a9609ed";
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
  if (!env.LIBRARY) missing.push("LIBRARY");
  if (missing.length) {
    const err = new Error("Bindings ausentes: " + missing.join(", "));
    err.code = "BINDINGS_MISSING";
    throw err;
  }
}

function requireSecret(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) {
    const err = new Error("Secret " + name + " ainda não configurado.");
    err.code = "EXTERNAL_AI_NOT_CONFIGURED";
    throw err;
  }
  return value;
}

async function sha256Text(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(text || ""))));
}

function rawToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return (request.headers.get("X-FNS-Owner-Token") || "").trim();
}

async function adminAuthorized(request, env) {
  const automation = (request.headers.get("X-FNS-Automation") || "").trim();
  if (env.AUTOMATION_SECRET && automation && automation === env.AUTOMATION_SECRET) return true;
  const token = rawToken(request);
  if (!token || token.length < 10) return false;
  return (await sha256Text(token)) === OWNER_TOKEN_HASH;
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

async function embedTexts(env, texts, inputType = "search_document") {
  const apiKey = requireSecret(env, "COHERE_API_KEY");
  const list = Array.from(texts || []).map(text => String(text || ""));
  if (!list.length) return [];
  const safeInputType = inputType === "search_query" ? "search_query" : "search_document";
  const res = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "X-Client-Name": "consciencia-fabiano",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      texts: list,
      input_type: safeInputType,
      embedding_types: ["float"],
      truncate: "END",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.message || body?.error?.message || ("Cohere embeddings HTTP " + res.status));
    err.status = res.status;
    throw err;
  }
  const vectors =
    body?.embeddings?.float ||
    body?.embeddings?.float_ ||
    (Array.isArray(body?.embeddings) ? body.embeddings : []);
  if (vectors.length !== list.length || vectors.some(v => !Array.isArray(v) || !v.length)) {
    throw new Error("Cohere não retornou todos os embeddings esperados.");
  }
  return vectors;
}

async function parallelMapLimit(items, limit, mapper) {
  const list = Array.from(items || []);
  if (!list.length) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit || 1), list.length));
  const results = new Array(list.length);
  let cursor = 0;
  const runners = Array.from({ length: safeLimit }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= list.length) return;
      results[index] = await mapper(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function isRateLimitError(error) {
  return /429|rate.?limit|too many requests|quota|overload|temporar/i.test(String(error?.message || error || ""));
}

async function embedOneWithRetry(env, text, maxAttempts = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const vectors = await embedTexts(env, [text]);
      if (!vectors?.[0]?.length) throw new Error("Embedding vazio.");
      return vectors[0];
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === maxAttempts) throw error;
      const delay = Math.min(8000, 300 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 350);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error("Falha ao gerar embedding.");
}

async function embedWaveBatchedWithRetry(env, chunks, maxAttempts = 5) {
  const list = Array.from(chunks || []);
  if (!list.length) return [];

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const vectors = await embedTexts(env, list.map(item => String(item?.text || "")));
      if (!Array.isArray(vectors) || vectors.length !== list.length || vectors.some(v => !Array.isArray(v) || !v.length)) {
        throw new Error("Lote de embeddings retornou quantidade inválida.");
      }
      return vectors;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const retryable = isRateLimitError(error) || /timeout|temporar|overload|unavailable/i.test(message);
      if (!retryable || attempt === maxAttempts) break;
      const delay = Math.min(12000, 500 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 350);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (list.length > 1) {
    const mid = Math.ceil(list.length / 2);
    const left = await embedWaveBatchedWithRetry(env, list.slice(0, mid), maxAttempts);
    const right = await embedWaveBatchedWithRetry(env, list.slice(mid), maxAttempts);
    return [...left, ...right];
  }

  return [await embedOneWithRetry(env, String(list[0]?.text || ""), maxAttempts)];
}

async function embedChunksBatched(env, chunks) {
  const list = Array.from(chunks || []);
  for (let offset = 0; offset < list.length; offset += EMBED_CONCURRENCY) {
    const batch = list.slice(offset, offset + EMBED_CONCURRENCY);
    const vectors = await embedWaveBatchedWithRetry(env, batch);
    for (let i = 0; i < batch.length; i++) batch[i].embedding = vectors[i];
  }
  return list;
}

async function matrixChunkPages(pageRows) {
  return parallelMapLimit(pageRows, CHUNK_CONCURRENCY, async row => {
    const page = Math.max(1, Number(row.page || 1));
    return chunkText(String(row.text || "")).map(text => ({ page, text }));
  });
}

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
}
function encodeR2Key(key) { return String(key).split("/").map(awsEncode).join("/"); }

async function hmacSha256(key, value) {
  const rawKey = typeof key === "string" ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(String(value))));
}
async function sha256HexValue(value) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(value)))); }
function amzTimestamp(date = new Date()) { return date.toISOString().replace(/[:-]|\.\d{3}/g, ""); }

async function presignR2Put(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return json({ ok:false, code:"R2_DIRECT_DISABLED", message:"Cofre R2 direto ainda não configurado. A indexação continua por texto sem enviar o PDF ao Worker." }, 503);
  }
  const filename = safeName(body?.filename || "documento.pdf");
  const bucket = "consciencia-fabiano-pdfs";
  const contentType = "application/pdf";
  const key = "originals/" + new Date().toISOString().slice(0,10) + "/" + uuidCompact() + "-" + filename;
  const host = String(env.R2_ACCOUNT_ID) + ".r2.cloudflarestorage.com";
  const canonicalUri = "/" + awsEncode(bucket) + "/" + encodeR2Key(key);
  const amzDate = amzTimestamp();
  const dateStamp = amzDate.slice(0,8);
  const scope = dateStamp + "/auto/s3/aws4_request";
  const signedHeaders = "content-type;host";
  const query = {
    "X-Amz-Algorithm":"AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256":"UNSIGNED-PAYLOAD",
    "X-Amz-Credential":String(env.R2_ACCESS_KEY_ID)+"/"+scope,
    "X-Amz-Date":amzDate,
    "X-Amz-Expires":"900",
    "X-Amz-SignedHeaders":signedHeaders
  };
  const canonicalQuery = Object.keys(query).sort().map(k => awsEncode(k)+"="+awsEncode(query[k])).join("&");
  const canonicalHeaders = "content-type:"+contentType+"\n"+"host:"+host+"\n";
  const canonicalRequest = ["PUT",canonicalUri,canonicalQuery,canonicalHeaders,signedHeaders,"UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256",amzDate,scope,await sha256HexValue(canonicalRequest)].join("\n");
  const kDate = await hmacSha256("AWS4"+String(env.R2_SECRET_ACCESS_KEY), dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = hex(await hmacSha256(kSigning, stringToSign));
  return json({
    ok:true,direct:true,
    upload_url:"https://"+host+canonicalUri+"?"+canonicalQuery+"&X-Amz-Signature="+signature,
    r2_key:key,bucket,content_type:contentType,expires_in:900
  });
}

function normalizeClientPages(rawPages) {
  if (!Array.isArray(rawPages)) return [];
  return rawPages.slice(0,10000).map((entry,index)=>({
    page:Math.max(1,Number(entry?.page || index+1)),
    text:String(entry?.text || "").replace(/\u0000/g,"").slice(0,700000)
  }));
}
function validateClientPageBatch(pages) {
  if (!pages.length) throw new Error("Nenhuma página recebida.");
  const chars = pages.reduce((n,p)=>n+p.text.length,0);
  if (chars > MAX_TEXT_BATCH_CHARS) throw new Error("Lote de texto acima do limite seguro.");
  return chars;
}

async function triggerIndex(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const mode = String(body?.mode || "inline").toLowerCase();

  if (mode === "start") {
    const jobId = String(body?.job_id || uuidCompact()).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,120) || uuidCompact();
    const sha = String(body?.content_sha256 || "").toLowerCase().replace(/[^0-9a-f]/g,"").slice(0,64);
    if (sha.length !== 64) return json({ok:false,message:"SHA-256 do PDF ausente ou inválido."},400);
    const started = await libraryCall(env,"/jobs/text-start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      id:jobId, filename:safeName(body?.filename || "documento.pdf"),
      size_bytes:Math.max(0,Number(body?.size_bytes || 0)),
      page_count:Math.max(1,Math.min(10000,Number(body?.page_count || 1))),
      title:String(body?.title || "").slice(0,500),
      author:String(body?.author || "").slice(0,500),
      content_sha256:sha,
      original_r2_key:String(body?.original_r2_key || "").slice(0,700)
    })});
    return json({ok:true,accepted:true,job_id:jobId,status:started.status || "receiving",client_extraction:true},201);
  }

  if (mode === "append") {
    const jobId=String(body?.job_id || "").trim();
    if(!jobId) return json({ok:false,message:"job_id ausente."},400);
    const pages=normalizeClientPages(body?.pages); validateClientPageBatch(pages);
    return json(await libraryCall(env,"/jobs/text-append",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:jobId,pages})}));
  }

  if (mode === "commit") {
    const jobId=String(body?.job_id || "").trim();
    if(!jobId) return json({ok:false,message:"job_id ausente."},400);
    const committed=await libraryCall(env,"/jobs/text-commit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:jobId})});
    return json({ok:true,accepted:true,job_id:jobId,status:committed.status || "queued",client_extraction:true},202);
  }

  if (mode === "inline") {
    const pages=normalizeClientPages(body?.pages);
    const chars=pages.reduce((n,p)=>n+p.text.length,0);
    if(!pages.length || !chars) return json({ok:false,message:"Texto extraído vazio."},400);
    if(chars>MAX_TEXT_BATCH_CHARS) return json({ok:false,code:"USE_BATCHED_TEXT",message:"Documento grande: use start/append/commit."},413);
    const sha=String(body?.content_sha256 || "").toLowerCase().replace(/[^0-9a-f]/g,"").slice(0,64);
    if(sha.length!==64) return json({ok:false,message:"SHA-256 do PDF ausente ou inválido."},400);
    const jobId=uuidCompact();
    await libraryCall(env,"/jobs/text-start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      id:jobId,filename:safeName(body?.filename || "documento.pdf"),size_bytes:Math.max(0,Number(body?.size_bytes || 0)),
      page_count:pages.length,title:String(body?.title || "").slice(0,500),author:String(body?.author || "").slice(0,500),
      content_sha256:sha,original_r2_key:String(body?.original_r2_key || "").slice(0,700)
    })});
    await libraryCall(env,"/jobs/text-append",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:jobId,pages})});
    await libraryCall(env,"/jobs/text-commit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:jobId})});
    return json({ok:true,accepted:true,job_id:jobId,status:"queued",client_extraction:true},202);
  }
  return json({ok:false,message:"Modo de indexação inválido."},400);
}

async function indexStatus(env,url) {
  assertBindings(env);
  const jobId=String(url.searchParams.get("job_id") || "").trim();
  if(!jobId) return json({ok:false,message:"job_id ausente."},400);
  return json(await libraryCall(env,"/jobs/status?job_id="+encodeURIComponent(jobId)));
}

async function listBooks(env) {
  assertBindings(env);
  return libraryCall(env, "/docs");
}

async function deletePdf(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  return json(await libraryCall(env, "/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: String(body?.document_id || ""),
      arquivo: String(body?.arquivo || ""),
    }),
  }));
}

async function reindexLibrary(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const onlyId = String(body?.document_id || "").trim();
  const data = await libraryCall(env, "/chunks" + (onlyId ? ("?document_id=" + encodeURIComponent(onlyId)) : ""));
  const chunks = Array.isArray(data.chunks) ? data.chunks : [];
  await embedChunksBatched(env, chunks);
  for (let i = 0; i < chunks.length; i += 36) {
    const group = chunks.slice(i, i + 36);
    await libraryCall(env, "/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: group.map(c => ({ id: c.id, embedding: c.embedding })) }),
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
  const qEmbedding = await embedTexts(env, [question], "search_query");
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

async function persistChatTurn(env, ownerId, body, question, answer, sources, fallback) {
  if (!ownerId) return false;
  const turnId = String(body?.turn_id || crypto.randomUUID()).slice(0, 120);
  try {
    await appendPersistentMessage(env, {
      id: turnId + ":u",
      owner_id: ownerId,
      role: "user",
      content: question.slice(0, 8000),
      sources: [],
      fallback: false,
    });
    await appendPersistentMessage(env, {
      id: turnId + ":a",
      owner_id: ownerId,
      role: "assistant",
      content: String(answer).trim().slice(0, 12000),
      sources,
      fallback,
    });
    return true;
  } catch {
    return false;
  }
}

async function groqCompletion(env, messages, stream = false) {
  const apiKey = requireSecret(env, "GROQ_API_KEY");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: 0.35,
      max_completion_tokens: 1100,
      stream,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error?.message || ("Groq chat HTTP " + res.status));
    err.status = res.status;
    throw err;
  }
  return res;
}

function sseFrame(event, payload) {
  return "event: " + event + "\n" + "data: " + JSON.stringify(payload) + "\n\n";
}

async function groqStreamResponse(env, messages, meta) {
  const upstream = await groqCompletion(env, messages, true);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      let pending = "";
      let answer = "";
      try {
        controller.enqueue(encoder.encode(sseFrame("meta", {
          fontes: meta.sources,
          fallback: meta.fallback,
          provider: "groq+cohere-rag",
          embedding_model: EMBEDDING_MODEL,
          chat_model: CHAT_MODEL,
        })));
        const reader = upstream.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            const line = frame.split("\n").find(x => x.startsWith("data:"));
            if (!line) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            const packet = JSON.parse(raw);
            const delta = packet?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              answer += delta;
              controller.enqueue(encoder.encode(sseFrame("delta", { text: delta })));
            }
          }
        }
        const memoryPersisted = await persistChatTurn(
          env, meta.ownerId, meta.body, meta.question, answer, meta.sources, meta.fallback
        );
        controller.enqueue(encoder.encode(sseFrame("done", {
          ok: true,
          resposta: answer,
          fontes: meta.sources,
          fallback: meta.fallback,
          memory_persisted: memoryPersisted,
          provider: "groq+cohere-rag",
          embedding_model: EMBEDDING_MODEL,
          chat_model: CHAT_MODEL,
        })));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode(sseFrame("error", {
          message: String(error?.message || error),
          code: error?.code || "STREAM_ERROR",
        })));
        controller.close();
      }
    }
  });
  return new Response(stream, {
    headers: securityHeaders(new Headers({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    })),
  });
}

async function chat(request, env) {
  assertBindings(env);
  requireSecret(env, "GROQ_API_KEY");
  requireSecret(env, "COHERE_API_KEY");
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
  } catch (error) {
    if (error?.code === "EXTERNAL_AI_NOT_CONFIGURED") throw error;
    context = [];
  }

  const contextText = context.length
    ? context.map((c, i) =>
        `[F${i + 1}] ${c.title || c.filename}${c.author ? " — " + c.author : ""}, página ${c.page || "não informada"}\n${c.text}`
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

  const sources = uniqueSources(context);
  const fallback = context.length === 0;
  const wantsStream =
    String(request.headers.get("Accept") || "").includes("text/event-stream") ||
    body?.stream === true;

  if (wantsStream) {
    return groqStreamResponse(env, messages, { ownerId, body, question, sources, fallback });
  }

  const result = await (await groqCompletion(env, messages, false)).json();
  const answer = String(result?.choices?.[0]?.message?.content || "Não consegui formular uma resposta agora.").trim();
  const memoryPersisted = await persistChatTurn(env, ownerId, body, question, answer, sources, fallback);

  return json({
    ok: true,
    resposta: answer,
    fontes: sources,
    fallback,
    memory_persisted: memoryPersisted,
    provider: "groq+cohere-rag",
    embedding_model: EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
  });
}

async function stt(request, env) {
  assertBindings(env);
  const apiKey = requireSecret(env, "GROQ_API_KEY");
  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) return json({ ok: false, message: "Áudio vazio." }, 400);
  const contentType = request.headers.get("Content-Type") || "audio/webm";
  const ext = contentType.includes("wav") ? "wav" : contentType.includes("mpeg") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), "voice." + ext);
  form.append("model", STT_MODEL);
  form.append("language", "pt");
  form.append("response_format", "json");
  form.append("temperature", "0");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ ok: false, message: data?.error?.message || ("Groq STT HTTP " + res.status) }, res.status);
  return json({ ok: true, text: String(data?.text || "").trim(), language: "pt-BR", model: STT_MODEL, provider: "groq" });
}

async function tts(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const text = String(body?.text || "").trim().slice(0, 5000);
  if (!text) return json({ ok: false, message: "Texto vazio." }, 400);
  return json({
    ok: false,
    code: "BROWSER_TTS",
    message: "TTS no servidor foi removido para zerar Workers AI. Use speechSynthesis pt-BR do navegador.",
    provider: TTS_MODEL,
  }, 503);
}

async function status(env) {
  const missing = [];
  if (!env.LIBRARY) missing.push("LIBRARY");
  if (!env.GROQ_API_KEY) missing.push("GROQ_API_KEY");
  if (!env.COHERE_API_KEY) missing.push("COHERE_API_KEY");
  let documents = null, chunks = null, memoryMessages = null, indexJobs = null, ready = false;
  if (!missing.length) {
    try {
      const st = await libraryCall(env, "/status");
      documents = Number(st.documents || 0);
      chunks = Number(st.chunks || 0);
      memoryMessages = Number(st.memory_messages || 0);
      indexJobs = Number(st.index_jobs || 0);
      ready = st.ok === true;
    } catch {}
  }
  return {
    ok: ready,
    service: "Consciência do Fabiano",
    version: VERSION,
    architecture: "cloudflare-router-external-ai",
    storage_backend: "durable-object-sqlite",
    pdf_storage: (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) ? "r2-direct-presigned" : "r2-direct-not-configured",
    ingest_backend: "client-pdfjs-matrix-50x50-cohere",
    client_pdf_extraction: "pdf.js",
    server_pdf_parsing: false,
    chunk_concurrency_limit: CHUNK_CONCURRENCY,
    embedding_concurrency_limit: EMBED_CONCURRENCY,
    r2_direct_ready: Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY),
    vector_backend: "durable-object-cosine",
    llm_provider: "groq",
    embedding_provider: "cohere",
    workers_ai_used: false,
    render_dependency: false,
    bindings_missing: missing,
    documents, chunks, memory_messages: memoryMessages, index_jobs: indexJobs,
    embedding_model: EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
    stt_model: STT_MODEL,
    tts_model: TTS_MODEL,
  };
}

async function handleApi(request, env, url, ctx) {
  try {
    const privateIndexRoute =
      url.pathname.startsWith("/api/admin/") ||
      url.pathname === "/api/trigger-index" ||
      url.pathname === "/api/index-status";

    if (privateIndexRoute && !(await adminAuthorized(request, env))) {
      return json({ ok: false, code: "AUTH_REQUIRED", message: "Acesso administrativo privado." }, 401);
    }
    if (url.pathname === "/api/status" && request.method === "GET") return json(await status(env));
    if (url.pathname === "/api/chat" && request.method === "POST") return chat(request, env);
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
    if (url.pathname === "/api/stt" && request.method === "POST") return stt(request, env);
    if (url.pathname === "/api/tts" && request.method === "POST") return tts(request, env);
    if (url.pathname === "/api/admin/upload-pdf" && request.method === "POST") {
      return json({ok:false,code:"CLIENT_EXTRACTION_REQUIRED",message:"Binário PDF desativado. Extraia no navegador com pdf.js e envie somente texto para /api/trigger-index."},410);
    }
    if (url.pathname === "/api/admin/r2-presign" && request.method === "POST") return presignR2Put(request, env);
    if (url.pathname === "/api/trigger-index" && request.method === "POST") return triggerIndex(request, env);
    if (url.pathname === "/api/index-status" && request.method === "GET") return indexStatus(env, url);
    if (url.pathname === "/api/admin/livros" && request.method === "GET") return json(await listBooks(env));
    if (url.pathname === "/api/admin/delete-pdf" && request.method === "POST") return await deletePdf(request, env);
    if (url.pathname === "/api/admin/reindex" && request.method === "POST") return await reindexLibrary(request, env);
    return json({ ok: false, message: "Rota não encontrada." }, 404);
  } catch (error) {
    return json({
      ok: false,
      code: error?.code || "INTERNAL_ERROR",
      message: String(error?.message || error),
    }, ["BINDINGS_MISSING","EXTERNAL_AI_NOT_CONFIGURED"].includes(error?.code) ? 503 : 500);
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
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'pdf-index',
          storage_key TEXT NOT NULL,
          filename TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'queued',
          progress INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          document_id TEXT,
          pages INTEGER NOT NULL DEFAULT 0,
          chunks INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS job_text_pages (
          job_id TEXT NOT NULL,
          page INTEGER NOT NULL,
          text TEXT NOT NULL,
          PRIMARY KEY(job_id, page)
        );
        CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_document_page ON chunks(document_id, page);
        CREATE INDEX IF NOT EXISTS idx_memory_owner_created ON conversation_messages(owner_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_index_jobs_status_updated ON index_jobs(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_job_text_pages_job ON job_text_pages(job_id, page);
      `);
      const jobColumns=[...this.sql.exec("PRAGMA table_info(index_jobs)")].map(row=>String(row.name || ""));
      const addJobColumn=(name,ddl)=>{if(!jobColumns.includes(name))this.sql.exec("ALTER TABLE index_jobs ADD COLUMN "+name+" "+ddl);};
      addJobColumn("expected_pages","INTEGER NOT NULL DEFAULT 0");
      addJobColumn("received_pages","INTEGER NOT NULL DEFAULT 0");
      addJobColumn("title","TEXT");
      addJobColumn("author","TEXT");
      addJobColumn("content_sha256","TEXT");
      addJobColumn("original_r2_key","TEXT");
      const docColumns=[...this.sql.exec("PRAGMA table_info(documents)")].map(row=>String(row.name || ""));
      if(!docColumns.includes("r2_key")) this.sql.exec("ALTER TABLE documents ADD COLUMN r2_key TEXT");
    });
  }

  updateJob(id, status, progress, error = null, documentId = null, pages = null, chunks = null) {
    this.sql.exec(
      "UPDATE index_jobs SET status=?, progress=?, error=?, document_id=COALESCE(?,document_id), pages=COALESCE(?,pages), chunks=COALESCE(?,chunks), updated_at=? WHERE id=?",
      status,
      Math.max(0, Math.min(100, Number(progress || 0))),
      error,
      documentId,
      pages,
      chunks,
      new Date().toISOString(),
      id
    );
  }

  cleanupJobText(jobId) { this.sql.exec("DELETE FROM job_text_pages WHERE job_id=?", jobId); }

  async processIndexJob(jobId) {
    const job=[...this.sql.exec("SELECT id,filename,size_bytes,status,attempts,expected_pages,received_pages,title,author,content_sha256,original_r2_key FROM index_jobs WHERE id=? LIMIT 1",jobId)][0];
    if(!job || ["ready","duplicate","failed","receiving"].includes(String(job.status))) return;
    const attempt=Number(job.attempts || 0)+1;
    this.sql.exec("UPDATE index_jobs SET status='processing',attempts=?,progress=18,error=NULL,updated_at=? WHERE id=?",attempt,new Date().toISOString(),jobId);
    let documentId=null;
    try {
      const digest=String(job.content_sha256 || "").trim();
      if(!/^[0-9a-f]{64}$/i.test(digest)) throw new Error("SHA-256 do documento inválido.");
      const duplicate=[...this.sql.exec("SELECT id,filename FROM documents WHERE sha256=? LIMIT 1",digest)][0] || null;
      if(duplicate){this.updateJob(jobId,"duplicate",100,null,duplicate.id);this.cleanupJobText(jobId);return;}

      const stats=[...this.sql.exec("SELECT COUNT(*) AS pages,COALESCE(SUM(LENGTH(text)),0) AS chars FROM job_text_pages WHERE job_id=?",jobId)][0] || {pages:0,chars:0};
      const actualPages=Number(stats.pages || 0), totalChars=Number(stats.chars || 0);
      if(!actualPages || !totalChars) throw new Error("Nenhum texto útil foi recebido do navegador.");
      const sample=[...this.sql.exec("SELECT text FROM job_text_pages WHERE job_id=? ORDER BY page LIMIT 8",jobId)].map(r=>String(r.text || "").slice(0,10000)).join("\n");
      const language=detectLanguage(sample);

      documentId=uuidCompact(); const now=new Date().toISOString();
      this.sql.exec("INSERT INTO documents (id,filename,title,author,language,sha256,size_bytes,page_count,chunk_count,status,created_at,r2_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        documentId,job.filename,String(job.title || ""),String(job.author || ""),language || "unknown",digest,Number(job.size_bytes || 0),actualPages,0,"indexing",now,String(job.original_r2_key || "") || null);

      let offset=0,chunkIndex=0,processedPages=0;
      while(offset<actualPages){
        const pageRows=[...this.sql.exec("SELECT page,text FROM job_text_pages WHERE job_id=? ORDER BY page LIMIT 50 OFFSET ?",jobId,offset)];
        if(!pageRows.length) break;
        const groups=await matrixChunkPages(pageRows);
        const wave=[];
        for(const group of groups) for(const piece of group) wave.push({id:uuidCompact(),page:piece.page,chunk_index:chunkIndex++,text:piece.text});
        for(let embedOffset=0;embedOffset<wave.length;embedOffset+=EMBED_CONCURRENCY){
          const batch=wave.slice(embedOffset,embedOffset+EMBED_CONCURRENCY);
          const embeddings=await embedWaveBatchedWithRetry(this.env,batch);
          for(let i=0;i<batch.length;i++){
            const chunk=batch[i];
            const embedding=embeddings[i];
            this.sql.exec("INSERT INTO chunks (id,document_id,page,chunk_index,text,embedding,created_at) VALUES (?,?,?,?,?,?,?)",
              chunk.id,documentId,chunk.page,chunk.chunk_index,chunk.text,JSON.stringify(embedding),now);
          }
        }
        processedPages+=pageRows.length; offset+=pageRows.length;
        const progress=18+Math.round((processedPages/Math.max(1,actualPages))*78);
        this.updateJob(jobId,"processing",Math.min(96,progress),null,documentId,actualPages,chunkIndex);
      }
      this.sql.exec("UPDATE documents SET chunk_count=?,status='ready' WHERE id=?",chunkIndex,documentId);
      this.updateJob(jobId,"ready",100,null,documentId,actualPages,chunkIndex);
      this.cleanupJobText(jobId);
    } catch(error) {
      if(documentId){this.sql.exec("DELETE FROM chunks WHERE document_id=?",documentId);this.sql.exec("DELETE FROM documents WHERE id=?",documentId);}
      const message=String(error?.message || error).slice(0,1500);
      if(attempt<3){
        this.sql.exec("UPDATE index_jobs SET status='queued',error=?,updated_at=? WHERE id=?",message,new Date().toISOString(),jobId);
        await this.ctx.storage.setAlarm(Date.now()+attempt*1800);
      } else this.updateJob(jobId,"failed",100,message);
    }
  }

  async alarm() {
    const job = [...this.sql.exec(
      "SELECT id FROM index_jobs WHERE status IN ('queued','processing') ORDER BY created_at LIMIT 1"
    )][0] || null;

    if (job?.id) await this.processIndexJob(job.id);

    const more = [...this.sql.exec(
      "SELECT id FROM index_jobs WHERE status IN ('queued','processing') ORDER BY created_at LIMIT 1"
    )][0] || null;
    if (more?.id) await this.ctx.storage.setAlarm(Date.now() + 750);
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/status") {
        const d = [...this.sql.exec("SELECT COUNT(*) AS n FROM documents")][0]?.n || 0;
        const c = [...this.sql.exec("SELECT COUNT(*) AS n FROM chunks")][0]?.n || 0;
        const m = [...this.sql.exec("SELECT COUNT(*) AS n FROM conversation_messages")][0]?.n || 0;
        const j = [...this.sql.exec("SELECT COUNT(*) AS n FROM index_jobs WHERE status IN ('queued','processing')")][0]?.n || 0;
        return json({ ok: true, documents: Number(d), chunks: Number(c), memory_messages: Number(m), index_jobs: Number(j) });
      }

      if (url.pathname === "/duplicate") {
        const sha = String(url.searchParams.get("sha") || "");
        const row = [...this.sql.exec("SELECT id, filename AS arquivo, status FROM documents WHERE sha256 = ? LIMIT 1", sha)][0] || null;
        return json({ ok: true, document: row });
      }

      if (url.pathname === "/jobs/upload" && request.method === "POST") {
        return json({ok:false,code:"CLIENT_EXTRACTION_REQUIRED",message:"PDF binário não é aceito pelo backend."},410);
      }
      if (url.pathname === "/jobs/text-start" && request.method === "POST") {
        const body=await request.json().catch(()=>({}));
        const id=String(body.id || "").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,120);
        const filename=safeName(body.filename || "documento.pdf");
        const expectedPages=Math.max(1,Math.min(10000,Number(body.page_count || 1)));
        const contentSha=String(body.content_sha256 || "").toLowerCase();
        if(!id || !/^[0-9a-f]{64}$/.test(contentSha)) return json({ok:false,message:"Job de texto inválido."},400);
        const now=new Date().toISOString();
        this.sql.exec("DELETE FROM job_text_pages WHERE job_id=?",id);
        this.sql.exec("DELETE FROM index_jobs WHERE id=?",id);
        this.sql.exec("INSERT INTO index_jobs (id,kind,storage_key,filename,size_bytes,status,progress,attempts,error,document_id,pages,chunks,created_at,updated_at,expected_pages,received_pages,title,author,content_sha256,original_r2_key) VALUES (?, 'client-text', ?, ?, ?, 'receiving', 1, 0, NULL, NULL, 0, 0, ?, ?, ?, 0, ?, ?, ?, ?)",
          id,"client://text/"+id,filename,Math.max(0,Number(body.size_bytes || 0)),now,now,expectedPages,String(body.title || "").slice(0,500),String(body.author || "").slice(0,500),contentSha,String(body.original_r2_key || "").slice(0,700));
        return json({ok:true,job_id:id,status:"receiving",expected_pages:expectedPages},201);
      }
      if (url.pathname === "/jobs/text-append" && request.method === "POST") {
        const body=await request.json().catch(()=>({})); const id=String(body.job_id || "").trim();
        const job=[...this.sql.exec("SELECT id,status,expected_pages FROM index_jobs WHERE id=? LIMIT 1",id)][0] || null;
        if(!job) return json({ok:false,message:"Job não encontrado."},404);
        if(job.status!=="receiving") return json({ok:false,message:"Job não está recebendo páginas."},409);
        const pages=normalizeClientPages(body.pages); validateClientPageBatch(pages);
        for(const page of pages) this.sql.exec("INSERT OR REPLACE INTO job_text_pages (job_id,page,text) VALUES (?,?,?)",id,page.page,page.text);
        const stats=[...this.sql.exec("SELECT COUNT(*) AS pages,COALESCE(SUM(LENGTH(text)),0) AS chars FROM job_text_pages WHERE job_id=?",id)][0] || {pages:0,chars:0};
        const received=Number(stats.pages || 0), totalChars=Number(stats.chars || 0);
        if(totalChars>MAX_TEXT_CHARS){this.sql.exec("DELETE FROM job_text_pages WHERE job_id=?",id);this.updateJob(id,"failed",100,"Texto extraído acima do limite de segurança.");return json({ok:false,message:"Texto extraído acima do limite de segurança."},413);}
        const expected=Math.max(1,Number(job.expected_pages || 1));
        const progress=Math.min(15,2+Math.round((received/expected)*13));
        this.sql.exec("UPDATE index_jobs SET received_pages=?,progress=?,updated_at=? WHERE id=?",received,progress,new Date().toISOString(),id);
        return json({ok:true,job_id:id,status:"receiving",received_pages:received,expected_pages:expected,chars_received:totalChars});
      }
      if (url.pathname === "/jobs/text-commit" && request.method === "POST") {
        const body=await request.json().catch(()=>({})); const id=String(body.job_id || "").trim();
        const row=[...this.sql.exec("SELECT id,status,expected_pages FROM index_jobs WHERE id=? LIMIT 1",id)][0] || null;
        if(!row) return json({ok:false,message:"Job não encontrado."},404);
        const received=Number([...this.sql.exec("SELECT COUNT(*) AS n FROM job_text_pages WHERE job_id=?",id)][0]?.n || 0);
        const expected=Math.max(1,Number(row.expected_pages || 1));
        if(received<expected) return json({ok:false,message:"Páginas incompletas: "+received+" de "+expected+"."},409);
        this.sql.exec("UPDATE index_jobs SET status='queued',received_pages=?,progress=16,error=NULL,updated_at=? WHERE id=?",received,new Date().toISOString(),id);
        await this.ctx.storage.sync(); await this.ctx.storage.setAlarm(Date.now()+200);
        return json({ok:true,job_id:id,status:"queued",received_pages:received,expected_pages:expected},202);
      }

      if (url.pathname === "/jobs/status" && request.method === "GET") {
        const id = String(url.searchParams.get("job_id") || "").trim();
        const row = [...this.sql.exec(
          "SELECT id AS job_id,filename AS arquivo,status,progress,attempts,error,document_id,pages AS paginas,chunks,expected_pages,received_pages,original_r2_key,created_at,updated_at FROM index_jobs WHERE id=? LIMIT 1",
          id
        )][0] || null;
        if (!row) return json({ ok: false, message: "Job não encontrado." }, 404);
        return json({ ok: true, ...row });
      }

      if (url.pathname === "/jobs/requeue" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const id = String(body.job_id || "").trim();
        const row = [...this.sql.exec("SELECT id,status FROM index_jobs WHERE id=? LIMIT 1", id)][0] || null;
        if (!row) return json({ ok: false, message: "Job não encontrado." }, 404);
        if (row.status !== "ready" && row.status !== "duplicate") {
          this.sql.exec("UPDATE index_jobs SET status='queued',error=NULL,updated_at=? WHERE id=?", new Date().toISOString(), id);
          await this.ctx.storage.setAlarm(Date.now() + 250);
        }
        return json({ ok: true, accepted: true, job_id: id, status: row.status === "ready" ? "ready" : "queued" });
      }

      if (url.pathname === "/docs") {
        const rows = [...this.sql.exec(`
          SELECT id, filename AS arquivo, title AS titulo, author AS autor, language AS idioma,
                 page_count AS paginas, chunk_count AS chunks, size_bytes, status, created_at
          FROM documents ORDER BY created_at DESC
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
            id: row.id, role: row.role, content: row.content, sources,
            fallback: Number(row.fallback || 0) === 1, ts: row.created_at,
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
