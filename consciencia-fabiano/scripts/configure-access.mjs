const apiBase = "https://api.cloudflare.com/client/v4";
const token = process.env.FABIANO_CLOUDFLARE_API_TOKEN || "";
let accountId = process.env.FABIANO_CLOUDFLARE_ACCOUNT_ID || "";
const hostname = "consciencia-fabiano.focoeepoder2.workers.dev";
const allowedEmail = "focoeepoder2@gmail.com";
const appName = "Consciência Fabiano Admin";
const policyName = "Fabiano somente";

if (!token || !accountId) throw new Error("Cloudflare credentials ausentes");

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
    console.log("ACCESS_ACCOUNT_MATCH=yes");
    return;
  }
  if (body.result.length === 1) {
    accountId = body.result[0].id;
    console.log("ACCESS_ACCOUNT_RESOLVED_FROM_TOKEN=yes");
    return;
  }
  throw new Error("Account ID não corresponde e o token enxerga múltiplas contas.");
}

async function cf(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  headers.set("Content-Type", "application/json");
  const res = await fetch(apiBase + path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

function ensureSuccess(label, result) {
  if (!result.res.ok || result.body?.success !== true) {
    const errors = Array.isArray(result.body?.errors) ? result.body.errors : [];
    const safe = errors.map(e => ({ code:e.code, message:e.message }));
    throw new Error(label + " failed HTTP " + result.res.status + " " + JSON.stringify(safe));
  }
  return result.body.result;
}

async function probeOrganization() {
  const org = await cf("/accounts/" + accountId + "/access/organizations");
  console.log("ACCESS_ORG_HTTP=" + org.res.status);
  if (org.body?.success === true) {
    console.log("ACCESS_ORG_READY=yes");
    return org.body.result;
  }
  const errors = Array.isArray(org.body?.errors) ? org.body.errors : [];
  console.log("ACCESS_ORG_ERRORS=" + JSON.stringify(errors.map(e => ({code:e.code,message:e.message}))));
  console.log("ACCESS_ORG_READY=unknown");
  return null;
}

async function diagnoseIdPs() {
  const r = await cf("/accounts/" + accountId + "/access/identity_providers");
  console.log("IDP_LIST_HTTP=" + r.res.status);
  if (r.body?.success === true && Array.isArray(r.body.result)) {
    console.log("IDP_LIST=" + JSON.stringify(r.body.result.map(x => ({ id:x.id, name:x.name, type:x.type }))));
    return r.body.result;
  }
  const errors = Array.isArray(r.body?.errors) ? r.body.errors : [];
  console.log("IDP_LIST_ERRORS=" + JSON.stringify(errors.map(e => ({code:e.code,message:e.message}))));
  return [];
}

async function ensureOtpIdp() {
  const current = await diagnoseIdPs();
  let otp = current.find(x => x.type === "onetimepin");
  if (otp) {
    console.log("OTP_IDP_EXISTS=yes");
    return otp;
  }
  const created = await cf("/accounts/" + accountId + "/access/identity_providers", {
    method: "POST",
    body: JSON.stringify({ name: "Código por e-mail", type: "onetimepin", config: {} })
  });
  otp = ensureSuccess("create OTP IdP", created);
  console.log("OTP_IDP_CREATED=yes");
  console.log("OTP_IDP_ID=" + otp.id);
  return otp;
}

async function ensureApplication(otpId) {
  const listed = await cf("/accounts/" + accountId + "/access/apps?per_page=100");
  const apps = ensureSuccess("list apps", listed) || [];
  let app = Array.isArray(apps) ? apps.find(x => x.name === appName) : null;

  const body = {
    name: appName,
    type: "self_hosted",
    domain: hostname + "/admin",
    session_duration: "1h",
    app_launcher_visible: false,
    skip_interstitial: false,
    allow_authenticate_via_warp: false,
    http_only_cookie_attribute: true,
    same_site_cookie_attribute: "strict",
    allowed_idps: [otpId],
    auto_redirect_to_identity: true,
    destinations: [
      { type: "public", uri: hostname + "/admin" },
      { type: "public", uri: hostname + "/admin*" },
      { type: "public", uri: hostname + "/api/admin/*" }
    ]
  };

  if (!app) {
    const created = await cf("/accounts/" + accountId + "/access/apps", {
      method: "POST",
      body: JSON.stringify(body)
    });
    app = ensureSuccess("create app", created);
    console.log("ACCESS_APP_CREATED=yes");
  } else {
    const updated = await cf("/accounts/" + accountId + "/access/apps/" + app.id, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    app = ensureSuccess("update app", updated);
    console.log("ACCESS_APP_UPDATED=yes");
  }
  console.log("ACCESS_APP_ID=" + app.id);
  return app;
}

async function ensurePolicy(appId, otpId) {
  const listed = await cf("/accounts/" + accountId + "/access/apps/" + appId + "/policies?per_page=100");
  const policies = ensureSuccess("list policies", listed) || [];
  let policy = Array.isArray(policies) ? policies.find(x => x.name === policyName) : null;

  const body = {
    name: policyName,
    decision: "allow",
    precedence: 1,
    session_duration: "1h",
    include: [{ email: { email: allowedEmail } }],
    require: [{ login_method: { id: otpId } }],
    exclude: []
  };

  if (!policy) {
    const created = await cf("/accounts/" + accountId + "/access/apps/" + appId + "/policies", {
      method: "POST",
      body: JSON.stringify(body)
    });
    policy = ensureSuccess("create policy", created);
    console.log("ACCESS_POLICY_CREATED=yes");
  } else {
    const updated = await cf("/accounts/" + accountId + "/access/apps/" + appId + "/policies/" + policy.id, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    policy = ensureSuccess("update policy", updated);
    console.log("ACCESS_POLICY_UPDATED=yes");
  }
  console.log("ACCESS_POLICY_ID=" + policy.id);
  return policy;
}

async function verifyEdgeLock() {
  const publicHealth = await fetch("https://" + hostname + "/health", { redirect:"manual" });
  if (publicHealth.status !== 200) throw new Error("public /health unexpectedly blocked: " + publicHealth.status);
  console.log("PUBLIC_HEALTH_STILL_OPEN=yes");

  for (const path of ["/admin", "/api/admin/livros"]) {
    const res = await fetch("https://" + hostname + path, { redirect:"manual" });
    const location = res.headers.get("location") || "";
    console.log("ACCESS_PROBE_" + path.replaceAll("/","_").toUpperCase() + "_HTTP=" + res.status);
    if (res.status === 200) throw new Error("Admin route still publicly reachable: " + path);
    if (![301,302,303,307,308,401,403].includes(res.status)) {
      throw new Error("Unexpected Access response " + res.status + " on " + path);
    }
    if (location) console.log("ACCESS_REDIRECT_PRESENT=yes");
  }
  console.log("ADMIN_EDGE_LOCK_PASS=yes");
}

await resolveAccountId();
await probeOrganization();
const otp = await ensureOtpIdp();
const app = await ensureApplication(otp.id);
await ensurePolicy(app.id, otp.id);
await new Promise(r => setTimeout(r, 5000));
await verifyEdgeLock();
console.log("ZERO_TRUST_ACCESS=success");
