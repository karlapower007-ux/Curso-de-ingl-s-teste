(() => {
  const $ = id => document.getElementById(id);
  const HISTORY_KEY = "consciencia_fabiano_history_v1";
  const MEMORY_KEY = "consciencia_fabiano_memory_secret_v1";
  const OWNER_TOKEN_KEY = "consciencia_fabiano_owner_token_session_v2";
  const MAX_HISTORY = 60;
  const INLINE_TEXT_LIMIT = 320000;
  const PAGE_BATCH_LIMIT = 300000;
  const LOCAL_EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
  const LOCAL_EMBED_DB = "fns_local_embeddings_v1";
  const LOCAL_EMBED_DB_VERSION = 4;
  const LOCAL_EMBED_BATCH = Number(navigator.deviceMemory || 4) <= 4 ? 6 : 12;

  // V3.0 micro-kernel: heavy browser engines remain dormant until a failure,
  // an offline event, or an explicit Library/Admin action requires them.
  let ragCascadePromise = null;
  let failoverModulePromise = null;
  let heavyLocalSubsystemsActivated = false;

  async function ensureRagCascade(reason="on-demand") {
    if(window.FNSRagCascade) return window.FNSRagCascade;
    if(!ragCascadePromise){
      ragCascadePromise=import("/rag-cascade.js?v=3.0.0").then(()=>{
        if(!window.FNSRagCascade) throw new Error("RAG local não inicializou.");
        return window.FNSRagCascade;
      }).catch(error=>{
        ragCascadePromise=null;
        throw error;
      });
    }
    const engine=await ragCascadePromise;
    window.__ragCascadeActivationReason=reason;
    return engine;
  }

  async function ensureFailoverV3(){
    if(!failoverModulePromise){
      failoverModulePromise=import("/failover-v3.js?v=3.0.0").catch(error=>{
        failoverModulePromise=null;
        throw error;
      });
    }
    return failoverModulePromise;
  }

  function activateHeavyLocalSubsystems(reason="manual"){
    if(heavyLocalSubsystemsActivated) return;
    heavyLocalSubsystemsActivated=true;
    ensureRagCascade(reason).catch(()=>{});
    setTimeout(()=>resumeLocalEmbeddingJobs(false).catch(()=>{}),250);
    setTimeout(()=>resumeOfflineVectorJobs().catch(()=>{}),500);
    setTimeout(()=>pruneIndexedDbPointers().catch(()=>{}),800);
    setTimeout(()=>processSyncQueue().catch(()=>{}),1100);
    setTimeout(()=>processMirrorQueue().catch(()=>{}),1400);
    setTimeout(()=>backfillLocalVectorMirror().catch(()=>{}),1700);
  }

  let history = [];
  let speakingTimer = null;
  let recorder = null;
  let chunks = [];
  let voiceLoopEnabled = false;
  let voiceStream = null;
  let voiceMonitor = 0;
  let voiceAudioContext = null;
  let ttsAudioContext = null;
  let audioOutputUnlocked = false;
  let voiceReconnectTimer = 0;
  let voiceKeepAliveTimer = 0;
  let voiceReconnectAttempts = 0;
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
        if(!db.objectStoreNames.contains("library_catalog")){
          const store=db.createObjectStore("library_catalog",{keyPath:"document_id"});
          store.createIndex("filename","arquivo",{unique:false});
          store.createIndex("updated_at","updated_at",{unique:false});
        }
        if(!db.objectStoreNames.contains("sync_queue")){
          const store=db.createObjectStore("sync_queue",{keyPath:"id"});
          store.createIndex("status","status",{unique:false});
          store.createIndex("next_attempt_at","next_attempt_at",{unique:false});
        }
        if(!db.objectStoreNames.contains("offline_vector_jobs")){
          const store=db.createObjectStore("offline_vector_jobs",{keyPath:"document_id"});
          store.createIndex("state","state",{unique:false});
        }
        if(!db.objectStoreNames.contains("mirror_queue")){
          const store=db.createObjectStore("mirror_queue",{keyPath:"id"});
          store.createIndex("next_attempt_at","next_attempt_at",{unique:false});
          store.createIndex("created_at","created_at",{unique:false});
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
  async function idbDelete(storeName,key){
    const db=await openEmbeddingDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,"readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete=()=>{db.close();resolve(true);};
      tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
    });
  }
  async function pruneIndexedDbPointers(maxDoneJobs=20){
    const jobs=await idbGetAll("jobs").catch(()=>[]);
    const done=jobs.filter(j=>j.state==="done").sort((a,b)=>(b.updated_at||0)-(a.updated_at||0));
    for(const old of done.slice(maxDoneJobs)) await idbDelete("jobs",old.document_id).catch(()=>{});
    const checkpoints=await idbGetAll("checkpoints").catch(()=>[]);
    for(const stale of checkpoints.filter(x=>x.synced===true || !Array.isArray(x.updates) || !x.updates.length)){
      await idbDelete("checkpoints",stale.key).catch(()=>{});
    }
  }

  async function idbCheckpointsFor(documentId,onlyUnsynced=false){
    const all=await idbGetAll("checkpoints");
    return all.filter(x=>x.document_id===documentId && (!onlyUnsynced || x.synced!==true)).sort((a,b)=>(a.created_at||0)-(b.created_at||0));
  }
  function ensureEmbeddingWorker(){
    if(embeddingWorker) return embeddingWorker;
    embeddingWorker=new Worker("/embedding-worker.js?v="+Date.now(),{type:"module"});
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
    await idbDelete("checkpoints",record.key);
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
          await idbPut("jobs",{document_id:documentId,filename:job.filename,state:"done",batch_no:batchNo,remaining:0,last_page:job.last_page||0,updated_at:Date.now(),model:LOCAL_EMBED_MODEL});
          await pruneIndexedDbPointers();
          if($("adminStatus")) $("adminStatus").textContent="Vetorização local concluída para "+(job.filename || "o PDF")+".";
          await loadBooks(); await checkBackend(); return;
        }
        if($("adminStatus")) $("adminStatus").textContent="PDF já disponível por busca lexical. Vetorização local em segundo plano: "+Math.max(0,Number(data.total||0)-Number(data.remaining||0))+"/"+Number(data.total||0)+" trechos.";
        const result=await workerRequest("embed-batch",{texts:list.map(x=>String(x.text||""))},"normal");
        const vectors=Array.isArray(result.vectors)?result.vectors:[];
        if(vectors.length!==list.length) throw new Error("Worker local retornou lote incompleto.");
        if(window.FNSRagCascade?.persistVectors){
          await window.FNSRagCascade.persistVectors({
            document_id:documentId,
            filename:job.filename || "",
            title:job.title || "",
            author:job.author || "",
            chunks:list,
            vectors
          }).catch(()=>{});
        }
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
    try{
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    }catch{
      const compact=history.slice(-MAX_HISTORY).map(item=>{
        if(item?.raw_document===true && String(item?.content || "").length>24000){
          return {
            ...item,
            content:"[Texto documental integral exibido nesta sessão; conteúdo extenso não persistido no localStorage.]",
            raw_document:false
          };
        }
        return item;
      });
      try{localStorage.setItem(HISTORY_KEY,JSON.stringify(compact));}catch{}
    }
  }

  const LOCAL_ADMIN_PASSWORD = "gadu";
  function ownerToken() { return sessionStorage.getItem(OWNER_TOKEN_KEY) || ""; }
  function unlockUI() {
    sessionStorage.setItem(OWNER_TOKEN_KEY,LOCAL_ADMIN_PASSWORD);
    setTimeout(()=>backfillLocalVectorMirror().catch(()=>{}),250);
    return true;
  }
  function ensureLocalAdminAccess() {
    if(ownerToken()===LOCAL_ADMIN_PASSWORD) return true;
    const password=prompt("Senha da biblioteca:");
    if(password===LOCAL_ADMIN_PASSWORD) return unlockUI();
    if(password!==null) alert("Senha incorreta.");
    return false;
  }
  function authHeaders(extra = {}) {
    const headers={"X-FNS-Memory-Key":memorySecret};
    const token=ownerToken(); if(token) headers["X-FNS-Owner-Token"]=token;
    return {...headers,...extra};
  }
  function isPrivateApi(path){return /\/api\/(admin\/|trigger-index|index-status)/.test(String(path || ""));}
  async function api(path,options={},canPrompt=true){
    if(isPrivateApi(path) && !ownerToken()){
      if(!ensureLocalAdminAccess()){
        const err=new Error("Acesso administrativo cancelado.");
        err.code="AUTH_CANCELLED";
        throw err;
      }
    }
    const headers=new Headers(authHeaders(options.headers || {}));
    const res=await fetch(path,{...options,headers});
    const ct=res.headers.get("content-type") || "";
    const body=ct.includes("application/json") ? await res.json() : await res.text();
    if(res.status===401 && isPrivateApi(path)){
      sessionStorage.removeItem(OWNER_TOKEN_KEY);
      const err=new Error("Sessão administrativa inválida. Abra a Biblioteca e informe a senha novamente.");
      err.code="AUTH_REQUIRED";err.status=401;throw err;
    }
    if(!res.ok){const err=new Error(body?.message || body?.detail || body?.error || String(body));err.code=body?.code || "";err.status=res.status;throw err;}
    return body;
  }

  let mirrorQueueRunning=false;

  async function enqueueMirrorRecords(records){
    const list=Array.isArray(records)?records.filter(r=>Array.isArray(r?.vector)&&r.vector.length>=64):[];
    if(!list.length) return {ok:true,queued:0};
    let queued=0;
    for(let i=0;i<list.length;i+=50){
      const batch=list.slice(i,i+50);
      const id="mirror-"+Date.now()+"-"+Math.random().toString(36).slice(2,9)+"-"+i;
      await idbPut("mirror_queue",{
        id,
        records:batch,
        attempts:0,
        next_attempt_at:Date.now(),
        created_at:Date.now(),
        updated_at:Date.now()
      });
      queued+=batch.length;
    }
    processMirrorQueue().catch(()=>{});
    return {ok:true,queued};
  }

  async function processMirrorQueue(){
    if(mirrorQueueRunning || !navigator.onLine || ownerToken()!==LOCAL_ADMIN_PASSWORD) return;
    mirrorQueueRunning=true;
    try{
      const now=Date.now();
      const items=(await idbGetAll("mirror_queue").catch(()=>[]))
        .filter(x=>Number(x.next_attempt_at||0)<=now)
        .sort((a,b)=>(a.created_at||0)-(b.created_at||0));

      for(const item of items.slice(0,2)){
        try{
          const list=Array.isArray(item.records)?item.records.slice(0,50):[];
          if(!list.length){await idbDelete("mirror_queue",item.id);continue;}
          const result=await api("/api/admin/mirror-upsert",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({records:list})
          },false);

          if(result?.any_configured===false){
            const attempts=Number(item.attempts||0)+1;
            await idbPut("mirror_queue",{
              ...item,
              attempts,
              next_attempt_at:Date.now()+6*60*60*1000,
              last_error:"Nenhum co-master configurado no servidor.",
              updated_at:Date.now()
            });
            break;
          }

          await idbDelete("mirror_queue",item.id);
          await new Promise(resolve=>setTimeout(resolve,900));
        }catch(error){
          const msg=String(error?.message || error || "");
          const attempts=Number(item.attempts||0)+1;
          const quota=error?.status===429 || /quota|rate limit|too many/i.test(msg);
          const delay=quota
            ? Math.min(6*60*60*1000,Math.max(15*60*1000,attempts*30*60*1000))
            : Math.min(60*60*1000,Math.max(5*60*1000,attempts*10*60*1000));
          await idbPut("mirror_queue",{
            ...item,
            attempts,
            next_attempt_at:Date.now()+delay,
            last_error:msg,
            updated_at:Date.now()
          });
          if(quota) break;
        }
      }
    }finally{
      mirrorQueueRunning=false;
    }
  }

  window.FNSRagMirrorBatch = enqueueMirrorRecords;

  const MIRROR_BACKFILL_STATE_KEY="fns_rag_mirror_backfill_v2";
  let mirrorBackfillRunning=false;

  async function backfillLocalVectorMirror(){
    if(mirrorBackfillRunning || !navigator.onLine || ownerToken()!==LOCAL_ADMIN_PASSWORD) return;
    mirrorBackfillRunning=true;
    try{
      await ensureRagCascade("mirror-backfill");
      if(!window.FNSRagCascade?.localStats || !window.FNSRagCascade?.exportVectors) return;
      const stats=await window.FNSRagCascade.localStats();
      const total=Math.max(0,Number(stats?.vectors||0));
      if(!total) return;

      let state={offset:0,total:0,updated_at:0};
      try{state=JSON.parse(localStorage.getItem(MIRROR_BACKFILL_STATE_KEY)||"{}")||state;}catch{}
      if(Number(state.total||0)!==total || Number(state.offset||0)>total) state={offset:0,total,updated_at:Date.now()};

      let offset=Math.max(0,Number(state.offset||0));
      let batches=0;
      while(offset<total && batches<8){
        const page=await window.FNSRagCascade.exportVectors(offset,50);
        const records=Array.isArray(page?.records)?page.records:[];
        if(!records.length) break;

        const result=await api("/api/admin/mirror-upsert",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({records})
        },false);

        if(result?.any_configured===false || result?.any_upserted!==true) break;
        offset=Number(page.next_offset||offset+records.length);
        batches++;
        localStorage.setItem(MIRROR_BACKFILL_STATE_KEY,JSON.stringify({offset,total,updated_at:Date.now()}));
        await new Promise(resolve=>setTimeout(resolve,950));
      }

      if(offset>=total){
        localStorage.setItem(MIRROR_BACKFILL_STATE_KEY,JSON.stringify({offset:total,total,done:true,updated_at:Date.now()}));
      }else if(batches>0){
        setTimeout(()=>backfillLocalVectorMirror().catch(()=>{}),4000);
      }
    }catch{
      setTimeout(()=>backfillLocalVectorMirror().catch(()=>{}),15*60*1000);
    }finally{
      mirrorBackfillRunning=false;
    }
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

  function safeMarkdownHtml(content) {
    const raw=String(content || "");
    if(!window.marked?.parse || !window.DOMPurify?.sanitize) return null;
    const rendered=window.marked.parse(raw,{gfm:true,breaks:true});
    return window.DOMPurify.sanitize(rendered,{
      ALLOWED_TAGS:["p","br","strong","em","del","blockquote","code","pre","ul","ol","li","a","h1","h2","h3","h4","h5","h6","hr","table","thead","tbody","tr","th","td"],
      ALLOWED_ATTR:["href","title"],
      FORBID_TAGS:["style","script","iframe","object","embed","form","input","button","textarea","select","option","svg","math"],
      FORBID_ATTR:["style","src","srcset"]
    });
  }

  function renderAssistantMarkdown(node,content) {
    const clean=safeMarkdownHtml(content);
    if(clean===null){
      node.textContent=String(content || "");
      return;
    }
    node.innerHTML=clean;
    node.classList.add("markdown-body");
    node.querySelectorAll("a").forEach(a=>{
      a.rel="noopener noreferrer";
      a.target="_blank";
    });
  }

  function scheduleAssistantMarkdown(node,content) {
    node.__pendingMarkdown=String(content || "");
    if(node.__markdownFrame) return;
    node.__markdownFrame=requestAnimationFrame(()=>{
      node.__markdownFrame=0;
      renderAssistantMarkdown(node,node.__pendingMarkdown || "");
    });
  }

  const NODE_VIRTUAL_ROW_HEIGHT = 58;
  const NODE_VIRTUAL_MAX = 500;

  function createNodeProgressVirtualizer(host) {
    const header=document.createElement("div");
    header.className="node-progress-header";
    header.textContent="RAG V2.1 • preparando 500 nós assíncronos";
    const viewport=document.createElement("div");
    viewport.className="node-progress-viewport";
    viewport.setAttribute("aria-label","Progresso dos nós RAG");
    const spacer=document.createElement("div");
    spacer.className="node-progress-spacer";
    const layer=document.createElement("div");
    layer.className="node-progress-window";
    viewport.appendChild(spacer);
    viewport.appendChild(layer);
    host.appendChild(header);
    host.appendChild(viewport);

    const items=[];
    const indexByNode=new Map();
    let raf=0;
    let reduceDone=0;
    let reduceTotal=0;

    const schedule=()=>{
      if(raf) return;
      raf=requestAnimationFrame(()=>{
        raf=0;
        const h=Math.max(180,viewport.clientHeight || 260);
        const overscan=5;
        const start=Math.max(0,Math.floor(viewport.scrollTop/NODE_VIRTUAL_ROW_HEIGHT)-overscan);
        const end=Math.min(items.length,Math.ceil((viewport.scrollTop+h)/NODE_VIRTUAL_ROW_HEIGHT)+overscan);
        spacer.style.height=(items.length*NODE_VIRTUAL_ROW_HEIGHT)+"px";
        layer.style.transform="translateY("+(start*NODE_VIRTUAL_ROW_HEIGHT)+"px)";
        const fragment=document.createDocumentFragment();
        for(let i=start;i<end;i++){
          const item=items[i];
          const row=document.createElement("div");
          row.className="node-progress-row "+(item.status || "");
          const badge=document.createElement("span");
          badge.className="node-progress-badge";
          badge.textContent="N"+String(item.node || i+1).padStart(3,"0");
          const body=document.createElement("div");
          body.className="node-progress-body";
          const title=document.createElement("strong");
          title.textContent=item.source || (item.status==="pass-through" ? "Sem trecho atribuído" : "Nó de análise");
          const small=document.createElement("small");
          small.textContent=item.summary || item.status || "concluído";
          body.appendChild(title);
          body.appendChild(small);
          row.appendChild(badge);
          row.appendChild(body);
          fragment.appendChild(row);
        }
        layer.replaceChildren(fragment);
      });
    };

    viewport.addEventListener("scroll",schedule,{passive:true});

    return {
      upsert(data){
        const node=Math.max(1,Math.min(NODE_VIRTUAL_MAX,Number(data?.node || 0)));
        if(!node) return;
        const record={
          node,
          status:String(data?.status || "complete"),
          source:String(data?.source || ""),
          summary:String(data?.summary || "").replace(/\s+/g," ").slice(0,190),
          completed:Number(data?.completed || 0),
          total:Number(data?.total || NODE_VIRTUAL_MAX)
        };
        const existing=indexByNode.get(node);
        if(existing===undefined){
          if(items.length>=NODE_VIRTUAL_MAX) return;
          indexByNode.set(node,items.length);
          items.push(record);
        }else{
          items[existing]=record;
        }
        header.textContent="RAG V2.1 • "+Math.min(record.completed,NODE_VIRTUAL_MAX)+"/"+NODE_VIRTUAL_MAX+" nós concluídos"+
          (reduceTotal ? " • síntese "+reduceDone+"/"+reduceTotal : "");
        const nearBottom=(viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight)<90;
        schedule();
        if(nearBottom) requestAnimationFrame(()=>{viewport.scrollTop=viewport.scrollHeight;});
      },
      reduce(data){
        reduceTotal=Math.max(reduceTotal,Number(data?.total_groups || 0));
        reduceDone=Math.min(reduceTotal || Number.MAX_SAFE_INTEGER,reduceDone+1);
        header.textContent="RAG V2.1 • 500 nós • síntese "+reduceDone+"/"+Math.max(reduceTotal,reduceDone);
      },
      keepalive(){
        header.dataset.live=String(Date.now());
      },
      complete(){
        header.textContent="RAG V2.1 • fusão enciclopédica concluída";
      },
      destroy(){
        if(raf) cancelAnimationFrame(raf);
      }
    };
  }

  function isDirectRetrievalIntent(question) {
    const raw=String(question || "");
    const q=raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ");
    const fullChapter=/\b(?:capitulo|chapter)\b.*\b(?:completo|inteiro|integral|na integra|full|whole|entire)\b/i.test(q) ||
      /\b(?:completo|inteiro|integral|na integra|full|whole|entire)\b.*\b(?:capitulo|chapter)\b/i.test(q);
    const exactVerse=/\b(?:versiculo|verse)\b.*\b(?:exato|literal|integral|exact|verbatim)\b/i.test(q) ||
      (/\b(?:exato|literal|exact|verbatim)\b/i.test(q) && /\b\d{1,4}\s*:\s*\d{1,4}\b/.test(raw));
    const rawText=/\b(?:texto exato|texto literal|texto integral|na integra|sem resumir|sem resumo|raw text|verbatim|transcreva|transcricao integral|copie exatamente|mostre exatamente)\b/i.test(q);
    return fullChapter || exactVerse || rawText;
  }

  function appendRawDocumentMessage(content,meta={}) {
    const wrap=document.createElement("div");
    wrap.className="msg assistant raw-document-msg";

    const bar=document.createElement("div");
    bar.className="raw-document-status";
    const offline=meta?.offline_takeover===true;
    bar.textContent=offline
      ? "Modo Offline Ativado - Leitura Contínua Local"
      : "Leitura documental direta • LLM bypass • ordem verificada";
    wrap.appendChild(bar);

    const source=document.createElement("div");
    source.className="raw-document-source";
    const bits=[
      meta?.title || meta?.filename || "Documento",
      meta?.author ? "autor: "+meta.author : "",
      meta?.page ? "página "+meta.page : "",
      meta?.scope ? "modo: "+meta.scope : ""
    ].filter(Boolean);
    source.textContent=bits.join(" • ");
    wrap.appendChild(source);

    const raw=document.createElement("div");
    raw.className="raw-document-text";
    raw.textContent=String(content || "");
    wrap.appendChild(raw);

    $("messages").appendChild(wrap);
    $("messages").scrollTop=$("messages").scrollHeight;
  }

  async function directRetrievalWithFailover(question,queryEmbedding=null){
    let primaryFailure="";
    if(navigator.onLine){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),10000);
      try{
        const res=await fetch("/api/rag/direct",{
          method:"POST",
          headers:authHeaders({"Content-Type":"application/json"}),
          body:JSON.stringify({
            question:String(question || ""),
            query_embedding:Array.isArray(queryEmbedding)?queryEmbedding:[]
          }),
          signal:controller.signal
        });
        const data=await res.json().catch(()=>({}));
        if(res.ok && data?.ok===true && typeof data?.text==="string" && data.text.length){
          return {...data,plan:"A",offline_takeover:false};
        }
        primaryFailure=String(data?.code || data?.message || ("HTTP "+res.status));
      }catch(error){
        primaryFailure=String(error?.message || error);
      }finally{
        clearTimeout(timer);
      }
    }else{
      primaryFailure="offline";
    }

    try{
      const failover=await ensureFailoverV3();
      const recovered=await failover.recoverDirect({question:String(question||""),query_embedding:queryEmbedding||[]});
      if(recovered?.ok){
        if(recovered.plan==="C"){
          try{navigator.vibrate?.(35);}catch{}
          if($("avatarState")) $("avatarState").textContent="Modo Offline Ativado - Leitura Contínua Local";
        }else if($("avatarState")){
          $("avatarState").textContent="Contingência Plano "+String(recovered.plan||"?")+" ativa";
        }
        return {...recovered,offline_takeover:recovered.plan==="C",primary_failure:primaryFailure};
      }
      return {...recovered,primary_failure:primaryFailure,bypass_llm:true,text:""};
    }catch(error){
      return {
        ok:false,direct:true,bypass_llm:true,
        code:"DIRECT_RETRIEVAL_UNAVAILABLE",
        primary_failure:primaryFailure,
        failover_error:String(error?.message||error),
        text:""
      };
    }
  }

  function appendMessage(role, content, sources = [], fallback = false) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const text = document.createElement("div");
    if(role === "assistant") renderAssistantMarkdown(text,content);
    else text.textContent = content;
    wrap.appendChild(text);

    const hasDeterministicReferenceSection = role === "assistant" && /FONTES\s+E\s+REFER[ÊE]NCIAS/i.test(String(content || ""));
    if (role === "assistant" && !hasDeterministicReferenceSection && (sources?.length || fallback)) {
      const src = document.createElement("div");
      src.className = "sources";
      if (fallback) {
        const note = document.createElement("div");
        note.className = "source";
        note.textContent = /índices de busca estão temporariamente indisponíveis/i.test(String(content || ""))
          ? "A biblioteca não foi considerada vazia. O índice remoto está indisponível e a recuperação local continua ativa."
          : "Não encontrei uma passagem documental direta nesta busca; tente ampliar os termos.";
        src.appendChild(note);
      }
      (sources || []).forEach(item => {
        const row = document.createElement("div");
        row.className = "source";
        const strong = document.createElement("strong");
        strong.textContent = item.titulo || item.arquivo || "Documento";
        row.appendChild(strong);

        const meta = [];
        if (item.autor) meta.push("autor: " + item.autor);
        if (item.pagina) meta.push("página " + item.pagina);
        if (item.idioma && item.idioma !== "unknown") meta.push("idioma: " + item.idioma);
        if (item.arquivo && item.titulo && item.arquivo !== item.titulo && !/\.pdf$/i.test(item.arquivo)) meta.push(item.arquivo);
        if (meta.length) {
          const details = document.createElement("div");
          details.className = "source-meta";
          details.textContent = meta.join(" • ");
          row.appendChild(details);
        }

        // O texto bruto recuperado não é repetido aqui; a síntese limpa já aparece na resposta.
        src.appendChild(row);
      });
      wrap.appendChild(src);
    }

    $("messages").appendChild(wrap);
    $("messages").scrollTop = $("messages").scrollHeight;
  }

  function appendStreamingMessage() {
    const wrap = document.createElement("div");
    wrap.className = "msg assistant streaming-msg";
    const progressHost=document.createElement("div");
    progressHost.className="node-progress-host";
    const virtual=createNodeProgressVirtualizer(progressHost);
    const text = document.createElement("div");
    text.className = "markdown-body streaming-answer";
    text.textContent = "";
    wrap.appendChild(progressHost);
    wrap.appendChild(text);
    $("messages").appendChild(wrap);
    $("messages").scrollTop = $("messages").scrollHeight;
    return { wrap, text, virtual };
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
            scheduleAssistantMarkdown(live.text,answer);
            $("messages").scrollTop = $("messages").scrollHeight;
          } else if (event === "node") {
            live.virtual?.upsert(data);
          } else if (event === "reduce") {
            live.virtual?.reduce(data);
          } else if (event === "keepalive") {
            live.virtual?.keepalive(data);
          } else if (event === "meta" || event === "done") {
            meta = { ...meta, ...data };
            if (event === "done") {
              live.virtual?.complete();
              if (data.resposta) answer = String(data.resposta);
            }
          } else if (event === "error") {
            throw new Error(data.message || "Falha no streaming.");
          }
        }
      }
    } finally {
      live.virtual?.destroy();
      live.wrap.remove();
    }
    return {
      ok: meta.ok !== false,
      resposta: answer || "Não encontrei uma referência direta a este tema neste trecho específico. Quer que eu faça uma busca mais ampla no documento?",
      fontes: meta.fontes || [],
      fallback: meta.fallback === true,
      retrieval_unavailable: meta.retrieval_unavailable === true,
      memory_persisted: meta.memory_persisted === true,
      provider: meta.provider || "groq+resilient-rag",
      code: meta.code || "",
      raw_meta: meta
    };
  }

  function renderHistory() {
    $("messages").innerHTML = "";
    history.forEach(x => {
      if(x.role==="assistant" && x.raw_document===true) appendRawDocumentMessage(x.content,x.direct_meta || {});
      else appendMessage(x.role, x.content, x.sources || [], x.fallback);
    });
    if (!history.length) {
      appendMessage("assistant",
        "Estou pronto. Alimente minha biblioteca com PDFs e converse comigo sobre qualquer assunto. Vou responder sempre em português e mostrar as fontes quando a biblioteca as fornecer.");
    }
  }

  function markdownToSpeech(text) {
    return String(text || "")
      .replace(/\n\s*2\.\s*(?:📚\s*)?FONTES\s+E\s+REFER[ÊE]NCIAS\s*:?[^]*$/i, " ")
      .replace(/```[^\n]*\n?/g, " ")
      .replace(/```/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-+*]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/(^|[.!?]\s+|\n)\d{1,3}\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/g, "$1")
      .replace(/\s+\d{1,3}\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/g, " ")
      .replace(/\bGên\.?\b/gi, "Gênesis")
      .replace(/\bÊx\.?\b/gi, "Êxodo")
      .replace(/\bLev\.?\b/gi, "Levítico")
      .replace(/\bNúm\.?\b/gi, "Números")
      .replace(/\bDeut\.?\b/gi, "Deuteronômio")
      .replace(/\bMt\.?\b/gi, "Mateus")
      .replace(/\bMc\.?\b/gi, "Marcos")
      .replace(/\bLc\.?\b/gi, "Lucas")
      .replace(/\bJo\.?\b/gi, "João")
      .replace(/\bD&C\b/gi, "Doutrina e Convênios")
      .replace(/standard[-_ ]?works[-_\w]*\.pdf/gi, "Obras Padrão")
      .replace(/[\[\]{}()*_~#>|]/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s*\n+\s*/g, ". ")
      .replace(/\s{2,}/g, " ")
      .replace(/\.{2,}/g, ".")
      .trim();
  }

  async function unlockAudioOutput() {
    try {
      if(!ttsAudioContext){
        const Ctx=window.AudioContext || window.webkitAudioContext;
        if(Ctx) ttsAudioContext=new Ctx();
      }
      if(ttsAudioContext?.state === "suspended") await ttsAudioContext.resume();
      if(window.speechSynthesis?.paused) window.speechSynthesis.resume();
      audioOutputUnlocked=true;
    } catch {}
    return audioOutputUnlocked;
  }

  function clearVoiceReconnect() {
    if(voiceReconnectTimer) clearTimeout(voiceReconnectTimer);
    voiceReconnectTimer=0;
  }

  function stopVoiceKeepAlive() {
    clearVoiceReconnect();
    if(voiceKeepAliveTimer) clearInterval(voiceKeepAliveTimer);
    voiceKeepAliveTimer=0;
    voiceReconnectAttempts=0;
  }

  function scheduleVoiceReconnect(reason="conexão interrompida",delay=700) {
    if(!voiceLoopEnabled) return;
    clearVoiceReconnect();
    const wait=Math.min(5000,Math.max(500,delay));
    setMicStatus("Reconectando microfone em segundo plano…");
    voiceReconnectTimer=setTimeout(async()=>{
      voiceReconnectTimer=0;
      if(!voiceLoopEnabled) return;
      const live=voiceStream?.getAudioTracks?.().some(t=>t.readyState==="live");
      if(live && recorder?.state==="recording") {
        voiceReconnectAttempts=0;
        setMicStatus("Microfone ativo. Pode falar.");
        return;
      }
      try{
        if(voiceStream){
          voiceStream.getTracks().forEach(t=>{try{t.stop();}catch{}});
          voiceStream=null;
        }
        await ensureVoiceStream();
        voiceReconnectAttempts=0;
        if(!recorder || recorder.state!=="recording") await startRecorderFallback();
        setMicStatus("Microfone reconectado. Pode continuar.");
      }catch(error){
        voiceReconnectAttempts++;
        const next=Math.min(5000,700*(2**Math.min(3,voiceReconnectAttempts)));
        setMicStatus("Reconectando microfone… tentativa "+(voiceReconnectAttempts+1),true);
        scheduleVoiceReconnect(reason,next);
      }
    },wait);
  }

  function bindVoiceStreamHealth(stream) {
    for(const track of stream?.getAudioTracks?.() || []){
      track.onended=()=>scheduleVoiceReconnect("faixa encerrada",500);
      track.onmute=()=>setTimeout(()=>{
        if(voiceLoopEnabled && track.readyState!=="live") scheduleVoiceReconnect("faixa suspensa",600);
      },1200);
    }
    if(!voiceKeepAliveTimer){
      voiceKeepAliveTimer=setInterval(()=>{
        if(!voiceLoopEnabled) return;
        const live=voiceStream?.getAudioTracks?.().some(t=>t.readyState==="live");
        if(!live || (recorder && recorder.state==="inactive")){
          scheduleVoiceReconnect("keep-alive",500);
        }
      },4000);
    }
  }

  async function transcribeBlobWithRetry(blob,maxAttempts=2) {
    let lastError=null;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),45000);
      try{
        const res=await fetch("/api/stt",{
          method:"POST",
          headers:authHeaders({"Content-Type":blob.type || "audio/webm"}),
          body:blob,
          signal:controller.signal
        });
        const data=await res.json().catch(()=>({}));
        if(!res.ok){
          const error=new Error(data.message || "STT indisponível");
          error.status=res.status;
          throw error;
        }
        return data;
      }catch(error){
        lastError=error;
        const retryable=error?.name==="AbortError" || !Number(error?.status) || Number(error?.status)>=500 || Number(error?.status)===429;
        if(!retryable || attempt===maxAttempts) throw error;
        await new Promise(resolve=>setTimeout(resolve,700*attempt));
      }finally{
        clearTimeout(timeout);
      }
    }
    throw lastError || new Error("STT indisponível");
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
    await unlockAudioOutput();
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
    unlockAudioOutput().catch(()=>{});
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
      const recentHistory=history.slice(-20).map(x=>({role:x.role,content:x.content}));

      // Leitura literal: Plano A primeiro. Só após falha o módulo B-F é carregado.
      if(isDirectRetrievalIntent(q)){
        const direct=await directRetrievalWithFailover(q,null);
        if(direct?.ok===true && typeof direct?.text==="string" && direct.text.length){
          appendRawDocumentMessage(direct.text,{
            ...direct,
            offline_takeover:direct.plan==="C",
            scope:direct.scope || direct.direct_scope || "",
            title:direct.title || direct.filename || "Documento"
          });
          history.push({
            role:"assistant",
            content:direct.text,
            raw_document:true,
            direct_meta:{
              offline_takeover:direct.plan==="C",
              title:direct.title || direct.filename || "Documento",
              filename:direct.filename || "",
              author:direct.author || "",
              page:direct.page || null,
              scope:direct.scope || direct.direct_scope || "",
              plan:direct.plan || "A"
            },
            fallback:false,
            ts:Date.now()
          });
          saveHistory();
          setAvatar("closed");
          return;
        }

        const failure=String(direct?.answer || "Não foi possível recuperar o texto documental exato agora. O V3.0 manteve o bypass do LLM: nenhum texto foi inventado ou completado por inteligência artificial.");
        appendMessage("assistant",failure,[],true);
        history.push({role:"assistant",content:failure,fallback:true,ts:Date.now()});
        saveHistory();
        setAvatar("closed");
        return;
      }

      // Plano A analítico: nenhum IndexedDB, pdf.js, embedding local ou RAG local é carregado.
      let data=null;
      let primaryError=null;
      try{
        data=await streamChat({
          pergunta:q,
          turn_id:turnId,
          historico:recentHistory
        });
      }catch(error){
        primaryError=error;
      }

      if(!data || data.fallback===true || data.retrieval_unavailable===true || data.ok===false){
        let recovered=null;
        try{
          const failover=await ensureFailoverV3();
          recovered=await failover.recoverAnalytic({
            question:q,
            history:recentHistory,
            primary_error:String(primaryError?.message || data?.code || data?.provider || "")
          });
        }catch(error){
          primaryError=primaryError || error;
        }

        if(recovered?.ok){
          const resposta=String(recovered.answer || recovered.text || "");
          appendMessage("assistant",resposta,recovered.sources || [],false);
          history.push({
            role:"assistant",content:resposta,sources:recovered.sources || [],fallback:false,
            failover_plan:recovered.plan || "",ts:Date.now()
          });
          saveHistory();
          if($("backendText")) $("backendText").textContent="Contingência Plano "+String(recovered.plan||"?")+" ativa";
          setAvatar("closed");
          return;
        }

        if(data?.resposta){
          const resposta=String(data.resposta);
          appendMessage("assistant",resposta,data.fontes||[],true);
          history.push({role:"assistant",content:resposta,sources:data.fontes||[],fallback:true,ts:Date.now()});
          saveHistory();
          setAvatar("closed");
          return;
        }
        throw primaryError || new Error("Todos os níveis automáticos A-E ficaram indisponíveis. O Plano F exige acesso humano ao raw-vault.");
      }

      const resposta=String(data.resposta || "");
      appendMessage("assistant",resposta,data.fontes || [],false);
      history.push({role:"assistant",content:resposta,sources:data.fontes || [],fallback:false,ts:Date.now()});
      saveHistory();
      await playAudio(data.audio_url,resposta);
    } catch (error) {
      appendMessage("assistant","Não consegui responder agora. "+String(error?.message||error));
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
      const res=await fetch("/health/deploy",{cache:"no-store"});
      const data=await res.json();
      const up=data?.ok===true;
      $("backendDot").className="dot "+(up?"ok":"bad");
      $("backendText").textContent=up
        ? "V3.0 • Plano A ativo • 500 nós analíticos • 1000 turbinas exatas"
        : "Modo local resiliente ativo";
    } catch {
      $("backendDot").className="dot ok";
      $("backendText").textContent="Modo local resiliente ativo";
    }
  }

  function switchPanel(name) {
    const lib = name === "library";
    if(lib && !ensureLocalAdminAccess()) return;
    $("chatPanel").classList.toggle("hidden", lib);
    $("libraryPanel").classList.toggle("hidden", !lib);
    $("chatTab").classList.toggle("active", !lib);
    $("libraryTab").classList.toggle("active", lib);
    if (lib) {
      activateHeavyLocalSubsystems("library-admin");
      loadBooks();
    }
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
    stopVoiceKeepAlive();
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
      bindVoiceStreamHealth(voiceStream);
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
    recorder.onerror = () => {
      if(voiceLoopEnabled) scheduleVoiceReconnect("falha do gravador",700);
    };
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
        const data = await transcribeBlobWithRetry(blob,2);
        const text = String(data.text || "").trim();
        $("questionInput").value = text;
        if (text && $("autoSendVoice")?.checked) {
          await sendQuestion({ fromVoice: true });
        } else if (voiceLoopEnabled) {
          setTimeout(() => startRecorderFallback().catch(stopVoiceLoop), 300);
        }
      } catch (e) {
        appendMessage("assistant", "Não consegui transcrever sua voz: " + e.message);
        if (voiceLoopEnabled) scheduleVoiceReconnect("falha na transcrição",700);
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
      if (rms > 0.020) {
        heardSpeech = true;
        lastVoiceAt = now;
      }
      const silenceAfterSpeech = heardSpeech && now - lastVoiceAt > 2600 && now - startedAt > 1500;
      const maxTurn = now - startedAt > 60000;
      const noSpeechTimeout = !heardSpeech && now - startedAt > 20000;
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
    if(window.pdfjsLib?.getDocument) return window.pdfjsLib;
    if(!window.__pdfjsReady){
      window.__pdfjsReady=import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs").then(mod=>{
        mod.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
        window.pdfjsLib=mod;
        return mod;
      }).catch(error=>{
        window.__pdfjsReady=null;
        throw error;
      });
    }
    return await window.__pdfjsReady;
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
  function bookIdentity(item){
    const name=String(item?.arquivo || item?.filename || item?.titulo || item?.title || "").trim().toLowerCase();
    return name ? "name:"+name : "id:"+String(item?.document_id || item?.id || "");
  }

  async function saveLocalCatalogEntry(entry){
    const documentId=String(entry?.document_id || "").trim();
    if(!documentId) return;
    await idbPut("library_catalog",{
      document_id:documentId,
      cloud_document_id:String(entry?.cloud_document_id || ""),
      arquivo:String(entry?.arquivo || entry?.filename || "Documento local"),
      titulo:String(entry?.titulo || entry?.title || entry?.arquivo || entry?.filename || "Documento local"),
      autor:String(entry?.autor || entry?.author || ""),
      paginas:Number(entry?.paginas || entry?.pages || 0),
      chunks:Number(entry?.chunks || 0),
      idioma:String(entry?.idioma || entry?.language || "pt"),
      status:String(entry?.status || "local-ready"),
      source:"indexeddb-catalog",
      updated_at:Number(entry?.updated_at || Date.now())
    });
  }

  async function localBookCatalog(){
    const map=new Map();

    try{
      for(const item of await idbGetAll("library_catalog")){
        const key=bookIdentity(item);
        if(key) map.set(key,{...item,source:"indexeddb-catalog"});
      }
    }catch{}

    try{
      await ensureRagCascade("on-demand-local");
      const docs=await window.FNSRagCascade?.listDocuments?.();
      for(const item of (Array.isArray(docs)?docs:[])){
        const normalized={
          document_id:String(item.document_id || ""),
          arquivo:String(item.filename || item.arquivo || "Documento local"),
          titulo:String(item.title || item.titulo || item.filename || "Documento local"),
          autor:String(item.author || item.autor || ""),
          paginas:Number(item.pages || item.paginas || 0),
          chunks:Number(item.chunks || 0),
          idioma:String(item.language || item.idioma || "pt"),
          status:String(item.status || "local-ready"),
          source:"local-rag",
          updated_at:Date.now()
        };
        const key=bookIdentity(normalized);
        if(key) map.set(key,{...(map.get(key)||{}),...normalized});
      }
    }catch{}

    try{
      for(const job of await idbGetAll("jobs")){
        const normalized={
          document_id:String(job.document_id || ""),
          arquivo:String(job.filename || "Documento local"),
          titulo:String(job.title || job.filename || "Documento local"),
          autor:String(job.author || ""),
          paginas:Number(job.last_page || 0),
          chunks:Number(job.total_chunks || 0),
          idioma:"pt",
          status:String(job.state || "local-checkpoint"),
          source:"local-checkpoint",
          updated_at:Number(job.updated_at || job.created_at || Date.now())
        };
        const key=bookIdentity(normalized);
        if(key) map.set(key,{...(map.get(key)||{}),...normalized});
      }
    }catch{}

    const list=[...map.values()];
    for(const item of list) if(item.document_id) saveLocalCatalogEntry(item).catch(()=>{});
    return list;
  }

  function mergeBookLists(localList,cloudList){
    const map=new Map();
    for(const item of (localList||[])){
      const key=bookIdentity(item);
      if(key) map.set(key,{...item,source:item.source || "local"});
    }
    for(const item of (cloudList||[])){
      const normalized={
        ...item,
        document_id:String(item.document_id || item.id || ""),
        arquivo:String(item.arquivo || item.filename || item.titulo || "Documento"),
        titulo:String(item.titulo || item.title || item.arquivo || "Documento"),
        autor:String(item.autor || item.author || ""),
        paginas:Number(item.paginas || item.pages || 0),
        chunks:Number(item.chunks || 0),
        idioma:String(item.idioma || item.language || "pt")
      };
      const key=bookIdentity(normalized);
      if(!key) continue;
      const existing=map.get(key) || {};
      map.set(key,{
        ...existing,
        ...normalized,
        document_id:String(existing.document_id || normalized.document_id || ""),
        cloud_document_id:String(normalized.document_id || existing.cloud_document_id || ""),
        source:existing.document_id ? "local+cloud" : "cloud"
      });
    }
    return [...map.values()];
  }

  function renderBooks(list,cloudAvailable=true){
    $("booksList").innerHTML="";
    if(!list.length){
      $("booksList").innerHTML='<div class="book"><div><strong>Nenhum PDF encontrado neste navegador.</strong><small>Seus livros da nuvem não foram apagados; a lista remota volta automaticamente quando a Cloudflare liberar a leitura.</small></div></div>';
      return;
    }
    list.forEach(item=>{
      const row=document.createElement("div");
      row.className="book";
      const info=document.createElement("div");
      const strong=document.createElement("strong");
      strong.textContent=item.arquivo || item.filename || item.titulo || "Documento";
      const small=document.createElement("small");
      const bits=[];
      if(item.titulo && item.titulo!==item.arquivo) bits.push(item.titulo);
      if(item.autor) bits.push(item.autor);
      if(Number(item.paginas||0)) bits.push(Number(item.paginas)+" páginas");
      if(Number(item.chunks||0)) bits.push(Number(item.chunks)+" trechos");
      bits.push((item.source||"").includes("local") || (item.source||"").includes("indexeddb") ? "IndexedDB local" : "nuvem");
      bits.push(item.status || (cloudAvailable?"pronto":"local"));
      small.textContent=bits.join(" • ");
      info.append(strong,small);

      const del=document.createElement("button");
      del.className="ghost danger";
      del.textContent="Excluir";
      del.onclick=async()=>{
        if(!confirm("Excluir "+strong.textContent+" da biblioteca?")) return;
        const localId=String(item.document_id || "");
        const cloudId=String(item.cloud_document_id || item.id || "");
        try{
          if(localId){
            await idbDelete("library_catalog",localId).catch(()=>{});
            await idbDelete("jobs",localId).catch(()=>{});
            await idbDelete("offline_vector_jobs",localId).catch(()=>{});
            await idbDelete("sync_queue",localId).catch(()=>{});
            await window.FNSRagCascade?.deleteDocument?.(localId).catch(()=>{});
          }
          if(cloudAvailable && (cloudId || localId)){
            await api("/api/admin/delete-pdf",{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({document_id:cloudId || localId,arquivo:item.arquivo || ""})
            }).catch(()=>{});
          }
          await loadBooks();
        }catch(e){$("adminStatus").textContent="Não foi possível excluir agora: "+e.message;}
      };
      row.append(info,del);
      $("booksList").appendChild(row);
    });
  }

  function splitLocalPageText(text,page,documentId){
    const clean=String(text || "").replace(/\s+/g," ").trim();
    if(!clean) return [];
    const out=[];
    const max=900,overlap=120;
    let start=0,index=0;
    while(start<clean.length){
      let end=Math.min(clean.length,start+max);
      if(end<clean.length){
        const cut=clean.lastIndexOf(" ",end);
        if(cut>start+420) end=cut;
      }
      const chunk=clean.slice(start,end).trim();
      if(chunk.length>=35){
        out.push({
          id:documentId+":"+page+":"+index,
          document_id:documentId,
          page:Number(page||0),
          chunk_index:index,
          text:chunk
        });
        index++;
      }
      if(end>=clean.length) break;
      start=Math.max(start+1,end-overlap);
    }
    return out;
  }

  const activeOfflineVectorJobs=new Set();

  async function runOfflineVectorJob(job){
    const documentId=String(job?.document_id || "");
    if(!documentId || activeOfflineVectorJobs.has(documentId)) return;
    if(!window.FNSRagCascade?.getDocumentChunks) return;
    activeOfflineVectorJobs.add(documentId);
    try{
      let offset=Number(job.offset || 0);
      let vectorCount=Number(job.vector_count || 0);
      await idbPut("offline_vector_jobs",{...job,state:"vectorizing",offset,updated_at:Date.now()});

      while(true){
        const rows=await window.FNSRagCascade.getDocumentChunks(documentId,offset,8);
        if(!rows.length) break;
        const chunksToEmbed=[];
        for(const row of rows) chunksToEmbed.push(...splitLocalPageText(row.text,row.page,documentId));

        for(let i=0;i<chunksToEmbed.length;i+=LOCAL_EMBED_BATCH){
          const batch=chunksToEmbed.slice(i,i+LOCAL_EMBED_BATCH);
          const result=await workerRequest("embed-batch",{texts:batch.map(x=>x.text)},"normal");
          const vectors=Array.isArray(result.vectors)?result.vectors:[];
          if(vectors.length!==batch.length) throw new Error("Lote local de embeddings incompleto.");
          await window.FNSRagCascade.persistVectors({
            document_id:documentId,
            filename:job.filename || "",
            title:job.title || job.filename || "",
            author:job.author || "",
            chunks:batch,
            vectors
          });
          vectorCount+=batch.length;
          await new Promise(resolve=>setTimeout(resolve,25));
        }

        offset+=rows.length;
        await idbPut("offline_vector_jobs",{...job,state:"vectorizing",offset,vector_count:vectorCount,updated_at:Date.now()});
        if($("adminStatus")) $("adminStatus").textContent="Vetorização offline: "+vectorCount+" trechos salvos no IndexedDB.";
      }

      await idbPut("offline_vector_jobs",{...job,state:"done",offset,vector_count:vectorCount,updated_at:Date.now()});
      await saveLocalCatalogEntry({
        document_id:documentId,
        arquivo:job.filename,
        titulo:job.title || job.filename,
        autor:job.author || "",
        paginas:job.page_count || 0,
        chunks:vectorCount,
        status:"local-vector-ready"
      });
      if($("adminStatus")) $("adminStatus").textContent="PDF pronto localmente: "+vectorCount+" embeddings armazenados no navegador.";
      await loadBooks();
    }catch(error){
      await idbPut("offline_vector_jobs",{...job,state:"paused",error:String(error?.message||error),updated_at:Date.now()}).catch(()=>{});
    }finally{
      activeOfflineVectorJobs.delete(documentId);
    }
  }

  async function queueOfflineVectorization(extracted){
    const documentId=String(extracted.content_sha256 || extracted.filename);
    const job={
      document_id:documentId,
      filename:extracted.filename,
      title:extracted.title || extracted.filename,
      author:extracted.author || "",
      page_count:Number(extracted.page_count || extracted.pages?.length || 0),
      offset:0,vector_count:0,state:"queued",created_at:Date.now(),updated_at:Date.now()
    };
    await idbPut("offline_vector_jobs",job);
    runOfflineVectorJob(job);
  }

  async function resumeOfflineVectorJobs(){
    const jobs=await idbGetAll("offline_vector_jobs").catch(()=>[]);
    for(const job of jobs.filter(j=>j.state!=="done")) runOfflineVectorJob(job);
  }

  async function enqueueCloudSync(extracted){
    const documentId=String(extracted.content_sha256 || extracted.filename);
    const item={
      id:documentId,
      document_id:documentId,
      filename:extracted.filename,
      title:extracted.title || extracted.filename,
      author:extracted.author || "",
      page_count:Number(extracted.page_count || extracted.pages?.length || 0),
      size_bytes:Number(extracted.size_bytes || 0),
      content_sha256:String(extracted.content_sha256 || ""),
      status:"pending",
      attempts:0,
      next_attempt_at:Date.now(),
      created_at:Date.now(),
      updated_at:Date.now()
    };
    await idbPut("sync_queue",item);
    return item;
  }

  let syncQueueRunning=false;
  async function processSyncQueue(){
    if(syncQueueRunning || !navigator.onLine || !ownerToken()) return;
    if(!window.FNSRagCascade?.getDocumentChunks) return;
    syncQueueRunning=true;
    try{
      const now=Date.now();
      const items=(await idbGetAll("sync_queue").catch(()=>[]))
        .filter(x=>x.status!=="synced" && Number(x.next_attempt_at||0)<=now)
        .sort((a,b)=>(a.created_at||0)-(b.created_at||0));

      for(const item of items.slice(0,2)){
        try{
          const start=await api("/api/admin/local-ingest-start",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              filename:item.filename,
              size_bytes:item.size_bytes,
              page_count:item.page_count,
              title:item.title,
              author:item.author,
              content_sha256:item.content_sha256,
              original_r2_key:""
            })
          },false);

          if(start.duplicate){
            await saveLocalCatalogEntry({...item,cloud_document_id:String(start.document_id||""),arquivo:item.filename,titulo:item.title,paginas:item.page_count,status:"local+cloud"});
            await idbDelete("sync_queue",item.id);
            continue;
          }

          let offset=0;
          while(true){
            const rows=await window.FNSRagCascade.getDocumentChunks(item.document_id,offset,20);
            if(!rows.length) break;
            await api("/api/admin/local-ingest-append",{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({
                job_id:start.job_id,
                pages:rows.map(r=>({page:Number(r.page||0),text:String(r.text||"")}))
              })
            },false);
            offset+=rows.length;
          }

          const committed=await api("/api/admin/local-ingest-commit",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({job_id:start.job_id})
          },false);

          await saveLocalCatalogEntry({
            ...item,
            cloud_document_id:String(committed.document_id || start.document_id || ""),
            arquivo:item.filename,
            titulo:item.title,
            paginas:item.page_count,
            chunks:Number(committed.chunks || 0),
            status:"local+cloud"
          });
          await idbDelete("sync_queue",item.id);
        }catch(error){
          const msg=String(error?.message || error || "");
          const quota=error?.status===429 || /Exceeded allowed rows read|free tier|rows read|quota/i.test(msg);
          const attempts=Number(item.attempts||0)+1;
          const delay=quota ? 60*60*1000 : Math.min(60*60*1000,Math.max(5*60*1000,attempts*10*60*1000));
          await idbPut("sync_queue",{...item,status:"pending",attempts,next_attempt_at:Date.now()+delay,last_error:msg,updated_at:Date.now()});
          if(quota) break;
        }
      }
    }finally{
      syncQueueRunning=false;
    }
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
    $("uploadBtn").disabled=true;
    const startedAt=performance.now();
    try{
      const extracted=await extractPdfLocally(file);
      const localId=String(extracted.content_sha256 || extracted.filename);

      $("adminStatus").textContent="Texto extraído. Salvando livro no IndexedDB/OPFS local…";
      await ensureRagCascade("on-demand-local");
      await window.FNSRagCascade?.persistExtracted?.(extracted);

      await saveLocalCatalogEntry({
        document_id:localId,
        arquivo:extracted.filename,
        titulo:extracted.title || extracted.filename,
        autor:extracted.author || "",
        paginas:Number(extracted.page_count || extracted.pages?.length || 0),
        chunks:Number(extracted.pages?.length || 0),
        idioma:"pt",
        status:"local-lexical-ready",
        updated_at:Date.now()
      });

      await enqueueCloudSync(extracted);
      await queueOfflineVectorization(extracted);
      $("pdfInput").value="";
      await loadBooks();

      const seconds=((performance.now()-startedAt)/1000).toFixed(1);
      $("adminStatus").textContent="PDF salvo localmente e já pesquisável • embeddings em segundo plano • sincronização em nuvem na fila • "+seconds+"s";

      // Tenta sincronizar agora; se a Cloudflare estiver em 429, a fila fica preservada para o próximo ciclo.
      processSyncQueue().catch(()=>{});
    }catch(error){
      $("adminStatus").textContent="Falha ao processar o PDF localmente: "+String(error?.message || error);
    }finally{
      $("uploadBtn").disabled=false;
    }
  }

  async function loadBooks() {
    const local=await localBookCatalog();
    renderBooks(local,false);

    if(local.length){
      $("adminStatus").textContent="Biblioteca local ativa: "+local.length+" PDF(s) carregado(s) do IndexedDB.";
    }else{
      $("adminStatus").textContent="Consultando biblioteca local e nuvem…";
    }

    try{
      const data=await api("/api/admin/livros");
      const cloud=Array.isArray(data?.livros)?data.livros:[];
      const merged=mergeBookLists(local,cloud);
      for(const item of merged){
        if(item.document_id) saveLocalCatalogEntry(item).catch(()=>{});
      }
      renderBooks(merged,true);
      $("adminStatus").textContent="Biblioteca sincronizada: "+merged.length+" PDF(s) disponível(is).";
      processSyncQueue().catch(()=>{});
    }catch(error){
      const msg=String(error?.message || error || "");
      const quota=error?.status===429 || /Exceeded allowed rows read|free tier|rows read|quota/i.test(msg);
      renderBooks(local,false);
      $("adminStatus").textContent=quota
        ? "Cloudflare em limite diário. A lista foi carregada do IndexedDB local; seus livros continuam disponíveis."
        : "Nuvem temporariamente indisponível. A lista local do IndexedDB continua ativa.";
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

  document.addEventListener("pointerdown",()=>{unlockAudioOutput().catch(()=>{});},{passive:true});
  document.addEventListener("keydown",()=>{unlockAudioOutput().catch(()=>{});},{passive:true});
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && voiceLoopEnabled){
      const live=voiceStream?.getAudioTracks?.().some(t=>t.readyState==="live");
      if(!live) scheduleVoiceReconnect("retorno à aba",300);
    }
  });

  $("chatTab").onclick = () => switchPanel("chat");
  $("libraryTab").onclick = () => switchPanel("library");
  $("sendBtn").onclick = sendQuestion;
  $("questionInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
  });
  // O botão micBtn é controlado exclusivamente pelo Whisper local em whisper-local.js.
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

  // Apenas o Service Worker leve é preparado no arranque. O módulo B-F continua sem ser importado.
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("/sw-v3.js",{scope:"/"}).catch(()=>{});
  }

  setInterval(()=>{
    if(!heavyLocalSubsystemsActivated) return;
    processSyncQueue().catch(()=>{});
    processMirrorQueue().catch(()=>{});
    backfillLocalVectorMirror().catch(()=>{});
  },20*60*1000);

  window.addEventListener("offline",()=>{
    activateHeavyLocalSubsystems("offline-event");
    if($("backendText")) $("backendText").textContent="Offline detectado • contingência local pronta";
  });
  window.addEventListener("online",()=>{
    if(!heavyLocalSubsystemsActivated) return;
    processSyncQueue().catch(()=>{});
    processMirrorQueue().catch(()=>{});
    backfillLocalVectorMirror().catch(()=>{});
  });
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && heavyLocalSubsystemsActivated){
      processSyncQueue().catch(()=>{});
      processMirrorQueue().catch(()=>{});
    }
  });
})();
