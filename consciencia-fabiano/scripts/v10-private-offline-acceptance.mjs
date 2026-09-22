import { readFileSync } from "node:fs";

const read = rel => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const index = read("src/index.js");
const stateful = read("src/stateful-rag-v75.js");
const app = read("public/app.js");
const sw = read("public/sw-v3.js");
const ragCascade = read("public/rag-cascade.js");
const ragWorker = read("public/rag-search-worker.js");
const html = read("public/index.html");
const css = read("public/style.css");

function assert(condition, message) {
  if (!condition) {
    console.error("V10.1 ACCEPTANCE FAILED:", message);
    process.exit(1);
  }
}

const server = index + "\n" + stateful;
assert(index.includes('10.1.0-private-egress-offline-online'), "version marker missing");
assert(index.includes("const PRIVATE_EGRESS_LOCK = true;"), "server private egress lock is not enabled");
assert(index.includes("const LEGACY_EXTERNAL_EMBEDDINGS = false;"), "legacy external embeddings are not disabled");
assert(index.includes("const LEGACY_EXTERNAL_MIRRORS = false;"), "legacy external mirrors are not disabled");
assert(index.includes("const GROQ_ZDR_REQUIRED = true;"), "Groq ZDR gate is not mandatory");
assert(index.includes("const GROQ_FREE_ONLY_REQUIRED = true;"), "Groq free-tier gate is not mandatory");
assert(index.includes("const WORKERS_AI_DAILY_NEURON_BUDGET = 8500;"), "Workers AI neuron budget is missing");
assert(index.includes("externalSafeMessages(messages),inputBudget"), "low-level Groq transport bypasses Privacy Gate");
assert(stateful.includes("const SECONDARY_PRIVACY_LOCK = true;"), "secondary privacy lock is not enabled");

for (const forbidden of [
  "https://api.cohere.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
  "api.x.ai"
]) {
  assert(!server.includes(forbidden), "forbidden server egress endpoint present: " + forbidden);
}

assert(index.includes("https://api.groq.com/openai/v1/chat/completions"), "Groq chat endpoint missing");
assert(index.includes('external_egress_allowlist: ["api.groq.com","cloudflare-workers-ai-binding"]'), "declared egress allowlist missing");
assert(index.includes('const EXTERNAL_EGRESS_ALLOWLIST = new Set(["api.groq.com"]);'), "runtime egress firewall missing");
assert(index.includes("async function externalEgressFetch"), "egress wrapper missing");
assert(index.includes('externalEgressFetch("https://api.groq.com/openai/v1/chat/completions"'), "Groq chat does not use runtime egress firewall");
assert(index.includes('externalEgressFetch("https://api.groq.com/openai/v1/audio/transcriptions"'), "Groq STT does not use runtime egress firewall");
assert(index.includes("const keys = requireGroqKeys(env);"), "Groq STT bypasses ZDR/free-tier gate");
assert(index.includes('privacy_mode: "strict-private-egress-lock"'), "strict privacy health marker missing");
assert(index.includes("encyclopedia_fts USING fts5"), "SQLite FTS5 encyclopedia missing");
assert(index.includes("CREATE TABLE IF NOT EXISTS encyclopedia_concepts"), "concept table missing");
assert(index.includes("CREATE TABLE IF NOT EXISTS encyclopedia_aliases"), "alias table missing");
assert(index.includes("CREATE TABLE IF NOT EXISTS encyclopedia_concept_occurrences"), "concept occurrence table missing");
assert(index.includes("CREATE TABLE IF NOT EXISTS encyclopedia_relations"), "concept relation table missing");
assert(index.includes("indexEncyclopediaConceptChunk(chunk"), "concept ingestion hook missing");
assert(index.includes("backfillEncyclopediaConcepts(limit"), "incremental concept backfill missing");
assert(index.includes('url.pathname === "/api/encyclopedia/concept"'), "public concept summary route missing");
assert(index.includes('url.pathname === "/api/admin/encyclopedia-concepts/backfill"'), "private concept backfill route missing");
assert(index.includes('encyclopedia_relation_type: "co_occurs_with"'), "relation type marker missing");
assert(index.includes("derived_index_error:true"), "concept indexing must fail open");
assert(index.includes("encyclopedia_concept_fail_open: true"), "concept fail-open health marker missing");
assert(index.includes("const CONCEPT_INDEX_MAX_CONCEPTS_PER_CHUNK = 4;"), "concept fanout zero-cost cap missing");
assert(index.includes("const CONCEPT_BACKFILL_DAILY_CHUNK_BUDGET = 1500;"), "concept daily zero-cost budget missing");
assert(index.includes("paused_zero_cost:true"), "concept backfill does not pause at zero-cost budget");
assert(index.includes("ready_for_search:readyForSearch"), "real PDF ready-for-search stage missing");
assert(index.includes("encyclopedia:{progress:encyclopediaProgress"), "encyclopedia indexing progress stage missing");
assert(index.includes("semantic_query_embedding_server_enabled: false"), "server semantic embeddings must stay disabled");

