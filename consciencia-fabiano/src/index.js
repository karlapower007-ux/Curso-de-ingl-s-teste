import {strictParagraphMatch,deriveStrictPhrase,firstStrictAnchor,pushStrictHit,roundRobinStrictHits,STRICT_LOGICAL_TASK_CAP,STRICT_PER_DOCUMENT_HIT_CAP} from "../public/strict-match-core.js";
const VERSION = "7.1.0-fabiano-r2-cross-device";
// Xeque-Mate: Groq chat/STT + browser-local multilingual embeddings.
const EMBEDDING_MODEL = "embed-multilingual-v3.0";
const CHAT_MODEL = "openai/gpt-oss-20b";
const STT_MODEL = "whisper-large-v3-turbo";
const TTS_MODEL = "browser-local-pt-BR";
const MAX_TEXT_CHARS = 30_000_000;
const MAX_TEXT_BATCH_CHARS = 1_250_000;
const CHUNK_CONCURRENCY = 50;
const EMBED_CONCURRENCY = 50;
const COHERE_API_BATCH = 95;
const COHERE_THROTTLE_MS = 2200;
const INDEX_PAGE_SLICE = 180;
const INDEX_ALARM_DELAY_MS = 900;
const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 120;
const MIN_PAGE_LETTERS = 50;
const MIN_CHUNK_LETTERS = 35;
const searchConfig = Object.freeze({
  semantic_min_score: 0.38,
  top_k: 500,
  require_lexical_match: false,
});
const TOP_K = searchConfig.top_k;
const VECTOR_SCAN_LIMIT = 50000;
const SEMANTIC_MIN_SCORE = searchConfig.semantic_min_score;
const REQUIRE_LEXICAL_MATCH = searchConfig.require_lexical_match;
const LEXICAL_MIN_COVERAGE = 0.50;
const BM25_K1 = 1.35;
const BM25_B = 0.75;
const LOCAL_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const LOCAL_EMBEDDING_DIMENSIONS = 384;
const MAX_SERVER_HISTORY = 40;
const GROQ_HISTORY_MESSAGES = 6;
const GROQ_INPUT_BUDGET_TOKENS = 9000;
const GROQ_HISTORY_BUDGET_TOKENS = 900;
const GROQ_RAG_BUDGET_TOKENS = 6100;
const GROQ_MAX_COMPLETION_TOKENS = 2600;
const MAP_REDUCE_THRESHOLD = 20;
const MAP_BATCH_SIZE = 5;
const MICRO_NODE_COUNT = 20;
const MICRO_NODE_BATCH_SIZE = 5;

// V2.0 MASSIVE SCALE: 500 nós lógicos, no máximo 25 workers ativos por vez.
// Os nós de evidência são determinísticos e baratos; somente reducers + master usam Groq.
const MASSIVE_NODE_COUNT = 500;
const MASSIVE_WORKER_CONCURRENCY = 25;
const MASSIVE_NODE_GROUP_SIZE = 25;
const MASSIVE_GROQ_MAX_RETRIES = 3;
const MASSIVE_NODE_EVIDENCE_CHARS = 520;
const SSE_KEEPALIVE_MS = 15000;

// V2.1 EXACT MATCH TURBINES — 1000 nós lógicos, LLM bypass e defesa anti-sufocamento.
const EXACT_SWARM_NODE_COUNT = 1000;
const EXACT_MAX_CONCURRENT_REQUESTS = 50;
const EXACT_DEGRADED_CONCURRENCY = 25;
const EXACT_CIRCUIT_FAILURE_THRESHOLD = 3;
const EXACT_CIRCUIT_SLOW_MS = 5000;
const EXACT_CIRCUIT_BASE_PAUSE_MS = 3000;
const EXACT_MAX_RETRIES = 3;
const EXACT_MAX_CHUNKS = 1000;
const EXACT_REMOTE_PAGE_SIZE = 50;
const EXACT_CHUNK_OVERLAP_SCAN = 360;
const exactSupabaseCircuit = {
  failures: 0,
  open_until: 0,
  backoff_round: 0,
  degraded: false,
  last_reason: ""
};
const MICRO_NODE_RELAY_BUDGET_TOKENS = 5600;
const MICRO_NODE_MAX_COMPLETION_TOKENS = 520;
const MASTER_NODE_MAX_COMPLETION_TOKENS = 3600;
const MAP_MAX_COMPLETION_TOKENS = 1000;
const GROQ_AGGRESSIVE_INPUT_BUDGET_TOKENS = 3600;
const OWNER_TOKEN_HASH = "62e5283fda284aaec71832ab0aafc8161168a01989c1e94764a3076fa4237aa0";
const EMPTY_GROUNDED_ANSWER = "Nenhuma correspondência exata encontrada na biblioteca total.";
const RETRIEVAL_UNAVAILABLE_ANSWER = "A biblioteca continua cadastrada, mas os índices de busca estão temporariamente indisponíveis. Não vou tratar isso como ausência de conteúdo. Tente novamente em instantes; se houver índice local neste navegador, ele será usado automaticamente.";
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
  headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
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
  if (!env.PDFS) missing.push("PDFS");
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
  if (!token || token.length < 4) return false;
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

