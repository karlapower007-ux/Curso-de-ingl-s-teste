import { chromium } from "playwright";

const base = process.env.BASE_URL || "https://consciencia-fabiano.focoeepoder2.workers.dev";
const oidc = process.env.OIDC_TOKEN || "";
if (!oidc) throw new Error("OIDC_TOKEN ausente");

function makePdf() {
  const text = "BT /F1 14 Tf 72 720 Td (Visual UI test document. Secret code VISUAL-4219.) Tj ET";
  const enc = new TextEncoder();
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + enc.encode(text).length + " >>\nstream\n" + text + "\nendstream",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(enc.encode(out).length);
    out += (i + 1) + " 0 obj\n" + objs[i] + "\nendobj\n";
  }
  const xref = enc.encode(out).length;
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
  for (const off of offsets.slice(1)) out += String(off).padStart(10, "0") + " 00000 n \n";
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.addInitScript(() => {
  sessionStorage.setItem("consciencia_fabiano_admin_password_v1", "ui-e2e-placeholder");
});

await page.route(base + "/api/**", async route => {
  const headers = { ...route.request().headers(), "x-fns-github-oidc": oidc };
  await route.continue({ headers });
});

let testDocId = "";
try {
  await page.goto(base + "/admin?ui-e2e=" + Date.now(), { waitUntil: "networkidle" });

  const backendText = page.locator("#backendText");
  await backendText.waitFor({ state: "attached" });
  const beforeText = await backendText.textContent();
  const beforeMatch = String(beforeText || "").match(/(\d+) PDFs/);
  const before = beforeMatch ? Number(beforeMatch[1]) : 0;

  await page.locator("#pdfInput").setInputFiles({
    name: "fns-ui-visual-e2e.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(),
  });

  await page.locator("#uploadBtn").click();
  await page.waitForFunction(() => {
    const t = document.querySelector("#adminStatus")?.textContent || "";
    return /PDF indexado:|já existia na biblioteca/.test(t);
  }, null, { timeout: 120000 });

  await page.waitForFunction((expected) => {
    const t = document.querySelector("#backendText")?.textContent || "";
    const m = t.match(/(\d+) PDFs/);
    return m && Number(m[1]) >= expected;
  }, before + 1, { timeout: 30000 });

  const afterText = await backendText.textContent();
  const afterMatch = String(afterText || "").match(/(\d+) PDFs/);
  const after = afterMatch ? Number(afterMatch[1]) : -1;
  if (after !== before + 1) throw new Error("contador visual não incrementou: " + before + " -> " + after);

  const statusText = await page.locator("#adminStatus").textContent();
  if (!/PDF indexado:/.test(statusText || "")) throw new Error("mensagem visual de sucesso ausente");

  const appJs = await page.evaluate(() => fetch("/app.js?v=8").then(r => r.text()));
  if (!appJs.includes('u.lang = "pt-BR"')) throw new Error("frontend sem pt-BR explícito");
  if (!appJs.includes("voiceschanged")) throw new Error("frontend não aguarda vozes naturais");
  if (!appJs.includes('/api/trigger-index')) throw new Error("frontend não chama trigger-index");

  const books = await page.evaluate(() => fetch("/api/admin/livros").then(r => r.json()));
  const row = (books.livros || []).find(x => x.arquivo === "fns-ui-visual-e2e.pdf");
  if (!row?.id) throw new Error("PDF visual não apareceu no catálogo");
  testDocId = row.id;

  await page.screenshot({ path: "ui-e2e-after-index.png", fullPage: true });

  console.log("UI_VISUAL_UPLOAD_PASS=yes");
  console.log("UI_VISUAL_COUNTER_PASS=yes");
  console.log("UI_TRIGGER_INDEX_PASS=yes");
  console.log("UI_PTBR_VOICE_CODE_PASS=yes");
} finally {
  if (testDocId) {
    await page.evaluate(async id => {
      await fetch("/api/admin/delete-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: id }),
      });
    }, testDocId).catch(() => {});
  }
  await browser.close();
}
