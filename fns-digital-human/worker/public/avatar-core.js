/* FNS AVATAR MULTI-CORE V11 — isolated DOM + config-driven avatar engine. */
(function(){
  'use strict';

  const params=new URLSearchParams(location.search);
  const avatarId=String(params.get('avatar')||'').trim().toLowerCase();
  const root=document.getElementById('root');
  const state={
    config:null,
    history:[],
    mode:'idle',
    voiceUnlocked:false,
    lastSpoken:'',
    audio:null,
    audioUrl:'',
    utterance:null,
    mouthTimer:null,
    mouthFlip:false,
    recorder:null,
    mediaStream:null,
    chunks:[],
    recognition:null,
    listening:false,
    busy:false,
    stats:{chatTurns:0,remoteVoice:0,browserVoice:0,mouthFrames:0,sttTurns:0}
  };

  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wait=ms=>new Promise(r=>setTimeout(r,ms));

  function setStatus(text){const el=$('statusText');if(el)el.textContent=String(text||'');}
  function setMode(mode,label){
    state.mode=mode;
    const app=$('avatarApp');
    if(app){app.classList.toggle('is-listening',mode==='listening');app.classList.toggle('is-talking',mode==='talking');app.classList.toggle('is-processing',mode==='processing');}
    const voice=$('voiceState');if(voice)voice.textContent=label||({idle:'Lista',listening:'Escuchando',talking:'Hablando',processing:'Procesando'}[mode]||mode);
  }

  function asset(frame){return state.config?.images?.[frame]||state.config?.images?.idle||'';}
  function setFrame(frame){
    const img=$('avatarImage');if(!img)return;
    const src=asset(frame);
    img.dataset.frame=frame;
    if(src&&img.getAttribute('src')!==src)img.setAttribute('src',src);
  }
  function stopMouth(){if(state.mouthTimer){clearInterval(state.mouthTimer);state.mouthTimer=null;}state.mouthFlip=false;setFrame('idle');}
  function startMouth(){
    if(state.mouthTimer)clearInterval(state.mouthTimer);
    state.mouthFlip=false;
    const tick=()=>{
      if(state.mode!=='talking'){stopMouth();return;}
      state.mouthFlip=!state.mouthFlip;
      setFrame(state.mouthFlip?'talking':'listening');
      state.stats.mouthFrames++;
    };
    tick();state.mouthTimer=setInterval(tick,115);
  }
  function startListeningVisual(){stopMouth();setMode('listening','Escuchando');setFrame('listening');}
  function stopListeningVisual(){if(state.mode==='listening'){setMode('idle','Lista');setFrame('idle');}}
  function startTalkingVisual(){setMode('talking','Hablando');startMouth();}
  function stopTalkingVisual(){stopMouth();setMode('idle','Lista');setFrame('idle');}

  function addMessage(role,text){
    const clean=String(text||'').trim();if(!clean)return;
    state.history.push({role,content:clean});if(state.history.length>30)state.history=state.history.slice(-30);
    const transcript=$('transcript');if(!transcript)return;
    const node=document.createElement('div');node.className='msg '+(role==='user'?'user':'teacher');node.textContent=clean;transcript.appendChild(node);transcript.scrollTop=transcript.scrollHeight;
  }

  function safeRuntimeConfig(cfg){
    if(!cfg||typeof cfg!=='object')throw new Error('Configuração do avatar inválida.');
    if(!cfg.id||!cfg.displayName||!cfg.images?.idle||!cfg.images?.talking)throw new Error('Configuração incompleta do avatar.');
    return cfg;
  }

  async function loadConfig(){
    if(!avatarId)throw new Error('Parâmetro ?avatar= ausente.');
    const response=await fetch('/avatar/runtime-config?avatar='+encodeURIComponent(avatarId),{cache:'no-store'});
    if(!response.ok){const detail=await response.text().catch(()=>'');throw new Error('Avatar não encontrado. '+detail.slice(0,120));}
    const json=await response.json();return safeRuntimeConfig(json.avatar||json);
  }

  function render(){
    const c=state.config;
    document.title=c.title+' • FNS Idiomas';
    document.documentElement.style.setProperty('--accent',c.theme?.accent||'#3158d8');
    document.documentElement.style.setProperty('--good',c.theme?.good||'#14603b');
    root.className='avatar-app';root.id='avatarApp';
    root.innerHTML=`
      <section class="avatar-pane" aria-label="Avatar ${escapeHtml(c.displayName)}">
        <div class="brand-row"><span class="brand">FNS IDIOMAS</span><span class="badge">NÚCLEO ${escapeHtml(c.displayName.toUpperCase())}</span></div>
        <div class="avatar-stage"><img id="avatarImage" alt="${escapeHtml(c.displayName)}, avatar virtual" loading="eager" decoding="sync" fetchpriority="high"><div id="voiceState" class="voice-state">Lista</div></div>
        <div class="avatar-caption"><strong>${escapeHtml(c.displayName)}</strong><span>${escapeHtml(c.subtitle||c.targetLanguage||'')}</span></div>
      </section>
      <section class="conversation-pane">
        <header class="conversation-header"><div><h1>${escapeHtml(c.title||c.displayName)}</h1><p>${escapeHtml(c.subtitle||'Núcleo independente')}</p></div><a class="main-link" href="/">Voltar ao núcleo principal</a></header>
        <div class="control-grid">
          <label>Nível<select id="levelSel"><option>A1</option><option>A2</option><option>B1</option><option>B2</option><option>C1</option><option>C2</option></select></label>
          <label>Microfone<select id="sttLangSel"><option value="auto">Automático</option>${(c.inputLanguages||[]).map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x.toUpperCase())}</option>`).join('')}</select></label>
          <label>Voz<select id="voiceTurbineSel"></select></label>
        </div>
        <div id="transcript" class="transcript" aria-live="polite"></div>
        <div class="action-row"><button id="voiceBtn" class="primary" type="button">🔊 Activar voz</button><button id="micBtn" class="good" type="button">🎤 Hablar / Falar</button><button id="stopBtn" type="button">⏹ Parar</button><button id="repeatBtn" type="button">🔁 Repetir</button></div>
        <form id="chatForm" class="composer" autocomplete="off"><input id="chatInput" maxlength="1400" placeholder="Escreva sua mensagem..." aria-label="Mensagem"><button id="sendBtn" class="primary" type="submit">Enviar</button></form>
        <div id="statusText" class="status-line">Núcleo independente pronto.</div>
      </section>`;
    setFrame('idle');
    const voiceSel=$('voiceTurbineSel');
    for(const t of c.voice?.turbines||[]){const o=document.createElement('option');o.value=t.id;o.textContent=t.label||t.id;if(t.id===c.voice.defaultTurbine)o.selected=true;voiceSel.appendChild(o);}
    addMessage('assistant',c.intro||'Hola.');state.lastSpoken=c.intro||'';
    bindUi();
  }

  function stopAudio(){
    if(state.audio){try{state.audio.pause();state.audio.src='';}catch(_){}state.audio.onplay=null;state.audio.onended=null;state.audio.onerror=null;state.audio=null;}
    if(state.audioUrl){try{URL.revokeObjectURL(state.audioUrl);}catch(_){}state.audioUrl='';}
    if(state.utterance){try{speechSynthesis.cancel();}catch(_){}state.utterance=null;}
    stopTalkingVisual();
  }

  function browserVoiceFor(locale){
    try{const voices=speechSynthesis.getVoices()||[],wanted=String(locale||'es-ES').toLowerCase(),base=wanted.split('-')[0];return voices.find(v=>String(v.lang||'').toLowerCase()===wanted)||voices.find(v=>String(v.lang||'').toLowerCase().startsWith(base+'-'))||null;}catch(_){return null;}
  }

  async function speakFallback(text){
    if(!('speechSynthesis'in window)||typeof SpeechSynthesisUtterance==='undefined')return false;
    return await new Promise(resolve=>{
      try{
        const locale=(state.config.voice?.turbines||[]).find(t=>t.id===$('voiceTurbineSel')?.value)?.locale||state.config.targetLanguage||'es-ES';
        const u=new SpeechSynthesisUtterance(text);state.utterance=u;const v=browserVoiceFor(locale);if(v)u.voice=v;u.lang=v?.lang||locale;u.rate=.96;u.pitch=1;u.volume=1;
        u.onstart=()=>{state.stats.browserVoice++;startTalkingVisual();setStatus('Voz do navegador ativa.');};
        const finish=ok=>{if(state.utterance===u)state.utterance=null;stopTalkingVisual();resolve(ok);};
        u.onend=()=>finish(true);u.onerror=()=>finish(false);speechSynthesis.speak(u);
      }catch(_){resolve(false);}
    });
  }

  async function speak(text){
    const clean=String(text||'').trim();if(!clean||!state.voiceUnlocked)return false;
    stopAudio();state.lastSpoken=clean;setStatus('Preparando voz…');
    try{
      const response=await fetch('/avatar/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:state.config.id,text:clean,voice_turbine:$('voiceTurbineSel')?.value||state.config.voice?.defaultTurbine})});
      if(!response.ok||!String(response.headers.get('content-type')||'').startsWith('audio/'))throw new Error('remote voice unavailable');
      const blob=await response.blob(),url=URL.createObjectURL(blob),audio=new Audio();state.audio=audio;state.audioUrl=url;audio.preload='auto';audio.src=url;
      return await new Promise((resolve,reject)=>{
        let done=false;const finish=(ok,err)=>{if(done)return;done=true;if(state.audio===audio)state.audio=null;if(state.audioUrl===url)state.audioUrl='';try{URL.revokeObjectURL(url);}catch(_){}stopTalkingVisual();if(ok)resolve(true);else reject(err||new Error('audio failed'));};
        audio.onplay=()=>{state.stats.remoteVoice++;startTalkingVisual();setStatus('Voz remota ativa.');};
        audio.onended=()=>finish(true);audio.onerror=()=>finish(false,new Error('Falha de áudio'));audio.play().catch(e=>finish(false,e));
      });
    }catch(_){setStatus('Usando voz do navegador…');return await speakFallback(clean);}
  }

  async function sendMessage(text){
    const clean=String(text||'').trim();if(!clean||state.busy)return;
    state.busy=true;setMode('processing','Procesando');setStatus('Pensando…');addMessage('user',clean);
    const history=state.history.slice(0,-1).slice(-24);
    try{
      const response=await fetch('/avatar/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:state.config.id,message:clean,level:$('levelSel')?.value||'A1',history})});
      const json=await response.json().catch(()=>({}));if(!response.ok||!json.reply)throw new Error(json.error||'Falha no chat');
      const reply=String(json.reply).trim();state.stats.chatTurns++;addMessage('assistant',reply);state.lastSpoken=reply;setMode('idle','Lista');setStatus('Resposta pronta.');if(state.voiceUnlocked)void speak(reply);
    }catch(e){setMode('idle','Lista');setStatus('Falha ao responder: '+String(e?.message||e));}
    finally{state.busy=false;}
  }

  function selectedSttLanguage(){const v=$('sttLangSel')?.value||'auto';return v==='auto'?'auto':v;}
  async function transcribeBlob(blob){
    setMode('processing','Transcribiendo');setStatus('Transcrevendo áudio…');
    const response=await fetch('/stt',{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream','X-FNS-STT-Language':selectedSttLanguage()},body:blob});
    const json=await response.json().catch(()=>({}));if(!response.ok||!json.text)throw new Error(json.error||'Transcrição vazia');state.stats.sttTurns++;return String(json.text).trim();
  }

  async function stopRecorder(send=true){
    if(state.recorder&&state.recorder.state!=='inactive'){state.recorder.stop();return;}
    if(state.recognition){try{state.recognition.stop();}catch(_){}return;}
    stopListeningVisual();
  }

  async function startMediaRecorder(){
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});state.mediaStream=stream;state.chunks=[];
    const rec=new MediaRecorder(stream);state.recorder=rec;
    rec.ondataavailable=e=>{if(e.data?.size)state.chunks.push(e.data);};
    rec.onstop=async()=>{
      const type=rec.mimeType||'audio/webm',blob=new Blob(state.chunks,{type});state.recorder=null;state.chunks=[];stream.getTracks().forEach(t=>t.stop());state.mediaStream=null;stopListeningVisual();
      if(!blob.size){setStatus('Áudio vazio.');return;}
      try{const text=await transcribeBlob(blob);addMessage('user',text);state.history.pop();await sendMessage(text);}catch(e){setMode('idle','Lista');setStatus('Falha na transcrição: '+String(e?.message||e));}
    };
    rec.start();startListeningVisual();setStatus('Gravando. Clique novamente para enviar.');
  }

  function startBrowserRecognition(){
    const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Ctor)throw new Error('Reconhecimento de voz indisponível.');
    const r=new Ctor();state.recognition=r;r.interimResults=false;r.continuous=false;r.lang=selectedSttLanguage()==='pt'?'pt-BR':selectedSttLanguage()==='es'?'es-ES':state.config.targetLanguage||'es-ES';
    r.onstart=()=>{startListeningVisual();setStatus('Escutando…');};
    r.onresult=e=>{const text=String(e.results?.[0]?.[0]?.transcript||'').trim();if(text)void sendMessage(text);};
    r.onerror=e=>{setStatus('Microfone: '+String(e.error||'erro'));};
    r.onend=()=>{state.recognition=null;stopListeningVisual();};r.start();
  }

  async function toggleMic(){
    if(state.recorder&&state.recorder.state!=='inactive'){await stopRecorder(true);return;}
    if(state.recognition){await stopRecorder(true);return;}
    stopAudio();
    try{if(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder)await startMediaRecorder();else startBrowserRecognition();}
    catch(e){try{startBrowserRecognition();}catch(e2){setStatus('Microfone indisponível: '+String(e2?.message||e2||e));}}
  }

  function bindUi(){
    $('voiceBtn').addEventListener('click',()=>{state.voiceUnlocked=true;$('voiceBtn').textContent='🔊 Voz ativada';void speak(state.lastSpoken||state.config.intro);});
    $('micBtn').addEventListener('click',()=>void toggleMic());
    $('stopBtn').addEventListener('click',()=>{void stopRecorder(false);stopAudio();setStatus('Parado.');});
    $('repeatBtn').addEventListener('click',()=>{state.voiceUnlocked=true;void speak(state.lastSpoken||state.config.intro);});
    $('chatForm').addEventListener('submit',e=>{e.preventDefault();const input=$('chatInput'),text=input.value.trim();if(!text)return;input.value='';void sendMessage(text);});
  }

  async function boot(){
    try{
      state.config=await loadConfig();
      for(const src of Object.values(state.config.images||{})){const img=new Image();img.decoding='sync';img.src=src;}
      render();setMode('idle','Lista');setStatus('Núcleo '+state.config.displayName+' pronto.');
    }catch(e){root.innerHTML='<div class="boot-card">'+escapeHtml(String(e?.message||e))+'<br><br><a class="main-link" href="/">Voltar</a></div>';}
  }

  window.FNS_AVATAR_CORE={
    version:'v11-multicore-20260917',
    get config(){return state.config;},
    speak,
    sendMessage,
    setFrame,
    health(){return {avatar:state.config?.id||avatarId,mode:state.mode,voiceUnlocked:state.voiceUnlocked,frame:$('avatarImage')?.dataset.frame||'',src:$('avatarImage')?.src||'',rootOnly:!!$('avatarApp')&&!document.querySelector('script[src*="app.js"]'),stats:{...state.stats}};}
  };

  void boot();
})();