function cleanDocumentText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/^\s*(?:\d+|[ivxlcdm]+)\s*$/gim, " ")
    .replace(/^\s*[-–—_=]{3,}\s*$/gm, " ")
    .replace(/^.{0,140}\.{5,}\s*\d{1,5}\s*$/gm, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textQuality(text) {
  const clean = cleanDocumentText(text);
  const letters = (clean.match(/\p{L}/gu) || []).length;
  const digits = (clean.match(/\d/g) || []).length;
  const words = clean.match(/[\p{L}][\p{L}\p{M}'’-]{1,}/gu) || [];
  const unique = new Set(words.map(w => w.toLowerCase())).size;
  const lines = clean.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const numericLines = lines.filter(line => /^[\d\s.,;:()[\]{}+\-–—/\\]+$/.test(line)).length;
  const numberHeavy = digits > Math.max(80, letters * 0.9);
  const numericLineRatio = lines.length ? numericLines / lines.length : 1;
  return { clean, letters, digits, words: words.length, unique, numberHeavy, numericLineRatio };
}

function isUsefulPageText(text) {
  const q = textQuality(text);
  return q.letters >= MIN_PAGE_LETTERS &&
    q.words >= 16 &&
    q.unique >= 8 &&
    !q.numberHeavy &&
    q.numericLineRatio < 0.65;
}

function isUsefulChunkText(text) {
  const q = textQuality(text);
  return q.letters >= MIN_CHUNK_LETTERS &&
    q.words >= 7 &&
    q.unique >= 5 &&
    !q.numberHeavy &&
    q.numericLineRatio < 0.60;
}

function narrativeUnits(text) {
  const clean=cleanDocumentText(text)
    .replace(/\s+(?=\d{1,3}\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/g,"\n")
    .replace(/\n{3,}/g,"\n\n");
  const blocks=clean.split(/\n{2,}/).flatMap(block=>{
    const trimmed=block.trim();
    if(!trimmed) return [];
    if(trimmed.length<=CHUNK_CHARS) return [trimmed];
    return trimmed.split(/(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/).map(x=>x.trim()).filter(Boolean);
  });
  return blocks.filter(isUsefulChunkText);
}

function chunkText(text, maxChars = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = cleanDocumentText(text);
  if (!clean || !isUsefulPageText(clean)) return [];
  const units=narrativeUnits(clean);
  if(!units.length) return [];
  const out=[];
  const seen=new Set();
  let current="";
  for(const unit of units){
    const candidate=current ? current+" "+unit : unit;
    if(candidate.length<=maxChars){
      current=candidate;
      continue;
    }
    if(current && isUsefulChunkText(current)){
      const fp=current.toLowerCase().replace(/\s+/g," ").slice(0,650);
      if(!seen.has(fp)){seen.add(fp);out.push(current);}
    }
    const tail=current ? current.slice(Math.max(0,current.length-overlap)).replace(/^\S*\s*/,"") : "";
    current=(tail ? tail+" " : "")+unit;
    if(current.length>maxChars*1.35){
      const split=current.slice(0,maxChars).replace(/\s+\S*$/,"").trim();
      if(isUsefulChunkText(split)){
        const fp=split.toLowerCase().replace(/\s+/g," ").slice(0,650);
        if(!seen.has(fp)){seen.add(fp);out.push(split);}
      }
      current=current.slice(Math.max(0,split.length-overlap)).trim();
    }
  }
  if(current && isUsefulChunkText(current)){
    const fp=current.toLowerCase().replace(/\s+/g," ").slice(0,650);
    if(!seen.has(fp)) out.push(current);
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

async function cohereEmbedTexts(env, texts, inputType = "search_document") {
  const apiKey = requireSecret(env, "COHERE_API_KEY");
  const list = Array.from(texts || []).map(text => String(text || ""));
  if (!list.length) return [];
  if (list.length > COHERE_API_BATCH) {
    throw new Error("Lote Cohere acima do limite interno de " + COHERE_API_BATCH + " textos.");
  }
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
    if (res.status === 429 && /trial key|1000 api calls|month|monthly/i.test(String(err.message || ""))) {
      err.code = "COHERE_MONTHLY_QUOTA_EXHAUSTED";
    }
    const retryAfter = Number(res.headers.get("retry-after") || 0);
    if (retryAfter > 0) err.retryAfterMs = Math.min(120000, retryAfter * 1000);
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

const embeddingAdapter = {
  name: "cohere-api",
  model: EMBEDDING_MODEL,
  async embed(env, texts, inputType) {
    return cohereEmbedTexts(env, texts, inputType);
  },
};

async function generateEmbeddings(env, texts, inputType = "search_document") {
  return embeddingAdapter.embed(env, texts, inputType);
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
  return Number(error?.status || 0) === 429 ||
    /429|rate.?limit|too many requests|quota|overload|temporar/i.test(String(error?.message || error || ""));
}

function isMonthlyQuotaError(error) {
  return error?.code === "COHERE_MONTHLY_QUOTA_EXHAUSTED" ||
    (Number(error?.status || 0) === 429 && /trial key|1000 api calls|month|monthly/i.test(String(error?.message || "")));
}

function isPayloadSizeError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || error || "");
  return status === 413 || /payload|request too large|too many texts|input too large|length limit/i.test(message);
}

async function embedOneWithRetry(env, text, maxAttempts = 6) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const vectors = await generateEmbeddings(env, [text], "search_document");
      if (!vectors?.[0]?.length) throw new Error("Embedding vazio.");
      return vectors[0];
    } catch (error) {
      lastError = error;
      if (isMonthlyQuotaError(error)) throw error;
      const retryable = isRateLimitError(error) || /timeout|temporar|overload|unavailable|network|fetch|5\d\d/i.test(String(error?.message || error || ""));
      if (!retryable || attempt === maxAttempts) throw error;
      const serverDelay = Number(error?.retryAfterMs || 0);
      const delay = serverDelay || Math.min(45000, 1200 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 700);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error("Falha ao gerar embedding.");
}

async function embedWaveBatchedWithRetry(env, chunks, maxAttempts = 6) {
  const list = Array.from(chunks || []);
  if (!list.length) return [];

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const vectors = await generateEmbeddings(env, list.map(item => String(item?.text || "")), "search_document");
      if (!Array.isArray(vectors) || vectors.length !== list.length || vectors.some(v => !Array.isArray(v) || !v.length)) {
        throw new Error("Lote de embeddings retornou quantidade inválida.");
      }
      return vectors;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      if (isMonthlyQuotaError(error)) throw error;
      const retryable = isRateLimitError(error) || /timeout|temporar|overload|unavailable|network|fetch|5\d\d/i.test(message);

      // Critical bulletproof rule: never split a rate-limited batch into dozens of smaller API calls.
      if (retryable) {
        if (attempt === maxAttempts) throw error;
        const serverDelay = Number(error?.retryAfterMs || 0);
        const delay = serverDelay || Math.min(60000, 1800 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 900);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Split only when the provider explicitly rejects the payload size.
      if (isPayloadSizeError(error) && list.length > 1) {
        const mid = Math.ceil(list.length / 2);
        const left = await embedWaveBatchedWithRetry(env, list.slice(0, mid), maxAttempts);
        await new Promise(resolve => setTimeout(resolve, COHERE_THROTTLE_MS));
        const right = await embedWaveBatchedWithRetry(env, list.slice(mid), maxAttempts);
        return [...left, ...right];
      }
      throw error;
    }
  }
  throw lastError || new Error("Falha no lote de embeddings.");
}

async function embedChunksBatched(env, chunks) {
  const list = Array.from(chunks || []).filter(item => isUsefulChunkText(item?.text || ""));
  for (let offset = 0; offset < list.length; offset += COHERE_API_BATCH) {
    const batch = list.slice(offset, offset + COHERE_API_BATCH);
    const vectors = await embedWaveBatchedWithRetry(env, batch);
    for (let i = 0; i < batch.length; i++) batch[i].embedding = vectors[i];
    if (offset + COHERE_API_BATCH < list.length) {
      await new Promise(resolve => setTimeout(resolve, COHERE_THROTTLE_MS));
    }
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

async function localIngestStart(request, env) {
  assertBindings(env);
  const body=await request.json().catch(()=>({}));
  return json(await libraryCall(env,"/local/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
}
async function localIngestAppend(request, env) {
  assertBindings(env);
  const body=await request.json().catch(()=>({}));
  return json(await libraryCall(env,"/local/append",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
}
async function localIngestCommit(request, env) {
  assertBindings(env);
  const body=await request.json().catch(()=>({}));
  return json(await libraryCall(env,"/local/commit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
}
async function localVectorChunks(env, url) {
  assertBindings(env);
  const documentId=String(url.searchParams.get("document_id") || "").trim();
  const limit=Math.max(1,Math.min(48,Number(url.searchParams.get("limit") || 12)));
  return json(await libraryCall(env,"/local/chunks?document_id="+encodeURIComponent(documentId)+"&limit="+limit));
}
async function localVectorUpdate(request, env) {
  assertBindings(env);
  const body=await request.json().catch(()=>({}));
  return json(await libraryCall(env,"/local/embeddings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
}

async function reindexLibrary(request, env) {
  assertBindings(env);
  return json({ok:false,code:"LOCAL_EMBEDDINGS_REQUIRED",message:"Reindexação semântica agora é feita no navegador com Transformers.js e checkpoints locais."},409);
}

function foldSearchText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lexicalTokens(text) {
  return foldSearchText(text).split(" ").filter(token=>token.length>=2);
}

function semanticAnchorCoverage(text, question) {
  const terms=lexicalTerms(question);
  if(!terms.length) return 1;
  const folded=foldSearchText(text);
  const matched=terms.filter(term=>folded.includes(term)).length;
  return matched/terms.length;
}

function lexicalTerms(question) {
  const stop = new Set([
    "a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre",
    "para","por","com","como","qual","quais","fala","falar","quero","desejo","mostre","mostrar","saber","saiba","conhecer","conheca","informacao","informação",
    "versiculo","versículo","passagem","citacao","citação","referencia","referência","trecho","escritura",
    "the","and","of","to","in","is","what","about"
  ]);
  return [...new Set(foldSearchText(question).split(" ").filter(w => w.length >= 3 && !stop.has(w)))].slice(0, 18);
}

async function retrieveLexicalContext(env, question) {
  const terms = lexicalTerms(question);
  if (!terms.length) return [];
  const data = await libraryCall(env, "/search-lexical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: question, terms, top_k: TOP_K, scan_limit: VECTOR_SCAN_LIMIT }),
  });
  return Array.isArray(data.matches)
    ? data.matches.map(item => ({ ...item, retrieval_mode: "lexical-full-library" }))
    : [];
}

function supabaseLexicalConfigured(env) {
  return Boolean(
    String(env?.SUPABASE_URL || "").trim() &&
    String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_RAG_KEY || "").trim()
  );
}

async function retrieveSupabaseLexicalContext(env, question) {
  const base = String(env?.SUPABASE_URL || "").replace(/\/$/, "");
  const token = String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_RAG_KEY || "").trim();
  const terms = lexicalTerms(question).slice(0, 6);
  if (!base || !token || !terms.length) return [];

  const safeTerms = terms
    .map(term => foldSearchText(term).replace(/[,*()]/g, "").trim())
    .filter(Boolean);
  if (!safeTerms.length) return [];

  const endpoint = new URL(base + "/rest/v1/library_chunks");
  endpoint.searchParams.set("select", "id,document_id,filename,title,author,language,page,chunk_index,text");
  endpoint.searchParams.set("or", "(" + safeTerms.map(term => "text.ilike.*" + term + "*").join(",") + ")");
  endpoint.searchParams.set("limit", String(TOP_K));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + token,
        "apikey": token,
        "Accept": "application/json"
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error("Supabase lexical HTTP " + res.status);
      err.code = "SUPABASE_LEXICAL_FAILED";
      throw err;
    }
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
      const text = String(row?.text || "");
      const folded = foldSearchText(text);
      const matched = safeTerms.filter(term => folded.includes(term)).length;
      return {
        ...row,
        score: Math.max(0.01, matched / Math.max(1, safeTerms.length)),
        retrieval_mode: "supabase-lexical-fallback"
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseMirrorHasAnyRows(env) {
  const base = String(env?.SUPABASE_URL || "").replace(/\/$/, "");
  const token = String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_RAG_KEY || "").trim();
  if (!base || !token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const endpoint = base + "/rest/v1/library_chunks?select=id&limit=1";
    const res = await fetch(endpoint, {
      headers: {
        "Authorization": "Bearer " + token,
        "apikey": token,
        "Accept": "application/json"
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) ? rows.length > 0 : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mergeRetrievedMatches(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const item of (Array.isArray(group) ? group : [])) {
      const text = String(item?.text || item?.trecho || "").trim();
      if (!text) continue;
      const key =
        String(item?.id || "").trim() ||
        [
          String(item?.document_id || item?.filename || item?.title || ""),
          Number(item?.page || item?.pagina || 0),
          Number(item?.chunk_index || 0),
          foldSearchText(text).slice(0, 180)
        ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return diversifyContextAcrossDocuments(merged, TOP_K);
}

async function retrieveDurableStrictContext(env,question){
  const data=await libraryCall(env,"/search-strict",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({query:String(question||""),top_k:STRICT_LOGICAL_TASK_CAP})
  });
  return {
    matches:Array.isArray(data?.matches)?data.matches:[],
    readable:true,
    scanned:Number(data?.scanned||0),
    documents_hit:Number(data?.documents_hit||0)
  };
}

async function retrieveSupabaseStrictContext(env,question){
  const base=String(env?.SUPABASE_URL||"").replace(/\/$/,"");
  const token=String(env?.SUPABASE_SERVICE_ROLE_KEY||env?.SUPABASE_RAG_KEY||"").trim();
  const target=deriveStrictPhrase(question);
  const anchor=firstStrictAnchor(question);
  if(!base||!token||!target||!anchor)return {matches:[],readable:false,scanned:0,documents_hit:0};
  const perDocument=new Map();
  let offset=0,scanned=0;
  const pageSize=200;
  while(true){
    const endpoint=new URL(base+"/rest/v1/library_chunks");
    endpoint.searchParams.set("select","id,document_id,filename,title,author,language,page,chunk_index,text,content_hash,updated_at");
    endpoint.searchParams.set("text","ilike.*"+anchor.replace(/[,*()]/g,"")+"*");
    endpoint.searchParams.set("order","document_id.asc,chunk_index.asc");
    endpoint.searchParams.set("limit",String(pageSize));
    endpoint.searchParams.set("offset",String(offset));
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    let rows=[];
    try{
      const res=await fetch(endpoint.toString(),{
        headers:{"Authorization":"Bearer "+token,"apikey":token,"Accept":"application/json"},
        signal:controller.signal
      });
      if(!res.ok)throw new Error("Supabase strict HTTP "+res.status);
      rows=await res.json().catch(()=>[]);
      if(!Array.isArray(rows))rows=[];
    }finally{clearTimeout(timer);}
    for(const row of rows){
      scanned++;
      const match=strictParagraphMatch(row?.text||"",question);
      if(!match.matched)continue;
      pushStrictHit(perDocument,{
        ...row,score:100,coverage:1,
        strict_phrase:match.target,
        strict_paragraph_index:match.paragraph_index,
        retrieval_mode:"strict-phrase-supabase-v4"
      },STRICT_PER_DOCUMENT_HIT_CAP);
    }
    const count=rows.length;
    rows.length=0;
    rows=null;
    if(count<pageSize)break;
    offset+=count;
  }
  return {
    matches:roundRobinStrictHits(perDocument,STRICT_LOGICAL_TASK_CAP),
    readable:true,scanned,documents_hit:perDocument.size,target
  };
}

const R2_LIBRARY_POINTER_KEY="library/current.json";
function r2LibrarySegment(value){
  return encodeURIComponent(String(value||"unknown").replace(/[^\p{L}\p{N}._-]+/gu,"-").slice(0,160) || "unknown");
}
async function r2JsonGet(bucket,key){
  const obj=await bucket.get(key);
  if(!obj)return null;
  try{return JSON.parse(await obj.text());}catch{return null;}
}
async function r2LibraryShardUpsert(request,env){
  if(!env.PDFS)return json({ok:false,code:"R2_LIBRARY_BINDING_MISSING"},503);
  const body=await request.json().catch(()=>({}));
  const generation=String(body?.generation||"").replace(/[^a-zA-Z0-9._-]/g,"").slice(0,120);
  const documentId=String(body?.document_id||"").slice(0,180);
  const offset=Math.max(0,Number(body?.offset||0));
  const rows=normalizeLibraryChunkRecords(body?.records).slice(0,200);
  if(!generation||!documentId)return json({ok:false,code:"R2_LIBRARY_BAD_REQUEST",message:"generation/document_id ausente."},400);
  if(!rows.length)return json({ok:true,records:0,generation,document_id:documentId});
  const key="library/generations/"+r2LibrarySegment(generation)+"/shards/"+r2LibrarySegment(documentId)+"/"+String(offset).padStart(10,"0")+".json";
  const payload={
    version:1,generation,document_id:documentId,offset,
    count:rows.length,updated_at:new Date().toISOString(),rows
  };
  await env.PDFS.put(key,JSON.stringify(payload),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{generation,document_id:documentId,count:String(rows.length)}
  });
  return json({ok:true,records:rows.length,key,generation,document_id:documentId,offset,r2:true});
}
async function r2LibraryFinalize(request,env){
  if(!env.PDFS)return json({ok:false,code:"R2_LIBRARY_BINDING_MISSING"},503);
  const body=await request.json().catch(()=>({}));
  const generation=String(body?.generation||"").replace(/[^a-zA-Z0-9._-]/g,"").slice(0,120);
  if(!generation)return json({ok:false,code:"R2_LIBRARY_BAD_REQUEST",message:"generation ausente."},400);
  const pointer={
    version:1,
    generation,
    documents:Math.max(0,Number(body?.documents||0)),
    chunks:Math.max(0,Number(body?.chunks||0)),
    shards:Math.max(0,Number(body?.shards||0)),
    updated_at:new Date().toISOString(),
    bucket:"consciencia-fabiano-pdfs",
    source:"indexeddb-pc-backfill"
  };
  await env.PDFS.put(R2_LIBRARY_POINTER_KEY,JSON.stringify(pointer),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{generation}
  });
  return json({ok:true,...pointer,r2:true});
}
async function r2OmniSyncState(env){
  if(!env.PDFS)return json({ok:false,code:"R2_LIBRARY_BINDING_MISSING",message:"Binding R2 PDFS ausente."},503);
  const pointer=await r2JsonGet(env.PDFS,R2_LIBRARY_POINTER_KEY);
  if(!pointer?.generation)return json({
    ok:true,signature:"r2-empty",generation:"",total:0,documents:0,shards:0,batch_size:200,
    backend:"cloudflare-r2",bucket:"consciencia-fabiano-pdfs"
  });
  const signature=await sha256Text([
    pointer.generation,pointer.documents||0,pointer.chunks||0,pointer.shards||0,pointer.updated_at||""
  ].join("|"));
  return json({
    ok:true,signature,generation:String(pointer.generation),
    total:Number(pointer.chunks||0),documents:Number(pointer.documents||0),shards:Number(pointer.shards||0),
    updated_at:String(pointer.updated_at||""),batch_size:200,
    backend:"cloudflare-r2",bucket:"consciencia-fabiano-pdfs"
  });
}
async function r2OmniSyncPage(env,url){
  if(!env.PDFS)return json({ok:false,code:"R2_LIBRARY_BINDING_MISSING"},503);
  const pointer=await r2JsonGet(env.PDFS,R2_LIBRARY_POINTER_KEY);
  const generation=String(pointer?.generation||"");
  if(!generation)return json({ok:true,rows:[],done:true,next_cursor:"",total:0,batch_size:200,backend:"cloudflare-r2"});
  const cursor=String(url.searchParams.get("cursor")||"") || undefined;
  const prefix="library/generations/"+r2LibrarySegment(generation)+"/shards/";
  const listed=await env.PDFS.list({prefix,limit:1,cursor});
  const object=listed.objects?.[0]||null;
  if(!object)return json({
    ok:true,rows:[],done:true,next_cursor:"",total:Number(pointer?.chunks||0),generation,batch_size:200,backend:"cloudflare-r2"
  });
  const shard=await r2JsonGet(env.PDFS,object.key);
  let rows=Array.isArray(shard?.rows)?shard.rows.slice(0,200):[];
  const count=rows.length;
  const nextCursor=listed.truncated?String(listed.cursor||""):"";
  const response=json({
    ok:true,rows,cursor:String(cursor||""),next_cursor:nextCursor,
    done:!listed.truncated,total:Number(pointer?.chunks||0),generation,
    batch_size:200,memory_bounded:true,backend:"cloudflare-r2",bucket:"consciencia-fabiano-pdfs",
    shard_key:object.key
  });
  rows.length=0; rows=null;
  return response;
}

async function retrieveContextV4Strict(env,question){
  assertBindings(env);
  let durable={matches:[],readable:false,scanned:0,documents_hit:0};
  let supabase={matches:[],readable:false,scanned:0,documents_hit:0};
  try{durable=await retrieveDurableStrictContext(env,question);}catch{}
  if(supabaseLexicalConfigured(env)){
    try{supabase=await retrieveSupabaseStrictContext(env,question);}catch{}
  }
  const seen=new Set(),perDocument=new Map();
  for(const row of [...(durable.matches||[]),...(supabase.matches||[])]){
    const key=String(row?.id||"")||[row?.document_id||"",row?.chunk_index||0,String(row?.text||"").slice(0,160)].join("|");
    if(seen.has(key))continue;
    seen.add(key);
    pushStrictHit(perDocument,row,STRICT_PER_DOCUMENT_HIT_CAP);
  }
  const matches=roundRobinStrictHits(perDocument,STRICT_LOGICAL_TASK_CAP);
  if(!matches.length&&!durable.readable){
    const mirrorHasRows=supabaseLexicalConfigured(env)?await supabaseMirrorHasAnyRows(env):null;
    if(!supabase.readable || mirrorHasRows!==true){
      const err=new Error("Os índices documentais estão temporariamente indisponíveis; a biblioteca não foi considerada vazia.");
      err.code="RAG_RETRIEVAL_UNAVAILABLE";
      throw err;
    }
  }
  return matches;
}

async function retrieveContext(env, question, suppliedEmbedding = null) {
  // V4: suppliedEmbedding é deliberadamente ignorado. Online e offline usam o mesmo núcleo de frase exata.
  void suppliedEmbedding;
  return retrieveContextV4Strict(env,question);
}

function humanDocumentName(filename, title = "") {
  const t=String(title || "").trim();
  if(t && !/\.pdf$/i.test(t) && !/^[\w-]+\.pdf$/i.test(t)) return t;
  const raw=String(filename || "").trim();
  if(/standard[-_ ]?works/i.test(raw)) return "Obras Padrão";
  const base=raw.replace(/\.pdf$/i,"").replace(/[_-]+/g," ").replace(/\b\d{4,}\b/g," ").replace(/\s+/g," ").trim();
  if(!base) return "Documento";
  return base.replace(/\b\p{L}/gu,m=>m.toUpperCase());
}

function isReferenceNoiseLine(line) {
  const s=String(line || "").trim();
  if(!s) return true;
  const refs=(s.match(/\b(?:D&C|G[eê]n\.?|Êx\.?|Lev\.?|N[uú]m\.?|Deut\.?|Jos\.?|Ju[ií]z\.?|Sal\.?|Prov\.?|Isa\.?|Jer\.?|Mat\.?|Mt\.?|Mar\.?|Mc\.?|Luc\.?|Lc\.?|Jo\.?|At\.?|Rom\.?|Cor\.?|G[aá]l\.?|Ef\.?|Fil\.?|Col\.?|Tes\.?|Tim\.?|Heb\.?|Tg\.?|Ped\.?|Pe\.?|Apoc\.?|Alma|Mosias|Hel\.?|M[oó]rmon|Mois\.?|Abra[aã]o|JS.?H|GEE|IE)\s*[\w.]*\s*\d{1,3}(?::\d{1,3})?/gi) || []).length;
  const semicolons=(s.match(/;/g) || []).length;
  const digits=(s.match(/\d/g) || []).length;
  const letters=(s.match(/\p{L}/gu) || []).length;
  return refs >= 2 || (refs >= 1 && semicolons >= 2) || (digits > 20 && letters < digits * 2);
}

function cleanNarrativeText(text) {
  const raw=String(text || "").replace(/\u00ad/g,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n");
  const lines=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean).filter(line=>!isReferenceNoiseLine(line));
  return lines.join(" ")
    .replace(/\s+/g," ")
    .replace(/\b(?:GEE|IE)\b[^.!?]{0,140}(?=[.!?]|$)/gi," ")
    .replace(/\s{2,}/g," ")
    .trim();
}

function uniqueSources(context) {
  const seen = new Set();
  const sources = [];
  const rows=Array.from(context || []);
  for (let index=0; index<rows.length; index++) {
    const item=rows[index];
    if(!item) continue;
    const key = `${item.document_id}:${item.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const humanName=humanDocumentName(item.filename,item.title);
    sources.push({
      ref_id: "F"+(index+1),
      document_id: item.document_id,
      arquivo: humanName,
      titulo: humanName,
      autor: item.author || "",
      idioma: item.language || "unknown",
      pagina: item.page || null,
      trecho: cleanNarrativeText(item.text || "").slice(0, 520),
      score: Math.round(item.score * 10000) / 10000,
      retrieval_mode: item.retrieval_mode || "semantic",
    });
  }
  return sources.slice(0, TOP_K);
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

function gracefulEmptyAnswer() {
  return EMPTY_GROUNDED_ANSWER;
}

function sourceRefId(source,index=0) {
  const explicit=String(source?.ref_id || "").trim().toUpperCase();
  return /^F\d{1,3}$/.test(explicit) ? explicit : "F"+(index+1);
}

function citedSourceRefIds(answer) {
  const ids=new Set();
  const text=String(answer || "");
  const re=/\[F(\d{1,3})\]/gi;
  let match;
  while((match=re.exec(text))!==null) ids.add("F"+Number(match[1]));
  return ids;
}

function selectCitedSources(answer,sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  const ids=citedSourceRefIds(answer);
  if(!ids.size) return [];
  const seen=new Set();
  const selected=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    const ref=sourceRefId(row,i);
    if(!ids.has(ref)) continue;
    const key=String(row?.document_id || "")+":"+String(row?.pagina || "");
    if(seen.has(key)) continue;
    seen.add(key);
    selected.push({...row,ref_id:ref});
  }
  return selected;
}

function compactCitationEvidence(sources) {
  return (Array.isArray(sources)?sources:[]).slice(0,TOP_K).map((s,index)=>{
    const ref=sourceRefId(s,index);
    const name=String(s?.titulo || s?.arquivo || "Documento").replace(/[\r\n]+/g," ").trim();
    const author=String(s?.autor || "").replace(/[\r\n]+/g," ").trim();
    const page=s?.pagina ? "p. "+Number(s.pagina) : "página não informada";
    const excerpt=String(s?.trecho || "").replace(/\s+/g," ").trim().slice(0,220);
    return "["+ref+"] "+name+(author?" — "+author:"")+" — "+page+" — "+excerpt;
  }).join("\n");
}

function groundedReferencesMarkdown(sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  if(!rows.length) return "";
  const lines=rows.map((s,index)=>{
    const ref=sourceRefId(s,index);
    const name=String(s?.titulo || s?.arquivo || "Documento").replace(/[\r\n]+/g," ").trim();
    const author=String(s?.autor || "Autor não informado").replace(/[\r\n]+/g," ").trim();
    const page=s?.pagina ? "Página "+Number(s.pagina) : "Página não informada";
    return "- **["+ref+"] "+name+"** — "+author+"; "+page+".";
  });
  return "2. 📚 FONTES E REFERÊNCIAS\n\n"+lines.join("\n");
}

function stripModelReferenceSection(answer) {
  return String(answer || "")
    .replace(/\n\s*(?:2\.?\s*)?(?:📚\s*)?FONTES\s+E\s+REFER[ÊE]NCIAS\s*:?[^]*$/i,"")
    .trim();
}

function isEmptyGroundedFailure(answer) {
  const clean=stripModelReferenceSection(answer)
    .replace(/^1\.\s*SÍNTESE PRINCIPAL:\s*/i,"")
    .trim();
  return !clean ||
    clean===EMPTY_GROUNDED_ANSWER ||
    /^não encontrei informações nos documentos indexados para responder a esta pergunta\.?$/i.test(clean) ||
    /^sem resposta\.?$/i.test(clean);
}

function deterministicSynthesisFromSources(sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  if(!rows.length) return EMPTY_GROUNDED_ANSWER;
  const docs=new Map();
  for(let index=0; index<rows.length; index++){
    const s=rows[index];
    const key=String(s?.document_id || s?.titulo || s?.arquivo || "").trim() || "documento";
    if(!docs.has(key)) docs.set(key,{
      name:String(s?.titulo || s?.arquivo || "Documento").trim(),
      author:String(s?.autor || "").trim(),
      excerpts:[],
      refs:[]
    });
    const entry=docs.get(key);
    const text=String(s?.trecho || "").replace(/\s+/g," ").trim();
    if(text && entry.excerpts.length<2){
      entry.excerpts.push(text.slice(0,260));
      entry.refs.push(sourceRefId(s,index));
    }
  }
  const parts=[];
  for(const doc of [...docs.values()].slice(0,TOP_K)){
    const label=doc.author ? doc.name+" de "+doc.author : doc.name;
    const evidence=doc.excerpts.filter(Boolean).join(" ");
    const refs=doc.refs.map(ref=>"["+ref+"]").join("");
    if(evidence) parts.push(label+" sustenta este ponto documental: "+evidence+" "+refs);
  }
  if(!parts.length) return "Há evidência documental válida recuperada, mas ela não pôde ser sintetizada com segurança.";
  return "Os documentos recuperados permitem construir uma síntese sustentada pelas evidências abaixo. "+parts.join(" ");
}

async function repairFalseNegativeSynthesis(env,question,sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  if(!rows.length) return EMPTY_GROUNDED_ANSWER;
  const evidence=compactIndependentEvidenceFromSources(rows);
  const messages=[
    {
      role:"system",
      content:
        "Há uma ou mais fontes documentais válidas já confirmadas pelo servidor. Portanto, é PROIBIDO responder que não foram encontradas informações. " +
        "Produza somente a seção 1. SÍNTESE PRINCIPAL usando exclusivamente as evidências fornecidas. " +
        "Cruze as fontes independentes diretamente relevantes em prosa coesa, com densidade enciclopédica, sem despejar trechos ou nomes em sequência. " +
        "Depois de cada afirmação factual, mantenha os identificadores [F#] das evidências que realmente a sustentam. " +
        "Não invente fatos, autores, páginas, capítulos ou citações e não acrescente uma seção de referências."
    },
    {
      role:"user",
      content:"PERGUNTA:\n"+trimToTokenBudget(question,700)+"\n\nFONTES INDEPENDENTES CONFIRMADAS:\n"+trimToTokenBudget(evidence,5200)
    }
  ];
  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:7000,
      max_completion_tokens:900,
      temperature:0.0
    });
    const data=await res.json().catch(()=>({}));
    const repaired=String(data?.choices?.[0]?.message?.content || "").trim();
    if(repaired && !isEmptyGroundedFailure(repaired)) return stripModelReferenceSection(repaired);
  }catch{}
  return deterministicSynthesisFromSources(rows);
}

function citationCoverageTarget(sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  if(!rows.length) return 0;
  const independentDocs=new Set(
    rows.map(s=>String(s?.document_id || s?.titulo || s?.arquivo || "").trim()).filter(Boolean)
  ).size;
  if(independentDocs>=2) return Math.min(rows.length,Math.max(independentDocs,Math.min(24,Math.ceil(rows.length*0.35))));
  if(rows.length>=30) return 12;
  if(rows.length>=15) return 8;
  if(rows.length>=8) return 5;
  if(rows.length>=3) return 3;
  return 1;
}

async function repairSparseCitationCoverage(env,question,answer,sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  if(!rows.length) return answer;
  const current=selectCitedSources(answer,rows);
  const target=citationCoverageTarget(rows);
  if(current.length>=target) return answer;

  const evidence=compactCitationEvidence(rows);
  const messages=[
    {
      role:"system",
      content:
        "Reescreva o rascunho no MODO DICIONÁRIO DENSO: um verbete enciclopédico profundo, coeso e articulado, usando EXCLUSIVAMENTE as evidências fornecidas. " +
        "É proibido produzir frases soltas, notas telegráficas, enumeração de livros sem explicação, colagem de citações ou parágrafos de uma única frase. " +
        "Organize prosa contínua em parágrafos sólidos: definição/núcleo, desenvolvimento histórico ou conceitual, convergências entre autores, complementos, nuances ou diferenças sustentadas e uma conclusão integradora. " +
        "Cada parágrafo deve conectar ideias de mais de uma evidência sempre que isso for documentalmente possível. " +
        "Use [F#] imediatamente após cada afirmação ou conjunto de afirmações sustentadas. Integre o maior número possível de documentos independentes DIRETAMENTE RELEVANTES e atinja a meta mínima de cobertura indicada pelo usuário, sem jamais citar fonte irrelevante só para aumentar quantidade. " +
        "Elimine afirmações que não possam ser sustentadas por pelo menos uma evidência [F#]. Não invente fatos, autores, páginas, capítulos ou citações. Não escreva a seção de referências."
    },
    {
      role:"user",
      content:
        "PERGUNTA:\n"+trimToTokenBudget(question,700)+
        "\n\nMETA MÍNIMA DE COBERTURA: "+target+" referências documentais distintas, ou todas as fontes diretamente relevantes se forem menos que isso."+
        "\n\nRASCUNHO:\n"+trimToTokenBudget(stripModelReferenceSection(answer),1800)+
        "\n\nEVIDÊNCIAS DISPONÍVEIS:\n"+trimToTokenBudget(evidence,5600)
    }
  ];
  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:9000,
      max_completion_tokens:3200,
      temperature:0.0
    });
    const data=await res.json().catch(()=>({}));
    const repaired=String(data?.choices?.[0]?.message?.content || "").trim();
    if(repaired && !isEmptyGroundedFailure(repaired)){
      const repairedCoverage=selectCitedSources(repaired,rows).length;
      if(repairedCoverage>=Math.max(1,current.length)) return stripModelReferenceSection(repaired);
    }
  }catch{}
  return answer;
}

function synthesisBody(answer) {
  return stripModelReferenceSection(answer)
    .replace(/^1\.\s*SÍNTESE PRINCIPAL:\s*/i,"")
    .trim();
}

function needsDenseEncyclopedicRewrite(answer,sources) {
  const rows=Array.isArray(sources)?sources:[];
  if(rows.length<5) return false;
  const body=synthesisBody(answer);
  const words=body.split(/\s+/).filter(Boolean).length;
  const paragraphs=body.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  const bulletLines=body.split("\n").filter(line=>/^\s*[-*•]\s+/.test(line)).length;
  const minWords=rows.length>=20 ? 650 : rows.length>=10 ? 480 : 320;
  const minParagraphs=rows.length>=20 ? 6 : rows.length>=10 ? 5 : 4;
  return words<minWords || paragraphs.length<minParagraphs || bulletLines>0;
}

async function enforceDenseEncyclopedicMode(env,question,answer,sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  if(!needsDenseEncyclopedicRewrite(answer,rows)) return answer;
  const evidence=compactCitationEvidence(rows);
  const target=citationCoverageTarget(rows);
  const messages=[
    {
      role:"system",
      content:
        "Transforme o rascunho em um VERBETE ENCICLOPÉDICO DENSO e documentalmente rigoroso. " +
        "Use somente as evidências fornecidas. É proibido escrever frases soltas, listas de ideias, nomes de livros em sequência, citações isoladas sem contexto ou texto fragmentado. " +
        "Produza parágrafos substanciais, coesos e articulados que expliquem o tema em profundidade e cruzem autores e livros dentro do mesmo raciocínio. " +
        "Estruture naturalmente: definição e tese central; desenvolvimento; relações entre conceitos; convergências; complementos; diferenças ou tensões quando existirem; síntese integradora. " +
        "Use identificadores [F#] junto das afirmações sustentadas. Preserve zero alucinação: não acrescente nenhum fato que não esteja nas evidências. " +
        "A meta é amplitude máxima do acervo com qualidade argumentativa, não uma coleção de citações."
    },
    {
      role:"user",
      content:
        "PERGUNTA:\n"+trimToTokenBudget(question,700)+
        "\n\nMETA DE FONTES DISTINTAS: "+target+
        "\n\nRASCUNHO ATUAL:\n"+trimToTokenBudget(synthesisBody(answer),2200)+
        "\n\nEVIDÊNCIAS DOCUMENTAIS:\n"+trimToTokenBudget(evidence,5900)
    }
  ];
  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:9300,
      max_completion_tokens:3600,
      temperature:0.0
    });
    const data=await res.json().catch(()=>({}));
    const rewritten=String(data?.choices?.[0]?.message?.content || "").trim();
    if(rewritten && !isEmptyGroundedFailure(rewritten)){
      const currentCoverage=selectCitedSources(answer,rows).length;
      const newCoverage=selectCitedSources(rewritten,rows).length;
      if(newCoverage>=Math.max(1,currentCoverage)) return stripModelReferenceSection(rewritten);
    }
  }catch{}
  return answer;
}

function finalizeGroundedAnswer(answer,sources) {
  const rows=Array.isArray(sources)?sources:[];
  if(!rows.length) return EMPTY_GROUNDED_ANSWER;
  let base=stripModelReferenceSection(answer);
  if(isEmptyGroundedFailure(base)) base=deterministicSynthesisFromSources(rows);

  let cited=selectCitedSources(base,rows);
  if(!cited.length){
    base=deterministicSynthesisFromSources(rows);
    cited=selectCitedSources(base,rows);
  }

  const normalized=/^1\.\s*SÍNTESE PRINCIPAL:/i.test(base)
    ? base
    : "1. SÍNTESE PRINCIPAL:\n\n"+base;
  const references=groundedReferencesMarkdown(cited);
  return normalized+(references?"\n\n"+references:"");
}

function ensureEngagementQuestion(answer, fallback = false) {
  const text=String(answer || "").trim();
  if(!text) return gracefulEmptyAnswer();
  if(fallback || /\?\s*$/.test(text)) return text;
  return text+"\n\nGostaria de explorar outra referência sobre isto?";
}

let groqRoundRobinCursor = 0;

function groqApiKeys(env) {
  const keys = [];
  const push = value => {
    const key = String(value || "").trim();
    if (key && !keys.includes(key)) keys.push(key);
  };
  push(env?.GROQ_API_KEY);
  for (let i = 1; i <= 32; i++) push(env?.["GROQ_API_KEY_" + i]);
  push(env?.GROQ_API_KEY_N);
  return keys;
}

function requireGroqKeys(env) {
  const keys = groqApiKeys(env);
  if (!keys.length) {
    const err = new Error("Nenhuma chave Groq foi configurada no servidor.");
    err.code = "EXTERNAL_AI_NOT_CONFIGURED";
    throw err;
  }
  return keys;
}

async function groqCompletion(env, messages, stream = false, options = {}) {
  const keys = requireGroqKeys(env);
  const inputBudget=Math.max(1200,Number(options.input_budget || GROQ_INPUT_BUDGET_TOKENS));
  const model=String(options.model || CHAT_MODEL);
  const maxCompletionTokens=Math.max(100,Number(options.max_completion_tokens || GROQ_MAX_COMPLETION_TOKENS));
  const temperature=Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.0;
  const maxRetries=Math.max(0,Math.min(MASSIVE_GROQ_MAX_RETRIES,Number(options.max_retries ?? MASSIVE_GROQ_MAX_RETRIES)));
  let safeMessages=enforceGroqBudget(messages,inputBudget);
  const startIndex=(groqRoundRobinCursor++) % keys.length;

  const execute=async(payloadMessages,apiKey)=>{
    return fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: payloadMessages,
        temperature,
        max_completion_tokens: maxCompletionTokens,
        stream,
      }),
    });
  };

  let res=null;
  for(let attempt=0; attempt<=maxRetries; attempt++){
    const apiKey=keys[(startIndex+attempt)%keys.length];
    res=await execute(safeMessages,apiKey);
    if(res.status!==429) break;
    if(attempt>=maxRetries) break;
    safeMessages=aggressiveGroqMessages(safeMessages);
    const retryAfter=Math.max(0,Math.min(4,Number(res.headers.get("retry-after") || 0)));
    const backoffMs=retryAfter ? retryAfter*1000 : Math.min(4000,250*(2**attempt));
    await new Promise(resolve=>setTimeout(resolve,backoffMs));
  }

  if (!res?.ok) {
    const body = await res?.json().catch(() => ({})) || {};
    const err = new Error(body?.error?.message || ("Groq chat HTTP " + (res?.status || 503)));
    err.status = res?.status || 503;
    err.input_tokens_estimated=groqInputTokenEstimate(safeMessages);
    err.key_pool_size=keys.length;
    throw err;
  }
  return res;
}

async function mapExtractReferences(env, question, batch, batchIndex) {
  const raw=buildMapBatchContext(batch,question,batchIndex);
  const messages=[
    {
      role:"system",
      content:
        "Você é a etapa MAP de um sistema RAG documental. Não escreva síntese e não invente metadados. " +
        "Examine TODOS os trechos do lote individualmente; nenhum [F#] recebido pode ser ignorado silenciosamente. " +
        "Para CADA [F#], devolva exatamente uma linha no formato '[F#] | RELEVÂNCIA=ALTA|MÉDIA|BAIXA|NENHUMA | EVIDÊNCIA=resumo factual em até 40 palavras | PAPEL=definição|apoio|contraste|contexto'. " +
        "Marque RELEVÂNCIA=NENHUMA quando o trecho não sustentar a pergunta; não force conexão temática e não transforme ruído de recuperação em evidência. " +
        "Não selecione apenas a fonte mais óbvia: examine também livros e autores com score menor e preserve toda evidência ALTA ou MÉDIA para a etapa REDUCE. " +
        "É proibido criar autor, livro, capítulo, página, citação ou conteúdo ausente do contexto."
    },
    {
      role:"user",
      content:"PERGUNTA:\n"+trimToTokenBudget(question,500)+"\n\nLOTE "+(batchIndex+1)+":\n"+raw
    }
  ];
  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:3400,
      max_completion_tokens:MAP_MAX_COMPLETION_TOKENS,
      temperature:0.0
    });
    const data=await res.json().catch(()=>({}));
    const text=String(data?.choices?.[0]?.message?.content || "").trim();
    return text || raw;
  }catch{
    return raw;
  }
}

function diversifyContextAcrossDocuments(context,limit=TOP_K) {
  const rows=Array.from(context || []).slice(0,Math.max(limit,TOP_K));
  if(rows.length<=1) return rows.slice(0,limit);

  const groups=new Map();
  const order=[];
  for(const item of rows){
    const id=String(item?.document_id || item?.title || item?.filename || "unknown");
    if(!groups.has(id)){groups.set(id,[]);order.push(id);}
    groups.get(id).push(item);
  }
  if(groups.size<=1) return rows.slice(0,limit);

  for(const list of groups.values()){
    list.sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
  }

  const out=[];
  let round=0;
  while(out.length<limit){
    let added=false;
    for(const id of order){
      const item=groups.get(id)?.[round];
      if(item){
        out.push(item);
        added=true;
        if(out.length>=limit) break;
      }
    }
    if(!added) break;
    round++;
  }
  return out;
}

function crossLibraryLedger(context) {
  const stats=crossLibraryStats(context);
  const lines=stats.documents.map((doc,index)=>{
    const author=doc.author ? " — "+doc.author : "";
    return "- "+(index+1)+". "+doc.name+author+" ("+doc.hits+" trecho(s) recuperado(s))";
  });
  return lines.join("\n");
}

function compactIndependentEvidenceFromSources(sources) {
  const docs=new Map();
  const rows=Array.isArray(sources)?sources:[];
  for(let index=0; index<rows.length; index++){
    const s=rows[index];
    const key=String(s?.document_id || s?.titulo || s?.arquivo || "").trim() || "documento";
    if(docs.has(key)) continue;
    docs.set(key,{...s,ref_id:sourceRefId(s,index)});
  }
  return [...docs.values()].slice(0,TOP_K).map((s)=>{
    const ref=sourceRefId(s,0);
    const name=String(s?.titulo || s?.arquivo || "Documento").replace(/[\r\n]+/g," ").trim();
    const author=String(s?.autor || "").replace(/[\r\n]+/g," ").trim();
    const page=s?.pagina ? "p. "+Number(s.pagina) : "página não informada";
    const text=String(s?.trecho || "").replace(/\s+/g," ").trim().slice(0,180);
    return "["+ref+"] "+name+(author?" — "+author:"")+" — "+page+" — "+text;
  }).join("\n");
}

function documentIdentity(item) {
  return String(item?.document_id || item?.title || item?.filename || "").trim();
}

function crossLibraryStats(context) {
  const docs=new Map();
  for(const item of (context || [])){
    const id=documentIdentity(item);
    if(!id) continue;
    const current=docs.get(id) || {
      id,
      name:humanDocumentName(item?.filename,item?.title),
      author:String(item?.author || ""),
      hits:0
    };
    current.hits++;
    docs.set(id,current);
  }
  return {
    independent_documents:docs.size,
    documents:[...docs.values()].slice(0,TOP_K)
  };
}

function microNodeFallbackBatch(batch,question,nodeIndex) {
  const raw=buildMapBatchContext(batch,question,nodeIndex);
  return raw.split(/\n\n+/).map(block=>{
    const line=String(block||"").replace(/\s+/g," ").trim();
    if(!line) return "";
    const ref=(line.match(/\[F\d+\]/)||["[F?]"])[0];
    return ref+" | RELEVÂNCIA=NÃO AVALIADA | EVIDÊNCIA="+line.slice(0,360);
  }).filter(Boolean).join("\n");
}

function relayRelevantRefIds(relayText) {
  const ids=new Set();
  const text=String(relayText || "");
  const re=/\[F(\d{1,3})\][^\n]*RELEVÂNCIA=(ALTA|MÉDIA)/gi;
  let match;
  while((match=re.exec(text))!==null) ids.add("F"+Number(match[1]));
  return [...ids];
}

async function processMicroRelayNode(env,question,batch,nodeIndex,baton) {
  const raw=buildMapBatchContext(batch,question,nodeIndex);
  if(!raw) return {ok:true,text:"",skipped:true};
  const messages=[
    {
      role:"system",
      content:
        "Você é o MICRO-NÚCLEO "+(nodeIndex+1)+" de "+MICRO_NODE_COUNT+" numa cadeia documental. Temperature 0.0. " +
        "Receba o bastão acumulado somente para manter continuidade e evitar contradições, mas analise EXCLUSIVAMENTE o bloco novo deste núcleo. " +
        "Não reescreva nem apague o bastão anterior: o servidor fará a concatenação determinística. " +
        "Para CADA [F#] do bloco novo, devolva exatamente uma linha no formato '[F#] | RELEVÂNCIA=ALTA|MÉDIA|BAIXA|NENHUMA | EVIDÊNCIA=resumo factual de até 28 palavras | PAPEL=definição|apoio|contraste|contexto'. " +
        "Use apenas o texto explícito da fonte. É proibido inventar autor, livro, capítulo, página, citação, fato ou relação causal. " +
        "Não descarte uma fonte só por score menor; classifique-a. Preserve ALTA e MÉDIA para o núcleo mestre."
    },
    {
      role:"user",
      content:
        "PERGUNTA:\n"+trimToTokenBudget(question,450)+
        "\n\nBASTÃO ACUMULADO DOS NÚCLEOS ANTERIORES:\n"+trimToTokenBudget(baton || "(início da cadeia)",MICRO_NODE_RELAY_BUDGET_TOKENS)+
        "\n\nBLOCO NOVO DO NÚCLEO "+(nodeIndex+1)+":\n"+raw
    }
  ];
  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:7600,
      max_completion_tokens:MICRO_NODE_MAX_COMPLETION_TOKENS,
      temperature:0.0
    });
    const data=await res.json().catch(()=>({}));
    const text=String(data?.choices?.[0]?.message?.content || "").trim();
    if(text) return {ok:true,text,skipped:false};
  }catch(error){
    return {ok:false,text:microNodeFallbackBatch(batch,question,nodeIndex),skipped:false,error:String(error?.message||error)};
  }
  return {ok:false,text:microNodeFallbackBatch(batch,question,nodeIndex),skipped:false,error:"empty-node-output"};
}

async function runMasterNode20(env,question,lastBatch,baton,history,source) {
  const lastRaw=buildMapBatchContext(lastBatch,question,MICRO_NODE_COUNT-1);
  const relevantRefs=relayRelevantRefIds(baton);
  const cross=crossLibraryStats(source);
  const ledger=crossLibraryLedger(source);
  const messages=enforceGroqBudget([
    {
      role:"system",
      content:
        "Você é o NÚCLEO MESTRE 20 de 20 da malha documental da Consciência do Fabiano. Temperature 0.0. " +
        "Sua função é fundir toda a cadeia num VERBETE ENCICLOPÉDICO DENSO, profundo, articulado e documentalmente rigoroso. " +
        "Use SOMENTE as evidências recebidas no bastão e no bloco final. É proibido inventar fatos, autores, livros, capítulos, páginas, citações ou preencher lacunas com conhecimento externo. " +
        "Se existirem evidências ALTA ou MÉDIA de vários livros/autores, costure todas elas transversalmente em prosa contínua; não afunile em uma única fonte. " +
        "Produza de 6 a 10 parágrafos substanciais quando houver material suficiente, com definição central, desenvolvimento, convergências, complementos, contrastes e síntese integradora. " +
        "É proibido entregar frases soltas, listas telegráficas, lixo textual, colagem de citações ou sequência de nomes sem explicação. " +
        "Cite inline os identificadores [F#] logo após as afirmações que eles sustentam. Procure incorporar todos os [F#] classificados como ALTA ou MÉDIA, sem forçar fontes BAIXA/NENHUMA. " +
        "Não escreva a seção final de fontes: o servidor montará o rodapé deterministicamente a partir dos metadados originais."
    },
    ...Array.from(history || []).slice(-4),
    {
      role:"user",
      content:
        "PERGUNTA:\n"+trimToTokenBudget(question,650)+
        "\n\nABRANGÊNCIA: "+cross.independent_documents+" documento(s) independente(s) candidato(s)."+
        "\nIDENTIFICADORES ALTA/MÉDIA PRESERVADOS PELOS NÚCLEOS 1-19: "+(relevantRefs.length?relevantRefs.map(x=>"["+x+"]").join(" "):"(nenhum classificado ainda)")+
        "\n\nCATÁLOGO TRANSVERSAL:\n"+trimToTokenBudget(ledger,1400)+
        "\n\nBASTÃO ACUMULADO DOS NÚCLEOS 1-19:\n"+trimToTokenBudget(baton || "(sem conteúdo acumulado)",5600)+
        "\n\nBLOCO FINAL DO NÚCLEO 20:\n"+(lastRaw || "(sem novos trechos neste núcleo; faça a fusão do bastão acumulado)")+
        "\n\nREDAJA AGORA SOMENTE A SÍNTESE PRINCIPAL ENCICLOPÉDICA."
    }
  ],9200);

  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:9200,
      max_completion_tokens:MASTER_NODE_MAX_COMPLETION_TOKENS,
      temperature:0.0
    });
    const data=await res.json().catch(()=>({}));
    const text=String(data?.choices?.[0]?.message?.content || "").trim();
    if(text && !isEmptyGroundedFailure(text)) return {ok:true,text};
  }catch(error){
    return {ok:false,text:deterministicSynthesisFromSources(uniqueSources(source)),error:String(error?.message||error)};
  }
  return {ok:false,text:deterministicSynthesisFromSources(uniqueSources(source)),error:"empty-master-output"};
}

function massiveNodeEvidence(source, question, nodeIndex) {
  const node=nodeIndex+1;
  if(!source){
    return {
      node,
      status:"pass-through",
      ref_id:"",
      source:"",
      page:null,
      evidence:"",
      metadata:{deterministic:true,temperature:0}
    };
  }
  const ref=sourceRefId(source,nodeIndex);
  const sourceName=String(source?.titulo || source?.arquivo || "Documento").replace(/[\r\n]+/g," ").trim();
  const author=String(source?.autor || "").replace(/[\r\n]+/g," ").trim();
  const page=Number(source?.pagina || 0) || null;
  const raw=String(source?.trecho || source?.text || "");
  const excerpt=focusExcerptForQuestion(raw,question,MASSIVE_NODE_EVIDENCE_CHARS) ||
    cleanNarrativeText(raw).slice(0,MASSIVE_NODE_EVIDENCE_CHARS);
  const evidence="["+ref+"] "+sourceName+(author?" — "+author:"")+(page?" — página "+page:"")+
    " — "+String(excerpt || "").replace(/\s+/g," ").trim();
  return {
    node,
    status:excerpt ? "complete" : "no-evidence",
    ref_id:ref,
    source:sourceName,
    page,
    evidence,
    metadata:{
      deterministic:true,
      temperature:0,
      document_id:String(source?.document_id || ""),
      retrieval_score:Number(source?.score || 0)
    }
  };
}

async function runAsyncWorkerPool(tasks,limit,worker,onSettled=null) {
  const list=Array.from(tasks || []);
  const results=new Array(list.length);
  let cursor=0;
  const workerCount=Math.max(1,Math.min(Number(limit)||1,list.length||1));
  const runners=Array.from({length:workerCount},async()=>{
    while(true){
      const index=cursor++;
      if(index>=list.length) return;
      let result;
      try{
        result=await worker(list[index],index);
      }catch(error){
        result={
          node:index+1,
          status:"failed",
          error:String(error?.message || error),
          evidence:"",
          metadata:{deterministic:true}
        };
      }
      results[index]=result;
      if(onSettled) await onSettled(result,index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function massiveReduceGroup(env,question,group,groupIndex) {
  const evidence=Array.from(group || []).filter(x=>x?.evidence).map(x=>x.evidence).join("\n");
  if(!evidence) return {ok:true,text:"",group:groupIndex+1};
  const messages=[
    {
      role:"system",
      content:
        "Você é um REDUCER documental determinístico de um RAG massivo. Trabalhe somente com as evidências [F#] recebidas. " +
        "Produza um resumo denso, factual e articulado; preserve os identificadores [F#] imediatamente após cada afirmação sustentada. " +
        "Não invente fatos, metadados, autores, páginas ou citações. Não escreva seção de referências. Temperatura lógica: 0."
    },
    {
      role:"user",
      content:"PERGUNTA:\n"+trimToTokenBudget(question,600)+"\n\nEVIDÊNCIAS DO GRUPO "+(groupIndex+1)+":\n"+
        trimToTokenBudget(evidence,5200)
    }
  ];
  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:6500,
      max_completion_tokens:720,
      temperature:0.0,
      max_retries:MASSIVE_GROQ_MAX_RETRIES
    });
    const data=await res.json().catch(()=>({}));
    const text=String(data?.choices?.[0]?.message?.content || "").trim();
    if(text) return {ok:true,text,group:groupIndex+1};
  }catch(error){
    return {ok:false,text:trimToTokenBudget(evidence,1600),group:groupIndex+1,error:String(error?.message||error)};
  }
  return {ok:false,text:trimToTokenBudget(evidence,1600),group:groupIndex+1,error:"empty-reducer-output"};
}

async function massiveMasterSynthesis(env,question,reducers,history,sources) {
  const reducerText=Array.from(reducers || [])
    .filter(x=>String(x?.text || "").trim())
    .map(x=>"GRUPO "+x.group+":\n"+String(x.text || "").trim())
    .join("\n\n");
  const historyText=slidingHistory(history,4,650)
    .map(x=>x.role.toUpperCase()+": "+x.content).join("\n");
  const ledger=crossLibraryLedger(sources);
  const messages=[
    {
      role:"system",
      content:
        "Você é o MASTER FINAL do RAG V2.0 MASSIVE SCALE. Escreva somente a seção '1. SÍNTESE PRINCIPAL:' em português. " +
        "Produza um verbete enciclopédico denso, profundo, coeso e articulado, cruzando todas as evidências diretamente relevantes. " +
        "Cada afirmação factual deve conservar os identificadores [F#] que realmente a sustentam. " +
        "Não despeje trechos soltos, não invente fatos, autores, páginas, capítulos ou citações e não escreva a seção de referências. " +
        "Se houver tensões entre fontes, descreva-as sem resolver por invenção. Temperatura obrigatória: 0."
    },
    {
      role:"user",
      content:
        "PERGUNTA:\n"+trimToTokenBudget(question,700)+
        (historyText?"\n\nCONTEXTO RECENTE:\n"+trimToTokenBudget(historyText,650):"")+
        "\n\nMAPA DE DOCUMENTOS:\n"+trimToTokenBudget(ledger,1300)+
        "\n\nREDUÇÕES DOS NÓS:\n"+trimToTokenBudget(reducerText,7200)+
        "\n\nREDAJA A SÍNTESE ENCICLOPÉDICA FINAL."
    }
  ];
  try{
    const res=await groqCompletion(env,messages,false,{
      input_budget:9200,
      max_completion_tokens:MASTER_NODE_MAX_COMPLETION_TOKENS,
      temperature:0.0,
      max_retries:MASSIVE_GROQ_MAX_RETRIES
    });
    const data=await res.json().catch(()=>({}));
    const text=String(data?.choices?.[0]?.message?.content || "").trim();
    if(text && !isEmptyGroundedFailure(text)) return {ok:true,text};
  }catch(error){
    return {ok:false,text:deterministicSynthesisFromSources(sources),error:String(error?.message||error)};
  }
  return {ok:false,text:deterministicSynthesisFromSources(sources),error:"empty-master-output"};
}

async function massivePipelineSynthesis(env,question,sources,history=[],onEvent=null) {
  const rows=Array.from(sources || []).slice(0,MASSIVE_NODE_COUNT);
  const tasks=Array.from({length:MASSIVE_NODE_COUNT},(_,index)=>({node:index+1,source:rows[index] || null}));
  let completed=0;
  let failed=0;

  const nodeResults=await runAsyncWorkerPool(
    tasks,
    MASSIVE_WORKER_CONCURRENCY,
    async task=>massiveNodeEvidence(task.source,question,task.node-1),
    async result=>{
      completed++;
      if(result?.status==="failed") failed++;
      if(onEvent){
        await onEvent("node",{
          node:Number(result?.node || completed),
          status:String(result?.status || "complete"),
          ref_id:String(result?.ref_id || ""),
          source:String(result?.source || ""),
          page:result?.page || null,
          summary:String(result?.evidence || "").slice(0,240),
          completed,
          total:MASSIVE_NODE_COUNT
        });
      }
    }
  );

  const evidence=nodeResults.filter(x=>x?.evidence);
  const groups=[];
  for(let i=0;i<evidence.length;i+=MASSIVE_NODE_GROUP_SIZE){
    groups.push(evidence.slice(i,i+MASSIVE_NODE_GROUP_SIZE));
  }

  const reducerTasks=groups.map((group,index)=>({group,index}));
  const reducerResults=await runAsyncWorkerPool(
    reducerTasks,
    MASSIVE_WORKER_CONCURRENCY,
    async task=>massiveReduceGroup(env,question,task.group,task.index),
    async result=>{
      if(onEvent){
        await onEvent("reduce",{
          group:Number(result?.group || 0),
          status:result?.ok ? "complete" : "fallback",
          total_groups:groups.length
        });
      }
    }
  );

  const master=await massiveMasterSynthesis(env,question,reducerResults,history,rows);
  return {
    text:reducerResults.map(x=>x?.text || "").filter(Boolean).join("\n\n"),
    masterSynthesis:master.text,
    used:true,
    batches:groups.length,
    micro_nodes_total:MASSIVE_NODE_COUNT,
    micro_nodes_executed:completed,
    micro_nodes_failed:failed,
    relay_mode:"async-worker-pool",
    active_worker_limit:MASSIVE_WORKER_CONCURRENCY,
    master_node:"final-fusion",
    node_results:nodeResults
  };
}

async function massivePipelineStreamResponse(env,meta) {
  const encoder=new TextEncoder();
  const stream=new ReadableStream({
    async start(controller){
      let closed=false;
      const emit=(event,payload)=>{
        if(closed) return;
        controller.enqueue(encoder.encode(sseFrame(event,payload)));
      };
      const keepalive=setInterval(()=>{
        emit("keepalive",{ts:Date.now(),pipeline:"v2.0-massive-scale"});
      },SSE_KEEPALIVE_MS);
      try{
        emit("meta",{
          fontes:meta.sources,
          fallback:false,
          provider:"groq+500-node-async-rag",
          retrieval_level:meta.retrievalLevel || 0,
          embedding_model:LOCAL_EMBEDDING_MODEL,
          chat_model:CHAT_MODEL,
          micro_nodes_total:MASSIVE_NODE_COUNT,
          active_worker_limit:MASSIVE_WORKER_CONCURRENCY,
          queue_strategy:"fifo-exponential-backoff",
          ui_virtualization:true,
          temperature:0.0
        });

        const reduced=await massivePipelineSynthesis(
          env,
          meta.question,
          meta.sources,
          meta.history || [],
          async(event,payload)=>emit(event,payload)
        );

        let answer=String(reduced.masterSynthesis || "").trim();
        if(meta.sources.length && isEmptyGroundedFailure(answer)) answer=deterministicSynthesisFromSources(meta.sources);
        answer=finalizeGroundedAnswer(answer,meta.sources);
        const usedSources=selectCitedSources(answer,meta.sources);
        const memoryPersisted=await persistChatTurn(
          env,meta.ownerId,meta.body,meta.question,answer,usedSources,false
        );
        emit("delta",{text:answer});
        emit("done",{
          ok:true,
          resposta:answer,
          fontes:usedSources,
          fallback:false,
          memory_persisted:memoryPersisted,
          provider:"groq+500-node-async-rag",
          retrieval_level:meta.retrievalLevel || 0,
          embedding_model:LOCAL_EMBEDDING_MODEL,
          chat_model:CHAT_MODEL,
          map_reduce:true,
          map_batches:reduced.batches,
          independent_documents:Number(meta.independentDocuments || 0),
          micro_nodes_total:MASSIVE_NODE_COUNT,
          micro_nodes_executed:reduced.micro_nodes_executed,
          micro_nodes_failed:reduced.micro_nodes_failed,
          active_worker_limit:MASSIVE_WORKER_CONCURRENCY,
          relay_mode:"async-worker-pool",
          master_node:"final-fusion",
          false_negative_guard:true,
          ui_virtualization:true
        });
      }catch(error){
        emit("error",{message:String(error?.message||error),code:error?.code||"MASSIVE_PIPELINE_ERROR"});
      }finally{
        clearInterval(keepalive);
        closed=true;
        controller.close();
      }
    }
  });
  return new Response(stream,{headers:securityHeaders(new Headers({
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-cache, no-transform",
    "X-Accel-Buffering":"no",
    "Connection":"keep-alive"
  }))});
}

async function mapReduceContext(env, question, context, history=[]) {
  const source=Array.from(context || []).slice(0,TOP_K);
  if(!source.length){
    return {
      text:"",
      masterSynthesis:EMPTY_GROUNDED_ANSWER,
      used:false,
      batches:0,
      micro_nodes_total:MICRO_NODE_COUNT,
      micro_nodes_executed:0,
      micro_nodes_failed:0,
      relay_mode:"legacy-sequential-rollback",
      releasedIndexes:[]
    };
  }

  const batches=Array.from({length:MICRO_NODE_COUNT},(_,index)=>
    source.slice(index*MICRO_NODE_BATCH_SIZE,(index+1)*MICRO_NODE_BATCH_SIZE)
  );

  let baton="";
  let executed=0;
  let failed=0;
  const trace=[];

  // Núcleos 1-19: relay sequencial. O servidor concatena cada saída ao bastão,
  // impedindo que um núcleo posterior apague informação já preservada.
  for(let nodeIndex=0;nodeIndex<MICRO_NODE_COUNT-1;nodeIndex++){
    const batch=batches[nodeIndex];
    if(!batch.length){
      trace.push({node:nodeIndex+1,items:0,status:"pass-through"});
      continue;
    }
    const result=await processMicroRelayNode(env,question,batch,nodeIndex,baton);
    executed++;
    if(!result.ok) failed++;
    const nodeText=String(result.text || "").trim();
    if(nodeText){
      baton+=(baton?"\n":"")+"NÚCLEO "+(nodeIndex+1)+":\n"+nodeText;
    }
    trace.push({node:nodeIndex+1,items:batch.length,status:result.ok?"ok":"fallback"});
  }

  // Núcleo 20: recebe o bastão inteiro + último bloco e faz a fusão enciclopédica.
  const master=await runMasterNode20(env,question,batches[MICRO_NODE_COUNT-1],baton,history,source);
  executed++;
  if(!master.ok) failed++;
  trace.push({node:20,items:batches[19].length,status:master.ok?"master-ok":"master-fallback"});

  return {
    text:trimToTokenBudget(baton,6500),
    masterSynthesis:master.text,
    used:true,
    batches:Math.ceil(source.length/MICRO_NODE_BATCH_SIZE),
    micro_nodes_total:MICRO_NODE_COUNT,
    micro_nodes_executed:executed,
    micro_nodes_failed:failed,
    relay_mode:"legacy-sequential-rollback",
    master_node:20,
    trace,
    releasedIndexes:source.map((_,i)=>i)
  };
}


function sseFrame(event, payload) {
  return "event: " + event + "\n" + "data: " + JSON.stringify(payload) + "\n\n";
}

async function precomputedRelayStreamResponse(env,answer,meta) {
  const sources=Array.isArray(meta.sources)?meta.sources:[];
  let safe=String(answer || "").trim();
  if(sources.length && isEmptyGroundedFailure(safe)) safe=deterministicSynthesisFromSources(sources);
  if(!sources.length) safe=EMPTY_GROUNDED_ANSWER;
  const finalAnswer=finalizeGroundedAnswer(safe,sources);
  const usedSources=selectCitedSources(finalAnswer,sources);
  const memoryPersisted=await persistChatTurn(
    env,meta.ownerId,meta.body,meta.question,finalAnswer,usedSources,meta.fallback
  );
  const frames=
    sseFrame("meta",{
      fontes:usedSources,
      fallback:meta.fallback,
      provider:"groq+20-node-relay",
      retrieval_level:meta.retrievalLevel || 0,
      embedding_model:LOCAL_EMBEDDING_MODEL,
      chat_model:CHAT_MODEL,
      map_reduce:true,
      map_batches:Number(meta.mapBatches || 0),
      independent_documents:Number(meta.independentDocuments || 0),
      micro_nodes_total:MICRO_NODE_COUNT,
      micro_nodes_executed:Number(meta.microNodesExecuted || 0),
      micro_nodes_failed:Number(meta.microNodesFailed || 0),
      relay_mode:"legacy-sequential-rollback",
      master_node:20
    })+
    sseFrame("delta",{text:finalAnswer})+
    sseFrame("done",{
      ok:true,
      resposta:finalAnswer,
      fontes:usedSources,
      fallback:meta.fallback,
      memory_persisted:memoryPersisted,
      provider:"groq+20-node-relay",
      retrieval_level:meta.retrievalLevel || 0,
      embedding_model:LOCAL_EMBEDDING_MODEL,
      chat_model:CHAT_MODEL,
      map_reduce:true,
      map_batches:Number(meta.mapBatches || 0),
      independent_documents:Number(meta.independentDocuments || 0),
      micro_nodes_total:MICRO_NODE_COUNT,
      micro_nodes_executed:Number(meta.microNodesExecuted || 0),
      micro_nodes_failed:Number(meta.microNodesFailed || 0),
      relay_mode:"legacy-sequential-rollback",
      master_node:20,
      false_negative_guard:true
    });
  return new Response(frames,{headers:securityHeaders(new Headers({
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-cache, no-transform",
    "X-Accel-Buffering":"no"
  }))});
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
          provider: "groq+resilient-rag",
          retrieval_level: meta.retrievalLevel || 0,
          embedding_model: LOCAL_EMBEDDING_MODEL,
          chat_model: CHAT_MODEL,
          map_reduce: meta.mapReduceUsed === true,
          map_batches: Number(meta.mapBatches || 0),
          independent_documents: Number(meta.independentDocuments || 0),
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
            if (typeof delta === "string" && delta) answer += delta;
          }
        }

        if(Array.isArray(meta.sources) && meta.sources.length>0 && isEmptyGroundedFailure(answer)){
          answer=await repairFalseNegativeSynthesis(env,meta.question,meta.sources);
        }else if(!String(answer || "").trim() || /^sem resposta\.?$/i.test(String(answer || "").trim())){
          answer=gracefulEmptyAnswer();
        }

        answer=await repairSparseCitationCoverage(env,meta.question,answer,meta.sources);
        answer=await enforceDenseEncyclopedicMode(env,meta.question,answer,meta.sources);
        const finalAnswer=finalizeGroundedAnswer(answer,meta.sources);
        const usedSources=selectCitedSources(finalAnswer,meta.sources);
        controller.enqueue(encoder.encode(sseFrame("delta",{text:finalAnswer})));
        answer=finalAnswer;

        const memoryPersisted = await persistChatTurn(
          env, meta.ownerId, meta.body, meta.question, answer, usedSources, meta.fallback
        );
        controller.enqueue(encoder.encode(sseFrame("done", {
          ok: true,
          resposta: answer,
          fontes: usedSources,
          fallback: meta.fallback,
          memory_persisted: memoryPersisted,
          provider: "groq+resilient-rag",
          retrieval_level: meta.retrievalLevel || 0,
          embedding_model: LOCAL_EMBEDDING_MODEL,
          chat_model: CHAT_MODEL,
          map_reduce: meta.mapReduceUsed === true,
          map_batches: Number(meta.mapBatches || 0),
          independent_documents: Number(meta.independentDocuments || 0),
          false_negative_guard: true,
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
      "Content-Type":"text/event-stream; charset=utf-8",
      "Cache-Control":"no-cache, no-transform",
      "X-Accel-Buffering":"no",
    })),
  });
}

function estimateTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(value.length / 3.2), Math.ceil(words * 1.35));
}

function trimToTokenBudget(text, budget) {
  const value = String(text || "");
  if (estimateTokens(value) <= budget) return value;
  const maxChars = Math.max(100, Math.floor(budget * 3.0));
  return value.slice(0, maxChars).replace(/\s+\S*$/, "").trim() + "…";
}

function slidingHistory(history, maxMessages = GROQ_HISTORY_MESSAGES, tokenBudget = GROQ_HISTORY_BUDGET_TOKENS) {
  const source = Array.from(history || []).slice(-Math.max(maxMessages * 2, maxMessages));
  const selected = [];
  let used = 0;
  for (let i = source.length - 1; i >= 0 && selected.length < maxMessages; i--) {
    const role = source[i]?.role === "assistant" ? "assistant" : "user";
    const content = trimToTokenBudget(String(source[i]?.content || ""), 600);
    const cost = estimateTokens(content) + 8;
    if (!content) continue;
    if (selected.length && used + cost > tokenBudget) break;
    if (!selected.length && cost > tokenBudget) {
      selected.push({ role, content: trimToTokenBudget(content, Math.max(200, tokenBudget - 8)) });
      break;
    }
    selected.push({ role, content });
    used += cost;
  }
  return selected.reverse();
}

function focusExcerptForQuestion(text, question, maxChars = 950) {
  const clean=cleanNarrativeText(text);
  if(!clean) return "";
  const terms=lexicalTerms(question);
  if(!terms.length || clean.length<=maxChars) return clean.slice(0,maxChars);
  const units=clean
    .replace(/\s+(?=\d{1,3}\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/g,"\n")
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/)
    .map(x=>x.trim()).filter(Boolean);
  if(!units.length) return clean.slice(0,maxChars);
  const scored=units.map((unit,index)=>{
    const folded=foldSearchText(unit);
    let score=0;
    for(const term of terms){
      if(folded.includes(term)) score+=2;
      const escaped=term.replace(/[.*+?^$()|[\]\\{}]/g,"\\$&");
      const re=new RegExp("\\b"+escaped+"\\b","g");
      score+=Math.min(3,(folded.match(re)||[]).length)*0.5;
    }
    return {unit,index,score};
  }).sort((a,b)=>b.score-a.score);
  const best=scored[0];
  if(!best || best.score<=0) return clean.slice(0,maxChars);
  let excerpt=best.unit;
  const prev=units[best.index-1] || "";
  const next=units[best.index+1] || "";
  if(prev && (prev.length+1+excerpt.length)<=maxChars) excerpt=prev+" "+excerpt;
  if(next && (excerpt.length+1+next.length)<=maxChars) excerpt=excerpt+" "+next;
  return excerpt.slice(0,maxChars).trim();
}

function buildMapBatchContext(batch,question="",batchIndex=0) {
  const rows=Array.from(batch || []).slice(0,MAP_BATCH_SIZE);
  const parts=[];
  for(let i=0;i<rows.length;i++){
    const c=rows[i];
    const globalIndex=batchIndex*MAP_BATCH_SIZE+i+1;
    const sourceName=humanDocumentName(c.filename,c.title);
    const header="[F"+globalIndex+"] "+sourceName+
      (c.author ? " — "+c.author : "")+
      ", página "+(c.page || "não informada");
    const focused=focusExcerptForQuestion(c.text || "",question,420);
    const excerpt=trimToTokenBudget(focused,105);
    if(!excerpt) continue;
    parts.push(header+"\n"+excerpt);
  }
  return parts.join("\n\n");
}

function buildRagContext(context, question = "", tokenBudget = GROQ_RAG_BUDGET_TOKENS) {
  if (!Array.isArray(context) || !context.length) {
    return "(Nenhum trecho da biblioteca foi recuperado para esta pergunta.)";
  }
  const parts = [];
  let used = 0;
  for (let i = 0; i < context.length; i++) {
    const c = context[i];
    const sourceName=humanDocumentName(c.filename,c.title);
    const header = "[F" + (i + 1) + "] " + sourceName +
      (c.author ? " — " + c.author : "") + ", página " + (c.page || "não informada");
    const remaining = Math.max(180, tokenBudget - used - estimateTokens(header) - 20);
    if (remaining <= 180 && parts.length) break;
    const focused=focusExcerptForQuestion(c.text || "",question,720);
    const excerpt = trimToTokenBudget(focused, Math.min(260, remaining));
    if(!excerpt) continue;
    const part = header + "\n" + excerpt;
    const cost = estimateTokens(part);
    if (parts.length && used + cost > tokenBudget) break;
    parts.push(part);
    used += cost;
  }
  return parts.join("\n\n");
}

function enforceGroqBudget(messages, budget = GROQ_INPUT_BUDGET_TOKENS) {
  const list = Array.from(messages || []).map(m => ({ role: m.role, content: String(m.content || "") }));
  let total = list.reduce((n, m) => n + estimateTokens(m.content) + 8, 0);
  if (total <= budget) return list;
  while (list.length > 2 && total > budget) {
    const removed = list.splice(1, 1)[0];
    total -= estimateTokens(removed.content) + 8;
  }
  if (total > budget && list.length) {
    const last = list[list.length - 1];
    const overflow = total - budget;
    const current = estimateTokens(last.content);
    last.content = trimToTokenBudget(last.content, Math.max(500, current - overflow - 120));
  }
  return list;
}

function aggressiveGroqMessages(messages) {
  const list=Array.from(messages || []);
  const system=list.find(m=>m.role==="system") || list[0];
  const newest=[...list].reverse().find(m=>m.role==="user") || list[list.length-1];
  return enforceGroqBudget([system,newest].filter(Boolean),GROQ_AGGRESSIVE_INPUT_BUDGET_TOKENS);
}

function groqInputTokenEstimate(messages) {
  return Array.from(messages || []).reduce((sum,m)=>sum+estimateTokens(m.content)+8,0);
}

function wantsMultipleSources(question) {
  return /\b(v[aá]rias?\s+(?:op[cç][oõ]es|fontes|refer[eê]ncias)|mais\s+de\s+uma|diversas?\s+fontes|liste\s+v[aá]rias|compare|comparar|todas?\s+as\s+refer[eê]ncias)\b/i.test(String(question || ""));
}

function isFocusedCitationRequest(question) {
  const q=String(question || "");
  return /\b(escritura|vers[ií]culo|passagem|cita[cç][aã]o|refer[eê]ncia|trecho|onde\s+(?:fala|diz)|o\s+que\s+.{0,80}(?:fala|diz)\s+sobre)\b/i.test(q);
}

function normalizeClientContext(items) {
  if(!Array.isArray(items)) return [];
  const out=[];
  for(const raw of items.slice(0,TOP_K)){
    const text=String(raw?.text || raw?.trecho || "").trim();
    if(!text) continue;
    out.push({
      id:String(raw?.id || raw?.key || crypto.randomUUID()).slice(0,180),
      document_id:String(raw?.document_id || raw?.doc_key || "client-local").slice(0,180),
      page:Number(raw?.page || raw?.pagina || 0) || null,
      chunk_index:Number(raw?.chunk_index || 0) || 0,
      text:text.slice(0,6000),
      filename:String(raw?.filename || raw?.arquivo || raw?.title || "Documento local").slice(0,300),
      title:String(raw?.title || raw?.titulo || raw?.filename || "Documento local").slice(0,500),
      author:String(raw?.author || raw?.autor || "").slice(0,300),
      language:String(raw?.language || raw?.idioma || "pt").slice(0,40),
      score:Number(raw?.score || 0),
      retrieval_mode:String(raw?.retrieval_mode || "client-resilience").slice(0,80),
    });
  }
  return out;
}

function ragProviderConfig(env, provider) {
  const p=String(provider || "").toLowerCase();
  const supabaseToken=env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_RAG_KEY;
  const map={
    supabase:{
      url:env.SUPABASE_RAG_SEARCH_URL || (env.SUPABASE_URL ? String(env.SUPABASE_URL).replace(/\/$/,"")+"/rest/v1/rpc/match_rag_embeddings" : ""),
      token:supabaseToken,header:"Authorization",prefix:"Bearer "
    },
    pinecone:{url:env.PINECONE_RAG_SEARCH_URL || env.PINECONE_QUERY_URL,token:env.PINECONE_API_KEY,header:"Api-Key",prefix:""},
    mongodb:{url:env.MONGODB_RAG_SEARCH_URL,token:env.MONGODB_RAG_API_KEY,header:"Authorization",prefix:"Bearer "},
    astra:{url:env.ASTRA_RAG_SEARCH_URL,token:env.ASTRA_DB_APPLICATION_TOKEN,header:"Token",prefix:""},
  };
  return map[p] || null;
}

async function externalRagProviderSearch(request, env) {
  const body=await request.json().catch(()=>({}));
  const provider=String(body?.provider || "").toLowerCase();
  const cfg=ragProviderConfig(env,provider);
  if(!cfg) return json({ok:false,configured:false,provider,message:"Provedor RAG desconhecido."},404);
  if(!cfg.url || !cfg.token) return json({ok:false,configured:false,provider,matches:[]},503);

  const queryEmbedding=Array.isArray(body?.query_embedding)?body.query_embedding.map(Number).filter(Number.isFinite).slice(0,2048):[];
  if(queryEmbedding.length<64) return json({ok:true,configured:true,provider,matches:[]});

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),1800);
  try{
    let res;
    if(provider==="supabase"){
      res=await fetch(String(cfg.url),{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":"Bearer "+String(cfg.token),
          "apikey":String(cfg.token)
        },
        signal:controller.signal,
        body:JSON.stringify({query_embedding:queryEmbedding,match_count:TOP_K})
      });
    }else if(provider==="pinecone"){
      res=await fetch(String(cfg.url),{
        method:"POST",
        headers:{"Content-Type":"application/json","Api-Key":String(cfg.token)},
        signal:controller.signal,
        body:JSON.stringify({vector:queryEmbedding,topK:TOP_K,includeMetadata:true,namespace:"fabiano"})
      });
    }else{
      const headers={"Content-Type":"application/json",[cfg.header]:cfg.prefix+String(cfg.token)};
      res=await fetch(String(cfg.url),{
        method:"POST",headers,signal:controller.signal,
        body:JSON.stringify({
          question:String(body?.question || body?.pergunta || "").slice(0,8000),
          query_embedding:queryEmbedding,
          top_k:TOP_K
        })
      });
    }

    const data=await res.json().catch(()=>({}));
    if(!res.ok) return json({ok:false,configured:true,provider,status:res.status,matches:[]},res.status);

    let raw=[];
    if(provider==="supabase"){
      raw=Array.isArray(data)?data:(data?.data || data?.matches || []);
    }else if(provider==="pinecone"){
      raw=(data?.matches || []).map(m=>({
        id:m.id,
        ...(m.metadata || {}),
        score:Number(m.score || 0),
        text:String(m?.metadata?.text || "")
      }));
    }else{
      raw=data?.matches || data?.data || [];
    }
    const matches=normalizeClientContext(raw)
      .filter(row=>strictParagraphMatch(row?.text||"",body?.question||body?.pergunta||"").matched)
      .map(row=>({...row,score:100,coverage:1,retrieval_mode:"strict-phrase-provider-v4"}));
    return json({ok:true,configured:true,provider,matches,fuzzy_disabled:true,or_disabled:true});
  }catch(error){
    return json({ok:false,configured:true,provider,matches:[],message:String(error?.message || error)},504);
  }finally{clearTimeout(timer);}
}

function normalizeMirrorRecords(items){
  if(!Array.isArray(items)) return [];
  return items.slice(0,100).map((raw,index)=>({
    id:String(raw?.id || raw?.key || ("mirror-"+index)).slice(0,180),
    document_id:String(raw?.document_id || raw?.doc_key || "unknown").slice(0,180),
    filename:String(raw?.filename || raw?.title || "Documento").slice(0,300),
    title:String(raw?.title || raw?.filename || "Documento").slice(0,500),
    author:String(raw?.author || "").slice(0,300),
    language:String(raw?.language || "pt").slice(0,40),
    page:Number(raw?.page || 0) || 0,
    chunk_index:Number(raw?.chunk_index || 0) || 0,
    text:String(raw?.text || "").slice(0,6000),
    vector:Array.isArray(raw?.vector) ? raw.vector.map(Number).filter(Number.isFinite).slice(0,2048) : []
  })).filter(r=>r.text && r.vector.length>=64);
}
function normalizeLibraryChunkRecords(items){
  if(!Array.isArray(items)) return [];
  return items.slice(0,200).map((raw,index)=>({
    id:String(raw?.id || raw?.key || ("library-"+index)).slice(0,180),
    document_id:String(raw?.document_id || raw?.doc_key || "unknown").slice(0,180),
    filename:String(raw?.filename || raw?.title || "Documento").slice(0,300),
    title:String(raw?.title || raw?.filename || "Documento").slice(0,500),
    author:String(raw?.author || "").slice(0,300),
    language:String(raw?.language || "pt").slice(0,40),
    page:Number(raw?.page || 0) || 0,
    chunk_index:Number(raw?.chunk_index || 0) || 0,
    text:String(raw?.text || "").slice(0,12000),
    content_hash:String(raw?.content_hash || "").slice(0,180)
  })).filter(r=>r.document_id && r.text);
}

async function mirrorLibraryChunks(request,env){
  const base=String(env.SUPABASE_URL || "").replace(/\/$/,"");
  const token=String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if(!base || !token) return json({ok:false,code:"SUPABASE_LIBRARY_MIRROR_UNAVAILABLE"},503);
  const body=await request.json().catch(()=>({}));
  const rows=normalizeLibraryChunkRecords(body?.records);
  if(!rows.length) return json({ok:true,records:0});
  const payload=rows.map(r=>({...r,updated_at:new Date().toISOString()}));
  const res=await fetch(base+"/rest/v1/library_chunks?on_conflict=id",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+token,
      "apikey":token,
      "Content-Type":"application/json",
      "Prefer":"resolution=merge-duplicates,return=minimal"
    },
    body:JSON.stringify(payload)
  });
  if(!res.ok){
    const txt=await res.text().catch(()=>"");
    return json({ok:false,code:"SUPABASE_LIBRARY_MIRROR_FAILED",message:"Supabase library mirror HTTP "+res.status+" "+txt.slice(0,240)},res.status);
  }
  return json({ok:true,records:payload.length});
}


async function mirrorSupabase(env,records){
  const base=String(env.SUPABASE_URL || "").replace(/\/$/,"");
  const token=String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if(!base || !token) return {provider:"supabase",configured:false,upserted:0};
  const payload=records.map(r=>({
    id:r.id,document_id:r.document_id,filename:r.filename,title:r.title,author:r.author,
    language:r.language,page:r.page,chunk_index:r.chunk_index,text:r.text,embedding:r.vector
  }));
  const res=await fetch(base+"/rest/v1/rag_embeddings?on_conflict=id",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+token,"apikey":token,"Content-Type":"application/json",
      "Prefer":"resolution=merge-duplicates,return=minimal"
    },
    body:JSON.stringify(payload)
  });
  if(!res.ok) throw new Error("Supabase mirror HTTP "+res.status);
  return {provider:"supabase",configured:true,upserted:payload.length};
}

async function mirrorPinecone(env,records){
  const url=String(env.PINECONE_UPSERT_URL || "");
  const key=String(env.PINECONE_API_KEY || "");
  if(!url || !key) return {provider:"pinecone",configured:false,upserted:0};
  const vectors=records.map(r=>({
    id:r.id,
    values:r.vector,
    metadata:{
      document_id:r.document_id,filename:r.filename,title:r.title,author:r.author,
      language:r.language,page:r.page,chunk_index:r.chunk_index,text:r.text
    }
  }));
  const res=await fetch(url,{
    method:"POST",
    headers:{"Api-Key":key,"Content-Type":"application/json"},
    body:JSON.stringify({vectors,namespace:"fabiano"})
  });
  if(!res.ok) throw new Error("Pinecone mirror HTTP "+res.status);
  return {provider:"pinecone",configured:true,upserted:vectors.length};
}

async function mirrorUpsert(request,env){
  const body=await request.json().catch(()=>({}));
  const records=normalizeMirrorRecords(body?.records).slice(0,50);
  if(!records.length) return json({ok:true,records:0,providers:[]});
  const providers=await Promise.allSettled([
    mirrorSupabase(env,records),
    mirrorPinecone(env,records)
  ]);
  const result=providers.map(x=>x.status==="fulfilled"?x.value:{configured:true,error:String(x.reason?.message||x.reason),upserted:0});
  return json({
    ok:true,records:records.length,providers:result,
    any_configured:result.some(x=>x.configured===true),
    any_upserted:result.some(x=>Number(x.upserted||0)>0)
  });
}

async function exportLibraryPage(env,url){
  const offset=Math.max(0,Number(url.searchParams.get("offset")||0));
  const limit=Math.max(1,Math.min(250,Number(url.searchParams.get("limit")||250)));
  return json(await libraryCall(env,"/export-page?offset="+offset+"&limit="+limit));
}


function detectExactRetrievalIntent(question) {
  const raw=String(question || "").trim();
  const q=foldSearchText(raw);
  const chapterMatch=q.match(/\b(?:capitulo|chapter)\s+(\d{1,4})\b/);
  const verseMatch=raw.match(/\b(\d{1,4})\s*:\s*(\d{1,4})\b/);
  const fullChapter=
    /\b(?:capitulo|chapter)\b.*\b(?:completo|inteiro|integral|na integra|full|whole|entire)\b/i.test(q) ||
    /\b(?:completo|inteiro|integral|na integra|full|whole|entire)\b.*\b(?:capitulo|chapter)\b/i.test(q);
  const exactVerse=
    /\b(?:versiculo|verse)\b.*\b(?:exato|literal|integral|exact|verbatim)\b/i.test(q) ||
    (/\b(?:exato|literal|exact|verbatim)\b/i.test(q) && Boolean(verseMatch));
  const rawText=
    /\b(?:texto exato|texto literal|texto integral|na integra|sem resumir|sem resumo|raw text|verbatim|transcreva|transcricao integral|copie exatamente|mostre exatamente)\b/i.test(q);
  const triggered=fullChapter || exactVerse || rawText;
  return {
    triggered,
    mode: fullChapter ? "full-chapter" : exactVerse ? "exact-verse" : rawText ? "raw-text" : "",
    chapter_number: chapterMatch ? Number(chapterMatch[1]) : (verseMatch ? Number(verseMatch[1]) : null),
    verse_number: verseMatch ? Number(verseMatch[2]) : null,
    raw_question: raw
  };
}

function sortSequentialChunks(rows) {
  return Array.from(rows || []).filter(r=>String(r?.text || "").length).sort((a,b)=>{
    const ai=Number.isFinite(Number(a?.chunk_index)) ? Number(a.chunk_index) : Number.MAX_SAFE_INTEGER;
    const bi=Number.isFinite(Number(b?.chunk_index)) ? Number(b.chunk_index) : Number.MAX_SAFE_INTEGER;
    if(ai!==bi) return ai-bi;
    const ap=Number(a?.page || 0), bp=Number(b?.page || 0);
    if(ap!==bp) return ap-bp;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

function stitchExactChunks(rows) {
  const ordered=sortSequentialChunks(rows);
  let out="";
  for(const row of ordered){
    const next=String(row?.text || "");
    if(!next) continue;
    if(!out){out=next;continue;}
    const max=Math.min(EXACT_CHUNK_OVERLAP_SCAN,out.length,next.length);
    let overlap=0;
    for(let n=max;n>=12;n--){
      if(out.slice(-n)===next.slice(0,n)){overlap=n;break;}
    }
    out += overlap ? next.slice(overlap) : "\n"+next;
  }
  return out;
}

function exactChapterSlice(text,chapterNumber,allowOpenEnd=false) {
  const raw=String(text || "");
  const n=Number(chapterNumber || 0);
  if(!raw || !n) return null;
  const startRe=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+n+"\\b","im");
  const startMatch=startRe.exec(raw);
  if(!startMatch) return null;
  let start=startMatch.index;
  if(raw[start]==="\n") start++;
  const tailStart=startMatch.index+startMatch[0].length;
  const nextRe=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+(n+1)+"\\b","im");
  const nextMatch=nextRe.exec(raw.slice(tailStart));
  if(!nextMatch && !allowOpenEnd) return null;
  const end=nextMatch ? tailStart+nextMatch.index : raw.length;
  const chapter=raw.slice(start,end).replace(/\s+$/,"");
  return chapter || null;
}

function exactVerseSlice(text,verseNumber) {
  const raw=String(text || "");
  const v=Number(verseNumber || 0);
  if(!raw || !v) return null;
  const startRe=new RegExp("(^|[\\n\\r]|\\s)"+v+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu");
  const startMatch=startRe.exec(raw);
  if(!startMatch) return null;
  const start=startMatch.index+(startMatch[1]?.length || 0);
  const rest=raw.slice(start+String(v).length);
  const nextRe=new RegExp("(^|[\\n\\r]|\\s)"+(v+1)+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu");
  const nextMatch=nextRe.exec(rest);
  const end=nextMatch ? start+String(v).length+nextMatch.index+(nextMatch[1]?.length || 0) : raw.length;
  return raw.slice(start,end).replace(/\s+$/,"") || null;
}

function chooseDirectAnchor(matches,question) {
  const rows=Array.from(matches || []);
  if(!rows.length) return null;
  const phrase=foldSearchText(question);
  const terms=lexicalTerms(question);
  return rows.map(row=>{
    const folded=foldSearchText(row?.text || "");
    const termHits=terms.reduce((n,t)=>n+(folded.includes(t)?1:0),0);
    const exact=phrase.length>=5 && folded.includes(phrase);
    return {row,rank:Number(row?.score || 0)+(exact?100:0)+termHits*2};
  }).sort((a,b)=>b.rank-a.rank)[0]?.row || rows[0];
}

function directWindowStart(anchor,intent) {
  const idx=Math.max(0,Number(anchor?.chunk_index || 0));
  if(intent?.mode==="full-chapter") return Math.max(0,idx-300);
  if(intent?.mode==="exact-verse") return Math.max(0,idx-80);
  return Math.max(0,idx-12);
}

function directWindowLimit(intent) {
  if(intent?.mode==="full-chapter") return EXACT_MAX_CHUNKS;
  if(intent?.mode==="exact-verse") return 240;
  return 48;
}

function directAssemble(rows,intent,anchor,windowExhausted=false) {
  const ordered=sortSequentialChunks(rows);
  if(!ordered.length) return {text:"",scope:"none",chunks:0};
  const stitched=stitchExactChunks(ordered);

  if(intent?.mode==="full-chapter" && intent?.chapter_number){
    const chapter=exactChapterSlice(stitched,intent.chapter_number,windowExhausted);
    if(chapter) return {text:chapter,scope:"full-chapter",chunks:ordered.length};
    return {text:"",scope:"chapter-boundary-incomplete",chunks:ordered.length};
  }

  if(intent?.mode==="exact-verse"){
    let base=stitched;
    if(intent?.chapter_number){
      const chapter=exactChapterSlice(stitched,intent.chapter_number,windowExhausted);
      if(chapter) base=chapter;
    }
    if(intent?.verse_number){
      const verse=exactVerseSlice(base,intent.verse_number);
      if(verse) return {text:verse,scope:"exact-verse",chunks:ordered.length};
    }
    const rawAnchor=String(anchor?.text || "");
    if(rawAnchor) return {text:rawAnchor,scope:"exact-anchor-chunk",chunks:1};
  }

  if(intent?.mode==="raw-text"){
    const anchorIndex=ordered.findIndex(r=>String(r?.id || "")===String(anchor?.id || ""));
    if(anchorIndex>=0){
      const slice=ordered.slice(Math.max(0,anchorIndex-2),Math.min(ordered.length,anchorIndex+3));
      return {text:stitchExactChunks(slice),scope:"raw-exact-window",chunks:slice.length};
    }
  }

  return {text:stitched,scope:"ordered-raw-window",chunks:ordered.length};
}

async function exactSleep(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}

function exactCircuitTrip(reason, immediate=false) {
  exactSupabaseCircuit.failures = immediate
    ? EXACT_CIRCUIT_FAILURE_THRESHOLD
    : exactSupabaseCircuit.failures + 1;
  exactSupabaseCircuit.last_reason=String(reason || "overload");
  if(exactSupabaseCircuit.failures>=EXACT_CIRCUIT_FAILURE_THRESHOLD){
    const pause=EXACT_CIRCUIT_BASE_PAUSE_MS*(2**Math.min(4,exactSupabaseCircuit.backoff_round));
    exactSupabaseCircuit.open_until=Date.now()+pause;
    exactSupabaseCircuit.backoff_round++;
    exactSupabaseCircuit.degraded=true;
  }
}

function exactCircuitRecover() {
  exactSupabaseCircuit.failures=0;
  if(Date.now()>=exactSupabaseCircuit.open_until){
    exactSupabaseCircuit.open_until=0;
  }
}

async function exactGuardedFetch(url,options={}) {
  if(Date.now()<exactSupabaseCircuit.open_until){
    await exactSleep(exactSupabaseCircuit.open_until-Date.now());
  }
  let lastError=null;
  for(let attempt=0;attempt<EXACT_MAX_RETRIES;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),EXACT_CIRCUIT_SLOW_MS+800);
    const started=Date.now();
    try{
      const res=await fetch(url,{...options,signal:controller.signal});
      const elapsed=Date.now()-started;
      if(elapsed>EXACT_CIRCUIT_SLOW_MS){
        exactCircuitTrip("latency>"+EXACT_CIRCUIT_SLOW_MS,true);
      }
      if(res.status===429 || res.status>=500){
        exactCircuitTrip("http-"+res.status,false);
        lastError=new Error("Supabase exact HTTP "+res.status);
        if(Date.now()<exactSupabaseCircuit.open_until){
          await exactSleep(exactSupabaseCircuit.open_until-Date.now());
        }else{
          await exactSleep(EXACT_CIRCUIT_BASE_PAUSE_MS*(2**attempt));
        }
        continue;
      }
      if(!res.ok){
        const err=new Error("Supabase exact HTTP "+res.status);
        err.status=res.status;
        throw err;
      }
      exactCircuitRecover();
      return res;
    }catch(error){
      lastError=error;
      exactCircuitTrip(error?.name==="AbortError"?"timeout":String(error?.message||error),error?.name==="AbortError");
      if(attempt<EXACT_MAX_RETRIES-1){
        const delay=Date.now()<exactSupabaseCircuit.open_until
          ? exactSupabaseCircuit.open_until-Date.now()
          : EXACT_CIRCUIT_BASE_PAUSE_MS*(2**attempt);
        await exactSleep(delay);
      }
    }finally{
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Supabase exact retrieval unavailable");
}

async function supabaseExactDocumentChunks(env,documentId,startChunk,limit) {
  const base=String(env?.SUPABASE_URL || "").replace(/\/$/,"");
  const token=String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_RAG_KEY || "").trim();
  if(!base || !token || !documentId) return [];
  const wanted=Math.max(1,Math.min(EXACT_MAX_CHUNKS,Number(limit || EXACT_MAX_CHUNKS)));
  const pages=Math.ceil(wanted/EXACT_REMOTE_PAGE_SIZE);
  const tasks=Array.from({length:pages},(_,i)=>i);
  const concurrency=exactSupabaseCircuit.degraded ? EXACT_DEGRADED_CONCURRENCY : EXACT_MAX_CONCURRENT_REQUESTS;
  const results=await runAsyncWorkerPool(tasks,concurrency,async pageIndex=>{
    const endpoint=new URL(base+"/rest/v1/library_chunks");
    endpoint.searchParams.set("select","id,document_id,filename,title,author,language,page,chunk_index,text,content_hash,updated_at");
    endpoint.searchParams.set("document_id","eq."+String(documentId));
    endpoint.searchParams.set("chunk_index","gte."+Math.max(0,Number(startChunk||0)));
    endpoint.searchParams.set("order","chunk_index.asc");
    endpoint.searchParams.set("limit",String(EXACT_REMOTE_PAGE_SIZE));
    endpoint.searchParams.set("offset",String(pageIndex*EXACT_REMOTE_PAGE_SIZE));
    const res=await exactGuardedFetch(endpoint.toString(),{
      headers:{
        "Authorization":"Bearer "+token,
        "apikey":token,
        "Accept":"application/json"
      }
    });
    const rows=await res.json().catch(()=>[]);
    return Array.isArray(rows)?rows:[];
  });
  const rows=sortSequentialChunks(results.filter(Array.isArray).flat()).slice(0,wanted);
  return {rows,exhausted:rows.length<wanted};
}

async function durableExactDocumentChunks(env,documentId,startChunk,limit) {
  const data=await libraryCall(
    env,
    "/chunks-range?document_id="+encodeURIComponent(String(documentId || ""))+
      "&start_chunk="+Math.max(0,Number(startChunk || 0))+
      "&limit="+Math.max(1,Math.min(EXACT_MAX_CHUNKS,Number(limit || EXACT_MAX_CHUNKS)))
  );
  return {
    rows:Array.isArray(data?.chunks) ? data.chunks : [],
    exhausted:data?.has_more===false
  };
}

async function directRetrievalPayload(env,body) {
  const question=String(body?.question || body?.pergunta || "").trim();
  const intent=detectExactRetrievalIntent(question);
  if(!intent.triggered){
    return {ok:false,direct:false,code:"DIRECT_INTENT_NOT_DETECTED"};
  }

  let anchors=[];
  let anchorError="";
  try{
    anchors=await retrieveContext(
      env,
      question,
      Array.isArray(body?.query_embedding) ? body.query_embedding.map(Number) : null
    );
  }catch(error){
    anchorError=String(error?.message || error);
  }
  const anchor=chooseDirectAnchor(anchors,question);
  if(!anchor){
    return {
      ok:false,direct:true,bypass_llm:true,code:"DIRECT_ANCHOR_UNAVAILABLE",
      intent,provider:"none",anchor_error:anchorError
    };
  }

  const startChunk=directWindowStart(anchor,intent);
  const limit=directWindowLimit(intent);
  let rows=[];
  let windowExhausted=false;
  let provider="durable-object";
  try{
    const durable=await durableExactDocumentChunks(env,anchor.document_id,startChunk,limit);
    rows=durable.rows;
    windowExhausted=durable.exhausted===true;
  }catch{}

  if(!rows.length){
    provider="supabase-postgrest";
    try{
      const supabase=await supabaseExactDocumentChunks(env,anchor.document_id,startChunk,limit);
      rows=supabase.rows;
      windowExhausted=supabase.exhausted===true;
    }catch{}
  }

  if(!rows.length){
    rows=[anchor];
    windowExhausted=false;
    provider=String(anchor?.retrieval_mode || "anchor-only");
  }

  const logical=sortSequentialChunks(rows).slice(0,EXACT_SWARM_NODE_COUNT);
  const processed=await runAsyncWorkerPool(
    logical,
    EXACT_MAX_CONCURRENT_REQUESTS,
    async (row,index)=>({
      ...row,
      __logical_node:index+1,
      __ordered_index:Number(row?.chunk_index || index)
    })
  );
  const ordered=sortSequentialChunks(processed);
  const assembled=directAssemble(ordered,intent,anchor,windowExhausted);
  if(!assembled.text){
    return {ok:false,direct:true,bypass_llm:true,code:"DIRECT_TEXT_EMPTY",intent,provider};
  }

  return {
    ok:true,
    direct:true,
    bypass_llm:true,
    text:assembled.text,
    scope:assembled.scope,
    intent,
    provider,
    document_id:String(anchor?.document_id || ""),
    filename:String(anchor?.filename || anchor?.title || "Documento"),
    title:String(anchor?.title || anchor?.filename || "Documento"),
    author:String(anchor?.author || ""),
    page:Number(anchor?.page || 0) || null,
    anchor_chunk_index:Number(anchor?.chunk_index || 0),
    logical_swarm_size:EXACT_SWARM_NODE_COUNT,
    logical_nodes_used:ordered.length,
    max_concurrency:EXACT_MAX_CONCURRENT_REQUESTS,
    ordered_buffer:true,
    chunks_reassembled:assembled.chunks,
    llm_calls:0,
    circuit_breaker:{
      failure_threshold:EXACT_CIRCUIT_FAILURE_THRESHOLD,
      slow_ms:EXACT_CIRCUIT_SLOW_MS,
      degraded_concurrency:EXACT_DEGRADED_CONCURRENCY,
      degraded:exactSupabaseCircuit.degraded===true
    }
  };
}

async function directRetrievalResponse(request,env) {
  const body=await request.json().catch(()=>({}));
  const result=await directRetrievalPayload(env,body);
  if(result.ok) return json(result);
  const status=result.code==="DIRECT_INTENT_NOT_DETECTED" ? 400 : 503;
  return json(result,status);
}

async function chat(request, env) {
  const body = await request.json().catch(() => ({}));
  const question = String(body?.pergunta || "").trim();
  if (question.length < 2) return json({ ok: false, message: "Pergunta vazia." }, 400);

  const exactIntent=detectExactRetrievalIntent(question);
  if(exactIntent.triggered){
    const direct=await directRetrievalPayload(env,body);
    const answer=direct.ok
      ? String(direct.text || "")
      : "Não foi possível recuperar o texto documental exato neste momento. O modo de leitura direta não acionou o LLM.";
    const wantsStream=
      String(request.headers.get("Accept") || "").includes("text/event-stream") ||
      body?.stream === true;
    const payload={
      ok:direct.ok,
      resposta:answer,
      fontes:direct.ok ? [{
        document_id:direct.document_id,
        arquivo:direct.filename,
        titulo:direct.title,
        autor:direct.author,
        pagina:direct.page,
        ref_id:"RAW1"
      }] : [],
      fallback:!direct.ok,
      bypass_llm:true,
      direct_retrieval:true,
      direct_scope:direct.scope || "",
      direct_provider:direct.provider || "none",
      logical_swarm_size:EXACT_SWARM_NODE_COUNT,
      max_concurrency:EXACT_MAX_CONCURRENT_REQUESTS,
      ordered_buffer:true,
      chunks_reassembled:Number(direct.chunks_reassembled || 0),
      code:direct.code || ""
    };
    if(wantsStream){
      const frames=
        sseFrame("meta",{...payload,resposta:undefined})+
        sseFrame("delta",{text:answer,raw_document:true})+
        sseFrame("done",payload);
      return new Response(frames,{status:direct.ok?200:503,headers:securityHeaders(new Headers({
        "Content-Type":"text/event-stream; charset=utf-8",
        "Cache-Control":"no-cache, no-transform",
        "X-Accel-Buffering":"no"
      }))});
    }
    return json(payload,direct.ok?200:503);
  }

  requireGroqKeys(env);

  const ownerId = await memoryOwner(request, body);
  const clientHistory = Array.isArray(body?.historico) ? body.historico.slice(-GROQ_HISTORY_MESSAGES * 2) : [];
  let storedHistory = [];
  try {
    storedHistory = await readPersistentHistory(env, ownerId, Math.min(MAX_SERVER_HISTORY, GROQ_HISTORY_MESSAGES * 2));
  } catch {}
  const historySource = storedHistory.length
    ? storedHistory.map(x => ({ role: x.role, content: x.content }))
    : clientHistory;
  const history = slidingHistory(historySource);

  const clientContext = normalizeClientContext(body?.client_context);
  let context = clientContext;
  let retrievalLevel=Number(body?.retrieval_level || 0) || (clientContext.length ? 2 : 0);
  let retrievalUnavailable = false;

  // V2.0: contexto local e remoto sempre são fundidos; falha remota não apaga o índice local.
  if(env.LIBRARY){
    try {
      const serverContext = await retrieveContext(
        env,
        question,
        Array.isArray(body?.query_embedding) ? body.query_embedding.map(Number) : null
      );
      context = mergeRetrievedMatches(clientContext, serverContext);
      if(serverContext.length) retrievalLevel=Math.max(retrievalLevel,5);
    } catch (error) {
      if (error?.code === "EXTERNAL_AI_NOT_CONFIGURED") throw error;
      if (error?.code === "RAG_RETRIEVAL_UNAVAILABLE") retrievalUnavailable = true;
      context = clientContext;
    }
  }

  context=(Array.isArray(context)?context:[])
    .filter(row=>strictParagraphMatch(row?.text||row?.trecho||"",question).matched)
    .map(row=>({...row,score:100,coverage:1,retrieval_mode:String(row?.retrieval_mode||"strict-phrase-v4")}));
  const mappedContext = diversifyContextAcrossDocuments(context,TOP_K);
  const crossLibrary = crossLibraryStats(mappedContext);
  const sources = uniqueSources(mappedContext).slice(0,MASSIVE_NODE_COUNT);
  const fallback = sources.length === 0;
  const wantsStream =
    String(request.headers.get("Accept") || "").includes("text/event-stream") ||
    body?.stream === true;

  if(fallback){
    const emptyAnswer = retrievalUnavailable ? RETRIEVAL_UNAVAILABLE_ANSWER : EMPTY_GROUNDED_ANSWER;
    const emptyProvider = retrievalUnavailable ? "retrieval-unavailable-guard" : "grounding-guard";
    if(wantsStream){
      const payload=sseFrame("done",{
        ok:true,resposta:emptyAnswer,fontes:[],fallback:true,retrieval_unavailable:retrievalUnavailable,
        strict_empty:!retrievalUnavailable,zero_noise:!retrievalUnavailable,
        provider:emptyProvider,retrieval_level:retrievalLevel,
        embedding_model:LOCAL_EMBEDDING_MODEL,chat_model:CHAT_MODEL,
        map_reduce:false,map_batches:0,
        micro_nodes_total:MASSIVE_NODE_COUNT,
        active_worker_limit:MASSIVE_WORKER_CONCURRENCY
      });
      return new Response(payload,{headers:securityHeaders(new Headers({
        "Content-Type":"text/event-stream; charset=utf-8",
        "Cache-Control":"no-cache, no-transform"
      }))});
    }
    return json({
      ok:true,resposta:emptyAnswer,fontes:[],fallback:true,retrieval_unavailable:retrievalUnavailable,
      strict_empty:!retrievalUnavailable,zero_noise:!retrievalUnavailable,
      provider:emptyProvider,retrieval_level:retrievalLevel,
      embedding_model:LOCAL_EMBEDDING_MODEL,chat_model:CHAT_MODEL,
      map_reduce:false,map_batches:0,
      micro_nodes_total:MASSIVE_NODE_COUNT,
      active_worker_limit:MASSIVE_WORKER_CONCURRENCY
    });
  }

  if (wantsStream) {
    return massivePipelineStreamResponse(env,{
      ownerId,body,question,sources,history,retrievalLevel,
      independentDocuments:crossLibrary.independent_documents
    });
  }

  const reduced=await massivePipelineSynthesis(env,question,sources,history);
  let answer = String(reduced.masterSynthesis || "").trim();
  if(sources.length>0 && isEmptyGroundedFailure(answer)) answer=deterministicSynthesisFromSources(sources);
  answer = finalizeGroundedAnswer(answer,sources);
  const usedSources=selectCitedSources(answer,sources);
  const memoryPersisted = await persistChatTurn(env, ownerId, body, question, answer, usedSources, false);

  return json({
    ok: true,
    resposta: answer,
    fontes: usedSources,
    fallback: false,
    memory_persisted: memoryPersisted,
    provider: "groq+500-node-async-rag",
    retrieval_level: retrievalLevel,
    embedding_model: LOCAL_EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
    map_reduce: true,
    map_batches: reduced.batches,
    independent_documents: crossLibrary.independent_documents,
    micro_nodes_total: MASSIVE_NODE_COUNT,
    micro_nodes_executed: reduced.micro_nodes_executed,
    micro_nodes_failed: reduced.micro_nodes_failed,
    active_worker_limit: MASSIVE_WORKER_CONCURRENCY,
    relay_mode: "async-worker-pool",
    master_node: "final-fusion",
    ui_virtualization: true
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
  if (!groqApiKeys(env).length) missing.push("GROQ_API_KEY_POOL");
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
    architecture: "cloudflare-v7.1-fabiano-r2-cross-device",
    storage_backend: "durable-object-sqlite",
    cross_device_storage: "r2-native-binding",
    pdf_storage: (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) ? "r2-direct-presigned" : "r2-direct-not-configured",
    ingest_backend: "client-pdfjs-lexical-first-local-transformers",
    client_pdf_extraction: "pdf.js",
    server_pdf_parsing: false,
    chunk_concurrency_limit: CHUNK_CONCURRENCY,
    embedding_concurrency_limit: EMBED_CONCURRENCY,
    local_checkpoint_backend: "indexeddb",
    local_worker_isolation: true,
    embedding_adapter: "browser-web-worker",
    smart_chunking: true,
    lexical_rag_fallback: true,
    semantic_min_score: SEMANTIC_MIN_SCORE,
    search_top_k: TOP_K,
    rag_map_reduce: true,
    anti_hallucination_mode: "strict-grounded",
    groq_temperature: 0.0,
    deterministic_reference_rendering: true,
    cross_document_citation_mode: "mandatory",
    anti_bibliographic_isolation: true,
    false_negative_synthesis_guard: true,
    full_library_recall_hotfix: true,
    client_and_server_context_merge: true,
    lexical_full_scan_limit: VECTOR_SCAN_LIMIT,
    lexical_single_anchor_opens_pipeline: true,
    supabase_lexical_fallback: true,
    durable_object_quota_fails_open_to_supabase: true,
    empty_mirror_is_not_empty_library: true,
    retrieval_unavailable_is_distinct_from_no_match: true,
    failure_message_requires_zero_sources: true,
    total_source_release: true,
    map_stage_can_filter_sources: false,
    deterministic_sources_use_cited_only: true,
    encyclopedic_dictionary_mode: true,
    transversal_mass_scan: true,
    diversity_round_robin: true,
    retrieval_candidates_are_not_evidence: true,
    encyclopedic_cohesion_guard: true,
    raw_excerpt_dump_in_references: false,
    inline_citation_grounding: true,
    synthesis_independent_document_cap: TOP_K,
    multicloud_mirror: true,
    provider_auth_surface: "server-side-secrets-only",
    client_provider_keys_exposed: false,
    supabase_transport: "postgrest-https",
    direct_postgres_connections: 0,
    logical_worker_nodes: MASSIVE_NODE_COUNT,
    worker_pool_concurrency: MASSIVE_WORKER_CONCURRENCY,
    exact_match_llm_bypass: true,
    exact_swarm_logical_nodes: EXACT_SWARM_NODE_COUNT,
    exact_max_concurrent_requests: EXACT_MAX_CONCURRENT_REQUESTS,
    exact_degraded_concurrency: EXACT_DEGRADED_CONCURRENCY,
    exact_circuit_failure_threshold: EXACT_CIRCUIT_FAILURE_THRESHOLD,
    exact_circuit_slow_ms: EXACT_CIRCUIT_SLOW_MS,
    exact_ordered_buffer: true,
    exact_local_indexeddb_takeover: true,
    exact_zero_model_rewrite: true,
    queue_strategy: "fifo-exponential-backoff",
    router_pattern: "micro-kernel-event-router-hybrid",
    frontend_switchboard_only: true,
    strict_lazy_local_engines: true,
    fallback_module_loading: "dynamic-import-on-failure",
    failover_tiers: 6,
    failover_order: ["A-primary","B-multi-cloud","C-indexeddb","D-static-vault","E-desktop-node","F-raw-vault"],
    plan_b_manifest_driven: true,
    plan_c_indexeddb_lazy: true,
    plan_d_service_worker_static_vault: true,
    plan_e_desktop_node: true,
    plan_f_raw_vault: true,
    plan_c_local_worker_pool: true,
    plan_c_logical_task_capacity: 1000,
    plan_c_physical_worker_cap: 16,
    plan_c_worker_count_source: "navigator.hardwareConcurrency",
    plan_c_main_thread_extraction: false,
    plan_c_offline_intelligence: "strict-same-paragraph-phrase-v4",
    plan_c_virtualized_result_cards: true,
    plan_c_card_gap_px: 40,
    plan_c_window_expansion: true,
    plan_c_context_before: 2,
    plan_c_context_after: 4,
    plan_c_full_chunk_fallback: true,
    plan_c_sequential_chunk_merge: true,
    plan_c_canonical_reference_elevation: true,
    plan_c_boolean_exact_match: true,
    plan_c_hard_bm25_threshold: 3.25,
    plan_c_hard_min_coverage: 0.50,
    plan_c_zero_noise: true,
    plan_c_elegant_silence: true,
    plan_c_fuzzy_compensation_disabled: true,
    plan_c_strict_reference_local_first: true,
    plan_c_strict_reference_cloud_fuzzy_bypass: true,
    plan_c_terminal_zero_hit: true,
    universal_strict_match_core: "strict-match-core-v4",
    online_offline_search_symmetry: true,
    same_paragraph_phrase_required: true,
    fuzzy_matching_disabled: true,
    or_matching_disabled: true,
    omni_library_sync: true,
    omni_sync_batch_size: 200,
    omni_sync_worker: true,
    omni_sync_memory_flush: true,
    omni_search_all_documents: true,
    omni_logical_task_capacity: 1000,
    omni_physical_worker_cap: 16,
    omni_virtual_scroller: true,
    omni_card_gap_px: 40,
    agent_swarm_enabled: true,
    agent_swarm_logical_nodes: 20,
    agent_swarm_physical_worker_cap: 16,
    agent_swarm_cpu_governor: "navigator.hardwareConcurrency",
    agent1_literal_exact: true,
    agent2_transformers_semantic: true,
    agent2_model: LOCAL_EMBEDDING_MODEL,
    agent3_context_window: "2-before-4-after",
    agent4_reference_judge: true,
    agent5_9_partition_sweep: true,
    agent10_bouncer: true,
    agent11_short_entity_hunter: true,
    agent12_long_form_explainer: true,
    agent13_freshness_sentinel: true,
    agent14_ocr_rescue: true,
    agent15_definition_specialist: true,
    agent16_chronology_mapper: true,
    agent17_cross_library_balancer: true,
    agent18_citation_specialist: true,
    agent19_conflict_auditor: true,
    agent20_mission_master: true,
    semantic_fallback_after_literal_miss: true,
    semantic_fallback_min_score: 0.62,
    bouncer_semantic_min_score: 0.72,
    bouncer_semantic_min_coverage: 0.50,
    reference_queries_remain_exact: true,
    phantom_daemon: true,
    phantom_daemon_target_interval_ms: 180000,
    phantom_daemon_service_worker: true,
    phantom_daemon_periodic_sync_best_effort: true,
    phantom_daemon_origin_heartbeat: true,
    omni_sync_cloud_fingerprint: true,
    omni_sync_generation_gc: true,
    omni_sync_manual_button: false,
    omni_sync_zero_touch_after_authorization: true,
    cross_device_library_mirror: true,
    cross_device_storage_backend: "cloudflare-r2",
    cross_device_r2_binding: "PDFS",
    cross_device_r2_bucket: "consciencia-fabiano-pdfs",
    cross_device_plaintext_chunk_sync: true,
    cross_device_no_supabase_dependency: true,
    cross_device_backfill_from_indexeddb: true,
    cross_device_mobile_hydration: true,
    cross_device_r2_generation_pointer: true,
    cross_device_batch_size: 200,
    map_reduce_threshold: MAP_REDUCE_THRESHOLD,
    map_batch_size: MAP_BATCH_SIZE,
    micro_node_chain: false,
    async_worker_pool: true,
    micro_node_count: MASSIVE_NODE_COUNT,
    micro_node_batch_size: MASSIVE_NODE_GROUP_SIZE,
    streaming_relay: "async-worker-pool",
    master_node: "final-fusion",
    master_fusion_mode: "massive-dense-encyclopedic",
    micro_node_temperature: 0.0,
    active_worker_limit: MASSIVE_WORKER_CONCURRENCY,
    max_bubbles_per_query: MASSIVE_NODE_COUNT,
    service_worker_static_vault: true,
    desktop_fallback_port: 8788,
    raw_vault_fallback: true,
    sse_keepalive_ms: SSE_KEEPALIVE_MS,
    groq_round_robin_key_rotation: true,
    groq_429_retry_limit: MASSIVE_GROQ_MAX_RETRIES,
    post_master_llm_rewrite: false,
    require_lexical_match: REQUIRE_LEXICAL_MATCH,
    lexical_ranker: "bm25",
    bm25_k1: BM25_K1,
    bm25_b: BM25_B,
    chunking_density: "paragraph-verse-granular",
    lexical_min_coverage: LEXICAL_MIN_COVERAGE,
    graceful_empty_answer: true,
    tts_clean_synthesis: true,
    citation_bullet_mode: true,
    pdf_noise_filter: true,
    indexeddb_gc: true,
    cache_busting: "dynamic",
    local_whisper_stt: true,
    local_whisper_model: "Xenova/whisper-tiny",
    rag_resilience_levels: 10,
    rag_local_levels: [1,2,3,10],
    rag_cloudflare_level: 5,
    rag_external_slots: [],
    supabase_mirror_configured: false,
    pinecone_mirror_configured: Boolean(env.PINECONE_UPSERT_URL && env.PINECONE_API_KEY),
    local_library_catalog: true,
    admin_access_password_version: "gadu-v1",
    groq_history_window: GROQ_HISTORY_MESSAGES,
    groq_input_budget_tokens: GROQ_INPUT_BUDGET_TOKENS,
    groq_aggressive_budget_tokens: GROQ_AGGRESSIVE_INPUT_BUDGET_TOKENS,
    groq_max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
    r2_direct_ready: Boolean(env.PDFS),
    vector_backend: "durable-object-cosine",
    llm_provider: "groq",
    embedding_provider: "browser-transformers",
    legacy_embedding_provider: "cohere-disabled",
    local_embedding_model: LOCAL_EMBEDDING_MODEL,
    local_embedding_dimensions: LOCAL_EMBEDDING_DIMENSIONS,
    workers_ai_used: false,
    render_dependency: false,
    r2_direct_ready: Boolean(env.PDFS),
    r2_bucket: "consciencia-fabiano-pdfs",
    official_workers_host: "consciencia-fabiano.focoeepoder2.workers.dev",
    bindings_missing: missing,
    documents, chunks, memory_messages: memoryMessages, index_jobs: indexJobs,
    embedding_model: LOCAL_EMBEDDING_MODEL,
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
    if (url.pathname === "/api/admin/ping" && request.method === "GET") return json({ok:true,authorized:true,version:VERSION});
    if (url.pathname === "/api/admin/mirror-upsert" && request.method === "POST") return mirrorUpsert(request,env);
    if (url.pathname === "/api/admin/r2-library-shard" && request.method === "POST") return r2LibraryShardUpsert(request,env);
    if (url.pathname === "/api/admin/r2-library-finalize" && request.method === "POST") return r2LibraryFinalize(request,env);
    if (url.pathname === "/api/admin/export-library" && request.method === "GET") return exportLibraryPage(env,url);
    if (url.pathname === "/api/admin/omni-sync-state" && request.method === "GET") return r2OmniSyncState(env);
    if (url.pathname === "/api/admin/omni-sync-page" && request.method === "GET") return r2OmniSyncPage(env,url);
        if (url.pathname === "/api/rag/config" && request.method === "GET") {
      return json({
        ok:true,
        levels:10,
        providers:{
          supabase:Boolean(env.SUPABASE_RAG_SEARCH_URL && env.SUPABASE_RAG_KEY),
          pinecone:Boolean(env.PINECONE_RAG_SEARCH_URL && env.PINECONE_API_KEY),
          mongodb:Boolean(env.MONGODB_RAG_SEARCH_URL && env.MONGODB_RAG_API_KEY),
          astra:Boolean(env.ASTRA_RAG_SEARCH_URL && env.ASTRA_DB_APPLICATION_TOKEN)
        }
      });
    }
    if (url.pathname === "/api/rag/provider-search" && request.method === "POST") return externalRagProviderSearch(request,env);
    if (url.pathname === "/api/rag/direct" && request.method === "POST") return directRetrievalResponse(request,env);
    if (url.pathname === "/api/rag/search" && request.method === "POST") {
      const body=await request.json().catch(()=>({}));
      const question=String(body?.question || body?.pergunta || "").trim();
      if(!question) return json({ok:true,matches:[],retrieval_level:5});
      if(!env.LIBRARY) return json({ok:false,matches:[],retrieval_level:5,code:"LIBRARY_UNAVAILABLE"},503);
      try{
        const matches=await retrieveContext(env,question,Array.isArray(body?.query_embedding)?body.query_embedding.map(Number):null);
        return json({ok:true,matches,retrieval_level:5});
      }catch(error){
        return json({ok:false,matches:[],retrieval_level:5,code:error?.code || "RAG_LEVEL5_FAILED",message:String(error?.message || error)},503);
      }
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
    if (url.pathname === "/api/trigger-index" && request.method === "POST") return json({ok:false,code:"LOCAL_EMBEDDINGS_REQUIRED",message:"Fluxo remoto de embeddings desativado. Atualize a página e use o motor local com Web Worker."},410);
    if (url.pathname === "/api/index-status" && request.method === "GET") return indexStatus(env, url);
    if (url.pathname === "/api/admin/livros" && request.method === "GET") return json(await listBooks(env));
    if (url.pathname === "/api/admin/delete-pdf" && request.method === "POST") return await deletePdf(request, env);
    if (url.pathname === "/api/admin/local-ingest-start" && request.method === "POST") return await localIngestStart(request, env);
    if (url.pathname === "/api/admin/local-ingest-append" && request.method === "POST") return await localIngestAppend(request, env);
    if (url.pathname === "/api/admin/local-ingest-commit" && request.method === "POST") return await localIngestCommit(request, env);
    if (url.pathname === "/api/admin/local-vector-chunks" && request.method === "GET") return await localVectorChunks(env, url);
    if (url.pathname === "/api/admin/local-vector-update" && request.method === "POST") return await localVectorUpdate(request, env);
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
      addJobColumn("processed_pages","INTEGER NOT NULL DEFAULT 0");
      const docColumns=[...this.sql.exec("PRAGMA table_info(documents)")].map(row=>String(row.name || ""));
      if(!docColumns.includes("r2_key")) this.sql.exec("ALTER TABLE documents ADD COLUMN r2_key TEXT");
      if(!docColumns.includes("embedding_model")) this.sql.exec("ALTER TABLE documents ADD COLUMN embedding_model TEXT");
      if(!docColumns.includes("embedding_dimensions")) this.sql.exec("ALTER TABLE documents ADD COLUMN embedding_dimensions INTEGER NOT NULL DEFAULT 0");
      const pending=[...this.sql.exec("SELECT id FROM index_jobs WHERE status IN ('queued','processing') ORDER BY updated_at LIMIT 1")][0] || null;
      if(pending?.id) await this.ctx.storage.setAlarm(Date.now()+250);
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
    const job=[...this.sql.exec(
      "SELECT id,filename,size_bytes,status,attempts,expected_pages,received_pages,title,author,content_sha256,original_r2_key,document_id,pages,chunks,processed_pages FROM index_jobs WHERE id=? LIMIT 1",
      jobId
    )][0];
    if(!job || ["ready","duplicate","failed","receiving"].includes(String(job.status))) return;

    this.sql.exec(
      "UPDATE index_jobs SET status='processing',error=NULL,updated_at=? WHERE id=?",
      new Date().toISOString(),jobId
    );

    let documentId=String(job.document_id || "");
    try {
      const digest=String(job.content_sha256 || "").trim();
      if(!/^[0-9a-f]{64}$/i.test(digest)) throw new Error("SHA-256 do documento inválido.");

      const stats=[...this.sql.exec(
        "SELECT COUNT(*) AS pages,COALESCE(SUM(LENGTH(text)),0) AS chars FROM job_text_pages WHERE job_id=?",
        jobId
      )][0] || {pages:0,chars:0};
      const actualPages=Number(stats.pages || 0), totalChars=Number(stats.chars || 0);
      if(!actualPages || !totalChars) throw new Error("Nenhum texto útil foi recebido do navegador.");

      if(!documentId) {
        const readyDuplicate=[...this.sql.exec(
          "SELECT id,filename FROM documents WHERE sha256=? AND status='ready' LIMIT 1",
          digest
        )][0] || null;
        if(readyDuplicate){
          this.updateJob(jobId,"duplicate",100,null,readyDuplicate.id,actualPages,Number(job.chunks || 0));
          this.cleanupJobText(jobId);
          return;
        }

        const resumable=[...this.sql.exec(
          "SELECT id FROM documents WHERE sha256=? AND status='indexing' LIMIT 1",
          digest
        )][0] || null;
        if(resumable?.id) {
          documentId=String(resumable.id);
        } else {
          const sample=[...this.sql.exec(
            "SELECT text FROM job_text_pages WHERE job_id=? ORDER BY page LIMIT 8",jobId
          )].map(r=>String(r.text || "").slice(0,10000)).join("\n");
          const language=detectLanguage(sample);
          documentId=uuidCompact();
          const now=new Date().toISOString();
          this.sql.exec(
            "INSERT INTO documents (id,filename,title,author,language,sha256,size_bytes,page_count,chunk_count,status,created_at,r2_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            documentId,job.filename,String(job.title || ""),String(job.author || ""),language || "unknown",
            digest,Number(job.size_bytes || 0),actualPages,0,"indexing",now,String(job.original_r2_key || "") || null
          );
        }
        this.sql.exec(
          "UPDATE index_jobs SET document_id=?,pages=?,updated_at=? WHERE id=?",
          documentId,actualPages,new Date().toISOString(),jobId
        );
      }

      let processedPages=Math.max(0,Math.min(actualPages,Number(job.processed_pages || 0)));
      if(processedPages===0) {
        this.sql.exec("DELETE FROM chunks WHERE document_id=?",documentId);
        this.sql.exec("UPDATE documents SET chunk_count=0,status='indexing' WHERE id=?",documentId);
      }

      if(processedPages>=actualPages) {
        const totalChunks=Number([...this.sql.exec("SELECT COUNT(*) AS n FROM chunks WHERE document_id=?",documentId)][0]?.n || 0);
        this.sql.exec("UPDATE documents SET chunk_count=?,status='ready' WHERE id=?",totalChunks,documentId);
        this.sql.exec(
          "UPDATE index_jobs SET status='ready',progress=100,error=NULL,pages=?,chunks=?,processed_pages=?,attempts=0,updated_at=? WHERE id=?",
          actualPages,totalChunks,actualPages,new Date().toISOString(),jobId
        );
        this.cleanupJobText(jobId);
        return;
      }

      const pageRows=[...this.sql.exec(
        "SELECT page,text FROM job_text_pages WHERE job_id=? ORDER BY page LIMIT ? OFFSET ?",
        jobId,INDEX_PAGE_SLICE,processedPages
      )];
      if(!pageRows.length) throw new Error("Nenhuma página disponível para continuar a indexação.");

      const firstPage=Number(pageRows[0].page || 1);
      const lastPage=Number(pageRows[pageRows.length-1].page || firstPage);
      this.sql.exec(
        "DELETE FROM chunks WHERE document_id=? AND page>=? AND page<=?",
        documentId,firstPage,lastPage
      );

      let chunkIndex=Number([...this.sql.exec(
        "SELECT COUNT(*) AS n FROM chunks WHERE document_id=?",documentId
      )][0]?.n || 0);
      const groups=await matrixChunkPages(pageRows);
      const wave=[];
      const waveSeen=new Set();
      for(const group of groups) {
        for(const piece of group) {
          const cleanPiece=cleanDocumentText(piece.text);
          if(!isUsefulChunkText(cleanPiece)) continue;
          const fingerprint=cleanPiece.toLowerCase().replace(/\s+/g," ").slice(0,700);
          if(waveSeen.has(fingerprint)) continue;
          waveSeen.add(fingerprint);
          wave.push({id:uuidCompact(),page:piece.page,chunk_index:chunkIndex++,text:cleanPiece});
        }
      }

      for(let embedOffset=0;embedOffset<wave.length;embedOffset+=COHERE_API_BATCH){
        const batch=wave.slice(embedOffset,embedOffset+COHERE_API_BATCH);
        const embeddings=await embedWaveBatchedWithRetry(this.env,batch);
        for(let i=0;i<batch.length;i++){
          const chunk=batch[i];
          this.sql.exec(
            "INSERT INTO chunks (id,document_id,page,chunk_index,text,embedding,created_at) VALUES (?,?,?,?,?,?,?)",
            chunk.id,documentId,chunk.page,chunk.chunk_index,chunk.text,JSON.stringify(embeddings[i]),new Date().toISOString()
          );
        }
        if(embedOffset+COHERE_API_BATCH<wave.length) {
          await new Promise(resolve=>setTimeout(resolve,COHERE_THROTTLE_MS));
        }
      }

      processedPages+=pageRows.length;
      const totalChunks=Number([...this.sql.exec(
        "SELECT COUNT(*) AS n FROM chunks WHERE document_id=?",documentId
      )][0]?.n || 0);
      this.sql.exec("UPDATE documents SET chunk_count=?,status='indexing' WHERE id=?",totalChunks,documentId);

      const progress=Math.min(96,18+Math.round((processedPages/Math.max(1,actualPages))*78));
      if(processedPages>=actualPages){
        this.sql.exec("UPDATE documents SET chunk_count=?,status='ready' WHERE id=?",totalChunks,documentId);
        this.sql.exec(
          "UPDATE index_jobs SET status='ready',progress=100,error=NULL,document_id=?,pages=?,chunks=?,processed_pages=?,attempts=0,updated_at=? WHERE id=?",
          documentId,actualPages,totalChunks,actualPages,new Date().toISOString(),jobId
        );
        this.cleanupJobText(jobId);
      } else {
        this.sql.exec(
          "UPDATE index_jobs SET status='queued',progress=?,error=NULL,document_id=?,pages=?,chunks=?,processed_pages=?,attempts=0,updated_at=? WHERE id=?",
          progress,documentId,actualPages,totalChunks,processedPages,new Date().toISOString(),jobId
        );
      }
    } catch(error) {
      const message=String(error?.message || error).slice(0,1500);
      if(isMonthlyQuotaError(error)){
        this.sql.exec(
          "UPDATE index_jobs SET status='paused_quota',error=?,updated_at=? WHERE id=?",
          "Cohere Trial Key atingiu a quota mensal. Progresso preservado; retome o mesmo job quando houver quota disponível.",
          new Date().toISOString(),jobId
        );
        if(documentId) this.sql.exec("UPDATE documents SET status='indexing' WHERE id=?",documentId);
        return;
      }
      const nextAttempt=Number(job.attempts || 0)+1;
      const retryable=isRateLimitError(error) || /timeout|temporar|overload|unavailable|network|fetch|5\d\d/i.test(message);
      if(retryable && nextAttempt<12){
        this.sql.exec(
          "UPDATE index_jobs SET status='queued',attempts=?,error=?,updated_at=? WHERE id=?",
          nextAttempt,message,new Date().toISOString(),jobId
        );
      } else {
        this.updateJob(jobId,"failed",100,message,documentId || null);
        if(documentId) this.sql.exec("UPDATE documents SET status='failed' WHERE id=?",documentId);
      }
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
    if (more?.id) await this.ctx.storage.setAlarm(Date.now() + INDEX_ALARM_DELAY_MS);
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/status") {
        const docStats = [...this.sql.exec("SELECT COUNT(*) AS documents, COALESCE(SUM(chunk_count),0) AS chunks FROM documents")][0] || {documents:0,chunks:0};
        const m = [...this.sql.exec("SELECT COUNT(*) AS n FROM conversation_messages")][0]?.n || 0;
        const j = [...this.sql.exec("SELECT COUNT(*) AS n FROM index_jobs WHERE status IN ('queued','processing','paused_quota')")][0]?.n || 0;
        return json({
          ok: true,
          documents: Number(docStats.documents || 0),
          chunks: Number(docStats.chunks || 0),
          memory_messages: Number(m),
          index_jobs: Number(j)
        });
      }

      if (url.pathname === "/duplicate") {
        const sha = String(url.searchParams.get("sha") || "");
        const row = [...this.sql.exec("SELECT id, filename AS arquivo, status FROM documents WHERE sha256 = ? LIMIT 1", sha)][0] || null;
        return json({ ok: true, document: row });
      }

      if (url.pathname === "/jobs/upload" && request.method === "POST") {
        return json({ok:false,code:"CLIENT_EXTRACTION_REQUIRED",message:"PDF binário não é aceito pelo backend."},410);
      }
      if (url.pathname === "/local/start" && request.method === "POST") {
        const body=await request.json().catch(()=>({}));
        const filename=safeName(body.filename || "documento.pdf");
        const expectedPages=Math.max(1,Math.min(10000,Number(body.page_count || 1)));
        const contentSha=String(body.content_sha256 || "").toLowerCase();
        if(!/^[0-9a-f]{64}$/.test(contentSha)) return json({ok:false,message:"SHA-256 inválido."},400);

        const existing=[...this.sql.exec(
          "SELECT id,filename,status,page_count,chunk_count,embedding_model FROM documents WHERE sha256=? LIMIT 1",
          contentSha
        )][0] || null;
        if(existing){
          return json({
            ok:true,duplicate:true,document_id:existing.id,arquivo:existing.filename,status:existing.status,
            paginas:Number(existing.page_count || 0),chunks:Number(existing.chunk_count || 0),
            embedding_model:existing.embedding_model || ""
          });
        }

        const documentId=uuidCompact();
        const jobId=uuidCompact();
        const now=new Date().toISOString();
        this.sql.exec(
          "INSERT INTO documents (id,filename,title,author,language,sha256,size_bytes,page_count,chunk_count,status,created_at,r2_key,embedding_model,embedding_dimensions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          documentId,filename,String(body.title || "").slice(0,500),String(body.author || "").slice(0,500),"unknown",
          contentSha,Math.max(0,Number(body.size_bytes || 0)),expectedPages,0,"lexical_loading",now,
          String(body.original_r2_key || "").slice(0,700) || null,LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_DIMENSIONS
        );
        this.sql.exec(
          "INSERT INTO index_jobs (id,kind,storage_key,filename,size_bytes,status,progress,attempts,error,document_id,pages,chunks,created_at,updated_at,expected_pages,received_pages,title,author,content_sha256,original_r2_key,processed_pages) VALUES (?, 'local-client', ?, ?, ?, 'receiving', 1, 0, NULL, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, 0)",
          jobId,"client://local/"+jobId,filename,Math.max(0,Number(body.size_bytes || 0)),documentId,expectedPages,now,now,
          expectedPages,String(body.title || "").slice(0,500),String(body.author || "").slice(0,500),contentSha,
          String(body.original_r2_key || "").slice(0,700)
        );
        return json({ok:true,job_id:jobId,document_id:documentId,status:"receiving",expected_pages:expectedPages},201);
      }

      if (url.pathname === "/local/append" && request.method === "POST") {
        const body=await request.json().catch(()=>({}));
        const jobId=String(body.job_id || "").trim();
        const job=[...this.sql.exec(
          "SELECT id,status,expected_pages,document_id FROM index_jobs WHERE id=? AND kind='local-client' LIMIT 1",jobId
        )][0] || null;
        if(!job) return json({ok:false,message:"Job local não encontrado."},404);
        if(job.status!=="receiving") return json({ok:false,message:"Job local não está recebendo páginas."},409);

        const pages=normalizeClientPages(body.pages); validateClientPageBatch(pages);
        for(const page of pages){
          this.sql.exec("INSERT OR REPLACE INTO job_text_pages (job_id,page,text) VALUES (?,?,?)",jobId,page.page,page.text);
          this.sql.exec("DELETE FROM chunks WHERE document_id=? AND page=?",job.document_id,page.page);
          const pieces=chunkText(page.text);
          for(let i=0;i<pieces.length;i++){
            const text=cleanDocumentText(pieces[i]);
            if(!isUsefulChunkText(text)) continue;
            const chunkId=uuidCompact();
            const chunkIndex=(Number(page.page || 1)*10000)+i;
            this.sql.exec(
              "INSERT INTO chunks (id,document_id,page,chunk_index,text,embedding,created_at) VALUES (?,?,?,?,?,'[]',?)",
              chunkId,job.document_id,Number(page.page || 1),chunkIndex,text,new Date().toISOString()
            );
          }
        }

        const stats=[...this.sql.exec(
          "SELECT COUNT(*) AS pages,COALESCE(SUM(LENGTH(text)),0) AS chars FROM job_text_pages WHERE job_id=?",jobId
        )][0] || {pages:0,chars:0};
        const received=Number(stats.pages || 0), totalChars=Number(stats.chars || 0);
        if(totalChars>MAX_TEXT_CHARS) return json({ok:false,message:"Texto extraído acima do limite de segurança."},413);
        const chunkCount=Number([...this.sql.exec("SELECT COUNT(*) AS n FROM chunks WHERE document_id=?",job.document_id)][0]?.n || 0);
        const expected=Math.max(1,Number(job.expected_pages || 1));
        const progress=Math.min(95,5+Math.round((received/expected)*85));
        this.sql.exec(
          "UPDATE index_jobs SET received_pages=?,chunks=?,progress=?,updated_at=? WHERE id=?",
          received,chunkCount,progress,new Date().toISOString(),jobId
        );
        this.sql.exec(
          "UPDATE documents SET chunk_count=?,status=? WHERE id=?",
          chunkCount,chunkCount>0?"lexical_ready":"lexical_loading",job.document_id
        );
        return json({ok:true,job_id:jobId,document_id:job.document_id,status:"receiving",received_pages:received,expected_pages:expected,chunks:chunkCount,chars_received:totalChars});
      }

      if (url.pathname === "/local/commit" && request.method === "POST") {
        const body=await request.json().catch(()=>({}));
        const jobId=String(body.job_id || "").trim();
        const job=[...this.sql.exec(
          "SELECT id,status,expected_pages,document_id FROM index_jobs WHERE id=? AND kind='local-client' LIMIT 1",jobId
        )][0] || null;
        if(!job) return json({ok:false,message:"Job local não encontrado."},404);
        const received=Number([...this.sql.exec("SELECT COUNT(*) AS n FROM job_text_pages WHERE job_id=?",jobId)][0]?.n || 0);
        const expected=Math.max(1,Number(job.expected_pages || 1));
        if(received<expected) return json({ok:false,message:"Páginas incompletas: "+received+" de "+expected+"."},409);
        const chunkCount=Number([...this.sql.exec("SELECT COUNT(*) AS n FROM chunks WHERE document_id=?",job.document_id)][0]?.n || 0);
        const sample=[...this.sql.exec("SELECT text FROM chunks WHERE document_id=? ORDER BY page LIMIT 8",job.document_id)]
          .map(r=>String(r.text || "").slice(0,10000)).join("\n");
        const language=detectLanguage(sample);
        this.sql.exec(
          "UPDATE documents SET page_count=?,chunk_count=?,language=?,status='lexical_ready',embedding_model=?,embedding_dimensions=? WHERE id=?",
          expected,chunkCount,language || "unknown",LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_DIMENSIONS,job.document_id
        );
        this.sql.exec(
          "UPDATE index_jobs SET status='ready',progress=100,received_pages=?,pages=?,chunks=?,processed_pages=?,updated_at=? WHERE id=?",
          received,expected,chunkCount,expected,new Date().toISOString(),jobId
        );
        this.cleanupJobText(jobId);
        return json({ok:true,job_id:jobId,document_id:job.document_id,status:"lexical_ready",received_pages:received,expected_pages:expected,chunks:chunkCount},200);
      }

      if (url.pathname === "/local/chunks" && request.method === "GET") {
        const documentId=String(url.searchParams.get("document_id") || "").trim();
        const limit=Math.max(1,Math.min(48,Number(url.searchParams.get("limit") || 12)));
        if(!documentId) return json({ok:false,message:"document_id ausente."},400);
        const doc=[...this.sql.exec("SELECT id,status,chunk_count,embedding_model,embedding_dimensions FROM documents WHERE id=? LIMIT 1",documentId)][0] || null;
        if(!doc) return json({ok:false,message:"Documento não encontrado."},404);
        const rows=[...this.sql.exec(
          "SELECT id,page,chunk_index,text FROM chunks WHERE document_id=? AND (embedding='[]' OR embedding='' OR embedding IS NULL) ORDER BY page,chunk_index LIMIT ?",
          documentId,limit
        )];
        const remaining=Number([...this.sql.exec(
          "SELECT COUNT(*) AS n FROM chunks WHERE document_id=? AND (embedding='[]' OR embedding='' OR embedding IS NULL)",documentId
        )][0]?.n || 0);
        return json({ok:true,document_id:documentId,status:doc.status,chunks:rows,remaining,total:Number(doc.chunk_count || 0),embedding_model:doc.embedding_model || LOCAL_EMBEDDING_MODEL,embedding_dimensions:Number(doc.embedding_dimensions || LOCAL_EMBEDDING_DIMENSIONS)});
      }

      if (url.pathname === "/local/embeddings" && request.method === "POST") {
        const body=await request.json().catch(()=>({}));
        const documentId=String(body.document_id || "").trim();
        const updates=Array.isArray(body.updates)?body.updates.slice(0,48):[];
        if(!documentId || !updates.length) return json({ok:false,message:"Atualizações locais ausentes."},400);
        let dimensions=0;
        for(const u of updates){
          const id=String(u?.id || "").trim();
          const vector=Array.isArray(u?.embedding)?u.embedding.map(Number):[];
          if(!id || vector.length<64 || vector.length>2048 || vector.some(v=>!Number.isFinite(v))) continue;
          if(!dimensions) dimensions=vector.length;
          if(vector.length!==dimensions) return json({ok:false,message:"Dimensões inconsistentes no lote local."},400);
          this.sql.exec("UPDATE chunks SET embedding=? WHERE id=? AND document_id=?",JSON.stringify(vector),id,documentId);
        }
        const remaining=Number([...this.sql.exec(
          "SELECT COUNT(*) AS n FROM chunks WHERE document_id=? AND (embedding='[]' OR embedding='' OR embedding IS NULL)",documentId
        )][0]?.n || 0);
        const total=Number([...this.sql.exec("SELECT COUNT(*) AS n FROM chunks WHERE document_id=?",documentId)][0]?.n || 0);
        const status=remaining>0?"vectorizing_local":"ready_local";
        this.sql.exec(
          "UPDATE documents SET status=?,chunk_count=?,embedding_model=?,embedding_dimensions=? WHERE id=?",
          status,total,String(body.embedding_model || LOCAL_EMBEDDING_MODEL).slice(0,180),dimensions || LOCAL_EMBEDDING_DIMENSIONS,documentId
        );
        return json({ok:true,document_id:documentId,status,updated:updates.length,remaining,total});
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
        this.sql.exec("UPDATE index_jobs SET status='queued',received_pages=?,processed_pages=0,attempts=0,progress=16,error=NULL,updated_at=? WHERE id=?",received,new Date().toISOString(),id);
        await this.ctx.storage.sync(); await this.ctx.storage.setAlarm(Date.now()+200);
        return json({ok:true,job_id:id,status:"queued",received_pages:received,expected_pages:expected},202);
      }

      if (url.pathname === "/jobs/status" && request.method === "GET") {
        const id = String(url.searchParams.get("job_id") || "").trim();
        const row = [...this.sql.exec(
          "SELECT id AS job_id,filename AS arquivo,status,progress,attempts,error,document_id,pages AS paginas,chunks,expected_pages,received_pages,processed_pages,original_r2_key,created_at,updated_at FROM index_jobs WHERE id=? LIMIT 1",
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
          this.sql.exec("UPDATE index_jobs SET status='queued',attempts=0,error=NULL,updated_at=? WHERE id=?", new Date().toISOString(), id);
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

      if (url.pathname === "/chunks-range") {
        const id=String(url.searchParams.get("document_id") || "").trim();
        const startChunk=Math.max(0,Number(url.searchParams.get("start_chunk") || 0));
        const limit=Math.max(1,Math.min(EXACT_MAX_CHUNKS,Number(url.searchParams.get("limit") || EXACT_MAX_CHUNKS)));
        if(!id) return json({ok:true,chunks:[]});
        const rows=[...this.sql.exec(`
          SELECT c.id,c.document_id,c.page,c.chunk_index,c.text,
                 d.filename,d.title,d.author,d.language
          FROM chunks c JOIN documents d ON d.id=c.document_id
          WHERE c.document_id=? AND c.chunk_index>=?
          ORDER BY c.chunk_index ASC LIMIT ?
        `,id,startChunk,limit+1)];
        const hasMore=rows.length>limit;
        return json({ok:true,chunks:rows.slice(0,limit),start_chunk:startChunk,limit,has_more:hasMore});
      }

      if (url.pathname === "/embeddings" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const updates = Array.isArray(body.updates) ? body.updates : [];
        for (const u of updates) this.sql.exec("UPDATE chunks SET embedding = ? WHERE id = ?", JSON.stringify(u.embedding || []), u.id);
        return json({ ok: true, updated: updates.length });
      }

      if (url.pathname === "/export-page" && request.method === "GET") {
        const offset=Math.max(0,Number(url.searchParams.get("offset")||0));
        const limit=Math.max(1,Math.min(250,Number(url.searchParams.get("limit")||250)));
        const total=Number([...this.sql.exec("SELECT COUNT(*) AS n FROM chunks")][0]?.n || 0);
        const rows=[...this.sql.exec(`
          SELECT c.id,c.document_id,c.page,c.chunk_index,c.text,c.embedding,
                 d.filename,d.title,d.author,d.language
          FROM chunks c JOIN documents d ON d.id=c.document_id
          ORDER BY c.created_at,c.chunk_index LIMIT ? OFFSET ?
        `,limit,offset)].map(row=>{
          let vector=[];
          try{vector=JSON.parse(row.embedding || "[]");}catch{}
          return {
            id:row.id,document_id:row.document_id,page:Number(row.page||0),
            chunk_index:Number(row.chunk_index||0),text:String(row.text||""),
            filename:String(row.filename||""),title:String(row.title||""),
            author:String(row.author||""),language:String(row.language||"pt"),
            vector:Array.isArray(vector)?vector:[]
          };
        });
        return json({ok:true,total,offset,limit,next_offset:offset+rows.length,done:(offset+rows.length)>=total,records:rows});
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

      if (url.pathname === "/search-strict" && request.method === "POST") {
        const body=await request.json().catch(()=>({}));
        const question=String(body?.query||body?.question||"").trim();
        const topK=Math.max(1,Math.min(STRICT_LOGICAL_TASK_CAP,Number(body?.top_k||STRICT_LOGICAL_TASK_CAP)));
        const target=deriveStrictPhrase(question);
        if(!target)return json({ok:true,matches:[],scanned:0,exact_hits:0,documents_hit:0,target:"",mode:"strict-phrase-v4"});
        const perDocument=new Map();
        let scanned=0,exactHits=0;
        const cursor=this.sql.exec(`
          SELECT c.id,c.document_id,c.page,c.chunk_index,c.text,
                 d.filename,d.title,d.author,d.language
          FROM chunks c JOIN documents d ON d.id=c.document_id
          WHERE d.status IN ('ready','indexing','lexical_loading','lexical_ready','vectorizing_local','ready_local')
          ORDER BY d.id ASC,c.chunk_index ASC
        `);
        for(const row of cursor){
          scanned++;
          const match=strictParagraphMatch(row?.text||"",question);
          if(!match.matched)continue;
          exactHits++;
          pushStrictHit(perDocument,{
            ...row,score:100,coverage:1,
            strict_phrase:match.target,
            strict_paragraph_index:match.paragraph_index,
            retrieval_mode:"strict-phrase-durable-v4"
          },STRICT_PER_DOCUMENT_HIT_CAP);
        }
        return json({
          ok:true,
          matches:roundRobinStrictHits(perDocument,topK),
          scanned,exact_hits:exactHits,documents_hit:perDocument.size,target,
          mode:"strict-phrase-v4",or_disabled:true,fuzzy_disabled:true
        });
      }

      if (url.pathname === "/search-lexical" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const query = foldSearchText(body.query || "");
        const terms = Array.isArray(body.terms)
          ? body.terms.map(foldSearchText).filter(Boolean).slice(0, 18)
          : lexicalTerms(query);
        const topK = Math.max(1, Math.min(MASSIVE_NODE_COUNT, Number(body.top_k || TOP_K)));
        const scanLimit = Math.max(200, Math.min(50000, Number(body.scan_limit || 30000)));
        if (!terms.length) return json({ ok: true, matches: [], scanned: 0, mode: "bm25-fallback" });

        const rows = [...this.sql.exec(`
          SELECT c.id,c.document_id,c.page,c.chunk_index,c.text,
                 d.filename,d.title,d.author,d.language
          FROM chunks c JOIN documents d ON d.id=c.document_id
          WHERE d.status IN ('ready','indexing','lexical_loading','lexical_ready','vectorizing_local','ready_local')
          ORDER BY c.created_at DESC LIMIT ?
        `, scanLimit)];

        const docs=rows.map(row=>{
          const tokens=lexicalTokens(row.text);
          const tf=new Map();
          for(const token of tokens) tf.set(token,(tf.get(token)||0)+1);
          return {row,tokens,tf,dl:Math.max(1,tokens.length)};
        });
        const N=Math.max(1,docs.length);
        const avgdl=docs.reduce((sum,d)=>sum+d.dl,0)/N || 1;
        const df=new Map();
        for(const term of terms){
          let count=0;
          for(const d of docs) if(d.tf.has(term)) count++;
          df.set(term,count);
        }

        const phrase=foldSearchText(query);
        const matches=[];
        for(const d of docs){
          let score=0,matchedTerms=0,hits=0;
          for(const term of terms){
            const freq=d.tf.get(term)||0;
            if(!freq) continue;
            matchedTerms++;
            hits+=freq;
            const termDf=df.get(term)||0;
            const idf=Math.log(1+((N-termDf+0.5)/(termDf+0.5)));
            const denom=freq+BM25_K1*(1-BM25_B+BM25_B*(d.dl/avgdl));
            score+=idf*((freq*(BM25_K1+1))/Math.max(0.0001,denom));
          }
          if(!matchedTerms) continue;
          const coverage=matchedTerms/terms.length;
          const minMatched=1;
          const folded=foldSearchText(d.row.text);
          const exactPhrase=phrase.length>=5 && folded.includes(phrase);
          if(matchedTerms<minMatched && !exactPhrase) continue;
          if(exactPhrase) score+=3.5;
          score+=coverage*2.0+Math.min(1.5,hits*0.12);
          matches.push({...d.row,score,coverage});
        }
        matches.sort((a,b)=>b.score-a.score);
        return json({ok:true,matches:matches.slice(0,topK),scanned:rows.length,mode:"bm25-fallback",avgdl});
      }

      if (url.pathname === "/search" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const query = Array.isArray(body.embedding) ? body.embedding : [];
        const topK = Math.max(1, Math.min(MASSIVE_NODE_COUNT, Number(body.top_k || TOP_K)));
        const minScore = Math.max(-1, Math.min(1, Number(body.min_score ?? SEMANTIC_MIN_SCORE)));
        const scanLimit = Math.max(50, Math.min(50000, Number(body.scan_limit || VECTOR_SCAN_LIMIT)));
        const rows = [...this.sql.exec(`
          SELECT c.id,c.document_id,c.page,c.chunk_index,c.text,c.embedding,
                 d.filename,d.title,d.author,d.language
          FROM chunks c JOIN documents d ON d.id=c.document_id
          WHERE d.status IN ('ready','indexing','lexical_loading','lexical_ready','vectorizing_local','ready_local') ORDER BY c.created_at DESC LIMIT ?
        `, scanLimit)];
        const matches = [];
        for (const row of rows) {
          let emb = [];
          try { emb = JSON.parse(row.embedding); } catch {}
          const score = cosine(query, emb);
          if (score >= minScore) matches.push({ ...row, embedding: undefined, score });
        }
        matches.sort((a,b) => b.score - a.score);
        return json({ ok: true, matches: matches.slice(0, topK), scanned: rows.length, min_score: minScore });
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

    if (url.pathname === "/health/deploy") {
      const missing=[];
      if(!env.LIBRARY) missing.push("LIBRARY");
      if(!groqApiKeys(env).length) missing.push("GROQ_API_KEY_POOL");
      return json({
        ok: missing.length===0,
        service: "Consciência do Fabiano",
        version: VERSION,
        architecture: "cloudflare-v7.1-fabiano-r2-cross-device",
        storage_backend: "durable-object-sqlite",
    cross_device_storage: "r2-native-binding",
        workers_ai_used: false,
        llm_provider: "groq",
        provider_auth_surface: "server-side-secrets-only",
        client_provider_keys_exposed: false,
        supabase_transport: "postgrest-https",
        direct_postgres_connections: 0,
        embedding_provider: "browser-transformers",
        server_pdf_parsing: false,
        chunk_concurrency_limit: CHUNK_CONCURRENCY,
        embedding_concurrency_limit: EMBED_CONCURRENCY,
        semantic_min_score: SEMANTIC_MIN_SCORE,
        search_top_k: TOP_K,
        require_lexical_match: REQUIRE_LEXICAL_MATCH,
        rag_map_reduce: true,
        map_batch_size: MAP_BATCH_SIZE,
        micro_node_chain: false,
        async_worker_pool: true,
        micro_node_count: MASSIVE_NODE_COUNT,
        micro_node_batch_size: MASSIVE_NODE_GROUP_SIZE,
        streaming_relay: "async-worker-pool",
        master_node: "final-fusion",
        master_fusion_mode: "massive-dense-encyclopedic",
        micro_node_temperature: 0.0,
        active_worker_limit: MASSIVE_WORKER_CONCURRENCY,
        max_bubbles_per_query: MASSIVE_NODE_COUNT,
        exact_match_llm_bypass: true,
        exact_swarm_logical_nodes: EXACT_SWARM_NODE_COUNT,
        exact_max_concurrent_requests: EXACT_MAX_CONCURRENT_REQUESTS,
        exact_degraded_concurrency: EXACT_DEGRADED_CONCURRENCY,
        exact_circuit_failure_threshold: EXACT_CIRCUIT_FAILURE_THRESHOLD,
        exact_circuit_slow_ms: EXACT_CIRCUIT_SLOW_MS,
        exact_ordered_buffer: true,
        exact_local_indexeddb_takeover: true,
        router_pattern: "micro-kernel-event-router-hybrid",
        frontend_switchboard_only: true,
        strict_lazy_local_engines: true,
        fallback_module_loading: "dynamic-import-on-failure",
        failover_tiers: 6,
        failover_order: ["A-primary","B-multi-cloud","C-indexeddb","D-static-vault","E-desktop-node","F-raw-vault"],
        service_worker_static_vault: true,
        desktop_fallback_port: 8788,
        raw_vault_fallback: true,
        plan_c_local_worker_pool: true,
        plan_c_logical_task_capacity: 1000,
        plan_c_physical_worker_cap: 16,
        plan_c_worker_count_source: "navigator.hardwareConcurrency",
        plan_c_main_thread_extraction: false,
        plan_c_offline_intelligence: "strict-same-paragraph-phrase-v4",
        plan_c_virtualized_result_cards: true,
        plan_c_card_gap_px: 40,
    plan_c_window_expansion: true,
    plan_c_context_before: 2,
    plan_c_context_after: 4,
    plan_c_full_chunk_fallback: true,
    plan_c_sequential_chunk_merge: true,
    plan_c_canonical_reference_elevation: true,
    plan_c_boolean_exact_match: true,
    plan_c_hard_bm25_threshold: 3.25,
    plan_c_hard_min_coverage: 0.50,
    plan_c_zero_noise: true,
    plan_c_elegant_silence: true,
    plan_c_fuzzy_compensation_disabled: true,
    plan_c_strict_reference_local_first: true,
    plan_c_strict_reference_cloud_fuzzy_bypass: true,
    plan_c_terminal_zero_hit: true,
    universal_strict_match_core: "strict-match-core-v4",
    online_offline_search_symmetry: true,
    same_paragraph_phrase_required: true,
    fuzzy_matching_disabled: true,
    or_matching_disabled: true,
    omni_library_sync: true,
    omni_sync_batch_size: 200,
    omni_sync_worker: true,
    omni_sync_memory_flush: true,
    omni_search_all_documents: true,
    omni_logical_task_capacity: 1000,
    omni_physical_worker_cap: 16,
    omni_virtual_scroller: true,
    omni_card_gap_px: 40,
    agent_swarm_enabled: true,
    agent_swarm_logical_nodes: 20,
    agent_swarm_physical_worker_cap: 16,
    agent_swarm_cpu_governor: "navigator.hardwareConcurrency",
    agent1_literal_exact: true,
    agent2_transformers_semantic: true,
    agent2_model: LOCAL_EMBEDDING_MODEL,
    agent3_context_window: "2-before-4-after",
    agent4_reference_judge: true,
    agent5_9_partition_sweep: true,
    agent10_bouncer: true,
    agent11_short_entity_hunter: true,
    agent12_long_form_explainer: true,
    agent13_freshness_sentinel: true,
    agent14_ocr_rescue: true,
    agent15_definition_specialist: true,
    agent16_chronology_mapper: true,
    agent17_cross_library_balancer: true,
    agent18_citation_specialist: true,
    agent19_conflict_auditor: true,
    agent20_mission_master: true,
    semantic_fallback_after_literal_miss: true,
    semantic_fallback_min_score: 0.62,
    bouncer_semantic_min_score: 0.72,
    bouncer_semantic_min_coverage: 0.50,
    reference_queries_remain_exact: true,
    phantom_daemon: true,
    phantom_daemon_target_interval_ms: 180000,
    phantom_daemon_service_worker: true,
    phantom_daemon_periodic_sync_best_effort: true,
    phantom_daemon_origin_heartbeat: true,
    omni_sync_cloud_fingerprint: true,
    omni_sync_generation_gc: true,
    omni_sync_manual_button: false,
    omni_sync_zero_touch_after_authorization: true,
    cross_device_library_mirror: true,
    cross_device_storage_backend: "cloudflare-r2",
    cross_device_r2_binding: "PDFS",
    cross_device_r2_bucket: "consciencia-fabiano-pdfs",
    cross_device_plaintext_chunk_sync: true,
    cross_device_no_supabase_dependency: true,
    cross_device_backfill_from_indexeddb: true,
    cross_device_mobile_hydration: true,
    cross_device_r2_generation_pointer: true,
    cross_device_batch_size: 200,
        sse_keepalive_ms: SSE_KEEPALIVE_MS,
        groq_round_robin_key_rotation: true,
        groq_429_retry_limit: MASSIVE_GROQ_MAX_RETRIES,
        post_master_llm_rewrite: false,
        static_backup_hydration: true,
        static_backup_expected_embeddings: 25199,
        static_backup_payload_status: "scheduled-export",
        supabase_mirror_configured: false,
        pinecone_mirror_configured: Boolean(env.PINECONE_UPSERT_URL && env.PINECONE_API_KEY),
        whisper_fallback_timeout_ms: 8000,
        local_whisper_stt: true,
        rag_resilience_levels: 10,
        local_library_catalog: true,
        r2_direct_ready: Boolean(env.PDFS),
    r2_bucket: "consciencia-fabiano-pdfs",
    official_workers_host: "consciencia-fabiano.focoeepoder2.workers.dev",
    bindings_missing: missing,
        probe: "deploy-only-no-storage-read"
      });
    }

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

    const assetResponse=await env.ASSETS.fetch(request);
    const assetHeaders=securityHeaders(new Headers(assetResponse.headers));
    return new Response(assetResponse.body,{status:assetResponse.status,headers:assetHeaders});
  }
};
