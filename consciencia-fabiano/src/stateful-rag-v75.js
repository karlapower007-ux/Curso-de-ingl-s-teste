const STATEFUL_WINDOW_MESSAGES = 20;
const SECONDARY_TIMEOUT_MS = 3500;
const SECONDARY_FAILURE_THRESHOLD = 3;
const SECONDARY_BASE_PAUSE_MS = 3000;
const SECONDARY_MAX_PAUSE_MS = 30000;

const secondaryCircuit = {
  failures: 0,
  openUntil: 0,
  rounds: 0,
  lastReason: ""
};

function cleanText(value, max = 1200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function hasConversationalReference(question) {
  const q = cleanText(question, 2000).toLowerCase();
  if (!q) return false;
  return /\b(isto|isso|aquilo|este|esta|esse|essa|ele|ela|eles|elas|dele|dela|deles|delas|anterior|acima|antes|último|ultima|última|mesmo|mesma|continue|continua|continuar|aprofund[ea]|mais sobre|e sobre|e ele|e ela|nesse|nessa|neste|nesta|desse|dessa|this|that|it|he|she|they|previous|above|continue|same|eso|esto|aquello|él|ella|anterior|continúa|continua)\b/u.test(q);
}

function priorUserTurns(history, currentQuestion) {
  const current = cleanText(currentQuestion, 2000);
  return Array.from(history || [])
    .slice(-STATEFUL_WINDOW_MESSAGES)
    .filter(item => String(item?.role || "").toLowerCase() === "user")
    .map(item => cleanText(item?.content, 900))
    .filter(Boolean)
    .filter(text => text !== current)
    .slice(-3);
}

function compactAnchor(turns) {
  const selected = Array.from(turns || []).slice(-2);
  if (!selected.length) return "";
  return cleanText(selected.join(" | "), 700);
}

export function resolveStatefulQuery(question, history, contract = {}) {
  const current = cleanText(question, 4000);
  const turns = priorUserTurns(history, current);
  const explicitReference = hasConversationalReference(current);
  const historyAllowed = Boolean(contract?.use_history) || explicitReference;

  if (!current || !historyAllowed || !turns.length) {
    return {
      query: current,
      standalone_query: current,
      used_history: false,
      mode: "standalone-current-question",
      source_turns: 0,
      llm_calls: 0
    };
  }

  const anchor = compactAnchor(turns);
  if (!anchor) {
    return {
      query: current,
      standalone_query: current,
      used_history: false,
      mode: "standalone-current-question",
      source_turns: 0,
      llm_calls: 0
    };
  }

  const standalone = cleanText(
    current + " — referência conversacional estritamente necessária: " + anchor,
    4800
  );

  return {
    query: standalone,
    standalone_query: standalone,
    used_history: true,
    mode: "deterministic-reference-resolution",
    source_turns: Math.min(2, turns.length),
    llm_calls: 0
  };
}

function secondaryDirectConfigured(env) {
  const base = String(env?.SUPABASE_URL || "").trim();
  const key = String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_RAG_KEY || "").trim();
  return Boolean(base && key);
}

function secondaryEdgeConfigured(env) {
  const base = String(env?.FNS_SECONDARY_URL || "").trim();
  const token = String(env?.FNS_OWNER_TOKEN || "").trim();
  return Boolean(base && token);
}

export function secondarySupabaseConfigured(env) {
  return secondaryDirectConfigured(env) || secondaryEdgeConfigured(env);
}

