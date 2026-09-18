const VERSION = "1.1.0-cloudflare-native-do-memory";
const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const TTS_MODEL = "@cf/myshell-ai/melotts";
const TTS_FALLBACK_MODEL = "@cf/deepgram/aura-1";
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 250;
const TOP_K = 8;
const VECTOR_SCAN_LIMIT = 1800;
const MAX_SERVER_HISTORY = 40;
const OWNER_TOKEN_HASH = "37ae863d0508e0d693e26f73ae5db81e0c60747d3870c0f8c4498513ebd0c8cb";
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
  if (!env.AI) missing.push("AI");
  if (!env.LIBRARY) missing.push("LIBRARY");
  if (missing.length) {
    const err = new Error("Bindings ausentes: " + missing.join(", "));
    err.code = "BINDINGS_MISSING";
    throw err;
  }
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
  if (!token || token.length < 30) return false;
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

async function uploadPdf(request, env) {
  assertBindings(env);
  const form = await request.formData();
  const file = form.get("arquivo");
  if (!(file instanceof File)) return json({ ok: false, message: "PDF não enviado." }, 400);
  const filename = safeName(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(filename);
  if (!isPdf) return json({ ok: false, message: "Envie um arquivo PDF." }, 415);
  if (file.size <= 0) return json({ ok: false, message: "PDF vazio." }, 400);
  if (file.size > MAX_PDF_BYTES) return json({ ok: false, message: "PDF acima do limite atual de 25 MB." }, 413);

  const buffer = await file.arrayBuffer();
  const digest = await sha256Buffer(buffer);
  const duplicate = await libraryCall(env, "/duplicate?sha=" + encodeURIComponent(digest));
  if (duplicate.document) {
    return json({ ok: true, duplicate: true, ...duplicate.document, message: "Este PDF já existe na biblioteca." });
  }

  const markdown = await convertPdf(env, filename, buffer);
  const pages = splitPages(markdown);
  const metadata = parsePdfMetadata(markdown, filename);
  const language = detectLanguage(markdown);
  const documentId = uuidCompact();
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
    const vectors = await embedTexts(env, group.map(c => c.text));
    if (vectors.length !== group.length) throw new Error("Quantidade de embeddings diferente da quantidade de trechos.");
    group.forEach((c, idx) => { c.embedding = vectors[idx]; });
  }

  const document = {
    id: documentId, filename, title: metadata.title, author: metadata.author, language,
    sha256: digest, size_bytes: file.size, page_count: pages.length,
    chunk_count: chunks.length, status: "ready",
  };

  await libraryCall(env, "/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document, chunks }),
  });

  return json({
    ok: true, document_id: documentId, arquivo: filename, titulo: metadata.title,
    autor: metadata.author, idioma: language, paginas: pages.length, chunks: chunks.length,
    storage: "durable-object-sqlite",
  }, 201);
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

async function chat(request, env) {
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

  const result = await env.AI.run(CHAT_MODEL, {
    messages,
    temperature: 0.35,
    max_tokens: 1100,
  });

  const answer =
    result?.response ||
    result?.result?.response ||
    result?.choices?.[0]?.message?.content ||
    "Não consegui formular uma resposta agora.";

  const sources = uniqueSources(context);
  const fallback = context.length === 0;
  if (ownerId) {
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
    } catch {}
  }

  return json({
    ok: true,
    resposta: String(answer).trim(),
    fontes: sources,
    fallback,
    memory_persisted: Boolean(ownerId),
    provider: "cloudflare-native-do-rag",
    embedding_model: EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
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

  // MeloTTS may return JSON with base64 audio instead of a raw Response.
  try {
    const result = await env.AI.run(TTS_MODEL, { prompt: text, lang: "pt" });
    if (result?.audio && typeof result.audio === "string") {
      const binary = atob(result.audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Response(bytes, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-FNS-TTS-Provider": "melotts",
        },
      });
    }
    if (result instanceof ReadableStream) {
      return new Response(result, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-FNS-TTS-Provider": "melotts-stream",
        },
      });
    }
  } catch {}

  // Cloudflare-native fallback. Aura returns a raw audio response and avoids
  // falling back to the browser when MeloTTS has no Portuguese voice available.
  try {
    const raw = await env.AI.run(
      TTS_FALLBACK_MODEL,
      { text },
      { returnRawResponse: true },
    );
    if (raw instanceof Response && raw.ok && raw.body) {
      const headers = new Headers(raw.headers);
      if (!headers.get("Content-Type")) headers.set("Content-Type", "audio/mpeg");
      headers.set("Cache-Control", "no-store");
      headers.set("X-FNS-TTS-Provider", "aura-1");
      return new Response(raw.body, { status: 200, headers });
    }
  } catch {}

  return json({
    ok: false,
    message: "TTS nativo indisponível; o navegador continuará usando a voz pt-BR local.",
  }, 503);
}

async function status(env) {
  const missing = [];
  if (!env.AI) missing.push("AI");
  if (!env.LIBRARY) missing.push("LIBRARY");
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
    storage_backend: "durable-object-sqlite",
    vector_backend: "durable-object-cosine",
    render_dependency: false,
    bindings_missing: missing,
    documents, chunks, memory_messages: memoryMessages,
    embedding_model: EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
    stt_model: STT_MODEL,
    tts_model: TTS_MODEL,
  };
}

async function handleApi(request, env, url) {
  try {
    if (url.pathname.startsWith("/api/admin/") && !(await adminAuthorized(request, env))) {
      return json({ ok: false, code: "AUTH_REQUIRED", message: "Acesso administrativo privado." }, 401);
    }
    if (url.pathname === "/api/status" && request.method === "GET") {
      return json(await status(env));
    }
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
      return await uploadPdf(request, env);
    }
    if (url.pathname === "/api/admin/livros" && request.method === "GET") {
      return json(await listBooks(env));
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
        CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_document_page ON chunks(document_id, page);
        CREATE INDEX IF NOT EXISTS idx_memory_owner_created ON conversation_messages(owner_id, created_at);
      `);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/status") {
        const d = [...this.sql.exec("SELECT COUNT(*) AS n FROM documents")][0]?.n || 0;
        const c = [...this.sql.exec("SELECT COUNT(*) AS n FROM chunks")][0]?.n || 0;
        const m = [...this.sql.exec("SELECT COUNT(*) AS n FROM conversation_messages")][0]?.n || 0;
        return json({ ok: true, documents: Number(d), chunks: Number(c), memory_messages: Number(m) });
      }
      if (url.pathname === "/duplicate") {
        const sha = String(url.searchParams.get("sha") || "");
        const row = [...this.sql.exec("SELECT id, filename AS arquivo, status FROM documents WHERE sha256 = ? LIMIT 1", sha)][0] || null;
        return json({ ok: true, document: row });
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
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json(await status(env));
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
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
