const apiBase = "https://api.cloudflare.com/client/v4";
const token = process.env.FABIANO_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
let accountId = process.env.FABIANO_CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
const appName = "Consciência Fabiano Admin";
const base = "https://consciencia-fabiano.focoeepoder2.workers.dev";

if (!token || !accountId) throw new Error("Cloudflare credentials ausentes");

async function cf(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  headers.set("Content-Type", "application/json");
  const res = await fetch(apiBase + path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function resolveAccountId() {
  const r = await fetch(apiBase + "/accounts?per_page=50", {
    headers: { Authorization: "Bearer " + token }
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.success !== true || !Array.isArray(body.result) || body.result.length === 0) {
    throw new Error("Não foi possível resolver a conta do token.");
  }
  const expected = String(accountId || "").trim();
  const match = body.result.find(x => x.id === expected);
  if (match) {
    accountId = match.id;
    console.log("ACCOUNT_MATCH=yes");
    return;
  }
  if (body.result.length === 1) {
    accountId = body.result[0].id;
    console.log("ACCOUNT_RESOLVED_FROM_TOKEN=yes");
    return;
  }
  throw new Error("Account ID não corresponde e o token enxerga múltiplas contas.");
}

async function removeLegacyAccess() {
  const listed = await cf("/accounts/" + accountId + "/access/apps?per_page=100");
  if (listed.res.status === 403 && listed.body?.errors?.some(e => Number(e.code) === 9999)) {
    console.log("LEGACY_ACCESS_ALREADY_DISABLED=yes");
    return;
  }
  if (!listed.res.ok || listed.body?.success !== true) {
    throw new Error("Falha ao listar Access apps: HTTP " + listed.res.status);
  }
  const apps = Array.isArray(listed.body.result) ? listed.body.result : [];
  const targets = apps.filter(x => x.name === appName);
  for (const app of targets) {
    const deleted = await cf("/accounts/" + accountId + "/access/apps/" + app.id, { method: "DELETE" });
    if (!deleted.res.ok || deleted.body?.success !== true) {
      throw new Error("Falha ao remover Access app " + app.id + ": HTTP " + deleted.res.status);
    }
    console.log("LEGACY_ACCESS_APP_REMOVED=yes");
  }
  if (!targets.length) console.log("LEGACY_ACCESS_APP_ABSENT=yes");
}

async function verifyNativeAuth() {
  for (let i = 0; i < 12; i++) {
    const admin = await fetch(base + "/admin", { redirect: "manual", cache: "no-store" });
    const api = await fetch(base + "/api/admin/livros", { redirect: "manual", cache: "no-store" });
    const bad = await fetch(base + "/api/admin/session", {
      redirect: "manual",
      cache: "no-store",
      headers: { "X-FNS-Admin-Password": "senha-incorreta-de-teste" }
    });

    if (admin.status === 200 && api.status === 401 && bad.status === 401) {
      console.log("ADMIN_NATIVE_LOGIN_PAGE_PASS=yes");
      console.log("ADMIN_API_REQUIRES_PASSWORD=yes");
      console.log("WRONG_PASSWORD_REJECTED=yes");
      console.log("NATIVE_ADMIN_AUTH=success");
      return;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("A autenticação nativa não ficou ativa no tempo esperado.");
}

await resolveAccountId();
await removeLegacyAccess();
await new Promise(r => setTimeout(r, 3500));
await verifyNativeAuth();
