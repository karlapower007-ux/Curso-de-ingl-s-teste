(() => {
  const $ = id => document.getElementById(id);
  const HISTORY_KEY = "consciencia_fabiano_history_v1";
  const MEMORY_KEY = "consciencia_fabiano_memory_secret_v1";
  const MAX_HISTORY = 60;

  let history = [];
  let speakingTimer = null;
  let recorder = null;
  let chunks = [];
  let voiceLoopEnabled = false;
  let voiceStream = null;
  let voiceMonitor = 0;
  let voiceAudioContext = null;

  const frames = {
    closed: "/fabiano-fechado.png",
    talking: "/fabiano-falando.png",
    open: "/fabiano-aberto.png"
  };

  function loadHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      history = Array.isArray(v) ? v.slice(-MAX_HISTORY) : [];
    } catch { history = []; }
  }

  function getMemorySecret() {
    let value = localStorage.getItem(MEMORY_KEY) || "";
    if (value.length >= 32) return value;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    value = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(MEMORY_KEY, value);
    return value;
  }

  const memorySecret = getMemorySecret();

  async function syncPersistentHistory() {
    try {
      const data = await api("/api/memory", { method: "GET" });
      const remote = Array.isArray(data?.messages) ? data.messages : [];
      if (remote.length) {
        history = remote.slice(-MAX_HISTORY).map(x => ({
          role: x.role === "assistant" ? "assistant" : "user",
          content: String(x.content || ""),
          sources: Array.isArray(x.sources) ? x.sources : [],
          fallback: x.fallback === true,
          ts: x.ts || Date.now()
        }));
        saveHistory();
        renderHistory();
      }
    } catch {}
  }

  function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  }

  function authHeaders(extra = {}) {
    return { "X-FNS-Memory-Key": memorySecret, ...extra };
  }

  async function api(path, options = {}) {
    const headers = new Headers(authHeaders(options.headers || {}));
    const res = await fetch(path, { ...options, headers });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      throw new Error(body?.message || body?.detail || body?.error || String(body));
    }
    return body;
  }

  function setAvatar(mode) {
    const img = $("avatarImg");
    if (!img) return;
    if (mode === "closed") {
      clearInterval(speakingTimer);
      speakingTimer = null;
      img.src = frames.closed;
      img.classList.remove("speaking");
      $("avatarState").textContent = "Pronto para conversar";
      return;
    }
    if (mode === "thinking") {
      clearInterval(speakingTimer);
      speakingTimer = null;
      img.src = frames.talking;
      img.classList.remove("speaking");
      $("avatarState").textContent = "Consultando a memória…";
      return;
    }
    if (mode === "speaking") {
      clearInterval(speakingTimer);
      let open = false;
      img.classList.add("speaking");
      $("avatarState").textContent = "Falando";
      speakingTimer = setInterval(() => {
        open = !open;
        img.src = open ? frames.open : frames.talking;
      }, 165);
    }
  }

  function appendMessage(role, content, sources = [], fallback = false) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const text = document.createElement("div");
    text.textContent = content;
    wrap.appendChild(text);

    if (role === "assistant" && (sources?.length || fallback)) {
      const src = document.createElement("div");
      src.className = "sources";
      if (fallback) {
        const note = document.createElement("div");
        note.className = "source";
        note.textContent = "Resposta de contingência: os PDFs não foram consultados.";
        src.appendChild(note);
      }
      (sources || []).forEach(item => {
        const row = document.createElement("div");
        row.className = "source";
        const strong = document.createElement("strong");
        strong.textContent = item.titulo || item.arquivo || "Fonte";
        row.appendChild(strong);

        const meta = [];
        if (item.autor) meta.push("autor: " + item.autor);
        if (item.pagina) meta.push("página " + item.pagina);
        if (item.idioma && item.idioma !== "unknown") meta.push("idioma: " + item.idioma);
        if (item.arquivo && item.titulo && item.arquivo !== item.titulo) meta.push(item.arquivo);
        if (meta.length) {
          const details = document.createElement("div");
          details.className = "source-meta";
          details.textContent = meta.join(" • ");
          row.appendChild(details);
        }

        if (item.trecho) {
          const excerpt = document.createElement("div");
          excerpt.className = "source-excerpt";
          excerpt.textContent = item.trecho;
          row.appendChild(excerpt);
        }
        src.appendChild(row);
      });
      wrap.appendChild(src);
    }

    $("messages").appendChild(wrap);
    $("messages").scrollTop = $("messages").scrollHeight;
  }

  function renderHistory() {
    $("messages").innerHTML = "";
    history.forEach(x => appendMessage(x.role, x.content, x.sources || [], x.fallback));
    if (!history.length) {
      appendMessage("assistant",
        "Estou pronto. Alimente minha biblioteca com PDFs e converse comigo sobre qualquer assunto. Vou responder sempre em português e mostrar as fontes quando a biblioteca as fornecer.");
    }
  }

  async function playAudio(path, textFallback) {
    try {
      let res;
      if (path) {
        res = await fetch(path, { headers: authHeaders() });
      } else {
        res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textFallback })
        });
      }
      if (!res.ok) throw new Error("audio " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await new Promise((resolve, reject) => {
        audio.onplay = () => setAvatar("speaking");
        audio.onended = () => { URL.revokeObjectURL(url); setAvatar("closed"); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Falha na reprodução do TTS.")); };
        audio.play().catch(reject);
      });
      return;
    } catch {}
    await browserSpeak(textFallback);
  }

  function browserSpeak(text) {
    return new Promise(resolve => {
      if (!("speechSynthesis" in window) || !text) {
        setAvatar("closed");
        resolve();
        return;
      }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 5000));
      u.lang = "pt-BR";
      u.rate = 0.96;
      const voices = speechSynthesis.getVoices();
      const pt = voices.find(v => /^pt-BR/i.test(v.lang)) || voices.find(v => /^pt/i.test(v.lang));
      if (pt) u.voice = pt;
      u.onstart = () => setAvatar("speaking");
      u.onend = () => { setAvatar("closed"); resolve(); };
      u.onerror = () => { setAvatar("closed"); resolve(); };
      speechSynthesis.speak(u);
    });
  }

  async function sendQuestion(options = {}) {
    const fromVoice = options.fromVoice === true;
    const q = $("questionInput").value.trim();
    if (!q) return;
    $("questionInput").value = "";
    appendMessage("user", q);
    history.push({ role: "user", content: q, ts: Date.now() });
    saveHistory();

    $("sendBtn").disabled = true;
    if (!voiceLoopEnabled) $("micBtn").disabled = true;
    setAvatar("thinking");
    try {
      const turnId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2)));
      const data = await api("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pergunta: q,
          turn_id: turnId,
          historico: history.slice(-20).map(x => ({ role: x.role, content: x.content }))
        })
      });
      const resposta = String(data.resposta || "Sem resposta.");
      appendMessage("assistant", resposta, data.fontes || [], data.fallback === true);
      history.push({ role: "assistant", content: resposta, sources: data.fontes || [], fallback: data.fallback === true, ts: Date.now() });
      saveHistory();
      await playAudio(data.audio_url, resposta);
    } catch (error) {
      appendMessage("assistant", "Não consegui responder agora. " + error.message);
      setAvatar("closed");
    } finally {
      $("sendBtn").disabled = false;
      $("micBtn").disabled = false;
      if (fromVoice && voiceLoopEnabled) {
        $("micBtn").textContent = "⏹️ Encerrar voz";
        setTimeout(() => {
          if (voiceLoopEnabled) startRecorderFallback().catch(stopVoiceLoop);
        }, 250);
      } else if (!voiceLoopEnabled) {
        $("micBtn").textContent = "🎙️ Falar";
      }
    }
  }

  async function checkBackend() {
    try {
      const data = await api("/api/status");
      const up = data?.ok === true && data?.architecture === "cloudflare-native";
      $("backendDot").className = "dot " + (up ? "ok" : "bad");
      $("backendText").textContent = up
        ? "Cloudflare RAG nativo • " + (data.documents || 0) + " PDFs • " + (data.chunks || 0) + " trechos"
        : "Infraestrutura documental ainda não provisionada";
    } catch {
      $("backendDot").className = "dot bad";
      $("backendText").textContent = "Biblioteca indisponível";
    }
  }

  function switchPanel(name) {
    const lib = name === "library";
    $("chatPanel").classList.toggle("hidden", lib);
    $("libraryPanel").classList.toggle("hidden", !lib);
    $("chatTab").classList.toggle("active", !lib);
    $("libraryTab").classList.toggle("active", lib);
    if (lib) loadBooks();
  }

  async function startVoice() {
    if (voiceLoopEnabled) {
      stopVoiceLoop();
      return;
    }
    voiceLoopEnabled = true;
    $("micBtn").textContent = "⏹️ Encerrar voz";
    await startRecorderFallback();
  }

  function stopVoiceMonitor() {
    if (voiceMonitor) cancelAnimationFrame(voiceMonitor);
    voiceMonitor = 0;
    if (voiceAudioContext) {
      voiceAudioContext.close().catch(() => {});
      voiceAudioContext = null;
    }
  }

  function stopVoiceLoop() {
    voiceLoopEnabled = false;
    stopVoiceMonitor();
    if (recorder?.state === "recording") {
      try { recorder.stop(); } catch {}
    }
    if (voiceStream) {
      voiceStream.getTracks().forEach(t => t.stop());
      voiceStream = null;
    }
    $("micBtn").textContent = "🎙️ Falar";
    $("micBtn").disabled = false;
    setAvatar("closed");
  }

  async function ensureVoiceStream() {
    if (voiceStream && voiceStream.getTracks().some(t => t.readyState === "live")) return voiceStream;
    voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
    return voiceStream;
  }

  async function startRecorderFallback() {
    if (!voiceLoopEnabled || recorder?.state === "recording") return;
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não oferece gravação de áudio compatível.");

    const stream = await ensureVoiceStream();
    chunks = [];
    recorder = new MediaRecorder(stream);
    const thisRecorder = recorder;
    let heardSpeech = false;
    let lastVoiceAt = performance.now();
    const startedAt = performance.now();

    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stopVoiceMonitor();
      if (!voiceLoopEnabled) return;
      $("avatarState").textContent = "Transcrevendo…";
      try {
        const blob = new Blob(chunks, { type: thisRecorder.mimeType || "audio/webm" });
        if (blob.size < 700) {
          setTimeout(() => voiceLoopEnabled && startRecorderFallback().catch(stopVoiceLoop), 300);
          return;
        }
        const res = await fetch("/api/stt", {
          method: "POST",
          headers: authHeaders({ "Content-Type": blob.type || "audio/webm" }),
          body: blob
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "STT indisponível");
        const text = String(data.text || "").trim();
        $("questionInput").value = text;
        if (text && $("autoSendVoice")?.checked) {
          await sendQuestion({ fromVoice: true });
        } else if (voiceLoopEnabled) {
          setTimeout(() => startRecorderFallback().catch(stopVoiceLoop), 300);
        }
      } catch (e) {
        appendMessage("assistant", "Não consegui transcrever sua voz: " + e.message);
        if (voiceLoopEnabled) setTimeout(() => startRecorderFallback().catch(stopVoiceLoop), 600);
      }
    };

    recorder.start(200);
    $("micBtn").textContent = "⏹️ Encerrar voz";
    $("avatarState").textContent = "Ouvindo";

    voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = voiceAudioContext.createMediaStreamSource(stream);
    const analyser = voiceAudioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    const monitor = () => {
      if (!voiceLoopEnabled || recorder !== thisRecorder || thisRecorder.state !== "recording") return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > 0.025) {
        heardSpeech = true;
        lastVoiceAt = now;
      }
      const silenceAfterSpeech = heardSpeech && now - lastVoiceAt > 950 && now - startedAt > 900;
      const maxTurn = now - startedAt > 25000;
      const noSpeechTimeout = !heardSpeech && now - startedAt > 9000;
      if (silenceAfterSpeech || maxTurn || noSpeechTimeout) {
        try { thisRecorder.stop(); } catch {}
        return;
      }
      voiceMonitor = requestAnimationFrame(monitor);
    };
    voiceMonitor = requestAnimationFrame(monitor);
  }

  async function waitForIndexJob(jobId, filename) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const data = await api("/api/index-status?job_id=" + encodeURIComponent(jobId), { method: "GET" });
      const status = String(data.status || "queued");
      const progress = Math.max(0, Math.min(100, Number(data.progress || 0)));
      $("adminStatus").textContent = "Indexando " + filename + "… " + progress + "% • " + status;
      if (status === "ready") return data;
      if (status === "duplicate") return { ...data, duplicate: true };
      if (status === "failed") throw new Error(data.error || "Falha durante a indexação.");
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error("A indexação continua no servidor, mas o acompanhamento local atingiu 10 minutos.");
  }

  async function uploadPdf() {
    const file = $("pdfInput").files?.[0];
    if (!file) {
      $("adminStatus").textContent = "Escolha um PDF.";
      return;
    }
    $("uploadBtn").disabled = true;
    $("adminStatus").textContent = "Enviando " + file.name + " para a fila de indexação…";
    try {
      const fd = new FormData();
      fd.append("arquivo", file, file.name);
      const res = await fetch("/api/admin/upload-pdf", { method: "POST", headers: authHeaders(), body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || "Falha no upload.");
      if (!data.job_id) throw new Error("Servidor não retornou o job de indexação.");
      const done = await waitForIndexJob(data.job_id, data.arquivo || file.name);
      $("adminStatus").textContent = done.duplicate
        ? "Este PDF já estava na biblioteca: " + (done.arquivo || file.name) + "."
        : "PDF indexado: " + (done.arquivo || file.name) + " • " + (done.chunks || 0) + " trechos.";
      $("pdfInput").value = "";
      await loadBooks();
      await checkBackend();
    } catch (error) {
      $("adminStatus").textContent = error.message;
    } finally {
      $("uploadBtn").disabled = false;
    }
  }

  async function loadBooks() {
    try {
      const data = await api("/api/admin/livros");
      const list = Array.isArray(data?.livros) ? data.livros : [];
      $("booksList").innerHTML = "";
      if (!list.length) {
        $("booksList").innerHTML = '<div class="book"><div><strong>Nenhum PDF listado ainda.</strong><small>Adicione o primeiro livro acima.</small></div></div>';
        return;
      }
      list.forEach(item => {
        const row = document.createElement("div");
        row.className = "book";
        const info = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = item.arquivo;
        const small = document.createElement("small");
        small.textContent =
          (item.titulo && item.titulo !== item.arquivo ? item.titulo + " • " : "") +
          (item.autor ? item.autor + " • " : "") +
          (item.paginas || 0) + " páginas • " +
          (item.chunks || 0) + " trechos • " +
          (item.idioma || "idioma não detectado") + " • " +
          (item.status || "sem status");
        info.append(strong, small);
        const del = document.createElement("button");
        del.className = "ghost danger";
        del.textContent = "Excluir";
        del.onclick = async () => {
          if (!confirm("Excluir " + item.arquivo + " da biblioteca?")) return;
          try {
            await api("/api/admin/delete-pdf", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ arquivo: item.arquivo })
            });
            await loadBooks();
          } catch (e) {
            $("adminStatus").textContent = e.message;
          }
        };
        row.append(info, del);
        $("booksList").appendChild(row);
      });
    } catch (error) {
      $("booksList").innerHTML = '<div class="book"><div><strong>Backend de biblioteca ainda não respondeu.</strong><small>' +
        String(error.message).replace(/[<>]/g, "") + '</small></div></div>';
    }
  }

  async function reindex() {
    $("reindexBtn").disabled = true;
    $("adminStatus").textContent = "Reindexando a biblioteca…";
    try {
      const data = await api("/api/admin/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const ok = (data.resultados || []).filter(x => x.ok).length;
      const total = (data.resultados || []).length;
      $("adminStatus").textContent = "Reindexação concluída: " + ok + " de " + total + " documentos.";
      await loadBooks();
      await checkBackend();
    } catch (e) {
      $("adminStatus").textContent = e.message;
    } finally {
      $("reindexBtn").disabled = false;
    }
  }

  $("chatTab").onclick = () => switchPanel("chat");
  $("libraryTab").onclick = () => switchPanel("library");
  $("sendBtn").onclick = sendQuestion;
  $("questionInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
  });
  $("micBtn").onclick = () => startVoice().catch(e => appendMessage("assistant", "Microfone indisponível: " + e.message));
  $("uploadBtn").onclick = uploadPdf;
  $("reindexBtn").onclick = reindex;
  $("clearChatBtn").onclick = async () => {
    if (!confirm("Limpar todo o histórico desta conversa?")) return;
    history = [];
    saveHistory();
    renderHistory();
    setAvatar("closed");
    try {
      await api("/api/memory/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
    } catch {}
  };

  loadHistory();
  renderHistory();
  syncPersistentHistory();
  switchPanel(location.pathname === "/admin" ? "library" : "chat");
  checkBackend();
  loadBooks();
})();
