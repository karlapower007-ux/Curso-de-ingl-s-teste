import assert from "node:assert/strict";
import {
  resolveStatefulQuery,
  retrieveSecondaryHybridContext,
  secondarySupabaseConfigured
} from "../src/stateful-rag-v75.js";

const history = [];
for (let i = 1; i <= 12; i++) {
  history.push({ role: "user", content: "Tema " + i + " sobre convênios e evidências." });
  history.push({ role: "assistant", content: "Resposta " + i });
}

const standalone = resolveStatefulQuery(
  "Qual é a definição de graça?",
  history,
  { use_history: false }
);
assert.equal(standalone.used_history, false);
assert.equal(standalone.query, "Qual é a definição de graça?");

const followup = resolveStatefulQuery(
  "Continue isso e aprofunde.",
  history,
  { use_history: true }
);
assert.equal(followup.used_history, true);
assert.equal(followup.llm_calls, 0);
assert.match(followup.query, /Tema 12/);
assert.doesNotMatch(followup.query, /Tema 1 sobre/);
assert.ok(followup.source_turns <= 2);

const env = {
  SUPABASE_URL: "https://secondary.example",
  SUPABASE_SERVICE_ROLE_KEY: "server-secret"
};
assert.equal(secondarySupabaseConfigured(env), true);

const originalFetch = globalThis.fetch;
let calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), body: String(options.body || "") });
  if (String(url).includes("fns_secondary_manifest")) {
    return new Response(JSON.stringify({
      ok: true, total_books: 0, total_chunks: 0, vector_count: 0
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("Search must not run when the mirror is empty.");
};

const emptyMirror = await retrieveSecondaryHybridContext(env, "teste", null);
assert.equal(emptyMirror.mirrored, false);
assert.equal(emptyMirror.matches.length, 0);
assert.equal(calls.length, 1);

calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), body: String(options.body || "") });
  if (String(url).includes("fns_secondary_manifest")) {
    return new Response(JSON.stringify({
      ok: true, total_books: 2, total_chunks: 20, vector_count: 20
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url).includes("fns_secondary_hybrid_search")) {
    return new Response(JSON.stringify([{
      id: "x1",
      document_id: "d1",
      text: "evidência",
      score: 0.91,
      lexical_score: 0.7,
      semantic_score: 0.8,
      retrieval_mode: "supabase-hybrid"
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};

const populated = await retrieveSecondaryHybridContext(
  env,
  "pergunta",
  Array.from({ length: 384 }, () => 0.01),
  { perDocumentK: 50, globalLimit: 150 }
);
assert.equal(populated.mirrored, true);
assert.equal(populated.matches.length, 1);
assert.equal(populated.per_document_k, 50);
assert.equal(populated.global_limit, 150);
assert.match(calls[1].body, /"per_document_k":50/);
assert.match(calls[1].body, /"global_limit":150/);

globalThis.fetch = originalFetch;
console.log("STATEFUL_V75_ACCEPTANCE=success");
