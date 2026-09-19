const VERSION = "1.17.2-cross-library-synthesis";
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
  top_k: 100,
  require_lexical_match: false,
});
const TOP_K = searchConfig.top_k;
const VECTOR_SCAN_LIMIT = 7000;
const SEMANTIC_MIN_SCORE = searchConfig.semantic_min_score;
const REQUIRE_LEXICAL_MATCH = searchConfig.require_lexical_match;
const LEXICAL_MIN_COVERAGE = 0.50;
const BM25_K1 = 1.35;
const BM25_B = 0.75;
const LOCAL_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const LOCAL_EMBEDDING_DIMENSIONS = 384;
const MAX_SERVER_HISTORY = 40;
const GROQ_HISTORY_MESSAGES = 6;
const GROQ_INPUT_BUDGET_TOKENS = 6800;
const GROQ_HISTORY_BUDGET_TOKENS = 900;
const GROQ_RAG_BUDGET_TOKENS = 4800;
const GROQ_MAX_COMPLETION_TOKENS = 1400;
const MAP_REDUCE_THRESHOLD = 20;
const MAP_BATCH_SIZE = 20;
const MAP_MAX_COMPLETION_TOKENS = 650;
const GROQ_AGGRESSIVE_INPUT_BUDGET_TOKENS = 3600;
const OWNER_TOKEN_HASH = "62e5283fda284aaec71832ab0aafc8161168a01989c1e94764a3076fa4237aa0";
const EMPTY_GROUNDED_ANSWER = "Não encontrei informações nos documentos indexados para responder a esta pergunta.";
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
    "para","por","com","como","qual","quais","fala","falar","quero","desejo","mostre","mostrar",
    "versiculo","versículo","passagem","citacao","citação","referencia","referência","trecho","escritura",
    "the","and","of","to","in","is","what","about"
  ]);
  return [...new Set(foldSearchText(question).split(" ").filter(w => w.length >= 3 && !stop.has(w)))].slice(0, 10);
}

async function retrieveLexicalContext(env, question) {
  const terms = lexicalTerms(question);
  if (!terms.length) return [];
  const data = await libraryCall(env, "/search-lexical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: question, terms, top_k: TOP_K, scan_limit: 7000 }),
  });
  return Array.isArray(data.matches)
    ? data.matches.map(item => ({ ...item, retrieval_mode: "lexical-fallback" }))
    : [];
}

