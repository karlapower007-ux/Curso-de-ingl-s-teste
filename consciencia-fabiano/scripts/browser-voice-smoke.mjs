import fs from "node:fs";
import { chromium } from "playwright-core";

const base = String(process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) throw new Error("BASE URL inválida.");

function makeSilentWav(seconds = 3, sampleRate = 44100) {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const b = Buffer.alloc(44 + dataSize);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataSize, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataSize, 40);
  return b;
}

const fakeMic = "/tmp/fns-fake-mic.wav";
fs.writeFileSync(fakeMic, makeSilentWav(3));

const candidates = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const executablePath = candidates.find(p => fs.existsSync(p));
if (!executablePath) throw new Error("Chrome/Chromium não encontrado no runner.");

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-file-for-fake-audio-capture=" + fakeMic,
  ],
});

const errors = [];
let sttCalls = 0;
let chatCalls = 0;
let ttsCalls = 0;
const shortAudio = makeSilentWav(0.35);

try {
  const context = await browser.newContext({
    permissions: ["microphone"],
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();
  page.on("pageerror", err => errors.push(String(err)));

  await page.route("**/api/stt", async route => {
    sttCalls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, text: "teste automático de voz", language: "pt-BR" }),
    });
  });
  await page.route("**/api/chat", async route => {
    chatCalls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        resposta: "Resposta de teste de voz.",
        fontes: [],
        fallback: false,
      }),
    });
  });
  await page.route("**/api/tts", async route => {
    ttsCalls++;
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: shortAudio,
    });
  });

  await page.goto(base + "/?browser_voice_smoke=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.locator("#micBtn").waitFor({ state: "visible", timeout: 10000 });
  await page.locator("#micBtn").click();

  await page.waitForFunction(() =>
    document.querySelector("#micBtn")?.textContent?.includes("Encerrar voz") &&
    document.querySelector("#avatarState")?.textContent?.includes("Ouvindo"),
    { timeout: 5000 }
  );

  const started = Date.now();
  while (Date.now() - started < 16000 && (sttCalls < 1 || chatCalls < 1 || ttsCalls < 1)) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (sttCalls < 1) throw new Error("O microfone não disparou STT após a janela de silêncio.");
  if (chatCalls < 1) throw new Error("O turno de voz não chegou ao /api/chat.");
  if (ttsCalls < 1) throw new Error("A resposta do turno de voz não chegou ao /api/tts.");

  await page.locator("#messages").getByText("Resposta de teste de voz.", { exact: true }).waitFor({
    state: "visible",
    timeout: 5000,
  });

  await page.waitForTimeout(1200);
  const rearmed = await page.evaluate(() => ({
    mic: document.querySelector("#micBtn")?.textContent || "",
    state: document.querySelector("#avatarState")?.textContent || "",
  }));
  if (!rearmed.mic.includes("Encerrar voz") || !rearmed.state.includes("Ouvindo")) {
    throw new Error("O microfone não foi reativado automaticamente após TTS: " + JSON.stringify(rearmed));
  }

  await page.locator("#micBtn").click();
  await page.waitForFunction(() =>
    document.querySelector("#micBtn")?.textContent?.includes("Falar"),
    { timeout: 5000 }
  );

  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));

  console.log(JSON.stringify({
    ok: true,
    production: base,
    microphone_started: true,
    stt_calls: sttCalls,
    chat_calls: chatCalls,
    tts_calls: ttsCalls,
    microphone_rearmed_after_tts: true,
    microphone_stopped: true,
  }));
} finally {
  await browser.close();
}
