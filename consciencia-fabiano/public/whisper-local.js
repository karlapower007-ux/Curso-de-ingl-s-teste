(() => {
  const btn = document.getElementById("btn-whisper");
  const status = document.getElementById("status-whisper");
  const input = document.getElementById("questionInput");
  const autoSend = document.getElementById("autoSendVoice");
  const sendBtn = document.getElementById("sendBtn");
  if (!btn || !status || !input) return;

  let worker = null;
  let ready = false;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let busy = false;
  let requestId = 0;

  const setStatus = text => { status.textContent = text || ""; };
  const resetButton = () => {
    btn.classList.remove("recording","processing");
    btn.style.background = "";
    btn.textContent = "🎤 Segure para Falar";
    btn.disabled = !ready || busy;
  };

  function initWorker() {
    if (worker) return;
    worker = new Worker("/whisper-worker.js?v=" + Date.now(), { type: "module" });
    worker.onmessage = async event => {
      const data = event.data || {};
      if (data.type === "progress") {
        const pct = Number(data.progress || 0);
        setStatus(data.message || (pct > 0 ? "Carregando IA de voz… " + Math.round(pct) + "%" : "Carregando IA de voz…"));
        return;
      }
      if (data.type === "ready") {
        ready = true;
        busy = false;
        setStatus("Pronto! IA de voz carregada no seu computador.");
        resetButton();
        return;
      }
      if (data.type === "error") {
        busy = false;
        setStatus("Erro no Whisper local: " + (data.error || "falha desconhecida") + ". O botão Falar continua disponível.");
        resetButton();
        return;
      }
      if (data.type === "result" && data.id === requestId) {
        busy = false;
        const text = String(data.text || "").trim();
        if (text) {
          input.value = text;
          setStatus("Texto extraído com sucesso!");
          if (autoSend?.checked && sendBtn) sendBtn.click();
        } else {
          setStatus("Não detectei fala suficiente. Tente novamente.");
        }
        resetButton();
      }
    };
    worker.onerror = event => {
      busy = false;
      ready = false;
      setStatus("Falha ao iniciar o Whisper local. Use o botão Falar enquanto isso.");
      btn.textContent = "Whisper local indisponível";
      btn.disabled = true;
    };
    worker.postMessage({ type: "load" });
  }

  async function decodeToMono16k(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ sampleRate: 16000 });
    try {
      const buffer = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buffer.slice(0));
      const channels = decoded.numberOfChannels;
      const length = decoded.length;
      const mono = new Float32Array(length);
      for (let ch = 0; ch < channels; ch++) {
        const channel = decoded.getChannelData(ch);
        for (let i = 0; i < length; i++) mono[i] += channel[i] / channels;
      }
      return mono;
    } finally {
      try { await ctx.close(); } catch {}
    }
  }

  async function startRecording(event) {
    if (!ready || busy || recorder?.state === "recording") return;
    event?.preventDefault?.();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = processAudio;
      recorder.start(200);
      btn.classList.add("recording");
      btn.textContent = "🎙️ Gravando... solte para enviar";
      setStatus("Pode falar e fazer pausas. O áudio será processado localmente.");
      if (event?.pointerId != null) {
        try { btn.setPointerCapture(event.pointerId); } catch {}
      }
    } catch (error) {
      setStatus("Microfone indisponível: " + (error?.message || error));
      resetButton();
    }
  }

  function stopRecording(event) {
    event?.preventDefault?.();
    if (!recorder || recorder.state === "inactive") return;
    try { recorder.stop(); } catch {}
    btn.classList.remove("recording");
    btn.classList.add("processing");
    btn.textContent = "⏳ Processando...";
    btn.disabled = true;
    setStatus("Lendo o áudio localmente...");
  }

  async function processAudio() {
    busy = true;
    const localStream = stream;
    stream = null;
    try {
      const mime = recorder?.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: mime });
      chunks = [];
      localStream?.getTracks?.().forEach(track => { try { track.stop(); } catch {} });
      if (blob.size < 700) {
        busy = false;
        setStatus("Áudio muito curto. Segure o botão e fale novamente.");
        resetButton();
        return;
      }
      const mono = await decodeToMono16k(blob);
      requestId++;
      worker.postMessage({
        type: "transcribe",
        id: requestId,
        audio: mono,
        language: "portuguese",
        task: "transcribe"
      }, [mono.buffer]);
    } catch (error) {
      busy = false;
      localStream?.getTracks?.().forEach(track => { try { track.stop(); } catch {} });
      setStatus("Erro ao processar o áudio: " + (error?.message || error));
      resetButton();
    }
  }

  btn.addEventListener("pointerdown", startRecording);
  btn.addEventListener("pointerup", stopRecording);
  btn.addEventListener("pointercancel", stopRecording);
  btn.addEventListener("lostpointercapture", event => {
    if (recorder?.state === "recording") stopRecording(event);
  });

  setStatus("Na primeira vez, o navegador baixa e guarda o modelo local. Aguarde...");
  initWorker();
})();