async function retrieveContext(env, question, suppliedEmbedding = null) {
  assertBindings(env);
  if (Array.isArray(suppliedEmbedding) && suppliedEmbedding.length >= 64 && suppliedEmbedding.every(Number.isFinite)) {
    try {
      const data = await libraryCall(env, "/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embedding: suppliedEmbedding,
          top_k: TOP_K,
          scan_limit: VECTOR_SCAN_LIMIT,
          min_score: SEMANTIC_MIN_SCORE
        }),
      });
      let matches = Array.isArray(data.matches)
        ? data.matches
            .filter(item => Number(item?.score ?? -1) >= SEMANTIC_MIN_SCORE)
            .map(item => ({ ...item, retrieval_mode: "local-semantic" }))
        : [];
      if (REQUIRE_LEXICAL_MATCH && isFocusedCitationRequest(question)) {
        matches = matches.filter(item => semanticAnchorCoverage(item.text,question) >= LEXICAL_MIN_COVERAGE);
      }
      if (matches.length) return matches;
    } catch {}
  }
  return retrieveLexicalContext(env, question);
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
  for (const item of context) {
    const key = `${item.document_id}:${item.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const humanName=humanDocumentName(item.filename,item.title);
    sources.push({
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

function groundedReferencesMarkdown(sources) {
  const rows=Array.isArray(sources)?sources.slice(0,TOP_K):[];
  if(!rows.length) return "";
  const lines=rows.map((s,index)=>{
    const name=String(s?.titulo || s?.arquivo || "Documento").replace(/[\r\n]+/g," ").trim();
    const author=String(s?.autor || "Autor não informado").replace(/[\r\n]+/g," ").trim();
    const page=s?.pagina ? "Página "+Number(s.pagina) : "Página não informada";
    const excerpt=String(s?.trecho || "").replace(/\s+/g," ").trim().slice(0,420);
    return "- **"+name+" | "+page+" | "+author+":** "+(excerpt ? "“"+excerpt+"”" : "Trecho recuperado sem prévia textual.");
  });
  return "2. 📚 FONTES E REFERÊNCIAS\n\n"+lines.join("\n");
}

function stripModelReferenceSection(answer) {
  return String(answer || "")
    .replace(/\n\s*(?:2\.?\s*)?(?:📚\s*)?FONTES\s+E\s+REFER[ÊE]NCIAS\s*:?[^]*$/i,"")
    .trim();
}

function finalizeGroundedAnswer(answer,sources) {
  const base=stripModelReferenceSection(answer);
  if(!Array.isArray(sources) || !sources.length) return EMPTY_GROUNDED_ANSWER;
  const synthesis=base || "1. SÍNTESE PRINCIPAL:\n\nAs fontes recuperadas estão listadas abaixo.";
  const normalized=/^1\.\s*SÍNTESE PRINCIPAL:/i.test(synthesis)
    ? synthesis
    : "1. SÍNTESE PRINCIPAL:\n\n"+synthesis;
  return normalized+"\n\n"+groundedReferencesMarkdown(sources);
}

function ensureEngagementQuestion(answer, fallback = false) {
  const text=String(answer || "").trim();
  if(!text) return gracefulEmptyAnswer();
  if(fallback || /\?\s*$/.test(text)) return text;
  return text+"\n\nGostaria de explorar outra referência sobre isto?";
}

async function groqCompletion(env, messages, stream = false, options = {}) {
  const apiKey = requireSecret(env, "GROQ_API_KEY");
  const inputBudget=Math.max(1200,Number(options.input_budget || GROQ_INPUT_BUDGET_TOKENS));
  const model=String(options.model || CHAT_MODEL);
  const maxCompletionTokens=Math.max(100,Number(options.max_completion_tokens || GROQ_MAX_COMPLETION_TOKENS));
  const temperature=Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.0;
  let safeMessages=enforceGroqBudget(messages,inputBudget);
  const execute=async(payloadMessages)=>{
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
  let res=await execute(safeMessages);
  if(res.status===429){
    const retryAfter=Math.max(0,Math.min(4,Number(res.headers.get("retry-after") || 0)));
    if(retryAfter) await new Promise(resolve=>setTimeout(resolve,retryAfter*1000));
    safeMessages=aggressiveGroqMessages(safeMessages);
    res=await execute(safeMessages);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error?.message || ("Groq chat HTTP " + res.status));
    err.status = res.status;
    err.input_tokens_estimated=groqInputTokenEstimate(safeMessages);
    throw err;
  }
  return res;
}

async function mapExtractReferences(env, question, batch, batchIndex) {
  const localRaw=buildRagContext(batch,question,2600);
  const raw=localRaw.replace(/\[F(\d+)\]/g,(_,n)=>"[F"+(batchIndex*MAP_BATCH_SIZE+Number(n))+"]");
  const messages=[
    {
      role:"system",
      content:
        "Você é a etapa MAP de um sistema RAG documental. Não escreva síntese e não invente metadados. " +
        "Examine TODOS os trechos do lote individualmente; não selecione apenas a fonte mais óbvia ou o documento com maior score. " +
        "Use somente fatos literalmente presentes nos trechos recebidos. Para CADA trecho realmente útil à pergunta, preserve o identificador [F#] e devolva uma linha curta com esse identificador e a ideia factual extraída. " +
        "Quando livros, documentos ou autores independentes diferentes abordarem o mesmo tema, é OBRIGATÓRIO preservar pelo menos uma referência [F#] de CADA fonte independente relevante. " +
        "Não descarte uma fonte válida apenas porque outra é mais direta. Se fontes diferentes trouxerem perspectivas complementares, convergentes ou contrastantes, mantenha todas. " +
        "É proibido criar autor, livro, capítulo, página ou citação ausente do contexto."
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

async function mapReduceContext(env, question, context) {
  const source=Array.from(context || []).slice(0,TOP_K);
  if(source.length<=MAP_REDUCE_THRESHOLD){
    return {
      text:buildRagContext(source,question),
      used:false,batches:1,
      selectedIndexes:source.map((_,i)=>i)
    };
  }
  const batches=[];
  for(let i=0;i<source.length;i+=MAP_BATCH_SIZE) batches.push(source.slice(i,i+MAP_BATCH_SIZE));
  const mapped=await Promise.all(batches.map((batch,index)=>mapExtractReferences(env,question,batch,index)));
  const combined=mapped.filter(Boolean).join("\n\n");
  const selected=new Set();
  for(const match of combined.matchAll(/\[F(\d+)\]/g)){
    const oneBased=Number(match[1]);
    if(Number.isInteger(oneBased) && oneBased>=1 && oneBased<=source.length) selected.add(oneBased-1);
  }
  return {
    text:"MAP-REDUCE: referências factuais selecionadas de "+source.length+" trechos em "+batches.length+" lotes.\n\n"+trimToTokenBudget(combined,4300),
    used:true,
    batches:batches.length,
    selectedIndexes:[...selected].sort((a,b)=>a-b)
  };
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
            if (typeof delta === "string" && delta) {
              answer += delta;
              controller.enqueue(encoder.encode(sseFrame("delta", { text: delta })));
            }
          }
        }
        if (!String(answer || "").trim() || /^sem resposta\.?$/i.test(String(answer || "").trim())) {
          answer = gracefulEmptyAnswer();
        }
        const finalAnswer=finalizeGroundedAnswer(answer,meta.sources);
        const refs=groundedReferencesMarkdown(meta.sources);
        if(refs){
          controller.enqueue(encoder.encode(sseFrame("delta",{text:"\n\n"+refs})));
        }
        answer=finalAnswer;
        const memoryPersisted = await persistChatTurn(
          env, meta.ownerId, meta.body, meta.question, answer, meta.sources, meta.fallback
        );
        controller.enqueue(encoder.encode(sseFrame("done", {
          ok: true,
          resposta: answer,
          fontes: meta.sources,
          fallback: meta.fallback,
          memory_persisted: memoryPersisted,
          provider: "groq+resilient-rag",
          retrieval_level: meta.retrievalLevel || 0,
          embedding_model: LOCAL_EMBEDDING_MODEL,
          chat_model: CHAT_MODEL,
          map_reduce: meta.mapReduceUsed === true,
          map_batches: Number(meta.mapBatches || 0),
          independent_documents: Number(meta.independentDocuments || 0),
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
    const matches=normalizeClientContext(raw);
    return json({ok:true,configured:true,provider,matches});
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

async function chat(request, env) {
  requireSecret(env, "GROQ_API_KEY");
  const body = await request.json().catch(() => ({}));
  const question = String(body?.pergunta || "").trim();
  if (question.length < 2) return json({ ok: false, message: "Pergunta vazia." }, 400);

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

  let context = normalizeClientContext(body?.client_context);
  const retrievalLevel=Number(body?.retrieval_level || 0) || (context.length ? 2 : 0);
  if(!context.length && env.LIBRARY){
    try {
      context = await retrieveContext(env, question, Array.isArray(body?.query_embedding) ? body.query_embedding.map(Number) : null);
    } catch (error) {
      if (error?.code === "EXTERNAL_AI_NOT_CONFIGURED") throw error;
      context = [];
    }
  }

  const focusedCitation = isFocusedCitationRequest(question);
  const multipleSourcesRequested = wantsMultipleSources(question);
  const promptContext = context.slice(0,TOP_K);
  const reduced = await mapReduceContext(env,question,promptContext);
  const mappedContext = reduced.used
    ? reduced.selectedIndexes.map(i=>promptContext[i]).filter(Boolean)
    : promptContext;
  const contextText = reduced.text;
  const crossLibrary = crossLibraryStats(mappedContext);

  const messages = enforceGroqBudget([
    {
      role: "system",
      content:
        "És um assistente de pesquisa documental de alta densidade. Usa exclusivamente os trechos fornecidos. " +
        "É expressamente proibido inventar autores, livros, capítulos, páginas, citações, fatos ou conteúdos que não estejam explícitos no contexto. " +
        "Se o contexto for vazio ou insuficiente, a resposta deve ser EXATAMENTE: \""+EMPTY_GROUNDED_ANSWER+"\". " +
        "Escreve apenas a seção 1. SÍNTESE PRINCIPAL, de forma factual e direta. NÃO escrevas a seção de fontes: o servidor anexará deterministicamente todas as fontes recuperadas, até 100, a partir dos metadados originais. " +
        "Faz uma varredura transversal de TODAS as evidências selecionadas pelo Map-Reduce e cruza as informações entre fontes independentes. " +
        "Sempre que múltiplos livros, capítulos ou documentos da biblioteca abordarem o tema da pergunta, é obrigatório cruzar as informações e citar todas as fontes independentes encontradas, incluindo vários livros e autores diferentes quando existirem, enriquecendo a resposta com a pluralidade do acervo e nunca limitando a evidência a um único documento isolado. " +
        "Não privilegies uma única fonte apenas por ter score maior quando outras fontes recuperadas também sustentarem a resposta. Expõe convergências, complementos e diferenças somente quando estiverem explicitamente sustentados pelos trechos. " +
        "Não uses conhecimento externo para preencher lacunas e não transformes inferências em fatos."
    },
    ...history,
    {
      role: "user",
      content:
        "ABRANGÊNCIA DOCUMENTAL: "+crossLibrary.independent_documents+" documento(s) independente(s) relevante(s) selecionado(s).\n" +
        "A síntese deve representar transversalmente todas essas fontes independentes quando houver mais de uma.\n\n" +
        "BIBLIOTECA RECUPERADA:\n" + contextText + "\n\nPERGUNTA:\n" + trimToTokenBudget(question, 900),
    },
  ]);

  const allSources = uniqueSources(mappedContext);
  const sources = allSources;
  const fallback = mappedContext.length === 0;
  const wantsStream =
    String(request.headers.get("Accept") || "").includes("text/event-stream") ||
    body?.stream === true;

  if(fallback){
    if(wantsStream){
      const payload=sseFrame("done",{
        ok:true,resposta:EMPTY_GROUNDED_ANSWER,fontes:[],fallback:true,
        provider:"grounding-guard",retrieval_level:retrievalLevel,
        embedding_model:LOCAL_EMBEDDING_MODEL,chat_model:CHAT_MODEL,
        map_reduce:false,map_batches:0
      });
      return new Response(payload,{headers:securityHeaders(new Headers({
        "Content-Type":"text/event-stream; charset=utf-8",
        "Cache-Control":"no-cache, no-transform"
      }))});
    }
    return json({
      ok:true,resposta:EMPTY_GROUNDED_ANSWER,fontes:[],fallback:true,
      provider:"grounding-guard",retrieval_level:retrievalLevel,
      embedding_model:LOCAL_EMBEDDING_MODEL,chat_model:CHAT_MODEL,
      map_reduce:false,map_batches:0
    });
  }

  if (wantsStream) {
    return groqStreamResponse(env, messages, { ownerId, body, question, sources, fallback, retrievalLevel, mapReduceUsed:reduced.used, mapBatches:reduced.batches, independentDocuments:crossLibrary.independent_documents });
  }

  const result = await (await groqCompletion(env, messages, false)).json();
  let answer = String(result?.choices?.[0]?.message?.content || "").trim();
  if (!answer || /^sem resposta\.?$/i.test(answer)) answer = gracefulEmptyAnswer();
  answer = finalizeGroundedAnswer(answer,sources);
  const memoryPersisted = await persistChatTurn(env, ownerId, body, question, answer, sources, fallback);

  return json({
    ok: true,
    resposta: answer,
    fontes: sources,
    fallback,
    memory_persisted: memoryPersisted,
    provider: "groq+resilient-rag",
    retrieval_level: retrievalLevel,
    embedding_model: LOCAL_EMBEDDING_MODEL,
    chat_model: CHAT_MODEL,
    map_reduce: reduced.used,
    map_batches: reduced.batches,
    independent_documents: crossLibrary.independent_documents,
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
    multicloud_mirror: true,
    map_reduce_threshold: MAP_REDUCE_THRESHOLD,
    map_batch_size: MAP_BATCH_SIZE,
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
    rag_external_slots: ["supabase","pinecone","mongodb","astra"],
    supabase_mirror_configured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    pinecone_mirror_configured: Boolean(env.PINECONE_UPSERT_URL && env.PINECONE_API_KEY),
    local_library_catalog: true,
    admin_access_password_version: "gadu-v1",
    groq_history_window: GROQ_HISTORY_MESSAGES,
    groq_input_budget_tokens: GROQ_INPUT_BUDGET_TOKENS,
    groq_aggressive_budget_tokens: GROQ_AGGRESSIVE_INPUT_BUDGET_TOKENS,
    groq_max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
    r2_direct_ready: Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY),
    vector_backend: "durable-object-cosine",
    llm_provider: "groq",
    embedding_provider: "browser-transformers",
    legacy_embedding_provider: "cohere-disabled",
    local_embedding_model: LOCAL_EMBEDDING_MODEL,
    local_embedding_dimensions: LOCAL_EMBEDDING_DIMENSIONS,
    workers_ai_used: false,
    render_dependency: false,
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
    if (url.pathname === "/api/admin/export-library" && request.method === "GET") return exportLibraryPage(env,url);
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

      if (url.pathname === "/search-lexical" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const query = foldSearchText(body.query || "");
        const terms = Array.isArray(body.terms)
          ? body.terms.map(foldSearchText).filter(Boolean).slice(0, 10)
          : lexicalTerms(query);
        const topK = Math.max(1, Math.min(100, Number(body.top_k || TOP_K)));
        const scanLimit = Math.max(200, Math.min(10000, Number(body.scan_limit || 7000)));
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
          const minMatched=terms.length<=1?1:Math.min(2,Math.ceil(terms.length*LEXICAL_MIN_COVERAGE));
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
        const topK = Math.max(1, Math.min(100, Number(body.top_k || TOP_K)));
        const minScore = Math.max(-1, Math.min(1, Number(body.min_score ?? SEMANTIC_MIN_SCORE)));
        const scanLimit = Math.max(50, Math.min(10000, Number(body.scan_limit || VECTOR_SCAN_LIMIT)));
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
      if(!env.GROQ_API_KEY) missing.push("GROQ_API_KEY");
      return json({
        ok: missing.length===0,
        service: "Consciência do Fabiano",
        version: VERSION,
        architecture: "cloudflare-router-external-ai",
        storage_backend: "durable-object-sqlite",
        workers_ai_used: false,
        llm_provider: "groq",
        embedding_provider: "browser-transformers",
        server_pdf_parsing: false,
        chunk_concurrency_limit: CHUNK_CONCURRENCY,
        embedding_concurrency_limit: EMBED_CONCURRENCY,
        semantic_min_score: SEMANTIC_MIN_SCORE,
        search_top_k: TOP_K,
        require_lexical_match: REQUIRE_LEXICAL_MATCH,
        rag_map_reduce: true,
        map_batch_size: MAP_BATCH_SIZE,
        static_backup_hydration: true,
        static_backup_expected_embeddings: 25199,
        static_backup_payload_status: "scheduled-export",
        supabase_mirror_configured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        pinecone_mirror_configured: Boolean(env.PINECONE_UPSERT_URL && env.PINECONE_API_KEY),
        whisper_fallback_timeout_ms: 8000,
        local_whisper_stt: true,
        rag_resilience_levels: 10,
        local_library_catalog: true,
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
