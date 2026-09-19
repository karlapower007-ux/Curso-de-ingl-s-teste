(() => {
  const btn=document.getElementById("micBtn");
  const status=document.getElementById("status-whisper") || document.getElementById("micStatus");
  const input=document.getElementById("questionInput");
  const autoSend=document.getElementById("autoSendVoice");
  const sendBtn=document.getElementById("sendBtn");
  if(!btn || !status || !input) return;

  let worker=null,workerReady=false,busy=false,mode="boot",bootTimer=0;
  let recorder=null,stream=null,chunks=[],requestId=0,lastBlob=null;
  let recognition=null,speechText="";

  const setStatus=t=>{status.textContent=t || "";};
  const enableButton=(label="🎤 Segure para Falar")=>{
    btn.classList.remove("recording","processing");
    btn.style.background="";
    btn.textContent=label;
    btn.disabled=false;
  };
  const finishText=text=>{
    const value=String(text || "").trim();
    busy=false;
    if(value){
      input.value=value;
      setStatus("Texto extraído com sucesso.");
      if(autoSend?.checked && sendBtn) sendBtn.click();
    }else setStatus("Não detectei fala suficiente. Tente novamente.");
    enableButton();
  };

  function activateFallback(reason="Whisper local demorou para carregar"){
    if(bootTimer) clearTimeout(bootTimer);
    bootTimer=0;
    if(worker && !workerReady){try{worker.terminate();}catch{} worker=null;}
    const SpeechRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;
    mode=SpeechRecognition ? "webspeech" : "cloud";
    workerReady=false;
    busy=false;
    setStatus(
      mode==="webspeech"
        ? reason+". Fallback de voz do navegador ativado."
        : reason+". Fallback STT da Groq ativado."
    );
    enableButton();
  }

  function initWorker(){
    try{
      worker=new Worker("/whisper-worker.js?v="+Date.now(),{type:"module"});
      bootTimer=setTimeout(()=>{if(!workerReady) activateFallback("Tempo limite de 8 segundos no Whisper local");},8000);
      worker.onmessage=event=>{
        const data=event.data || {};
        if(data.type==="progress"){
          const pct=Number(data.progress || 0);
          setStatus(pct>0?"Carregando Whisper local… "+Math.round(pct)+"%":"Carregando Whisper local…");
          return;
        }
        if(data.type==="ready"){
          if(bootTimer) clearTimeout(bootTimer);
          bootTimer=0;workerReady=true;mode="local";busy=false;
          setStatus("Whisper local pronto no computador.");
          enableButton();
          return;
        }
        if(data.type==="error"){
          if(mode==="local" && lastBlob) transcribeCloud(lastBlob).catch(()=>activateFallback("Falha no Whisper local"));
          else activateFallback("Falha no Whisper local");
          return;
        }
        if(data.type==="result" && data.id===requestId) finishText(data.text);
      };
      worker.onerror=()=>activateFallback("Worker do Whisper não iniciou");
      worker.postMessage({type:"load"});
    }catch{
      activateFallback("Whisper local indisponível");
    }
  }

  async function decodeToMono16k(blob){
    const Ctx=window.AudioContext || window.webkitAudioContext;
    const ctx=new Ctx({sampleRate:16000});
    try{
      const ab=await blob.arrayBuffer();
      const decoded=await ctx.decodeAudioData(ab.slice(0));
      const mono=new Float32Array(decoded.length);
      for(let ch=0;ch<decoded.numberOfChannels;ch++){
        const channel=decoded.getChannelData(ch);
        for(let i=0;i<decoded.length;i++) mono[i]+=channel[i]/decoded.numberOfChannels;
      }
      return mono;
    }finally{try{await ctx.close();}catch{}}
  }

  async function transcribeCloud(blob){
    mode="cloud";busy=true;
    btn.classList.add("processing");btn.textContent="⏳ Processando...";btn.disabled=true;
    setStatus("Transcrevendo pelo fallback de nuvem…");
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    try{
      const res=await fetch("/api/stt",{method:"POST",headers:{"Content-Type":blob.type || "audio/webm"},body:blob,signal:controller.signal});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data?.message || "STT HTTP "+res.status);
      finishText(data.text);
    }catch(error){
      busy=false;setStatus("Falha no STT: "+String(error?.message || error));enableButton();
    }finally{clearTimeout(timer);}
  }

  function startWebSpeech(event){
    event?.preventDefault?.();
    if(busy)return;
    const SpeechRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SpeechRecognition){mode="cloud";return startRecorder(event);}
    busy=true;speechText="";
    recognition=new SpeechRecognition();
    recognition.lang="pt-BR";recognition.continuous=true;recognition.interimResults=true;
    recognition.onresult=e=>{
      let finalText="";
      for(let i=e.resultIndex;i<e.results.length;i++) if(e.results[i].isFinal) finalText+=e.results[i][0].transcript+" ";
      if(finalText) speechText+=finalText;
    };
    recognition.onerror=()=>{busy=false;mode="cloud";enableButton();setStatus("Reconhecimento nativo falhou; fallback de nuvem preparado.");};
    recognition.onend=()=>finishText(speechText);
    try{
      recognition.start();
      btn.classList.add("recording");btn.textContent="🎙️ Gravando... solte para enviar";
      setStatus("Fallback do navegador ativo. Pode falar.");
    }catch{busy=false;mode="cloud";enableButton();}
  }

  function stopWebSpeech(event){
    event?.preventDefault?.();
    try{recognition?.stop();}catch{}
  }

  async function startRecorder(event){
    if(busy || recorder?.state==="recording")return;
    event?.preventDefault?.();
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:true,echoCancellation:true,autoGainControl:true,channelCount:1}});
      chunks=[];recorder=new MediaRecorder(stream);
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      recorder.onstop=processAudio;recorder.start(200);
      btn.classList.add("recording");btn.textContent="🎙️ Gravando... solte para enviar";
      setStatus(mode==="local"?"Whisper local: gravando.":"Fallback de nuvem: gravando.");
      if(event?.pointerId!=null){try{btn.setPointerCapture(event.pointerId);}catch{}}
    }catch(error){setStatus("Microfone indisponível: "+String(error?.message || error));enableButton();}
  }

  function stopRecorder(event){
    event?.preventDefault?.();
    if(!recorder || recorder.state==="inactive")return;
    try{recorder.stop();}catch{}
    btn.classList.remove("recording");btn.classList.add("processing");
    btn.textContent="⏳ Processando...";btn.disabled=true;setStatus("Lendo o áudio…");
  }

  async function processAudio(){
    busy=true;
    const localStream=stream;stream=null;
    const blob=new Blob(chunks,{type:recorder?.mimeType || "audio/webm"});lastBlob=blob;chunks=[];
    localStream?.getTracks?.().forEach(t=>{try{t.stop();}catch{}});
    if(blob.size<700){busy=false;setStatus("Áudio muito curto.");enableButton();return;}
    if(mode!=="local" || !workerReady){await transcribeCloud(blob);return;}
    try{
      const mono=await decodeToMono16k(blob);requestId++;
      worker.postMessage({type:"transcribe",id:requestId,audio:mono,language:"portuguese",task:"transcribe"},[mono.buffer]);
    }catch{await transcribeCloud(blob);}
  }

  btn.addEventListener("pointerdown",e=>mode==="webspeech"?startWebSpeech(e):startRecorder(e));
  btn.addEventListener("pointerup",e=>mode==="webspeech"?stopWebSpeech(e):stopRecorder(e));
  btn.addEventListener("pointercancel",e=>mode==="webspeech"?stopWebSpeech(e):stopRecorder(e));
  btn.addEventListener("lostpointercapture",e=>{if(mode!=="webspeech" && recorder?.state==="recording")stopRecorder(e);});

  btn.disabled=true;
  setStatus("Carregando Whisper local; fallback automático em até 8 segundos…");
  initWorker();
})();