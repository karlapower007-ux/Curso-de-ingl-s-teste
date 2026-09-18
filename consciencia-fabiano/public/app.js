(() => {
  const $ = id => document.getElementById(id);
  const KEY = "consciencia_fabiano_owner_token_v1";
  const HISTORY_KEY = "consciencia_fabiano_history_v1";
  const MAX_HISTORY = 60;

  let token = "";
  let history = [];
  let speakingTimer = null;
  let recorder = null;
  let chunks = [];

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

  function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  }

  function authHeaders(extra = {}) {
    return { Authorization: "Bearer " + token, ...extra };
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", "Bearer " + token);
    const res = await fetch(path, { ...options, headers });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      if (res.status === 401) logout();
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
        strong.textContent = item.arquivo || "Fonte";
        row.appendChild(strong);
        if (item.pagina) row.appendChild(document.createTextNode(" — página " + item.pagina));
        if (item.trecho) {
          const excerpt = document.createElement("div");
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
    if (path) {
      try {
        setAvatar("speaking");
        const res = await fetch(path, { headers: authHeaders() });
        if (!res.ok) throw new Error("audio " + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => { URL.revokeObjectURL(url); setAvatar("closed"); };
        audio.onerror = () => { URL.revokeObjectURL(url); browserSpeak(textFallback); };
        await audio.play();
        return;
      } catch {}
    }
    browserSpeak(textFallback);
  }

  function browserSpeak(text) {
    if (!("speechSynthesis" in window) || !text) {
      setAvatar("closed");
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
    u.onend = () => setAvatar("closed");
    u.onerror = () => setAvatar("closed");
    speechSynthesis.speak(u);
  }

  async function sendQuestion() {
    const q = $("questionInput").value.trim();
    if (!q) return;
    $("questionInput").value = "";
    appendMessage("user", q);
    history.push({ role: "user", content: q, ts: Date.now() });
    saveHistory();

    $("sendBtn").disabled = true;
    $("micBtn").disabled = true;
    setAvatar("thinking");
    try {
      const data = await api("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pergunta: q,
          historico: history.slice(-20).map(x => ({ role: x.role, content: x.content }))
        })
      });
      const resposta = String(data.resposta || "Sem resposta.");
      appendMessage("assistant", resposta, data.fontes || [], data.fallback === true);
      history.push({
        role: "assistant",
        content: resposta,
        sources: data.fontes || [],
        fallback: data.fallback === true,
        ts: Date.now()
      });
      saveHistory();
      await playAudio(data.audio_url, resposta);
    } catch (error) {
      appendMessage("assistant", "Não consegui responder agora. " + error.message);
      setAvatar("closed");
    } finally {
      $("sendBtn").disabled = false;
      $("micBtn").disabled = false;
    }
  }

  async function checkBackend() {
    try {
      const data = await api("/api/status");
      const up = data?.backend?.ok === true;
      $("backendDot").className = "dot " + (up ? "ok" : "bad");
      $("backendText").textContent = up
        ? "Biblioteca RAG conectada"
        : "Biblioteca despertando; IA de contingência disponível";
    } catch {
      $("backendDot").className = "dot bad";
      $("backendText").textContent = "Biblioteca indisponível";
    }
  }

  async function login(candidate) {
    $("loginStatus").textContent = "Verificando…";
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: candidate })
    });
    if (!res.ok) {
      $("loginStatus").textContent = "Chave inválida.";
      return false;
    }
    token = candidate;
    localStorage.setItem(KEY, token);
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    loadHistory();
    renderHistory();
    switchPanel(location.pathname === "/admin" ? "library" : "chat");
    checkBackend();
    loadBooks();
    return true;
  }

  function logout() {
    token = "";
    localStorage.removeItem(KEY);
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("tokenInput").value = "";
    $("loginStatus").textContent = "";
    speechSynthesis?.cancel?.();
    setAvatar("closed");
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
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.lang = "pt-BR";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      $("micBtn").textContent = "🎧 Ouvindo…";
      $("avatarState").textContent = "Ouvindo";
      rec.onresult = async e => {
        const text = e.results?.[0]?.[0]?.transcript || "";
        $("questionInput").value = text;
        if (text.trim() && $("autoSendVoice")?.checked) {
          await sendQuestion();
        }
      };
      rec.onend = () => {
        $("micBtn").textContent = "🎙️ Falar";
        setAvatar("closed");
      };
      rec.onerror = () => {
        $("micBtn").textContent = "🎙️ Falar";
        startRecorderFallback().catch(() => setAvatar("closed"));
      };
      rec.start();
      return;
    }
    await startRecorderFallback();
  }

  async function startRecorderFallback() {
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      $("micBtn").textContent = "🎙️ Falar";
      $("avatarState").textContent = "Transcrevendo…";
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const res = await fetch("/api/stt", {
          method: "POST",
          headers: authHeaders({ "Content-Type": blob.type || "audio/webm" }),
          body: blob
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "STT indisponível");
        $("questionInput").value = data.text || "";
        if ((data.text || "").trim() && $("autoSendVoice")?.checked) {
          await sendQuestion();
        }
      } catch (e) {
        appendMessage("assistant", "Não consegui transcrever sua voz: " + e.message);
      }
      setAvatar("closed");
    };
    recorder.start(250);
    $("micBtn").textContent = "⏹️ Parar";
    $("avatarState").textContent = "Ouvindo";
  }

  async function uploadPdf() {
    const file = $("pdfInput").files?.[0];
    if (!file) {
      $("adminStatus").textContent = "Escolha um PDF.";
      return;
    }
    $("uploadBtn").disabled = true;
    $("adminStatus").textContent = "Enviando e indexando " + file.name + "…";
    try {
      const fd = new FormData();
      fd.append("arquivo", file, file.name);
      const res = await fetch("/api/admin/upload-pdf", {
        method: "POST",
        headers: authHeaders(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || "Falha no upload.");
      $("adminStatus").textContent = "PDF indexado: " + (data.arquivo || file.name) + " • " + (data.chunks || 0) + " trechos.";
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
    if (!token) return;
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
        small.textContent = (item.chunks || 0) + " trechos indexados";
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
      const data = await api("/api/admin/reindex", { method: "POST" });
      $("adminStatus").textContent = "Reindexação concluída. " + (data.total_chunks || 0) + " trechos disponíveis.";
      await loadBooks();
    } catch (e) {
      $("adminStatus").textContent = e.message;
    } finally {
      $("reindexBtn").disabled = false;
    }
  }

  $("loginBtn").onclick = () => login($("tokenInput").value.trim());
  $("tokenInput").addEventListener("keydown", e => { if (e.key === "Enter") $("loginBtn").click(); });
  $("logoutBtn").onclick = logout;
  $("chatTab").onclick = () => switchPanel("chat");
  $("libraryTab").onclick = () => switchPanel("library");
  $("sendBtn").onclick = sendQuestion;
  $("questionInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
  });
  $("micBtn").onclick = () => startVoice().catch(e => appendMessage("assistant", "Microfone indisponível: " + e.message));
  $("uploadBtn").onclick = uploadPdf;
  $("reindexBtn").onclick = reindex;
  $("clearChatBtn").onclick = () => {
    if (!confirm("Limpar todo o histórico desta conversa?")) return;
    history = [];
    saveHistory();
    renderHistory();
    setAvatar("closed");
  };

  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const magic = fragment.get("access");
  if (magic) {
    history.replaceState(null, "", location.pathname + location.search);
    login(magic);
  } else {
    const saved = localStorage.getItem(KEY);
    if (saved) login(saved);
  }
})();
