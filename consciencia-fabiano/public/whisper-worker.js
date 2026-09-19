import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm";

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;
let loading = null;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

async function ensureTranscriber() {
  if (transcriber) return transcriber;
  if (loading) return loading;
  loading = pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
    quantized: true,
    progress_callback: progress => {
      const pct = Number(progress?.progress || 0);
      post("progress", {
        progress: Number.isFinite(pct) ? pct : 0,
        message: pct > 0 ? "Carregando Whisper local… " + Math.round(pct) + "%" : "Carregando Whisper local…"
      });
    }
  }).then(model => {
    transcriber = model;
    post("ready", { model: "Xenova/whisper-tiny" });
    return model;
  }).catch(error => {
    loading = null;
    post("error", { error: String(error?.message || error) });
    throw error;
  });
  return loading;
}

self.onmessage = async event => {
  const data = event.data || {};
  try {
    if (data.type === "load") {
      await ensureTranscriber();
      return;
    }
    if (data.type === "transcribe") {
      const model = await ensureTranscriber();
      const audio = data.audio instanceof Float32Array ? data.audio : new Float32Array(data.audio || []);
      const result = await model(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: data.language || "portuguese",
        task: data.task || "transcribe",
        return_timestamps: false
      });
      post("result", { id: data.id, text: String(result?.text || "").trim() });
    }
  } catch (error) {
    post("error", { id: data.id, error: String(error?.message || error) });
  }
};
