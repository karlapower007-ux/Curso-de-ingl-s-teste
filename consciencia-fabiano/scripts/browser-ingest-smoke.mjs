import fs from "node:fs";
import { chromium } from "playwright-core";

const base = String(process.argv[2] || "").replace(/\/$/, "");
const pdfPath = String(process.argv[3] || "");
const automationSecret = String(process.env.FNS_AUTOMATION_SECRET || "");
const expectR2 = String(process.env.EXPECT_R2 || "") === "1";

if (!/^https:\/\//.test(base)) throw new Error("BASE URL inválida.");
if (!pdfPath || !fs.existsSync(pdfPath)) throw new Error("PDF de teste não encontrado.");
if (!automationSecret) throw new Error("FNS_AUTOMATION_SECRET ausente.");

const candidates = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const executablePath = candidates.find(p => fs.existsSync(p));
if (!executablePath) throw new Error("Chrome/Chromium não encontrado.");

const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
const apiRequests = [];
const pageErrors = [];
const startedAt = Date.now();

try {
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const page = await context.newPage();
  page.on("pageerror", err => pageErrors.push(String(err)));
  page.on("request", req => {
    if (!req.url().startsWith(base + "/api/")) return;
    apiRequests.push({
      path: new URL(req.url()).pathname,
      method: req.method(),
      bytes: req.postDataBuffer()?.byteLength || 0,
    });
  });

  await page.route("**/api/**", async route => {
    const req = route.request();
    if (!req.url().startsWith(base + "/api/")) return route.continue();
    await route.continue({ headers: { ...req.headers(), "x-fns-automation": automationSecret } });
  });

  await page.goto(base + "/admin?client_ingest_smoke=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  await page.locator("#pdfInput").setInputFiles(pdfPath);
  await page.locator("#uploadBtn").click();

  let finalStatus = "";
  const deadline = Date.now() + 240000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    finalStatus = String(await page.locator("#adminStatus").textContent() || "");
    if (finalStatus !== lastStatus) {
      console.error("ADMIN_STATUS=" + finalStatus);
      lastStatus = finalStatus;
    }
    if (finalStatus.startsWith("Concluído:") || finalStatus.startsWith("Já indexado:")) break;
    if (/^(Falha|Erro):/i.test(finalStatus)) {
      throw new Error("Interface reportou falha: " + finalStatus);
    }
    await page.waitForTimeout(1000);
  }
  if (!finalStatus.startsWith("Concluído:") && !finalStatus.startsWith("Já indexado:")) {
    throw new Error("Timeout aguardando ingestão. status=" + finalStatus + " api=" + JSON.stringify(apiRequests.slice(-20)) + " pageErrors=" + JSON.stringify(pageErrors));
  }
  const bookName = pdfPath.split("/").pop();
  await page.locator("#booksList").getByText(bookName, { exact: true }).waitFor({ state: "visible", timeout: 15000 });

  const binaryWorkerUploads = apiRequests.filter(x => x.path === "/api/admin/upload-pdf");
  const triggerRequests = apiRequests.filter(x => x.path === "/api/trigger-index");
  const maxTriggerPayload = Math.max(0, ...triggerRequests.map(x => x.bytes));

  if (binaryWorkerUploads.length) throw new Error("O navegador enviou PDF binário ao Worker.");
  if (!triggerRequests.length) throw new Error("Nenhum payload chegou a /api/trigger-index.");
  if (maxTriggerPayload > 1600000) throw new Error("Payload JSON acima do limite leve: " + maxTriggerPayload);
  if (!/Matriz 50\/50/.test(finalStatus || "")) throw new Error("Interface não confirmou a Matriz 50/50.");
  if (expectR2 && !/original salvo direto no R2/.test(finalStatus || "")) throw new Error("R2 era esperado, mas o upload direto não foi confirmado.");
  if (pageErrors.length) throw new Error("Page errors: " + pageErrors.join(" | "));

  console.log(JSON.stringify({
    ok: true,
    production: base,
    pdf_file_bytes: fs.statSync(pdfPath).size,
    binary_pdf_requests_to_worker: binaryWorkerUploads.length,
    trigger_index_requests: triggerRequests.length,
    max_trigger_payload_bytes: maxTriggerPayload,
    r2_expected: expectR2,
    elapsed_ms: Date.now() - startedAt,
    final_status: finalStatus,
  }));
} finally {
  await browser.close();
}
