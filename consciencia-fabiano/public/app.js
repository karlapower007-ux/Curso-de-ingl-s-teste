(() => {
  const $ = id => document.getElementById(id);
  const HISTORY_KEY = "consciencia_fabiano_history_v1";
  const MEMORY_KEY = "consciencia_fabiano_memory_secret_v1";
  const ADMIN_PASSWORD_KEY = "consciencia_fabiano_admin_password_v1";
  const MAX_HISTORY = 60;

  let history = [];
  let speakingTimer = null;

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

  function adminHeaders(extra = {}) {
    const headers = new Headers(authHeaders(extra));
    const password = sessionStorage.getItem(ADMIN_PASSWORD_KEY) || "";
    if (password) headers.set("X-FNS-Admin-Password", password);
    return headers;
  }

  async function api(path, options = {}) {
    const adminPath =
      path.startsWith("/api/admin/") ||
      path === "/api/trigger-index" ||
      path.startsWith("/api/status?document_id=");
    const headers = adminPath
      ? adminHeaders(options.headers || {})
      : new Headers(authHeaders(options.headers || {}));
    const res = await fetch(path, { ...options, headers });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      throw new Error(body?.message || body?.detail || body?.error || String(body));
    }
    return body;
  }

  async function verifyAdminPassword(password) {
    const res = await fetch("/api/admin/session", {
      method: "GET",
      headers: {
        "X-FNS-Memory-Key": memorySecret,
        "X-FNS-Admin-Password": password
      }
    });
    return res.ok;
  }

  async function ensureAdminLogin() {
    const existing = sessionStorage.getItem(ADMIN_PASSWORD_KEY) || "";
    if (existing && await verifyAdminPassword(existing).catch(() => false)) return true;
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);

    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.id = "nativeAdminLogin";
      overlay.style.cssText = [
        "position:fixed","inset:0","z-index:99999","display:grid","place-items:center",
        "background:radial-gradient(circle at top,#18223a 0,#070b12 55%,#020305 100%)",
        "padding:24px","font-family:system-ui,-apple-system,Segoe UI,sans-serif"
      ].join(";");

      const card = document.createElement("form");
      card.autocomplete = "off";
      card.style.cssText = [
        "width:min(430px,92vw)","background:#0d1420","color:#fff","border:1px solid #29364a",
        "border-radius:18px","padding:28px","box-shadow:0 24px 80px rgba(0,0,0,.55)"
      ].join(";");

      const title = document.createElement("h1");
      title.textContent = "Área administrativa";
      title.style.cssText = "margin:0 0 8px;font-size:26px";

      const subtitle = document.createElement("p");
      subtitle.textContent = "Digite a palavra-passe para acessar sua biblioteca privada.";
      subtitle.style.cssText = "margin:0 0 22px;color:#aab7c8;line-height:1.45";

      const input = document.createElement("input");
      input.type = "password";
      input.placeholder = "Palavra-passe";
      input.autocomplete = "current-password";
      input.required = true;
      input.style.cssText = [
        "width:100%","box-sizing:border-box","padding:14px 15px","font-size:17px",
        "border-radius:10px","border:1px solid #3a4a63","background:#070c14","color:#fff",
        "outline:none"
      ].join(";");

      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Entrar";
      button.style.cssText = [
        "width:100%","margin-top:14px","padding:13px","font-size:16px","font-weight:700",
        "border:0","border-radius:10px","cursor:pointer","background:#fff","color:#101722"
      ].join(";");

      const status = document.createElement("div");
      status.style.cssText = "min-height:22px;margin-top:12px;color:#ff9b9b;font-size:14px";

      card.append(title, subtitle, input, button, status);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      input.focus();

      card.addEventListener("submit", async e => {
        e.preventDefault();
        const password = input.value;
        button.disabled = true;
        button.textContent = "Verificando…";
        status.textContent = "";
        try {
          const ok = await verifyAdminPassword(password);
          if (!ok) throw new Error("Palavra-passe incorreta.");
          sessionStorage.setItem(ADMIN_PASSWORD_KEY, password);
          overlay.remove();
          document.body.style.overflow = previousOverflow;
          resolve(true);
        } catch (error) {
          status.textContent = error.message || "Não foi possível autenticar.";
          input.select();
        } finally {
          button.disabled = false;
          button.textContent = "Entrar";
        }
      });
    });
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

  async function speakFinalResponse(text) {
    await browserSpeak(text);
  }

  function appendSourcesToMessage(wrap, sources = [], fallback = false) {
    if (!wrap || !(sources?.length || fallback)) return;
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

  function appendStreamingAssistant() {
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    const text = document.createElement("div");
    text.textContent = "";
    wrap.appendChild(text);
    $("messages").appendChild(wrap);
    $("messages").scrollTop = $("messages").scrollHeight;
    return { wrap, text };
  }

  function extractSseText(payload) {
    if (!payload || typeof payload !== "object") return "";
    return String(
      payload.response ??
      payload.delta?.content ??
      payload.choices?.[0]?.delta?.content ??
      payload.choices?.[0]?.text ??
      payload.result?.response ??
      ""
    );
  }

  async function consumeChatStream(res, target) {
    if (!res.body) throw new Error("O navegador não recebeu o stream da resposta.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resposta = "";
    let fontes = [];
    let fallback = false;

    const consumeEvent = block => {
      const lines = String(block || "").split(/\r?\n/);
      let eventName = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const raw = dataLines.join("\n");
      if (!raw || raw === "[DONE]") return;

      if (eventName === "fns-meta") {
        try {
          const meta = JSON.parse(raw);
          fontes = Array.isArray(meta.fontes) ? meta.fontes : [];
          fallback = meta.fallback === true;
        } catch {}
        return;
      }

      try {
        const piece = extractSseText(JSON.parse(raw));
        if (piece) {
          resposta += piece;
          target.text.textContent = resposta;
          $("messages").scrollTop = $("messages").scrollHeight;
        }
      } catch {}
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      for (const part of parts) consumeEvent(part);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeEvent(buffer);

    return { resposta: resposta.trim(), fontes, fallback };
  }

  function getSpeechVoices() {
    const current = speechSynthesis.getVoices();
    if (current.length) return Promise.resolve(current);

    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        speechSynthesis.removeEventListener("voiceschanged", finish);
        resolve(speechSynthesis.getVoices());
      };
      speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
      setTimeout(finish, 1200);
    });
  }

  async function browserSpeak(text) {
    if (!("speechSynthesis" in window) || !text) {
      setAvatar("closed");
      return;
    }

    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 5000));
    u.lang = "pt-BR";
    u.rate = 0.94;
    u.pitch = 1.0;

    const voices = await getSpeechVoices();
    const ptBr = voices.filter(v => /^pt-BR$/i.test(v.lang));
    const ptAny = voices.filter(v => /^pt(?:-|$)/i.test(v.lang));
    const candidates = ptBr.length ? ptBr : ptAny;

    const natural =
      candidates.find(v => /natural|online/i.test(v.name)) ||
      candidates.find(v => /microsoft|google/i.test(v.name)) ||
      candidates[0] ||
      null;

    if (natural) {
      u.voice = natural;
      u.lang = natural.lang || "pt-BR";
    } else {
      // Keep the BCP-47 language tag explicit even when the browser hides
      // its voice list; never force an en-US voice.
      u.lang = "pt-BR";
    }

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
    const target = appendStreamingAssistant();

    try {
      const turnId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2)));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        }),
        body: JSON.stringify({
          pergunta: q,
          turn_id: turnId,
          historico: history.slice(-20).map(x => ({ role: x.role, content: x.content }))
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || ("Chat indisponível (HTTP " + res.status + ")."));
      }
      if (!(res.headers.get("content-type") || "").includes("text/event-stream")) {
        throw new Error("O chat não retornou streaming SSE.");
      }

      const streamed = await consumeChatStream(res, target);
      const resposta = streamed.resposta || "Não consegui formular uma resposta agora.";
      if (!streamed.resposta) target.text.textContent = resposta;
      appendSourcesToMessage(target.wrap, streamed.fontes, streamed.fallback);

      history.push({
        role: "assistant",
        content: resposta,
        sources: streamed.fontes,
        fallback: streamed.fallback,
        ts: Date.now()
      });
      saveHistory();

      await speakFinalResponse(resposta);
    } catch (error) {
      target.text.textContent = "Não consegui responder agora. " + error.message;
      setAvatar("closed");
    } finally {
      $("sendBtn").disabled = false;
      $("micBtn").disabled = false;
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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      appendMessage("assistant",
        "O reconhecimento de voz nativo não está disponível neste navegador. Use Chrome ou Edge com permissão de microfone.");
      setAvatar("closed");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    $("micBtn").textContent = "🎧 Ouvindo…";
    $("avatarState").textContent = "Ouvindo";

    recognition.onresult = async event => {
      const transcricao = event.results?.[0]?.[0]?.transcript || "";
      $("questionInput").value = transcricao;
      if (transcricao.trim() && $("autoSendVoice")?.checked) {
        await sendQuestion();
      }
    };

    recognition.onend = () => {
      $("micBtn").textContent = "🎙️ Falar";
      if ($("avatarState").textContent === "Ouvindo") setAvatar("closed");
    };

    recognition.onerror = event => {
      $("micBtn").textContent = "🎙️ Falar";
      const reason = event?.error ? " (" + event.error + ")" : "";
      appendMessage("assistant", "Não foi possível usar o microfone do navegador" + reason + ".");
      setAvatar("closed");
    };

    recognition.start();
  }
  function uploadDirectToR2(url, file, contentType) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", contentType || "application/pdf");

      xhr.upload.onprogress = event => {
        if (!event.lengthComputable) {
          $("adminStatus").textContent = "Enviando diretamente para o R2…";
          return;
        }
        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        const mb = (event.loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (event.total / (1024 * 1024)).toFixed(1);
        $("adminStatus").textContent = "Upload direto ao R2: " + pct + "% • " + mb + " de " + totalMb + " MB";
      };

      xhr.onerror = () => reject(new Error("Falha de rede no upload direto ao R2."));
      xhr.onabort = () => reject(new Error("Upload cancelado."));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        reject(new Error("R2 recusou o upload direto (HTTP " + xhr.status + ")."));
      };

      xhr.send(file);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForIndexing(documentId, timeoutMs = 15 * 60 * 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const data = await api("/api/status?document_id=" + encodeURIComponent(documentId));
      if (data.status === "ready") return data;
      if (data.status === "duplicate") return data;
      if (data.status === "error") {
        throw new Error(data.error || "A indexação falhou no processamento em background.");
      }

      const chunksText = Number(data.chunks || 0) > 0 ? " • " + data.chunks + " trechos processados" : "";
      $("adminStatus").textContent =
        "Indexando em segundo plano…" + chunksText + " Pode continuar usando a página.";
      await sleep(1400);
    }
    throw new Error("A indexação continua em segundo plano por mais tempo que o esperado.");
  }

  async function uploadPdf() {
    const file = $("pdfInput").files?.[0];
    if (!file) {
      $("adminStatus").textContent = "Escolha um PDF.";
      return;
    }
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      $("adminStatus").textContent = "Escolha um arquivo PDF.";
      return;
    }
    if (!file.size) {
      $("adminStatus").textContent = "O PDF está vazio.";
      return;
    }

    $("uploadBtn").disabled = true;
    $("adminStatus").textContent = "Preparando upload direto ao R2 para " + file.name + "…";

    try {
      const ticket = await api("/api/admin/direct-upload-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content_type: "application/pdf",
          size_bytes: file.size
        })
      });

      if (!ticket?.upload_url || !ticket?.document_id || !ticket?.r2_key) {
        throw new Error("O servidor não gerou o endereço temporário do R2.");
      }

      await uploadDirectToR2(ticket.upload_url, file, ticket.content_type || "application/pdf");

      $("adminStatus").textContent =
        "Arquivo recebido pelo R2. Convertendo e criando a memória pesquisável…";

      const accepted = await api("/api/trigger-index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: ticket.document_id,
          r2_key: ticket.r2_key,
          filename: ticket.filename || file.name,
          size_bytes: file.size
        })
      });

      if (accepted.status !== "processing") {
        throw new Error("O Worker não aceitou a indexação assíncrona.");
      }

      $("adminStatus").textContent =
        "Upload concluído. Indexação iniciada em segundo plano…";

      const data = await waitForIndexing(ticket.document_id);

      $("adminStatus").textContent = data.status === "duplicate"
        ? "Este PDF já existia na biblioteca. O upload duplicado foi descartado com segurança."
        : "PDF indexado: " + (data.arquivo || file.name) + " • " + (data.chunks || 0) + " trechos.";

      $("pdfInput").value = "";
      await loadBooks();
      await checkBackend();
    } catch (error) {
      $("adminStatus").textContent = error.message || "Falha no upload direto ao R2.";
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

  async function initialize() {
    const isAdmin = location.pathname === "/admin";
    if (isAdmin) {
      const authenticated = await ensureAdminLogin();
      if (!authenticated) return;
    }

    loadHistory();
    renderHistory();
    syncPersistentHistory();
    switchPanel(isAdmin ? "library" : "chat");
    checkBackend();
    if (isAdmin) loadBooks();
  }

  initialize().catch(error => {
    console.error("Falha ao inicializar:", error);
  });
})();
