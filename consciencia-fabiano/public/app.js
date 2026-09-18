(() => {
  const $ = id => document.getElementById(id);
  const HISTORY_KEY = "consciencia_fabiano_history_v1";
  const MEMORY_KEY = "consciencia_fabiano_memory_secret_v1";
  const OWNER_TOKEN_KEY = "consciencia_fabiano_owner_token_session_v1";
  const MAX_HISTORY = 60;
  const INLINE_TEXT_LIMIT = 320000;
  const PAGE_BATCH_LIMIT = 300000;

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

  function ownerToken() { return sessionStorage.getItem(OWNER_TOKEN_KEY) || ""; }
  function authHeaders(extra = {}) {
    const headers={"X-FNS-Memory-Key":memorySecret};
    const token=ownerToken(); if(token) headers["X-FNS-Owner-Token"]=token;
    return {...headers,...extra};
  }
  function isPrivateApi(path){return /\/api\/(admin\/|trigger-index|index-status)/.test(String(path || ""));}
  async function api(path,options={},canPrompt=true){
    const headers=new Headers(authHeaders(options.headers || {}));
    const res=await fetch(path,{...options,headers});
    const ct=res.headers.get("content-type") || "";
    const body=ct.includes("application/json") ? await res.json() : await res.text();
    if(res.status===401 && canPrompt && isPrivateApi(path)){
      const value=prompt("Informe a chave privada do proprietário para administrar a biblioteca:");
      if(value && value.trim().length>=10){sessionStorage.setItem(OWNER_TOKEN_KEY,value.trim());return api(path,options,false);}
    }
    if(!res.ok){const err=new Error(body?.message || body?.detail || body?.error || String(body));err.code=body?.code || "";err.status=res.status;throw err;}
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

  async function getPdfJs() {
    if(window.__pdfjsReady) return await window.__pdfjsReady;
    if(window.pdfjsLib?.getDocument) return window.pdfjsLib;
    throw new Error("Motor local pdf.js não carregou. Verifique sua conexão.");
  }
  function bytesToHex(buffer){return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,"0")).join("");}
  function cleanPageText(items){
    let out="";
    for(const item of items || []){const value=String(item?.str || "");if(!value)continue;out+=value;out+=item?.hasEOL?"\n":" ";}
    return out.replace(/[ \t]+\n/g,"\n").replace(/[ \t]{2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();
  }
  async function extractPdfLocally(file){
    const pdfjs=await getPdfJs();
    $("adminStatus").textContent="Abrindo o PDF localmente com pdf.js…";
    const bytes=new Uint8Array(await file.arrayBuffer());
    const digestPromise=crypto.subtle.digest("SHA-256",bytes);
    const pdf=await pdfjs.getDocument({data:bytes,isEvalSupported:false}).promise;
    let title="",author="";
    try{const metadata=await pdf.getMetadata();title=String(metadata?.info?.Title || "").trim();author=String(metadata?.info?.Author || "").trim();}catch{}
    const pages=new Array(pdf.numPages);
    let cursor=1,completed=0,totalChars=0;
    const concurrency=Math.max(1,Math.min(8,Number(navigator.hardwareConcurrency || 4),pdf.numPages));
    const runner=async()=>{while(true){
      const pageNumber=cursor++; if(pageNumber>pdf.numPages)return;
      const page=await pdf.getPage(pageNumber);
      const content=await page.getTextContent({normalizeWhitespace:true});
      const text=cleanPageText(content.items);
      pages[pageNumber-1]={page:pageNumber,text}; totalChars+=text.length; completed++;
      $("adminStatus").textContent="Extração local: "+completed+"/"+pdf.numPages+" páginas • "+totalChars.toLocaleString("pt-BR")+" caracteres";
      page.cleanup();
    }};
    await Promise.all(Array.from({length:concurrency},runner));
    const contentSha256=bytesToHex(await digestPromise); await pdf.destroy();
    if(!pages.some(item=>String(item?.text || "").trim())) throw new Error("O PDF não possui texto selecionável. O binário não será enviado ao Worker.");
    return {filename:file.name,size_bytes:file.size,page_count:pages.length,title,author,content_sha256:contentSha256,pages,total_chars:totalChars};
  }
  function pageBatches(pages){
    const batches=[];let batch=[],chars=0;
    for(const page of pages){const size=String(page?.text || "").length;if(batch.length && (batch.length>=25 || chars+size>PAGE_BATCH_LIMIT)){batches.push(batch);batch=[];chars=0;}batch.push(page);chars+=size;}
    if(batch.length)batches.push(batch);return batches;
  }
  async function requestR2Presign(file){
    try{
      const data=await api("/api/admin/r2-presign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,size_bytes:file.size})});
      return {available:true,...data};
    }catch(error){
      if(error.code==="R2_DIRECT_DISABLED" || error.status===503)return {available:false,reason:error.message};
      throw error;
    }
  }
  async function uploadOriginalDirectToR2(file,presign){
    if(!presign?.available)return {stored:false,reason:presign?.reason || "R2 direto indisponível."};
    const res=await fetch(presign.upload_url,{method:"PUT",headers:{"Content-Type":"application/pdf"},body:file});
    if(!res.ok)throw new Error("Falha no upload direto ao R2: HTTP "+res.status);
    return {stored:true,r2_key:presign.r2_key,etag:res.headers.get("etag") || ""};
  }
  async function submitExtractedText(extracted,originalR2Key=""){
    const common={filename:extracted.filename,size_bytes:extracted.size_bytes,page_count:extracted.page_count,title:extracted.title,author:extracted.author,content_sha256:extracted.content_sha256,original_r2_key:originalR2Key};
    if(extracted.total_chars<=INLINE_TEXT_LIMIT){
      return api("/api/trigger-index",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"inline",...common,pages:extracted.pages})});
    }
    const started=await api("/api/trigger-index",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"start",...common})});
    const batches=pageBatches(extracted.pages);
    for(let i=0;i<batches.length;i++){
      $("adminStatus").textContent="Carga leve de texto: lote "+(i+1)+"/"+batches.length+"…";
      await api("/api/trigger-index",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"append",job_id:started.job_id,pages:batches[i]})});
    }
    return api("/api/trigger-index",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"commit",job_id:started.job_id})});
  }
  async function uploadPdf(){
    const file=$("pdfInput").files?.[0];
    if(!file){$("adminStatus").textContent="Escolha um PDF.";return;}
    if(file.type!=="application/pdf" && !/\.pdf$/i.test(file.name)){$("adminStatus").textContent="Selecione um PDF.";return;}
    $("uploadBtn").disabled=true; const startedAt=performance.now();
    try{
      const extracted=await extractPdfLocally(file);
      $("adminStatus").textContent="Texto extraído localmente. Preparando R2 direto e Matriz 50/50…";
      const presign=await requestR2Presign(file);
      const vaultPromise=presign.available?uploadOriginalDirectToR2(file,presign):Promise.resolve({stored:false,reason:presign.reason});
      const queued=await submitExtractedText(extracted,presign.available?presign.r2_key:"");
      if(!queued?.job_id)throw new Error("Servidor não retornou o job de indexação.");
      const [done,vault]=await Promise.all([waitForIndexJob(queued.job_id,extracted.filename),vaultPromise]);
      const seconds=((performance.now()-startedAt)/1000).toFixed(1);
      const vaultText=vault.stored?" • original salvo direto no R2":" • R2 não configurado; binário não passou pelo Worker";
      $("adminStatus").textContent=done.duplicate
        ?"Já indexado: "+(done.arquivo || file.name)+vaultText+" • "+seconds+"s"
        :"Concluído: "+(done.arquivo || file.name)+" • "+(done.chunks || 0)+" chunks • Matriz 50/50"+vaultText+" • "+seconds+"s";
      $("pdfInput").value="";await loadBooks();await checkBackend();
    }catch(error){$("adminStatus").textContent=error.message;}finally{$("uploadBtn").disabled=false;}
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
