(() => {
  const $ = id => document.getElementById(id);
  const HISTORY_KEY = "consciencia_fabiano_history_v1";
  const MEMORY_KEY = "consciencia_fabiano_memory_secret_v1";
  const OWNER_TOKEN_KEY = "consciencia_fabiano_owner_token_session_v1";
  const MAX_HISTORY = 60;
  const INLINE_TEXT_LIMIT = 320000;
  const PAGE_BATCH_LIMIT = 300000;
  const LOCAL_EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
  const LOCAL_EMBED_DB = "fns_local_embeddings_v1";
  const LOCAL_EMBED_DB_VERSION = 1;
  const LOCAL_EMBED_BATCH = Number(navigator.deviceMemory || 4) <= 4 ? 6 : 12;

  let history = [];
  let speakingTimer = null;
  let recorder = null;
  let chunks = [];
  let voiceLoopEnabled = false;
  let voiceStream = null;
  let voiceMonitor = 0;
  let voiceAudioContext = null;
  let activeAudio = null;
  let activeAudioUrl = "";
  let activeAudioDone = null;
  let audioStopSerial = 0;
  let embeddingWorker = null;
  let embeddingWorkerReady = false;
  let embeddingWorkerBusy = false;
  let embeddingWorkerSeq = 0;
  const embeddingWorkerPending = new Map();
  const activeVectorJobs = new Set();

  const frames = {
    closed: "/fabiano-fechado.png",
    talking: "/fabiano-falando.png",
    open: "/fabiano-aberto.png"
  };

  function openEmbeddingDb() {
    return new Promise((resolve, reject) => {
      const req=indexedDB.open(LOCAL_EMBED_DB,LOCAL_EMBED_DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs",{keyPath:"document_id"});
        if(!db.objectStoreNames.contains("checkpoints")){
          const store=db.createObjectStore("checkpoints",{keyPath:"key"});
          store.createIndex("document_id","document_id",{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async function idbPut(storeName,value){
    const db=await openEmbeddingDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,"readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete=()=>{db.close();resolve(value);};
      tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
    });
  }
  async function idbGetAll(storeName){
    const db=await openEmbeddingDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,"readonly");
      const req=tx.objectStore(storeName).getAll();
      req.onsuccess=()=>{const v=req.result || [];db.close();resolve(v);};
      req.onerror=()=>{const e=req.error;db.close();reject(e);};
    });
  }
  async function idbCheckpointsFor(documentId,onlyUnsynced=false){
    const all=await idbGetAll("checkpoints");
    return all.filter(x=>x.document_id===documentId && (!onlyUnsynced || x.synced!==true)).sort((a,b)=>(a.created_at||0)-(b.created_at||0));
  }
  function ensureEmbeddingWorker(){
    if(embeddingWorker) return embeddingWorker;
    embeddingWorker=new Worker("/embedding-worker.js?v=1",{type:"module"});
    embeddingWorker.onmessage=e=>{
      const data=e.data || {};
      if(data.type==="status"){
        if(data.stage==="ready") embeddingWorkerReady=true;
        if(data.stage==="error") embeddingWorkerReady=false;
        if($("adminStatus") && data.message && !activeVectorJobs.size) $("adminStatus").textContent=data.message;
        return;
      }
      const pending=embeddingWorkerPending.get(data.id);
      if(!pending) return;
      embeddingWorkerPending.delete(data.id);
      embeddingWorkerBusy=false;
      if(data.ok===false) pending.reject(new Error(data.error || "Falha no motor local."));
      else pending.resolve(data);
    };
    embeddingWorker.onerror=e=>{
      embeddingWorkerReady=false; embeddingWorkerBusy=false;
      for(const [,p] of embeddingWorkerPending){p.reject(new Error(e.message || "Web Worker de embeddings falhou."));}
      embeddingWorkerPending.clear();
    };
    const preferWebGPU=Boolean(navigator.gpu && Number(navigator.deviceMemory || 4)>=8);
    embeddingWorker.postMessage({type:"init",preferWebGPU});
    return embeddingWorker;
  }
  function workerRequest(type,payload={},priority="normal"){
    const worker=ensureEmbeddingWorker();
    const id="ew-"+(++embeddingWorkerSeq)+"-"+Date.now();
    return new Promise((resolve,reject)=>{
      embeddingWorkerPending.set(id,{resolve,reject});
      embeddingWorkerBusy=true;
      worker.postMessage({id,type,priority,...payload});
    });
  }
  async function saveVectorCheckpoint(documentId,batchId,chunks,vectors){
    const record={
      key:documentId+":"+batchId,document_id:documentId,batch_id:batchId,created_at:Date.now(),
      last_page:Math.max(...chunks.map(x=>Number(x.page || 0)),0),synced:false,
      updates:chunks.map((chunk,i)=>({id:chunk.id,embedding:Array.from(vectors[i] || [])}))
    };
    await idbPut("checkpoints",record);
    return record;
  }
  async function syncVectorCheckpoint(record){
    if(!record?.updates?.length) return;
    await api("/api/admin/local-vector-update",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({document_id:record.document_id,embedding_model:LOCAL_EMBED_MODEL,updates:record.updates})
    });
    record.synced=true; record.synced_at=Date.now(); await idbPut("checkpoints",record);
  }
  async function flushPendingVectorCheckpoints(documentId){
    const pending=await idbCheckpointsFor(documentId,true);
    for(const record of pending) await syncVectorCheckpoint(record);
  }
  async function runLocalVectorization(job){
    const documentId=String(job?.document_id || "");
    if(!documentId || activeVectorJobs.has(documentId)) return;
    activeVectorJobs.add(documentId);
    try{
      await idbPut("jobs",{...job,state:"vectorizing",updated_at:Date.now(),model:LOCAL_EMBED_MODEL});
      await flushPendingVectorCheckpoints(documentId);
      let batchNo=Number(job.batch_no || 0);
      while(true){
        const data=await api("/api/admin/local-vector-chunks?document_id="+encodeURIComponent(documentId)+"&limit="+LOCAL_EMBED_BATCH,{method:"GET"});
        const list=Array.isArray(data?.chunks)?data.chunks:[];
        if(!list.length){
          await idbPut("jobs",{...job,state:"done",batch_no:batchNo,remaining:0,updated_at:Date.now(),model:LOCAL_EMBED_MODEL});
          if($("adminStatus")) $("adminStatus").textContent="Vetorização local concluída para "+(job.filename || "o PDF")+".";
          await loadBooks(); await checkBackend(); return;
        }
        if($("adminStatus")) $("adminStatus").textContent="PDF já disponível por busca lexical. Vetorização local em segundo plano: "+Math.max(0,Number(data.total||0)-Number(data.remaining||0))+"/"+Number(data.total||0)+" trechos.";
        const result=await workerRequest("embed-batch",{texts:list.map(x=>String(x.text||""))},"normal");
        const vectors=Array.isArray(result.vectors)?result.vectors:[];
        if(vectors.length!==list.length) throw new Error("Worker local retornou lote incompleto.");
        const checkpoint=await saveVectorCheckpoint(documentId,++batchNo,list,vectors);
        await syncVectorCheckpoint(checkpoint);
        await idbPut("jobs",{...job,state:"vectorizing",batch_no:batchNo,last_page:checkpoint.last_page,remaining:Math.max(0,Number(data.remaining||0)-list.length),updated_at:Date.now(),model:LOCAL_EMBED_MODEL});
        await new Promise(resolve=>setTimeout(resolve,40));
      }
    }catch(error){
      await idbPut("jobs",{...job,state:"paused",error:String(error?.message||error),updated_at:Date.now(),model:LOCAL_EMBED_MODEL});
      if($("adminStatus")) $("adminStatus").textContent="Vetorização local pausada com checkpoint preservado: "+String(error?.message||error);
    }finally{
      activeVectorJobs.delete(documentId); embeddingWorkerBusy=false;
    }
  }
  async function resumeLocalEmbeddingJobs(showStatus=false){
    const jobs=await idbGetAll("jobs").catch(()=>[]);
    const pending=jobs.filter(j=>j.state!=="done" && j.document_id);
    if(showStatus && !pending.length && $("adminStatus")) $("adminStatus").textContent="Nenhum checkpoint local pendente.";
    for(const job of pending) runLocalVectorization(job);
    return pending.length;
  }
  async function localQueryEmbedding(text){
    if(!embeddingWorkerReady || embeddingWorkerBusy) return null;
    try{
      const result=await Promise.race([
        workerRequest("embed-query",{text:String(text||"")},"high"),
        new Promise(resolve=>setTimeout(()=>resolve(null),900))
      ]);
      if(!result || !Array.isArray(result.vector)) return null;
      return result.vector;
    }catch{return null;}
  }

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

  function appendStreamingMessage() {
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    const text = document.createElement("div");
    text.textContent = "";
    wrap.appendChild(text);
    $("messages").appendChild(wrap);
    $("messages").scrollTop = $("messages").scrollHeight;
    return { wrap, text };
  }

  async function streamChat(payload) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      }),
      body: JSON.stringify({ ...payload, stream: true })
    });
    if (!res.ok) {
      const body = await res.json().catch(async () => ({ message: await res.text().catch(() => "") }));
      const err = new Error(body?.message || body?.error || ("Chat HTTP " + res.status));
      err.code = body?.code || "";
      err.status = res.status;
      throw err;
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream")) return res.json();

    const live = appendStreamingMessage();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let answer = "";
    let meta = { fontes: [], fallback: false, memory_persisted: false };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          let event = "message";
          let dataLine = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (event === "delta") {
            const delta = String(data.text || "");
            answer += delta;
            live.text.textContent = answer;
            $("messages").scrollTop = $("messages").scrollHeight;
          } else if (event === "meta" || event === "done") {
            meta = { ...meta, ...data };
            if (event === "done" && data.resposta) answer = String(data.resposta);
          } else if (event === "error") {
            throw new Error(data.message || "Falha no streaming.");
          }
        }
      }
    } finally {
      live.wrap.remove();
    }
    return {
      ok: true,
      resposta: answer || "Sem resposta.",
      fontes: meta.fontes || [],
      fallback: meta.fallback === true,
      memory_persisted: meta.memory_persisted === true,
      provider: meta.provider || "groq+cohere-rag"
    };
  }

  function renderHistory() {
    $("messages").innerHTML = "";
    history.forEach(x => appendMessage(x.role, x.content, x.sources || [], x.fallback));
    if (!history.length) {
      appendMessage("assistant",
        "Estou pronto. Alimente minha biblioteca com PDFs e converse comigo sobre qualquer assunto. Vou responder sempre em português e mostrar as fontes quando a biblioteca as fornecer.");
    }
  }

  function markdownToSpeech(text) {
    return String(text || "")
      .replace(/\`\`\`[^\n]*\n?/g, " ")
      .replace(/\`\`\`/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-+*]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/[\`*_~#>|]/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s*\n+\s*/g, ". ")
      .replace(/\s{2,}/g, " ")
      .replace(/\.{2,}/g, ".")
      .trim();
  }

  function stopAudioPlayback() {
    audioStopSerial++;
    try { window.speechSynthesis?.cancel(); } catch {}
    if (activeAudio) {
      try { activeAudio.pause(); activeAudio.currentTime = 0; activeAudio.removeAttribute("src"); activeAudio.load(); } catch {}
      activeAudio = null;
    }
    if (activeAudioUrl) {
      try { URL.revokeObjectURL(activeAudioUrl); } catch {}
      activeAudioUrl = "";
    }
    if (activeAudioDone) {
      const done = activeAudioDone;
      activeAudioDone = null;
      try { done(); } catch {}
    }
    const stopBtn = $("stopAudioBtn");
    if (stopBtn) stopBtn.disabled = true;
    setAvatar("closed");
  }

  async function playAudio(path, textFallback) {
    const speechText = markdownToSpeech(textFallback);
    if (!speechText) return;
    const serial = audioStopSerial;
    try {
      let res;
      if (path) {
        res = await fetch(path, { headers: authHeaders() });
      } else {
        res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: speechText })
        });
      }
      if (!res.ok) throw new Error("audio " + res.status);
      if (serial !== audioStopSerial) return;
      const blob = await res.blob();
      activeAudioUrl = URL.createObjectURL(blob);
      activeAudio = new Audio(activeAudioUrl);
      const stopBtn = $("stopAudioBtn");
      if (stopBtn) stopBtn.disabled = false;
      await new Promise((resolve, reject) => {
        activeAudioDone = resolve;
        activeAudio.onplay = () => setAvatar("speaking");
        activeAudio.onended = () => {
          if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
          activeAudioUrl = "";
          activeAudio = null;
          activeAudioDone = null;
          if (stopBtn) stopBtn.disabled = true;
          setAvatar("closed");
          resolve();
        };
        activeAudio.onerror = () => {
          if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
          activeAudioUrl = "";
          activeAudio = null;
          activeAudioDone = null;
          if (stopBtn) stopBtn.disabled = true;
          reject(new Error("Falha na reprodução do TTS."));
        };
        activeAudio.play().catch(reject);
      });
      return;
    } catch {}
    if (serial !== audioStopSerial) return;
    await browserSpeak(speechText, serial);
  }

  function browserSpeak(text, serial = audioStopSerial) {
    return new Promise(resolve => {
      const speechText = markdownToSpeech(text);
      if (!("speechSynthesis" in window) || !speechText || serial !== audioStopSerial) {
        setAvatar("closed");
        resolve();
        return;
      }
      speechSynthesis.cancel();
      const stopBtn = $("stopAudioBtn");
      if (stopBtn) stopBtn.disabled = false;
      activeAudioDone = resolve;
      const u = new SpeechSynthesisUtterance(speechText.slice(0, 5000));
      u.lang = "pt-BR";
      u.rate = 0.96;
      const voices = speechSynthesis.getVoices();
      const pt = voices.find(v => /^pt-BR/i.test(v.lang)) || voices.find(v => /^pt/i.test(v.lang));
      if (pt) u.voice = pt;
      const finish = () => {
        activeAudioDone = null;
        if (stopBtn) stopBtn.disabled = true;
        setAvatar("closed");
        resolve();
      };
      u.onstart = () => setAvatar("speaking");
      u.onend = finish;
      u.onerror = finish;
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
      const queryEmbedding=await localQueryEmbedding(q);
      const data = await streamChat({
        pergunta: q,
        turn_id: turnId,
        query_embedding: queryEmbedding,
        query_embedding_model: queryEmbedding ? LOCAL_EMBED_MODEL : "",
        historico: history.slice(-20).map(x => ({ role: x.role, content: x.content }))
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
      const up = data?.ok === true && data?.architecture === "cloudflare-router-external-ai";
      $("backendDot").className = "dot " + (up ? "ok" : "bad");
      $("backendText").textContent = up
        ? "RAG Groq + Local • " + (data.documents || 0) + " PDFs • " + (data.chunks || 0) + " trechos"
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

  function setMicStatus(message = "", isError = false) {
    const node = $("micStatus");
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? "#ff9a9a" : "";
  }

  function microphoneErrorMessage(error) {
    const name = String(error?.name || "");
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return "Microfone bloqueado. Autorize o microfone no cadeado ao lado do endereço do site e tente novamente.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "Nenhum microfone foi encontrado neste aparelho.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "O microfone está ocupado ou bloqueado pelo sistema operacional. Feche outros aplicativos de áudio e tente novamente.";
    }
    return "Não foi possível iniciar o microfone: " + String(error?.message || error || "erro desconhecido");
  }

  async function startVoice() {
    if (voiceLoopEnabled) {
      stopVoiceLoop();
      setMicStatus("");
      return;
    }
    try {
      setMicStatus("Solicitando acesso ao microfone…");
      await ensureVoiceStream();
      voiceLoopEnabled = true;
      $("micBtn").textContent = "⏹️ Encerrar voz";
      setMicStatus("Microfone ativo. Pode falar.");
      await startRecorderFallback();
    } catch (error) {
      voiceLoopEnabled = false;
      $("micBtn").textContent = "🎙️ Falar";
      $("micBtn").disabled = false;
      const message = microphoneErrorMessage(error);
      setMicStatus("⚠️ " + message, true);
      setAvatar("closed");
      throw new Error(message);
    }
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
    if (!navigator.mediaDevices?.getUserMedia) {
      const error = new Error("Este navegador não oferece navigator.mediaDevices.getUserMedia.");
      error.name = "NotSupportedError";
      throw error;
    }
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      const track = voiceStream.getAudioTracks?.()[0];
      if (!track || track.readyState !== "live") throw new Error("O navegador não entregou uma faixa de áudio ativa.");
      setMicStatus("Microfone autorizado e ativo.");
      return voiceStream;
    } catch (error) {
      voiceStream = null;
      setMicStatus("⚠️ " + microphoneErrorMessage(error), true);
      throw error;
    }
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
    const deadline = Date.now() + 90 * 60 * 1000;
    while (Date.now() < deadline) {
      const data = await api("/api/index-status?job_id=" + encodeURIComponent(jobId), { method: "GET" });
      const status = String(data.status || "queued");
      const progress = Math.max(0, Math.min(100, Number(data.progress || 0)));
      const processed = Number(data.processed_pages || 0);
      const expected = Number(data.expected_pages || data.paginas || 0);
      const chunkCount = Number(data.chunks || 0);
      const detail = expected
        ? " • " + processed + "/" + expected + " páginas • " + chunkCount + " trechos"
        : " • " + chunkCount + " trechos";
      $("adminStatus").textContent = "Indexando " + filename + "… " + progress + "% • " + status + detail;
      if (status === "ready") return data;
      if (status === "duplicate") return { ...data, duplicate: true };
      if (status === "paused_quota") {
        throw new Error((data.error || "Quota mensal da Cohere atingida.") + " Job preservado: " + jobId);
      }
      if (status === "failed") throw new Error(data.error || "Falha durante a indexação.");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error("A indexação ainda está ativa no servidor. Ela continuará automaticamente; volte à Biblioteca para acompanhar o progresso.");
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
  async function submitExtractedTextLocal(extracted,originalR2Key=""){
    const common={filename:extracted.filename,size_bytes:extracted.size_bytes,page_count:extracted.page_count,title:extracted.title,author:extracted.author,content_sha256:extracted.content_sha256,original_r2_key:originalR2Key};
    const started=await api("/api/admin/local-ingest-start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(common)});
    if(started.duplicate) return started;
    const batches=pageBatches(extracted.pages);
    for(let i=0;i<batches.length;i++){
      $("adminStatus").textContent="Disponibilizando busca lexical: lote "+(i+1)+"/"+batches.length+"…";
      await api("/api/admin/local-ingest-append",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:started.job_id,pages:batches[i]})});
      if(i===0){await loadBooks();await checkBackend();}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return api("/api/admin/local-ingest-commit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({job_id:started.job_id})});
  }
  async function uploadPdf(){
    const file=$("pdfInput").files?.[0];
    if(!file){$("adminStatus").textContent="Escolha um PDF.";return;}
    if(file.type!=="application/pdf" && !/\.pdf$/i.test(file.name)){$("adminStatus").textContent="Selecione um PDF.";return;}
    $("uploadBtn").disabled=true; const startedAt=performance.now();
    try{
      const extracted=await extractPdfLocally(file);
      $("adminStatus").textContent="Texto extraído. Ativando busca lexical imediatamente…";
      const presign=await requestR2Presign(file);
      const vaultPromise=presign.available?uploadOriginalDirectToR2(file,presign):Promise.resolve({stored:false,reason:presign.reason});
      const ready=await submitExtractedTextLocal(extracted,presign.available?presign.r2_key:"");
      const vault=await vaultPromise.catch(()=>({stored:false}));
      const seconds=((performance.now()-startedAt)/1000).toFixed(1);
      const vaultText=vault.stored?" • original salvo direto no R2":" • R2 não configurado";
      if(ready.duplicate){
        $("adminStatus").textContent="PDF já existente na biblioteca • busca disponível"+vaultText+" • "+seconds+"s";
      }else{
        $("adminStatus").textContent="Busca lexical pronta: "+(ready.chunks||0)+" trechos. Vetorização local continuará em segundo plano"+vaultText+" • "+seconds+"s";
        const job={document_id:ready.document_id,filename:extracted.filename,content_sha256:extracted.content_sha256,total_chunks:Number(ready.chunks||0),state:"queued",batch_no:0,created_at:Date.now()};
        await idbPut("jobs",job);
        runLocalVectorization(job);
      }
      $("pdfInput").value=""; await loadBooks(); await checkBackend();
    }catch(error){$("adminStatus").textContent=error.message;}
    finally{$("uploadBtn").disabled=false;}
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
    $("reindexBtn").disabled=true;
    try{
      const count=await resumeLocalEmbeddingJobs(true);
      if(count>0) $("adminStatus").textContent="Retomando "+count+" job(s) local(is) a partir dos checkpoints do IndexedDB.";
    }catch(e){$("adminStatus").textContent=e.message;}
    finally{$("reindexBtn").disabled=false;}
  }

  $("chatTab").onclick = () => switchPanel("chat");
  $("libraryTab").onclick = () => switchPanel("library");
  $("sendBtn").onclick = sendQuestion;
  $("questionInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
  });
  $("micBtn").onclick = () => startVoice().catch(e => appendMessage("assistant", "Microfone indisponível: " + e.message));
  $("stopAudioBtn").onclick = stopAudioPlayback;
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
  setTimeout(()=>resumeLocalEmbeddingJobs(false).catch(()=>{}),1200);
})();