function secondaryHeaders(env) {
  const key = String(env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_RAG_KEY || "").trim();
  return {
    "Authorization": "Bearer " + key,
    "apikey": key,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
}

function secondaryEdgeHeaders(env) {
  const token = String(env?.FNS_OWNER_TOKEN || "").trim();
  return {
    "X-FNS-Owner-Token": token,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
}

function circuitTrip(reason, immediate = false) {
  secondaryCircuit.failures = immediate
    ? SECONDARY_FAILURE_THRESHOLD
    : secondaryCircuit.failures + 1;
  secondaryCircuit.lastReason = String(reason || "secondary-failure");
  if (secondaryCircuit.failures >= SECONDARY_FAILURE_THRESHOLD) {
    const pause = Math.min(
      SECONDARY_MAX_PAUSE_MS,
      SECONDARY_BASE_PAUSE_MS * (2 ** Math.min(4, secondaryCircuit.rounds))
    );
    secondaryCircuit.openUntil = Date.now() + pause;
    secondaryCircuit.rounds += 1;
  }
}

function circuitRecover() {
  secondaryCircuit.failures = 0;
  secondaryCircuit.openUntil = 0;
  secondaryCircuit.rounds = 0;
  secondaryCircuit.lastReason = "";
}

async function secondaryFetch(env, path, body = {}) {
  if (!secondarySupabaseConfigured(env)) {
    const error = new Error("Secondary Supabase is not configured.");
    error.code = "SECONDARY_NOT_CONFIGURED";
    throw error;
  }
  if (Date.now() < secondaryCircuit.openUntil) {
    const error = new Error("Secondary circuit is open.");
    error.code = "SECONDARY_CIRCUIT_OPEN";
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SECONDARY_TIMEOUT_MS);
  try {
    let res;
    let mode = "direct";

    if (secondaryDirectConfigured(env)) {
      const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
      res = await fetch(base + path, {
        method: "POST",
        headers: secondaryHeaders(env),
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
    } else {
      mode = "edge-owner-token";
      const base = String(env.FNS_SECONDARY_URL || "").replace(/\/$/, "");
      const action =
        path.includes("fns_secondary_manifest") ? "manifest" :
        path.includes("fns_secondary_hybrid_search") ? "search" :
        "";
      if (!action) {
        const error = new Error("Secondary edge action is not mapped.");
        error.code = "SECONDARY_EDGE_ACTION_UNMAPPED";
        throw error;
      }
      const edgeBody = action === "search"
        ? {
            query: String(body?.query_text || ""),
            query_embedding: body?.query_embedding_text || null,
            per_document_k: body?.per_document_k,
            global_limit: body?.global_limit
          }
        : body;
      res = await fetch(base + "?action=" + encodeURIComponent(action), {
        method: "POST",
        headers: secondaryEdgeHeaders(env),
        body: JSON.stringify(edgeBody || {}),
        signal: controller.signal
      });
    }

    if (res.status === 429 || res.status >= 500) {
      circuitTrip(mode + "-http-" + res.status, res.status === 429);
      const error = new Error("Secondary HTTP " + res.status);
      error.code = res.status === 429 ? "SECONDARY_QUOTA_OR_RATE_LIMIT" : "SECONDARY_UNAVAILABLE";
      error.status = res.status;
      throw error;
    }
    if (!res.ok) {
      const error = new Error("Secondary HTTP " + res.status);
      error.code = "SECONDARY_REQUEST_FAILED";
      error.status = res.status;
      throw error;
    }

    const data = await res.json().catch(() => null);
    circuitRecover();
    if (mode === "edge-owner-token" && path.includes("fns_secondary_hybrid_search")) {
      return Array.isArray(data?.matches) ? data.matches : [];
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      circuitTrip("timeout", true);
      const timeout = new Error("Secondary timeout.");
      timeout.code = "SECONDARY_TIMEOUT";
      throw timeout;
    }
    if (!String(error?.code || "").startsWith("SECONDARY_")) {
      circuitTrip(String(error?.message || error), false);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function vectorText(vector) {
  if (!Array.isArray(vector) || vector.length !== 384) return null;
  const clean = vector.map(Number);
  if (clean.some(value => !Number.isFinite(value))) return null;
  return "[" + clean.join(",") + "]";
}

export async function readSecondaryManifest(env) {
  const data = await secondaryFetch(env, "/rest/v1/rpc/fns_secondary_manifest", {});
  const manifest = data && typeof data === "object" ? data : {};
  return {
    ok: manifest?.ok === true,
    authoritative: false,
    secondary: true,
    mirrored: Number(manifest?.total_chunks || 0) > 0,
    total_books: Math.max(0, Number(manifest?.total_books || 0)),
    total_chunks: Math.max(0, Number(manifest?.total_chunks || 0)),
    vector_count: Math.max(0, Number(manifest?.vector_count || 0)),
    generation: String(manifest?.generation || ""),
    source_signature: String(manifest?.source_signature || ""),
    updated_at: String(manifest?.updated_at || "")
  };
}

export async function retrieveSecondaryHybridContext(
  env,
  question,
  suppliedEmbedding = null,
  options = {}
) {
  if (!secondarySupabaseConfigured(env)) {
    return {
      matches: [],
      readable: false,
      mirrored: false,
      provider: "supabase-secondary",
      reason: "not-configured"
    };
  }

  const manifest = await readSecondaryManifest(env);
  if (!manifest.mirrored) {
    return {
      matches: [],
      readable: true,
      mirrored: false,
      provider: "supabase-secondary",
      manifest,
      reason: "mirror-empty-not-library-empty"
    };
  }

  const perDocumentK = Math.max(1, Math.min(50, Number(options?.perDocumentK || 50)));
  const globalLimit = Math.max(1, Math.min(150, Number(options?.globalLimit || 150)));
  const data = await secondaryFetch(env, "/rest/v1/rpc/fns_secondary_hybrid_search", {
    query_text: cleanText(question, 4000),
    query_embedding_text: vectorText(suppliedEmbedding),
    per_document_k: perDocumentK,
    global_limit: globalLimit
  });

  const rows = Array.isArray(data) ? data : [];
  return {
    matches: rows.map(row => ({
      ...row,
      score: Number(row?.score || 0),
      lexical_score: Number(row?.lexical_score || 0),
      semantic_score: Number(row?.semantic_score || 0),
      retrieval_mode: String(row?.retrieval_mode || "supabase-secondary-hybrid"),
      secondary_provider: true
    })),
    readable: true,
    mirrored: true,
    provider: "supabase-secondary",
    manifest,
    per_document_k: perDocumentK,
    global_limit: globalLimit
  };
}

export function secondaryCircuitState() {
  return {
    failures: secondaryCircuit.failures,
    open: Date.now() < secondaryCircuit.openUntil,
    open_until: secondaryCircuit.openUntil,
    last_reason: secondaryCircuit.lastReason
  };
}
