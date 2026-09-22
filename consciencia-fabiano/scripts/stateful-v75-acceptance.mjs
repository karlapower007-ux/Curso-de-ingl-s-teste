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

// v10.1 privacy invariant: legacy secondary storage stays disabled even if
// old secrets still exist in the environment.
assert.equal(secondarySupabaseConfigured(env), false);

const originalFetch = globalThis.fetch;
let calls = [];
globalThis.fetch = async () => {
  calls.push("unexpected-egress");
  throw new Error("Secondary external egress must remain blocked.");
};

const blocked = await retrieveSecondaryHybridContext(
  env,
  "pergunta",
  Array.from({ length: 384 }, () => 0.01),
  { perDocumentK: 50, globalLimit: 150 }
);
assert.equal(blocked.mirrored, false);
assert.equal(blocked.matches.length, 0);
assert.equal(blocked.readable, false);
assert.equal(calls.length, 0);

globalThis.fetch = originalFetch;
console.log("STATEFUL_V75_ACCEPTANCE=success");
