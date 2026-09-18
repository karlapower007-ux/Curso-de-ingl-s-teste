const VERSION = "1.0.0-cloudflare-native";
const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const TTS_MODEL = "@cf/myshell-ai/melotts";
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 250;
const TOP_K = 8;

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
  if (!env.PDFS) missing.push("PDFS");
  if (!env.VECTORIZE) missing.push("VECTORIZE");
  if (!env.DB) missing.push("DB");
  if (missing.length) {
    const err = new Error("Bindings ausentes: " + missing.join(", "));
    err.code = "BINDINGS_MISSING";
    throw err;
  }
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

async function clearDocumentIndex(env, documentId) {
  const rows = await env.DB.prepare(
    "SELECT vector_id FROM chunks WHERE document_id = ? ORDER BY chunk_index"
  ).bind(documentId).all();
  const ids = (rows.results || []).map(r => r.vector_id).filter(Boolean);
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    if (batch.length) await env.VECTORIZE.deleteByIds(batch);
  }
  await env.DB.prepare("DELETE FROM chunks WHERE document_id = ?").bind(documentId).run();
}

async function indexDocument(env, documentId) {
  assertBindings(env);
  const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(documentId).first();
  if (!doc) throw new Error("Documento não encontrado no D1.");

  const object = await env.PDFS.get(doc.r2_key);
  if (!object) throw new Error("PDF original não encontrado no R2.");

  await env.DB.prepare(
    "UPDATE documents SET status='indexing', error=NULL, updated_at=datetime('now') WHERE id=?"
  ).bind(documentId).run();

  await clearDocumentIndex(env, documentId);

  try {
    const pdfBuffer = await object.arrayBuffer();
    const converted = await env.AI.toMarkdown(
      {
        name: doc.filename,
        blob: new Blob([pdfBuffer], { type: "application/pdf" }),
      },
      {
        conversionOptions: {
          pdf: { metadata: true },
          output: { format: "markdown" },
        },
      },
    );

    const result = Array.isArray(converted) ? converted[0] : converted;
    if (!result || result.format === "error" || !result.data) {
      throw new Error(result?.error || "Falha ao converter PDF para texto.");
    }

    const markdown = String(result.data);
    const pages = splitPages(markdown);
    const metadata = parsePdfMetadata(markdown, doc.filename);
    const language = detectLanguage(markdown);

    const chunks = [];
    let globalIndex = 0;
    for (const page of pages) {
      for (const piece of chunkText(page.text)) {
        chunks.push({
          id: uuidCompact(),
          document_id: documentId,
          page: page.page,
          chunk_index: globalIndex++,
          text: piece,
        });
      }
    }

    if (!chunks.length) throw new Error("Nenhum texto útil foi extraído do PDF.");

    for (let i = 0; i < chunks.length; i += 12) {
      const group = chunks.slice(i, i + 12);
      const vectors = await embedTexts(env, group.map(c => c.text));
      if (vectors.length !== group.length) {
        throw new Error("Quantidade de embeddings diferente da quantidade de trechos.");
      }

      const vectorRows = group.map((c, idx) => ({
        id: c.id,
        values: vectors[idx],
        metadata: {
          document_id: documentId,
          filename: doc.filename,
          title: metadata.title,
          author: metadata.author,
          language,
          page: c.page,
          chunk_index: c.chunk_index,
        },
      }));
      await env.VECTORIZE.upsert(vectorRows);

      const statements = group.map(c =>
        env.DB.prepare(
          `INSERT INTO chunks
           (id, document_id, vector_id, page, chunk_index, text, char_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(c.id, documentId, c.id, c.page, c.chunk_index, c.text, c.text.length)
      );
      if (statements.length) await env.DB.batch(statements);
    }

    await env.DB.prepare(
      `UPDATE documents
       SET title=?, author=?, language=?, page_count=?, chunk_count=?, status='ready',
           error=NULL, updated_at=datetime('now')
       WHERE id=?`
    ).bind(
      metadata.title,
      metadata.author,
      language,
      pages.length,
      chunks.length,
      documentId
    ).run();

    return {
      ok: true,
      document_id: documentId,
      arquivo: doc.filename,
      titulo: metadata.title,
      autor: metadata.author,
      idioma: language,
      paginas: pages.length,
      chunks: chunks.length,
    };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE documents SET status='error', error=?, updated_at=datetime('now') WHERE id=?"
    ).bind(String(error?.message || error).slice(0, 1200), documentId).run();
    throw error;
  }
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
  if (file.size > MAX_PDF_BYTES) {
    return json({ ok: false, message: "PDF acima do limite atual de 25 MB." }, 413);
  }

  const buffer = await file.arrayBuffer();
  const digest = await sha256Buffer(buffer);
  const duplicate = await env.DB.prepare("SELECT id, filename, status FROM documents WHERE sha256 = ?")
    .bind(digest).first();
  if (duplicate) {
    return json({
      ok: true,
      duplicate: true,
      document_id: duplicate.id,
      arquivo: duplicate.filename,
      status: duplicate.status,
      message: "Este PDF já existe na biblioteca.",
    });
  }

  const documentId = uuidCompact();
  const r2Key = `pdfs/${documentId}/${filename}`;
  await env.PDFS.put(r2Key, buffer, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { sha256: digest, originalName: filename },
  });

  try {
    await env.DB.prepare(
      `INSERT INTO documents
       (id, filename, r2_key, sha256, size_bytes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'uploaded', datetime('now'), datetime('now'))`
    ).bind(documentId, filename, r2Key, digest, file.size).run();

    return json(await indexDocument(env, documentId), 201);
  } catch (error) {
    try { await env.PDFS.delete(r2Key); } catch {}
    try { await env.DB.prepare("DELETE FROM documents WHERE id=?").bind(documentId).run(); } catch {}
    throw error;
  }
}

async function listBooks(env) {
  assertBindings(env);
  const rows = await env.DB.prepare(
    `SELECT id, filename AS arquivo, title AS titulo, author AS autor, language AS idioma,
            page_count AS paginas, chunk_count AS chunks, size_bytes, status, error,
            created_at, updated_at
     FROM documents
     ORDER BY created_at DESC`
  ).all();
  return {
    ok: true,
    livros: rows.results || [],
    total: (rows.results || []).length,
  };
}

async function deletePdf(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const id = String(body?.document_id || "").trim();
  const filename = String(body?.arquivo || "").trim();

  let doc = null;
  if (id) doc = await env.DB.prepare("SELECT * FROM documents WHERE id=?").bind(id).first();
  if (!doc && filename) doc = await env.DB.prepare("SELECT * FROM documents WHERE filename=?").bind(filename).first();
  if (!doc) return json({ ok: false, message: "Documento não encontrado." }, 404);

  await clearDocumentIndex(env, doc.id);
  await env.PDFS.delete(doc.r2_key);
  await env.DB.prepare("DELETE FROM documents WHERE id=?").bind(doc.id).run();
  return json({ ok: true, document_id: doc.id, arquivo: doc.filename });
}

async function reindexLibrary(request, env) {
  assertBindings(env);
  const body = await request.json().catch(() => ({}));
  const onlyId = String(body?.document_id || "").trim();
  const rows = onlyId
    ? { results: [await env.DB.prepare("SELECT * FROM documents WHERE id=?").bind(onlyId).first()].filter(Boolean) }
    : await env.DB.prepare("SELECT * FROM documents ORDER BY created_at ASC").all();

  const results = [];
  for (const doc of rows.results || []) {
    try {
      results.push(await indexDocument(env, doc.id));
    } catch (error) {
      results.push({ ok: false, document_id: doc.id, arquivo: doc.filename, erro: String(error?.message || error) });
    }
  }
  return json({ ok: results.every(x => x.ok), resultados: results });
}

async function retrieveContext(env, question) {
  assertBindings(env);
  const qEmbedding = await embedTexts(env, [question]);
  const matches = await env.VECTORIZE.query(qEmbedding[0], {
    topK: TOP_K,
    returnValues: false,
    returnMetadata: "all",
  });

  const ids = (matches.matches || []).map(m => m.id).filter(Boolean);
  if (!ids.length) return [];

  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT c.id, c.vector_id, c.page, c.chunk_index, c.text,
            d.id AS document_id, d.filename, d.title, d.author, d.language
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE c.vector_id IN (${placeholders})`
  ).bind(...ids).all();

  const rowMap = new Map((rows.results || []).map(r => [r.vector_id, r]));
  return (matches.matches || [])
    .map(m => {
      const row = rowMap.get(m.id);
      return row ? { ...row, score: Number(m.score || 0) } : null;
    })
    .filter(Boolean);
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

  const history = Array.isArray(body?.historico) ? body.historico.slice(-20) : [];
  let context = [];
  try {
    context = await retrieveContext(env, question);
  } catch (error) {
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
        "Se não houver fonte documental suficiente, ainda pode usar conhecimento geral, mas declare claramente que essa parte não veio dos PDFs."
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

  return json({
    ok: true,
    resposta: String(answer).trim(),
    fontes: uniqueSources(context),
    fallback: context.length === 0,
    provider: "cloudflare-native-rag",
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

  try {
    const raw = await env.AI.run(
      TTS_MODEL,
      { prompt: text, lang: "pt" },
      { returnRawResponse: true },
    );
    if (raw instanceof Response) {
      const headers = new Headers(raw.headers);
      if (!headers.get("Content-Type")) headers.set("Content-Type", "audio/mpeg");
      headers.set("Cache-Control", "no-store");
      return new Response(raw.body, { status: raw.status, headers });
    }
    if (raw?.body) {
      return new Response(raw.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
    return json({ ok: false, message: "TTS não retornou áudio." }, 503);
  } catch (error) {
    return json({ ok: false, message: String(error?.message || error) }, 503);
  }
}

async function status(env) {
  const missing = [];
  if (!env.AI) missing.push("AI");
  if (!env.PDFS) missing.push("PDFS");
  if (!env.VECTORIZE) missing.push("VECTORIZE");
  if (!env.DB) missing.push("DB");

  let documents = null;
  let chunks = null;
  let ready = false;
  if (!missing.length) {
    try {
      const d = await env.DB.prepare("SELECT COUNT(*) AS n FROM documents").first();
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM chunks").first();
      documents = Number(d?.n || 0);
      chunks = Number(c?.n || 0);
      ready = true;
    } catch {}
  }

  return {
    ok: ready,
    service: "Consciência do Fabiano",
    version: VERSION,
    architecture: "cloudflare-native",
    render_dependency: false,
    bindings_missing: missing,
    documents,
    chunks,
    embedding_model: EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
    stt_model: STT_MODEL,
    tts_model: TTS_MODEL,
  };
}

async function handleApi(request, env, url) {
  try {
    if (url.pathname === "/api/status" && request.method === "GET") {
      return json(await status(env));
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return chat(request, env);
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