assert(!app.includes("LOCAL_ADMIN_PASSWORD"), "admin password constant leaked to browser");
assert(!/["']gadu["']/i.test(app), "legacy cleartext admin password leaked to browser");
assert(!app.includes("/api/admin/mirror-upsert"), "browser external mirror endpoint still reachable");
assert(!app.includes('standard[-_ ]?works[-_\\w]*\\.pdf/gi, "Obras Padrão"'), "UI still rewrites a technical filename to Obras Padrão");
assert(app.includes('CURRENT_SYSTEM_VERSION = "v10.1-private-egress-offline-online"'), "client version marker missing");
assert(app.includes('return ["auto","offline","online"].includes(value)?value:"auto";'), "offline/online operating modes missing");
assert(app.includes("async function prepareOfflineMode()"), "offline preparation flow missing");
assert(app.includes("offlineDictionarySearch"), "local encyclopedia search missing");
assert(ragWorker.includes("OFFLINE_CONCEPT_ALIAS_GROUPS"), "offline concept aliases missing");
assert(ragWorker.includes('{key:"adam",label:"Adão"'), "Adam ↔ Adão offline alias missing");
assert(ragWorker.includes('{key:"michael",label:"Miguel"'), "Michael ↔ Miguel offline alias missing");
assert(ragWorker.includes('{key:"second-anointing",label:"Segunda Unção"'), "Second Anointing ↔ Segunda Unção offline alias missing");
assert(ragWorker.includes('{key:"tithing",label:"Dízimo"'), "Tithing ↔ Dízimo offline alias missing");
assert(ragWorker.includes('{key:"heavenly-father",label:"Pai Celestial"'), "Heavenly Father ↔ Pai Celestial offline alias missing");
assert(ragWorker.includes('{key:"melchizedek-priesthood",label:"Sacerdócio de Melquisedeque"'), "Melchizedek Priesthood alias missing");
assert(ragWorker.includes('{key:"plan-of-salvation",label:"Plano de Salvação"'), "Plan of Salvation alias missing");
assert(ragWorker.includes('{key:"premortal-life",label:"Vida Pré-Mortal"'), "Premortal Life alias missing");
assert(ragWorker.includes("offlineConceptsForQuestion"), "multi-concept offline parser missing");
assert(ragWorker.includes("strict-alias-and-indexeddb-page-v10-1"), "compound AND alias lock missing offline");
assert(ragCascade.includes("compound_alias_lock:r.compound_alias_lock===true"), "compound alias lock is not surfaced by cascade");
assert(index.includes("encyclopediaConceptsForQuestion"), "server multi-concept parser missing");
assert(index.includes("encyclopediaAliasParagraphMatch"), "server compound alias paragraph lock missing");
assert(index.includes("encyclopedia-alias-and-fts5-v10-1"), "server compound alias FTS mode missing");
assert(ragWorker.includes("strict-alias-indexeddb-page-v10-1"), "alias-aware offline pagination missing");
assert(ragWorker.includes('source:"indexeddb-local-derived"'), "offline concept summary source marker missing");
assert(ragWorker.includes('predicate:"co_occurs_with"'), "offline deterministic co-occurrence relations missing");
assert(ragCascade.includes("concept:r.concept||null"), "offline concept card is not returned to UI");
assert(ragCascade.includes("alias_expanded:r.alias_expanded===true"), "offline alias expansion metadata missing");
assert(app.includes("dictionaryState.concept=data?.concept||null;"), "UI does not use local concept cards offline");
assert(sw.includes('fns-consiencia-v10-1-private-offline-online-alias-v3'), "offline cache was not refreshed for alias search");
assert(app.includes('api("/api/encyclopedia/concept"'), "concept graph is not wired to dictionary UI");
assert(app.includes('api("/api/admin/encyclopedia-concepts/backfill"'), "incremental concept backfill is not wired");
assert(app.includes("Relações por coocorrência"), "concept relation UI missing");
assert(app.includes("orçamento R$0 diário preservado"), "concept zero-cost pause is not surfaced in UI");
assert(app.includes("Xenova/paraphrase-multilingual-MiniLM-L12-v2"), "local embedding model missing");

assert(!sw.includes('metaPut("owner_token"'), "service worker persists admin token");
assert(!sw.includes('metaGet("owner_token"'), "service worker reads a persisted admin token");
assert(sw.includes('let sessionOwnerToken=""'), "ephemeral service-worker admin token missing");
assert(sw.includes('if(mode==="offline") return cached || Response.error();'), "forced-offline external firewall missing");

assert(html.includes('<option value="offline">100% offline</option>'), "100% offline UI option missing");
assert(html.includes('<option value="online">Online</option>'), "online UI option missing");
assert(html.includes('id="prepareOfflineBtn"'), "offline preparation button missing");
assert(html.includes('id="settingsTab"'), "settings tab missing");
assert(html.includes('id="settingsPanel"'), "settings panel missing");
assert(html.includes('id="settingsOperationMode"'), "settings mode selector missing");
assert(html.includes('id="settingsPrepareOfflineBtn"'), "settings offline preparation button missing");
assert(html.includes('id="dictionaryConcept"'), "concept summary surface missing");
assert(html.includes('id="conceptIndexStatus"'), "concept index progress surface missing");
assert(app.includes('switchPanel("settings")'), "settings panel is not wired");
assert(app.includes('settingsModeSelect.addEventListener("change"'), "settings mode selector is not synchronized");

assert(css.includes(".dictionary-concept-card{"), "concept card styling missing");
for (const width of ["412px","390px","360px"]) {
  assert(css.includes("@media(max-width:" + width + ")"), "responsive breakpoint missing: " + width);
}

assert(index.includes("groq_final_stage_only:true"), "final-stage-only LLM marker missing");
console.log("V10.1 private/offline acceptance: OK");
