/* FNS OLIVIA CORE V6 — isolated DOM island, bilingual PT/ES STT, fast TTS fallback */
(function(){
  'use strict';
  if(window.__FNS_OLIVIA_V6_INSTALLED__)return;
  window.__FNS_OLIVIA_V6_INSTALLED__=true;

  const VERSION='v6-20260917';
  const PARAMS=new URLSearchParams(location.search);
  const DIRECT_MODE=PARAMS.get('olivia')==='v6'||PARAMS.has('olivia');
  const ASSETS=Object.freeze({
    closed:'/assets/olivia-fechada.png?v='+VERSION,
    talking:'/assets/olivia-falando.png?v='+VERSION,
    open:'/assets/olivia-aberta.png?v='+VERSION
  });
  const runtime={
    version:VERSION,directMode:DIRECT_MODE,booted:false,errors:[],repairs:0,
    mic:{attempts:0,lastBlobSize:0,lastEngine:'',lastError:'',lastTranscriptAt:0},
    voice:{remoteAttempts:0,browserFallbacks:0,lastLang:'',lastEngine:'',fallbackLatencyMs:0},
    assets:{closed:false,talking:false,open:false}
  };
  window.FNS_OLIVIA_V6=runtime;

  function remember(where,error){
    const message=String(error?.message||error||'error');
    runtime.errors.push({where,message,at:Date.now()});
    if(runtime.errors.length>16)runtime.errors.shift();
    console.error('[FNS OLIVIA V6]',where,error);
  }

  function isOliviaName(value){return String(value||'').trim().toLowerCase()==='olivia';}
  function isActive(){try{return isOliviaName(activeTeacher?.name)&&!!document.querySelector('#liteModal[data-olivia-v6="true"]');}catch(_){return false;}}
  function indexOfOlivia(){try{const i=teachers.findIndex(t=>isOliviaName(t?.name));return i>=0?i:2;}catch(_){return 2;}}

  function primeTeacher(){
    try{
      const i=indexOfOlivia(),t=teachers[i];
      if(!t)return null;
      t.name='Olivia';
      t.accent='Español para brasileiros';
      t.gender='female';
      t.provider='FNS Lite';
      t.profile='Español • Português de apoio';
      t.language='auto';
      delete t.strict_language;
      return t;
    }catch(e){remember('primeTeacher',e);return null;}
  }

  function intro(){return '¡Hola! Soy Olivia. Soy tu profesora de español. Puedes hablarme en español o en portugués. ¿Cómo te llamas?';}

  Object.entries(ASSETS).forEach(([key,src])=>{
    try{
      const img=new Image();
      img.onload=()=>{runtime.assets[key]=true;};
      img.onerror=()=>remember('asset:'+key,new Error('No se pudo cargar '+src));
      img.src=src;
    }catch(e){remember('preload:'+key,e);}
  });

  let cachedVoices=[];
  function warmVoices(){
    try{cachedVoices=speechSynthesis.getVoices()||[];}catch(_){cachedVoices=[];}
  }
  if('speechSynthesis'in window){
    warmVoices();
    try{speechSynthesis.addEventListener('voiceschanged',warmVoices);}catch(_){speechSynthesis.onvoiceschanged=warmVoices;}
  }

  function roomMarkup(level='A1',mode='conversation'){
    const options=levels.map(x=>`<option ${x===level?'selected':''}>${x}</option>`).join('');
    return `<div class="modal olivia-v6-modal" id="liteModal" data-olivia-v6="true">
      <div class="room olivia-v6-room">
        <button class="close" type="button" onclick="window.FNS_OLIVIA_V6.closeRoom()">Encerrar</button>
        <div class="row"><h2 style="margin-right:auto">Olivia • Español</h2><span class="status"><i id="statusDot" class="dot on"></i><span id="statusText">Lista</span></span></div>
        <div class="chat-shell">
          <div class="avatar-stage olivia-v6-stage" data-olivia-island-host="true">
            <div id="oliviaAvatarIsland" class="olivia-avatar-island" data-state="closed" aria-label="Olivia, profesora virtual">
              <img id="oliviaAvatarImage" class="olivia-avatar-image" src="${ASSETS.closed}" alt="Olivia, profesora virtual" loading="eager" decoding="sync">
              <div class="olivia-live-badge">● LIVE</div>
            </div>
            <div class="avatar-label olivia-v6-label"><b>Olivia</b><br><span class="small">Español • Português de apoio • FNS Lite</span><br><span class="small">🇪🇸 foco em espanhol • 🇧🇷 português para explicações e correções</span></div>
          </div>
          <div class="chat-panel">
            <div class="row">
              <select id="levelSel" style="width:auto">${options}</select>
              <select id="modeSel" style="width:auto"><option value="conversation">Conversation</option><option value="drill">Drill</option><option value="lesson">Lesson</option><option value="pronunciation">Pronunciation</option><option value="review">Review</option></select>
              <select id="sttLangSel" style="width:auto" title="Idioma do microfone da Olivia"><option value="auto" selected>🇧🇷 PT + 🇪🇸 ES • Auto</option><option value="es-ES">🇪🇸 Español</option><option value="pt-BR">🇧🇷 Português</option></select>
            </div>
            <div id="transcript" class="transcript"><div class="msg system">Olivia entende espanhol e português. O microfone detecta automaticamente os dois idiomas.</div><div class="msg teacher" data-olivia-v6-intro="true">${intro()}</div></div>
            <div class="row" style="margin-top:10px"><button id="micBtn" class="good" type="button" onclick="window.FNS_OLIVIA_V6.toggleMic()">🎤 Hablar / Falar</button><button type="button" onclick="window.FNS_OLIVIA_V6.stopMic()">Parar</button><button id="voiceBtn" class="primary" type="button" onclick="window.FNS_OLIVIA_V6.unlockVoice()">🔊 Activar voz</button><button type="button" onclick="window.FNS_OLIVIA_V6.repeat()">🔁 Repetir</button><button id="handsBtn" type="button" onclick="window.FNS_OLIVIA_V6.toggleHands()">🎧 Contínuo OFF</button></div>
            <div class="row"><input id="chatInput" placeholder="Escribe en español o português..." onkeydown="if(event.key==='Enter')sendTyped()"><button id="sendBtn" class="primary" onclick="sendTyped()">Enviar</button></div>
            <div class="small muted conversation-hint">Fale em espanhol ou português. Olivia responde principalmente em espanhol e usa português quando isso ajuda a ensinar.</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function removeForeignVisuals(stage){
    if(!stage)return;
    stage.querySelectorAll('#avatarFace,.human-avatar,.avatar-loading,.loading,.loader,.avatar-overlay,.loading-overlay,.avatar-loading-overlay,[data-loading-overlay],canvas,video').forEach(n=>{
      if(n.id==='oliviaAvatarIsland'||n.closest?.('#oliviaAvatarIsland'))return;
      n.remove();
    });
  }

  function ensureIsland(reason='watchdog'){
    if(!isActive())return null;
    const modal=document.querySelector('#liteModal[data-olivia-v6="true"]');
    const stage=modal?.querySelector('[data-olivia-island-host="true"]');
    if(!stage)return null;
    removeForeignVisuals(stage);
    let island=stage.querySelector('#oliviaAvatarIsland');
    if(!island){
      const label=stage.querySelector('.avatar-label');
      const holder=document.createElement('div');
      holder.innerHTML=`<div id="oliviaAvatarIsland" class="olivia-avatar-island" data-state="closed"><img id="oliviaAvatarImage" class="olivia-avatar-image" src="${ASSETS.closed}" alt="Olivia, profesora virtual" loading="eager" decoding="sync"><div class="olivia-live-badge">● LIVE</div></div>`;
      island=holder.firstElementChild;
      stage.insertBefore(island,label||stage.firstChild);
      runtime.repairs++;
    }
    const img=island.querySelector('#oliviaAvatarImage');
    if(img&&!/olivia-(fechada|falando|aberta)\.png/.test(img.src)){
      img.src=ASSETS.closed;
      runtime.repairs++;
    }
    island.dataset.lastGuard=reason;
    return island;
  }

  function setFrame(state){
    const island=ensureIsland('frame:'+state);
    if(!island)return;
    const img=island.querySelector('#oliviaAvatarImage');
    const src=ASSETS[state]||ASSETS.closed;
    island.dataset.state=state;
    if(img&&!img.src.includes(src.split('?')[0]))img.src=src;
  }

  let mouthTimer=null,mouthStep=0;
  function stopMouth(){clearInterval(mouthTimer);mouthTimer=null;mouthStep=0;if(isActive())setFrame('closed');}
  function startMouth(){
    if(mouthTimer)return;
    const seq=['talking','open','talking','open','talking'];
    mouthTimer=setInterval(()=>{if(!isActive()){stopMouth();return;}setFrame(seq[(mouthStep++)%seq.length]);},130);
  }
  function syncVisual(){
    if(!isActive())return;
    try{
      if(flowState===FLOW_STATES.SPEAKING||isSpeaking)startMouth();
      else{clearInterval(mouthTimer);mouthTimer=null;mouthStep=0;setFrame('closed');}
    }catch(_){setFrame('closed');}
  }

  function openRoom(i,level='A1',mode='conversation',topic='General conversation'){
    primeTeacher();
    try{
      stopRecognition?.();
      stopRemoteVoice?.();
    }catch(_){}
    document.querySelector('#liteModal')?.remove();
    activeTeacher={...teachers[i],i,level,mode,topic,name:'Olivia',accent:'Español para brasileiros',language:'auto'};
    document.body.insertAdjacentHTML('beforeend',roomMarkup(level,mode));
    const modeSel=document.querySelector('#modeSel');if(modeSel)modeSel.value=mode;
    try{setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}
    try{lastSpoken=intro();}catch(_){}
    runtime.booted=true;
    ensureIsland('open-room');
    syncControls();
    if(voiceUnlocked)setTimeout(()=>{if(isActive())void remoteSpeak(intro());},60);
    return true;
  }

  function syncControls(){
    if(!isActive())return;
    const mic=document.querySelector('#micBtn');
    const voice=document.querySelector('#voiceBtn');
    const hands=document.querySelector('#handsBtn');
    try{
      if(mic){
        mic.disabled=!!(isProcessing||isSpeaking);
        if(isSpeaking)mic.textContent='🔊 Olivia hablando';
        else if(isProcessing)mic.textContent='⏳ Procesando';
        else if(isRecording)mic.textContent=listeningEngine==='browser'?'⏹ Parar':'⏹ Enviar voz';
        else mic.textContent=browserSttPreferred?'🎤 Hablar / Falar (navegador)':'🎤 Hablar / Falar';
      }
      if(voice)voice.textContent=voiceUnlocked?'🔊 Voz activada':'🔊 Activar voz';
      if(hands&&window.FNSNatural)hands.textContent=FNSNatural.handsFree?'🎧 Contínuo ON':'🎧 Contínuo OFF';
    }catch(_){}
  }

  function recentUserText(){
    try{return readBrowserMemory().filter(x=>x.role==='user').slice(-5).map(x=>x.content).join(' ').toLowerCase();}catch(_){return '';}
  }
  function browserLanguage(){
    const select=document.querySelector('#sttLangSel');
    const chosen=select?.value||'auto';
    if(chosen==='es-ES'||chosen==='pt-BR')return chosen;
    const recent=recentUserText();
    if(/[ãõç]|\b(você|voce|não|nao|obrigado|obrigada|português|portugues|quero|preciso|explique|diferença|diferenca)\b/i.test(recent))return'pt-BR';
    if(/[ñ¿¡]|\b(hola|usted|gracias|español|espanol|quiero|necesito|puede|cómo|como estás)\b/i.test(recent))return'es-ES';
    const nav=String(navigator.language||'').toLowerCase();
    if(nav.startsWith('pt'))return'pt-BR';
    if(nav.startsWith('es'))return'es-ES';
    return'es-ES';
  }

  function detectSpeechLanguage(text){
    const s=String(text||'').toLowerCase();
    let pt=0,es=0;
    if(/[ãõç]/u.test(s))pt+=4;
    if(/[ñ¿¡]/u.test(s))es+=4;
    for(const w of s.match(/\p{L}+/gu)||[]){
      if(['você','voce','não','nao','português','portugues','obrigado','obrigada','também','tambem','estou','quero','preciso','explique','diferença','diferenca','uma','meu','minha'].includes(w))pt++;
      if(['usted','tú','tu','español','espanol','gracias','también','tambien','estoy','quiero','necesito','explique','una','hoy','ahora'].includes(w))es++;
    }
    return pt>es?'pt-BR':'es-ES';
  }

  function pickVoice(lang){
    warmVoices();
    const primary=lang.toLowerCase().split('-')[0];
    return cachedVoices.find(v=>String(v.lang||'').toLowerCase()===lang.toLowerCase())||cachedVoices.find(v=>String(v.lang||'').toLowerCase().startsWith(primary+'-'))||null;
  }

  function scheduleHandsFree(){
    try{
      if(!window.FNSNatural?.handsFree||!isActive())return;
      clearTimeout(FNSNatural.handsTimer);
      FNSNatural.handsTimer=setTimeout(()=>{if(FNSNatural.handsFree&&isActive()&&!recognizing)startRecording();},450);
    }catch(_){}
  }

  let fallbackUtterance=null;
  async function browserSpeak(text){
    const clean=String(text||'').trim();
    if(!clean||!('speechSynthesis'in window)||typeof SpeechSynthesisUtterance==='undefined')return false;
    const started=performance.now();
    return await new Promise(resolve=>{
      let done=false;
      const finish=ok=>{
        if(done)return;done=true;stopMouth();fallbackUtterance=null;
        try{setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}
        syncControls();if(ok)scheduleHandsFree();resolve(ok);
      };
      try{
        speechSynthesis.cancel();
        const lang=detectSpeechLanguage(clean),u=new SpeechSynthesisUtterance(clean),voice=pickVoice(lang);
        fallbackUtterance=u;if(voice)u.voice=voice;u.lang=voice?.lang||lang;u.rate=.97;u.pitch=1;u.volume=1;
        runtime.voice.browserFallbacks++;runtime.voice.lastLang=u.lang;runtime.voice.lastEngine='browser';
        u.onstart=()=>{runtime.voice.fallbackLatencyMs=Math.round(performance.now()-started);try{setFlowState(FLOW_STATES.SPEAKING,{force:true,status:'Olivia hablando'});}catch(_){}startMouth();syncControls();};
        u.onend=()=>finish(true);u.onerror=()=>finish(false);speechSynthesis.speak(u);
      }catch(e){remember('browserSpeak',e);finish(false);}
    });
  }

  function clearAudio(){
    const audio=currentVoiceAudio,url=currentVoiceUrl;
    currentVoiceAudio=null;currentVoiceUrl='';
    if(audio){try{audio.pause();audio.src='';}catch(_){};audio.onplay=null;audio.onended=null;audio.onerror=null;}
    if(url){try{URL.revokeObjectURL(url);}catch(_){}}
    stopMouth();
  }

  async function playRemote(response,text,session){
    const blob=await response.blob();
    if(session!==speechSessionSeq||!blob.size)return false;
    const url=URL.createObjectURL(blob),audio=new Audio();
    audio.crossOrigin='anonymous';audio.preload='auto';audio.src=url;currentVoiceAudio=audio;currentVoiceUrl=url;
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(ok,error)=>{
        if(settled)return;settled=true;
        audio.onplay=null;audio.onended=null;audio.onerror=null;
        if(currentVoiceAudio===audio)currentVoiceAudio=null;if(currentVoiceUrl===url)currentVoiceUrl='';
        try{URL.revokeObjectURL(url);}catch(_){};stopMouth();
        try{setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}syncControls();
        if(ok){scheduleHandsFree();resolve(true);}else reject(error||new Error('Falha ao reproduzir voz'));
      };
      audio.onplay=()=>{if(session!==speechSessionSeq)return finish(false,new Error('voz cancelada'));try{setFlowState(FLOW_STATES.SPEAKING,{force:true,status:'Olivia hablando'});}catch(_){}startMouth();syncControls();};
      audio.onended=()=>finish(true);audio.onerror=()=>finish(false,new Error('Falha de áudio'));
      audio.play().catch(e=>finish(false,e));
    });
  }

  async function oliviaRemoteSpeak(text){
    const clean=String(text||'').trim();if(!clean)return false;lastSpoken=clean;
    if(!voiceUnlocked){try{if(flowState===FLOW_STATES.PROCESSING)setFlowState(FLOW_STATES.IDLE,{force:true,status:'Activa la voz'});}catch(_){}syncControls();return false;}
    const session=++speechSessionSeq;runtime.voice.remoteAttempts++;
    clearAudio();
    try{setFlowState(FLOW_STATES.PROCESSING,{force:true,status:'Preparando voz'});}catch(_){}
    syncControls();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort('olivia-v6-fast-fallback'),1500);
    try{
      const response=await fetch(FNS_TTS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean,teacher:'Olivia'}),signal:controller.signal});
      clearTimeout(timer);
      const contentType=String(response.headers.get('content-type')||'');
      const voiceLang=String(response.headers.get('x-fns-voice-language')||'').toLowerCase();
      if(!response.ok||!contentType.startsWith('audio/')||(voiceLang&&voiceLang.startsWith('en')))throw new Error('remote-tts-not-usable');
      runtime.voice.lastEngine=String(response.headers.get('x-fns-voice-engine')||'remote');runtime.voice.lastLang=voiceLang||detectSpeechLanguage(clean);
      return await playRemote(response,clean,session);
    }catch(e){
      clearTimeout(timer);
      if(session!==speechSessionSeq)return false;
      runtime.voice.lastEngine='browser-fallback';
      return await browserSpeak(clean);
    }
  }

  const innerOpenLiteTeacher=openLiteTeacher;
  openLiteTeacher=function(i,level='A1',mode='conversation',topic='General conversation'){
    const target=teachers?.[i];
    if(!isOliviaName(target?.name))return innerOpenLiteTeacher(i,level,mode,topic);
    return openRoom(i,level,mode,topic);
  };

  const innerSelectedSttLanguage=selectedSttLanguage;
  selectedSttLanguage=function(){
    if(!isActive())return innerSelectedSttLanguage();
    return document.querySelector('#sttLangSel')?.value||'auto';
  };

  const innerInferBrowserSttLanguage=inferBrowserSttLanguage;
  inferBrowserSttLanguage=function(){return isActive()?browserLanguage():innerInferBrowserSttLanguage();};

  const innerRefreshFlowControls=refreshFlowControls;
  refreshFlowControls=function(...args){const out=innerRefreshFlowControls(...args);if(isActive())queueMicrotask(()=>{syncControls();syncVisual();});return out;};

  const innerSetFlowState=setFlowState;
  setFlowState=function(...args){const out=innerSetFlowState(...args);if(isActive())queueMicrotask(()=>{syncVisual();syncControls();});return out;};

  const innerStartRecording=startRecording;
  startRecording=async function(...args){
    if(!isActive())return await innerStartRecording(...args);
    runtime.mic.attempts++;runtime.mic.lastError='';runtime.mic.lastEngine='starting';
    try{
      const out=await innerStartRecording(...args);
      runtime.mic.lastEngine=listeningEngine||'media';syncControls();
      setTimeout(()=>{
        if(!isActive())return;
        try{
          if(flowState===FLOW_STATES.IDLE&&!isProcessing&&!isSpeaking&&!browserFallbackActive&&typeof startBrowserFallbackOnce==='function'){
            runtime.mic.lastEngine='browser-watchdog';startBrowserFallbackOnce('Olivia v6 fallback automático');
          }
        }catch(e){remember('micWatchdog',e);}
      },900);
      return out;
    }catch(e){
      runtime.mic.lastError=String(e?.message||e);remember('startRecording',e);
      try{if(typeof startBrowserFallbackOnce==='function')return startBrowserFallbackOnce('Olivia v6 recuperação do microfone');}catch(_){}
      return false;
    }
  };

  try{
    const innerTranscribe=transcribeWithFNS;
    transcribeWithFNS=async function(blob){
      if(isActive())runtime.mic.lastBlobSize=Number(blob?.size||0);
      const out=await innerTranscribe(blob);
      if(isActive())runtime.mic.lastTranscriptAt=Date.now();
      return out;
    };
  }catch(e){remember('wrapTranscribe',e);}

  const previousFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    if(!isActive())return previousFetch(input,init);
    let url='';try{url=new URL(typeof input==='string'?input:input.url,location.href).href;}catch(_){return previousFetch(input,init);}
    const method=String(init?.method||(typeof input!=='string'?input?.method:'')||'GET').toUpperCase();
    let patched=init;
    try{
      if(method==='POST'&&/\/stt(?:\?|$)/.test(url)){
        const headers=new Headers(init?.headers||{});headers.set('X-FNS-STT-Language',selectedSttLanguage());patched={...init,headers};runtime.mic.lastEngine='remote-whisper';
      }
      if(method==='POST'&&/\/chat(?:\?|$)/.test(url)&&typeof init?.body==='string'){
        const body=JSON.parse(init.body||'{}');body.teacher='Olivia';body.accent='Español para brasileiros';body.input_language=selectedSttLanguage();body.input_language_label='Português/Español';body.strict_language='';body.strict_language_enabled=false;body.pedagogical_bilingual=true;patched={...init,body:JSON.stringify(body)};
      }
      if(method==='POST'&&/\/tts(?:\?|$)/.test(url)&&typeof init?.body==='string'){
        const body=JSON.parse(init.body||'{}');body.teacher='Olivia';delete body.language;delete body.tts_language;patched={...init,body:JSON.stringify(body)};
      }
    }catch(e){remember('fetchPatch',e);}
    return previousFetch(input,patched);
  };

  const innerRemoteSpeak=remoteSpeak;
  remoteSpeak=async function(text){return isActive()?await oliviaRemoteSpeak(text):await innerRemoteSpeak(text);};

  const innerStopRemoteVoice=stopRemoteVoice;
  stopRemoteVoice=function(...args){
    if(!isActive())return innerStopRemoteVoice(...args);
    speechSessionSeq++;try{speechSynthesis.cancel();}catch(_){}fallbackUtterance=null;clearAudio();
    try{if(flowState!==FLOW_STATES.IDLE)setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}syncControls();return true;
  };

  const innerUnlockVoice=unlockVoice;
  unlockVoice=async function(...args){
    if(!isActive())return await innerUnlockVoice(...args);
    voiceUnlocked=true;lastSpoken=String(lastSpoken||'').trim()||intro();syncControls();return await oliviaRemoteSpeak(lastSpoken);
  };

  try{
    const innerUnlockAndRepeat=unlockAndRepeat;
    unlockAndRepeat=async function(...args){if(!isActive())return await innerUnlockAndRepeat(...args);voiceUnlocked=true;syncControls();return await oliviaRemoteSpeak(String(lastSpoken||'').trim()||intro());};
  }catch(e){remember('wrapRepeat',e);}

  runtime.toggleMic=async function(){try{return await toggleRecognition();}catch(e){remember('toggleMic',e);return false;}};
  runtime.stopMic=function(){try{return stopRecognition();}catch(e){remember('stopMic',e);return false;}};
  runtime.unlockVoice=async function(){return await unlockVoice();};
  runtime.repeat=async function(){try{return await unlockAndRepeat();}catch(_){voiceUnlocked=true;return await oliviaRemoteSpeak(lastSpoken||intro());}};
  runtime.toggleHands=function(){try{toggleHandsFree();syncControls();}catch(e){remember('toggleHands',e);}};
  runtime.closeRoom=function(){try{stopRecognition();stopRemoteVoice();if(window.FNSNatural){FNSNatural.handsFree=false;clearTimeout(FNSNatural.handsTimer);}document.querySelector('#liteModal')?.remove();activeTeacher=null;}catch(e){remember('closeRoom',e);}};

  const observer=new MutationObserver(()=>{if(isActive())requestAnimationFrame(()=>ensureIsland('mutation'));});
  observer.observe(document.body,{childList:true,subtree:true});

  runtime.health=function(){
    const modal=document.querySelector('#liteModal[data-olivia-v6="true"]'),stage=modal?.querySelector('[data-olivia-island-host="true"]'),island=stage?.querySelector('#oliviaAvatarIsland'),img=island?.querySelector('#oliviaAvatarImage');
    const ir=island?.getBoundingClientRect(),xr=img?.getBoundingClientRect(),ic=island?getComputedStyle(island):null,xc=img?getComputedStyle(img):null;
    return {version:VERSION,active:isActive(),booted:runtime.booted,modal:!!modal,stage:!!stage,island:!!island,noGlobalAvatar:!modal?.querySelector('#avatarFace'),image:!!img,imageLoaded:!!(img?.complete&&img?.naturalWidth>0),src:img?.src||'',state:island?.dataset.state||'',islandDisplay:ic?.display||'',islandVisibility:ic?.visibility||'',islandOpacity:ic?.opacity||'',imageDisplay:xc?.display||'',imageVisibility:xc?.visibility||'',imageOpacity:xc?.opacity||'',islandRect:ir?{width:ir.width,height:ir.height}:null,imageRect:xr?{width:xr.width,height:xr.height}:null,stt:selectedSttLanguage(),browserLang:browserLanguage(),mic:{...runtime.mic},voice:{...runtime.voice},assets:{...runtime.assets},repairs:runtime.repairs,errors:runtime.errors.slice(-8)};
  };

  function directBoot(){
    if(!DIRECT_MODE)return;
    try{primeTeacher();if(typeof live==='function')live();openLiteTeacher(indexOfOlivia(),'A1','conversation','General conversation');}catch(e){remember('directBoot',e);}
  }
  if(document.readyState==='complete')setTimeout(directBoot,0);else window.addEventListener('load',()=>setTimeout(directBoot,0),{once:true});
})();
