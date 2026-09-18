import { chromium } from "playwright";

const base = process.env.BASE_URL || "https://consciencia-fabiano.focoeepoder2.workers.dev";
const oidc = process.env.OIDC_TOKEN || "";
if (!oidc) throw new Error("OIDC_TOKEN ausente");

function makePdf(runCode, paddingBytes = 0) {
  const text = "BT /F1 14 Tf 72 720 Td (Visual UI test document. Code " + runCode + ".) Tj ET";
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
  if (paddingBytes > 0) {
    const padLine = "% UI-PADDING-" + "Y".repeat(1000) + "\n";
    while (Buffer.byteLength(out) < paddingBytes) out += padLine;
  }
  return Buffer.from(out);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let chatContentType = "";
page.on("response", response => {
  if (response.url().includes("/api/chat")) {
    chatContentType = response.headers()["content-type"] || "";
  }
});

await page.addInitScript(() => {
  sessionStorage.setItem("consciencia_fabiano_admin_password_v1", "ui-e2e-placeholder");

  class MockUtterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  class MockRecognition {
    constructor() {
      this.lang = "";
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.continuous = false;
      this.onresult = null;
      this.onend = null;
      this.onerror = null;
    }
    start() {
      window.__fnsMicStarted = true;
      setTimeout(() => {
        this.onresult?.({ results: [[{ transcript: "Responda em português dizendo que o microfone funcionou." }]] });
      }, 20);
      setTimeout(() => this.onend?.(), 80);
    }
  }

  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: MockRecognition });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: MockUtterance });

  const voices = [{ lang: "pt-BR", name: "Microsoft Francisca Online (Natural) - Portuguese (Brazil)" }];
  const synth = {
    getVoices: () => voices,
    cancel: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    speak: utterance => {
      window.__fnsSpoken = { text: utterance.text, lang: utterance.lang, voice: utterance.voice?.name || "" };
      utterance.onstart?.();
      setTimeout(() => utterance.onend?.(), 20);
    }
  };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
});

await page.route(base + "/api/**", async route => {
  const headers = { ...route.request().headers(), "x-fns-github-oidc": oidc };
  await route.continue({ headers });
});

let testDocId = "";
try {
  await page.goto(base + "/admin?ui-e2e=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector("#nativeAdminLogin"), null, { timeout: 30000 });
  await page.locator("#libraryTab").click();
  await page.waitForSelector("#uploadBtn", { state: "visible", timeout: 30000 });

  const backendText = page.locator("#backendText");
  await backendText.waitFor({ state: "attached" });
  const beforeText = await backendText.textContent();
  const beforeMatch = String(beforeText || "").match(/(\d+) PDFs/);
  const before = beforeMatch ? Number(beforeMatch[1]) : 0;

  const uiRunCode = "UI-" + crypto.randomUUID().slice(0, 8).toUpperCase();
  await page.locator("#pdfInput").setInputFiles({
    name: "fns-ui-visual-e2e.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(uiRunCode, 4 * 1024 * 1024),
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

  const appJs = await page.evaluate(() => fetch("/app.js?v=9").then(r => r.text()));
  if (!appJs.includes('u.lang = "pt-BR"')) throw new Error("frontend sem pt-BR explícito");
  if (!appJs.includes("voiceschanged")) throw new Error("frontend não aguarda vozes naturais");
  if (!appJs.includes('/api/trigger-index')) throw new Error("frontend não chama trigger-index");
  if (!appJs.includes("text/event-stream")) throw new Error("frontend não consome SSE");
  if (!appJs.includes("/api/status?document_id=")) throw new Error("frontend não faz polling assíncrono");

  const books = await page.evaluate(() => fetch("/api/admin/livros").then(r => r.json()));
  const row = (books.livros || []).find(x => x.arquivo === "fns-ui-visual-e2e.pdf");
  if (!row?.id) throw new Error("PDF visual não apareceu no catálogo");
  testDocId = row.id;

  await page.locator("#chatTab").click();
  const messagesBefore = await page.locator("#messages .msg").count();
  await page.locator("#micBtn").click();

  await page.waitForFunction(() => window.__fnsMicStarted === true, null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const msgs = [...document.querySelectorAll("#messages .msg.assistant")];
    return msgs.some(m => /microfone|funcionou|português/i.test(m.textContent || ""));
  }, null, { timeout: 90000 });

  await page.waitForFunction(() => Boolean(window.__fnsSpoken?.text), null, { timeout: 10000 });
  const messagesAfter = await page.locator("#messages .msg").count();
  if (messagesAfter <= messagesBefore) throw new Error("microfone não gerou novo turno visual");
  if (!chatContentType.includes("text/event-stream")) throw new Error("chat visual não recebeu SSE");

  const voiceState = await page.evaluate(() => ({
    mic: window.__fnsMicStarted === true,
    spoken: window.__fnsSpoken || null
  }));
  if (!(voiceState.mic && voiceState.spoken?.lang === "pt-BR" && /Natural/i.test(voiceState.spoken?.voice || ""))) {
    throw new Error("Web Speech pt-BR não foi usado: " + JSON.stringify(voiceState));
  }

  await page.screenshot({ path: "ui-e2e-after-index.png", fullPage: true });

  console.log("UI_MICROPHONE_WEB_SPEECH_PASS=yes");
  console.log("UI_CHAT_SSE_PASS=yes");
  console.log("UI_TTS_PTBR_NATIVE_PASS=yes");

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
