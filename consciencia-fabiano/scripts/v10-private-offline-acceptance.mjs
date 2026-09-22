import { readFileSync } from "node:fs";

const read = rel => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const index = read("src/index.js");
const stateful = read("src/stateful-rag-v75.js");
const app = read("public/app.js");
const sw = read("public/sw-v3.js");
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
assert(index.includes('privacy_mode: "strict-private-egress-lock"'), "strict privacy health marker missing");
assert(index.includes("encyclopedia_fts USING fts5"), "SQLite FTS5 encyclopedia missing");
assert(index.includes("semantic_query_embedding_server_enabled: false"), "server semantic embeddings must stay disabled");

assert(!app.includes("LOCAL_ADMIN_PASSWORD"), "admin password constant leaked to browser");
assert(!/["']gadu["']/i.test(app), "legacy cleartext admin password leaked to browser");
assert(!app.includes("/api/admin/mirror-upsert"), "browser external mirror endpoint still reachable");
assert(app.includes('CURRENT_SYSTEM_VERSION = "v10.1-private-egress-offline-online"'), "client version marker missing");
assert(app.includes('return ["auto","offline","online"].includes(value)?value:"auto";'), "offline/online operating modes missing");
assert(app.includes("async function prepareOfflineMode()"), "offline preparation flow missing");
assert(app.includes("offlineDictionarySearch"), "local encyclopedia search missing");
assert(app.includes("Xenova/paraphrase-multilingual-MiniLM-L12-v2"), "local embedding model missing");

assert(!sw.includes('metaPut("owner_token"'), "service worker persists admin token");
assert(!sw.includes('metaGet("owner_token"'), "service worker reads a persisted admin token");
assert(sw.includes('let sessionOwnerToken=""'), "ephemeral service-worker admin token missing");
assert(sw.includes('if(mode==="offline") return cached || Response.error();'), "forced-offline external firewall missing");

assert(html.includes('<option value="offline">100% offline</option>'), "100% offline UI option missing");
assert(html.includes('<option value="online">Online</option>'), "online UI option missing");
assert(html.includes('id="prepareOfflineBtn"'), "offline preparation button missing");

for (const width of ["412px","390px","360px"]) {
  assert(css.includes("@media(max-width:" + width + ")"), "responsive breakpoint missing: " + width);
}

console.log("V10.1 private/offline acceptance: OK");
