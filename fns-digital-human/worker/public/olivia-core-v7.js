/* FNS OLIVIA CORE V7 — body portal + 15 isolated TTS turbines A-O */
(function(){
  'use strict';
  if(window.__FNS_OLIVIA_V7_INSTALLED__)return;
  window.__FNS_OLIVIA_V7_INSTALLED__=true;

  const VERSION='v7-20260917';
  const PARAMS=new URLSearchParams(location.search);
  const DIRECT_MODE=PARAMS.get('olivia')==='v7';
  const ASSETS=Object.freeze({
    closed:'/assets/olivia-fechada.png?v='+VERSION,
    talking:'/assets/olivia-falando.png?v='+VERSION,
    open:'/assets/olivia-aberta.png?v='+VERSION
  });
  const TURBINES=Object.freeze({
    A:{label:'A • España • Néstor ♂',locale:'es-ES',speaker:'nestor',tier:'regional'},
    B:{label:'B • España • Carina ♀',locale:'es-ES',speaker:'carina',tier:'regional'},
    C:{label:'C • México • Sirio ♂',locale:'es-MX',speaker:'sirio',tier:'regional'},
    D:{label:'D • México • Estrella ♀',locale:'es-MX',speaker:'estrella',tier:'regional'},
    E:{label:'E • México • Javier ♂',locale:'es-MX',speaker:'javier',tier:'regional'},
    F:{label:'F • Colombia • Celeste ♀',locale:'es-CO',speaker:'celeste',tier:'regional'},
    G:{label:'G • Latinoamérica • Aquila ♂',locale:'es-419',speaker:'aquila',tier:'regional'},
    H:{label:'H • Latinoamérica • Selena ♀',locale:'es-419',speaker:'selena',tier:'regional'},
    I:{label:'I • España • Álvaro ♂',locale:'es-ES',speaker:'alvaro',tier:'regional'},
    J:{label:'J • España • Diana ♀',locale:'es-ES',speaker:'diana',tier:'regional'},
    K:{label:'K • Hi-Fi lossless • Colombia • Celeste ♀',locale:'es-CO',speaker:'celeste',tier:'hifi'},
    L:{label:'L • Hi-Fi lossless • México • Estrella ♀',locale:'es-MX',speaker:'estrella',tier:'hifi'},
    M:{label:'M • Hi-Fi lossless • España • Néstor ♂',locale:'es-ES',speaker:'nestor',tier:'hifi'},
    N:{label:'N • Hi-Fi lossless • España • Diana ♀',locale:'es-ES',speaker:'diana',tier:'hifi'},
    O:{label:'O • Hi-Fi lossless • Latinoamérica • Selena ♀',locale:'es-419',speaker:'selena',tier:'hifi'}
  });

  const runtime={
    version:VERSION,directMode:DIRECT_MODE,booted:false,errors:[],portalCreates:0,portalPositions:0,
    mic:{attempts:0,lastBlobSize:0,lastEngine:'',lastError:'',lastTranscriptAt:0},
    voice:{turbine:'K',remoteAttempts:0,browserFallbacks:0,lastLang:'',lastEngine:'',fallbackLatencyMs:0,lastSpeaker:'',lastTier:''},
    assets:{closed:false,talking:false,open:false},turbines:TURBINES
  };
  window.FNS_OLIVIA_V7=runtime;

  function remember(where,error){
    const message=String(error?.message||error||'error');
    runtime.errors.push({where,message,at:Date.now()});
    if(runtime.errors.length>16)runtime.errors.shift();
    console.error('[FNS OLIVIA V7]',where,error);
  }
  function isOliviaName(value){return String(value||'').trim().toLowerCase()==='olivia';}
  function isActive(){try{return isOliviaName(activeTeacher?.name)&&!!document.querySelector('#liteModal[data-olivia-v7="true"]');}catch(_){return false;}}
  function indexOfOlivia(){try{const i=teachers.findIndex(t=>isOliviaName(t?.name));return i>=0?i:2;}catch(_){return 2;}}
  function selectedTurbine(){const v=String(document.querySelector('#voiceTurbineSel')?.value||runtime.voice.turbine||'K').toUpperCase();return TURBINES[v]?v:'K';}
  function selectedTurbineConfig(){return TURBINES[selectedTurbine()]||TURBINES.K;}

  function primeTeacher(){
    try{
      const i=indexOfOlivia(),t=teachers[i];
      if(!t)return null;
      t.name='Olivia';t.accent='Español para brasileiros';t.gender='female';t.provider='FNS Lite';
      t.profile='Español • Português de apoio • 15 turbinas';t.language='auto';delete t.strict_language;return t;
    }catch(e){remember('primeTeacher',e);return null;}
  }
  function intro(){return '¡Hola! Soy Olivia. Soy tu profesora de español. Puedes hablarme en español o en portugués. ¿Cómo te llamas?';}

  Object.entries(ASSETS).forEach(([key,src])=>{
    try{const img=new Image();img.onload=()=>{runtime.assets[key]=true;};img.onerror=()=>remember('asset:'+key,new Error('No se pudo cargar '+src));img.src=src;}catch(e){remember('preload:'+key,e);}
  });

  let cachedVoices=[];
  function warmVoices(){try{cachedVoices=speechSynthesis.getVoices()||[];}catch(_){cachedVoices=[];}}
  if('speechSynthesis'in window){warmVoices();try{speechSynthesis.addEventListener('voiceschanged',warmVoices);}catch(_){speechSynthesis.onvoiceschanged=warmVoices;}}

  function turbineOptions(){return Object.entries(TURBINES).map(([k,c])=>`<option value="${k}" ${k==='K'?'selected':''}>${c.label}</option>`).join('');}
  function roomMarkup(level='A1',mode='conversation'){
    const options=levels.map(x=>`<option ${x===level?'selected':''}>${x}</option>`).join('');
    return `<div class="modal olivia-v7-modal" id="liteModal" data-olivia-v7="true">
      <div class="room olivia-v7-room">
        <button class="close" type="button" onclick="window.FNS_OLIVIA_V7.closeRoom()">Encerrar</button>
        <div class="row"><h2 style="margin-right:auto">Olivia • Español • V7</h2><span class="status"><i id="statusDot" class="dot on"></i><span id="statusText">Lista</span></span></div>
        <div class="chat-shell">
          <div class="olivia-v7-stage" id="oliviaV7Stage" aria-label="Área visual da Olivia"><div class="olivia-v7-anchor" aria-hidden="true"></div></div>
          <div class="chat-panel">
            <div class="row">
              <select id="levelSel" style="width:auto">${options}</select>
              <select id="modeSel" style="width:auto"><option value="conversation">Conversation</option><option value="drill">Drill</option><option value="lesson">Lesson</option><option value="pronunciation">Pronunciation</option><option value="review">Review</option></select>
              <select id="sttLangSel" style="width:auto" title="Idioma do microfone da Olivia"><option value="auto" selected>🇧🇷 PT + 🇪🇸 ES • Auto</option><option value="es-ES">🇪🇸 Español</option><option value="pt-BR">🇧🇷 Português</option></select>
            </div>
            <div class="row"><select id="voiceTurbineSel" title="Turbina de voz exclusiva da Olivia" onchange="window.FNS_OLIVIA_V7.setTurbine(this.value)">${turbineOptions()}</select></div>
            <div class="small muted olivia-v7-voice-note">A–J: perfis regionais • K–O: Aura-2 lossless Hi-Fi • fallback rápido para a voz do navegador.</div>
            <div id="transcript" class="transcript"><div class="msg system">Olivia entende espanhol e português. O microfone detecta automaticamente os dois idiomas.</div><div class="msg teacher" data-olivia-v7-intro="true">${intro()}</div></div>
            <div class="row" style="margin-top:10px"><button id="micBtn" class="good" type="button" onclick="window.FNS_OLIVIA_V7.toggleMic()">🎤 Hablar / Falar</button><button type="button" onclick="window.FNS_OLIVIA_V7.stopMic()">Parar</button><button id="voiceBtn" class="primary" type="button" onclick="window.FNS_OLIVIA_V7.unlockVoice()">🔊 Activar voz</button><button type="button" onclick="window.FNS_OLIVIA_V7.repeat()">🔁 Repetir</button><button id="handsBtn" type="button" onclick="window.FNS_OLIVIA_V7.toggleHands()">🎧 Contínuo OFF</button></div>
            <div class="row"><input id="chatInput" placeholder="Escribe en español o português..." onkeydown="if(event.key==='Enter')sendTyped()"><button id="sendBtn" class="primary" onclick="sendTyped()">Enviar</button></div>
            <div class="small muted conversation-hint">Fale em espanhol ou português. Olivia responde principalmente em espanhol e usa português quando isso ajuda a ensinar.</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function portal(){return document.getElementById('oliviaAvatarPortalV7');}
  function removePortal(){portal()?.remove();}
  function createPortal(){
    if(!isActive())return null;
    let p=portal();if(p)return p;
    p=document.createElement('div');p.id='oliviaAvatarPortalV7';p.dataset.state='closed';p.dataset.owner='body-v7';
    p.innerHTML=`<img id="oliviaAvatarImageV7" class="olivia-avatar-image-v7" src="${ASSETS.closed}" alt="Olivia, profesora virtual" loading="eager" decoding="sync"><div class="olivia-live-badge-v7">● LIVE</div><div class="olivia-portal-label-v7"><b>Olivia</b><br><span>Español • Português de apoio • 15 turbinas A–O</span></div>`;
    document.body.appendChild(p);runtime.portalCreates++;positionPortal();return p;
  }
  function positionPortal(){
    if(!isActive())return;
    const p=portal()||createPortal(),stage=document.getElementById('oliviaV7Stage');
    if(!p||!stage)return;
    const r=stage.getBoundingClientRect();
    if(r.width<20||r.height<20){p.style.visibility='hidden';return;}
    p.style.visibility='visible';p.style.left=Math.round(r.left)+'px';p.style.top=Math.round(r.top)+'px';p.style.width=Math.round(r.width)+'px';p.style.height=Math.round(r.height)+'px';runtime.portalPositions++;
  }
  let portalRaf=0;
  function queuePortalPosition(){cancelAnimationFrame(portalRaf);portalRaf=requestAnimationFrame(positionPortal);}
  window.addEventListener('resize',queuePortalPosition,{passive:true});
  window.addEventListener('scroll',queuePortalPosition,{passive:true,capture:true});

  function setFrame(state){
    const p=portal()||createPortal();if(!p)return;
    const img=p.querySelector('#oliviaAvatarImageV7'),src=ASSETS[state]||ASSETS.closed;p.dataset.state=state;
    if(img&&!img.src.includes(src.split('?')[0]))img.src=src;
  }
  let mouthTimer=null,mouthStep=0;
  function stopMouth(){clearInterval(mouthTimer);mouthTimer=null;mouthStep=0;if(isActive())setFrame('closed');}
  function startMouth(){if(mouthTimer)return;const seq=['talking','open','talking','open','talking'];mouthTimer=setInterval(()=>{if(!isActive()){stopMouth();return;}setFrame(seq[(mouthStep++)%seq.length]);},130);}
  function syncVisual(){if(!isActive())return;try{if(flowState===FLOW_STATES.SPEAKING||isSpeaking)startMouth();else{clearInterval(mouthTimer);mouthTimer=null;mouthStep=0;setFrame('closed');}}catch(_){setFrame('closed');}}

  function openRoom(i,level='A1',mode='conversation',topic='General conversation'){
    primeTeacher();try{stopRecognition?.();stopRemoteVoice?.();}catch(_){}
    removePortal();document.querySelector('#liteModal')?.remove();
    activeTeacher={...teachers[i],i,level,mode,topic,name:'Olivia',accent:'Español para brasileiros',language:'auto'};
    document.body.insertAdjacentHTML('beforeend',roomMarkup(level,mode));
    const modeSel=document.querySelector('#modeSel');if(modeSel)modeSel.value=mode;
    try{setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}
    try{lastSpoken=intro();}catch(_){}
    runtime.booted=true;runtime.voice.turbine='K';createPortal();queuePortalPosition();syncControls();
    setTimeout(queuePortalPosition,80);setTimeout(queuePortalPosition,320);
    if(voiceUnlocked)setTimeout(()=>{if(isActive())void remoteSpeak(intro());},80);
    return true;
  }

  function syncControls(){
    if(!isActive())return;
    const mic=document.querySelector('#micBtn'),voice=document.querySelector('#voiceBtn'),hands=document.querySelector('#handsBtn');
    try{
      if(mic){mic.disabled=!!(isProcessing||isSpeaking);if(isSpeaking)mic.textContent='🔊 Olivia hablando';else if(isProcessing)mic.textContent='⏳ Procesando';else if(isRecording)mic.textContent=listeningEngine==='browser'?'⏹ Parar':'⏹ Enviar voz';else mic.textContent=browserSttPreferred?'🎤 Hablar / Falar (navegador)':'🎤 Hablar / Falar';}
      if(voice)voice.textContent=voiceUnlocked?'🔊 Voz activada':'🔊 Activar voz';
      if(hands&&window.FNSNatural)hands.textContent=FNSNatural.handsFree?'🎧 Contínuo ON':'🎧 Contínuo OFF';
      const sel=document.querySelector('#voiceTurbineSel');if(sel&&sel.value!==runtime.voice.turbine)runtime.voice.turbine=sel.value;
      queuePortalPosition();
    }catch(_){}
  }

  function recentUserText(){try{return readBrowserMemory().filter(x=>x.role==='user').slice(-5).map(x=>x.content).join(' ').toLowerCase();}catch(_){return '';}}
  function browserLanguage(){
    const select=document.querySelector('#sttLangSel'),chosen=select?.value||'auto';if(chosen==='es-ES'||chosen==='pt-BR')return chosen;
    const recent=recentUserText();if(/[ãõç]|\b(você|voce|não|nao|obrigado|obrigada|português|portugues|quero|preciso|explique|diferença|diferenca)\b/i.test(recent))return'pt-BR';
    if(/[ñ¿¡]|\b(hola|usted|gracias|español|espanol|quiero|necesito|puede|cómo|como estás)\b/i.test(recent))return'es-ES';
    const nav=String(navigator.language||'').toLowerCase();if(nav.startsWith('pt'))return'pt-BR';if(nav.startsWith('es'))return'es-ES';return'es-ES';
  }
  function detectSpeechLanguage(text){
    const s=String(text||'').toLowerCase();let pt=0,es=0;if(/[ãõç]/u.test(s))pt+=4;if(/[ñ¿¡]/u.test(s))es+=4;
    for(const w of s.match(/\p{L}+/gu)||[]){if(['você','voce','não','nao','português','portugues','obrigado','obrigada','também','tambem','estou','quero','preciso','explique','diferença','diferenca','uma','meu','minha'].includes(w))pt++;if(['usted','tú','tu','español','espanol','gracias','también','tambien','estoy','quiero','necesito','una','hoy','ahora'].includes(w))es++;}
    return pt>es?'pt-BR':'es';
  }
  function browserVoiceLocale(text){return detectSpeechLanguage(text)==='pt-BR'?'pt-BR':selectedTurbineConfig().locale;}
  function pickVoice(lang){
    warmVoices();const wanted=String(lang||'es-ES').toLowerCase(),primary=wanted.split('-')[0];
    return cachedVoices.find(v=>String(v.lang||'').toLowerCase()===wanted)||cachedVoices.find(v=>String(v.lang||'').toLowerCase().startsWith(primary+'-'))||null;
  }

  function scheduleHandsFree(){try{if(!window.FNSNatural?.handsFree||!isActive())return;clearTimeout(FNSNatural.handsTimer);FNSNatural.handsTimer=setTimeout(()=>{if(FNSNatural.handsFree&&isActive()&&!recognizing)startRecording();},450);}catch(_){} }

  let fallbackUtterance=null;
  async function browserSpeak(text){
    const clean=String(text||'').trim();if(!clean||!('speechSynthesis'in window)||typeof SpeechSynthesisUtterance==='undefined')return false;
    const started=performance.now();return await new Promise(resolve=>{let done=false;const finish=ok=>{if(done)return;done=true;stopMouth();fallbackUtterance=null;try{setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}syncControls();if(ok)scheduleHandsFree();resolve(ok);};
      try{speechSynthesis.cancel();const lang=browserVoiceLocale(clean),u=new SpeechSynthesisUtterance(clean),voice=pickVoice(lang);fallbackUtterance=u;if(voice)u.voice=voice;u.lang=voice?.lang||lang;u.rate=selectedTurbineConfig().tier==='hifi'?.94:.97;u.pitch=1;u.volume=1;runtime.voice.browserFallbacks++;runtime.voice.lastLang=u.lang;runtime.voice.lastEngine='browser-fallback-'+selectedTurbine();u.onstart=()=>{runtime.voice.fallbackLatencyMs=Math.round(performance.now()-started);try{setFlowState(FLOW_STATES.SPEAKING,{force:true,status:'Olivia hablando'});}catch(_){}startMouth();syncControls();};u.onend=()=>finish(true);u.onerror=()=>finish(false);speechSynthesis.speak(u);}catch(e){remember('browserSpeak',e);finish(false);}});
  }

  function clearAudio(){const audio=currentVoiceAudio,url=currentVoiceUrl;currentVoiceAudio=null;currentVoiceUrl='';if(audio){try{audio.pause();audio.src='';}catch(_){}audio.onplay=null;audio.onended=null;audio.onerror=null;}if(url){try{URL.revokeObjectURL(url);}catch(_){}}stopMouth();}
  async function playRemote(response,text,session){
    const blob=await response.blob();if(session!==speechSessionSeq||!blob.size)return false;const url=URL.createObjectURL(blob),audio=new Audio();audio.crossOrigin='anonymous';audio.preload='auto';audio.src=url;currentVoiceAudio=audio;currentVoiceUrl=url;
    return await new Promise((resolve,reject)=>{let settled=false;const finish=(ok,error)=>{if(settled)return;settled=true;audio.onplay=null;audio.onended=null;audio.onerror=null;if(currentVoiceAudio===audio)currentVoiceAudio=null;if(currentVoiceUrl===url)currentVoiceUrl='';try{URL.revokeObjectURL(url);}catch(_){}stopMouth();try{setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}syncControls();if(ok){scheduleHandsFree();resolve(true);}else reject(error||new Error('Falha ao reproduzir voz'));};audio.onplay=()=>{if(session!==speechSessionSeq)return finish(false,new Error('voz cancelada'));try{setFlowState(FLOW_STATES.SPEAKING,{force:true,status:'Olivia hablando'});}catch(_){}startMouth();syncControls();};audio.onended=()=>finish(true);audio.onerror=()=>finish(false,new Error('Falha de áudio'));audio.play().catch(e=>finish(false,e));});
  }

  async function oliviaRemoteSpeak(text){
    const clean=String(text||'').trim();if(!clean)return false;lastSpoken=clean;if(!voiceUnlocked){try{if(flowState===FLOW_STATES.PROCESSING)setFlowState(FLOW_STATES.IDLE,{force:true,status:'Activa la voz'});}catch(_){}syncControls();return false;}
    const turbine=selectedTurbine(),cfg=TURBINES[turbine],session=++speechSessionSeq;runtime.voice.turbine=turbine;runtime.voice.remoteAttempts++;runtime.voice.lastSpeaker=cfg.speaker;runtime.voice.lastTier=cfg.tier;clearAudio();
    try{setFlowState(FLOW_STATES.PROCESSING,{force:true,status:'Preparando voz '+turbine});}catch(_){}syncControls();
    const controller=new AbortController(),fallbackMs=cfg.tier==='hifi'?2200:1500,timer=setTimeout(()=>controller.abort('olivia-v7-fast-fallback'),fallbackMs);
    try{
      const response=await fetch(FNS_TTS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean,teacher:'Olivia',voice_turbine:turbine}),signal:controller.signal});clearTimeout(timer);
      const contentType=String(response.headers.get('content-type')||''),voiceLang=String(response.headers.get('x-fns-voice-language')||'').toLowerCase();if(!response.ok||!contentType.startsWith('audio/')||(voiceLang&&voiceLang.startsWith('en')))throw new Error('remote-tts-not-usable');
      runtime.voice.lastEngine=String(response.headers.get('x-fns-voice-engine')||'remote');runtime.voice.lastLang=voiceLang||cfg.locale;runtime.voice.turbine=String(response.headers.get('x-fns-voice-turbine')||turbine);return await playRemote(response,clean,session);
    }catch(e){clearTimeout(timer);if(session!==speechSessionSeq)return false;runtime.voice.lastEngine='browser-fallback-'+turbine;return await browserSpeak(clean);}
  }

  const innerOpenLiteTeacher=openLiteTeacher;
  openLiteTeacher=function(i,level='A1',mode='conversation',topic='General conversation'){const target=teachers?.[i];if(!isOliviaName(target?.name))return innerOpenLiteTeacher(i,level,mode,topic);return openRoom(i,level,mode,topic);};
  const innerSelectedSttLanguage=selectedSttLanguage;selectedSttLanguage=function(){if(!isActive())return innerSelectedSttLanguage();return document.querySelector('#sttLangSel')?.value||'auto';};
  const innerInferBrowserSttLanguage=inferBrowserSttLanguage;inferBrowserSttLanguage=function(){return isActive()?browserLanguage():innerInferBrowserSttLanguage();};
  const innerRefreshFlowControls=refreshFlowControls;refreshFlowControls=function(...args){const out=innerRefreshFlowControls(...args);if(isActive())queueMicrotask(()=>{syncControls();syncVisual();});return out;};
  const innerSetFlowState=setFlowState;setFlowState=function(...args){const out=innerSetFlowState(...args);if(isActive())queueMicrotask(()=>{syncVisual();syncControls();});return out;};

  const innerStartRecording=startRecording;
  startRecording=async function(...args){
    if(!isActive())return await innerStartRecording(...args);runtime.mic.attempts++;runtime.mic.lastError='';runtime.mic.lastEngine='starting';
    try{const out=await innerStartRecording(...args);runtime.mic.lastEngine=listeningEngine||'media';syncControls();setTimeout(()=>{if(!isActive())return;try{if(flowState===FLOW_STATES.IDLE&&!isProcessing&&!isSpeaking&&!browserFallbackActive&&typeof startBrowserFallbackOnce==='function'){runtime.mic.lastEngine='browser-watchdog';startBrowserFallbackOnce('Olivia v7 fallback automático');}}catch(e){remember('micWatchdog',e);}},900);return out;}
    catch(e){runtime.mic.lastError=String(e?.message||e);remember('startRecording',e);try{if(typeof startBrowserFallbackOnce==='function')return startBrowserFallbackOnce('Olivia v7 recuperação do microfone');}catch(_){}return false;}
  };
  try{const innerTranscribe=transcribeWithFNS;transcribeWithFNS=async function(blob){if(isActive())runtime.mic.lastBlobSize=Number(blob?.size||0);const out=await innerTranscribe(blob);if(isActive())runtime.mic.lastTranscriptAt=Date.now();return out;};}catch(e){remember('wrapTranscribe',e);}

  const previousFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    if(!isActive())return previousFetch(input,init);let url='';try{url=new URL(typeof input==='string'?input:input.url,location.href).href;}catch(_){return previousFetch(input,init);}const method=String(init?.method||(typeof input!=='string'?input?.method:'')||'GET').toUpperCase();let patched=init;
    try{
      if(method==='POST'&&/\/stt(?:\?|$)/.test(url)){const headers=new Headers(init?.headers||{});headers.set('X-FNS-STT-Language',selectedSttLanguage());patched={...init,headers};runtime.mic.lastEngine='remote-whisper';}
      if(method==='POST'&&/\/chat(?:\?|$)/.test(url)&&typeof init?.body==='string'){const body=JSON.parse(init.body||'{}');body.teacher='Olivia';body.accent='Español para brasileiros';body.input_language=selectedSttLanguage();body.input_language_label='Português/Español';body.strict_language='';body.strict_language_enabled=false;body.pedagogical_bilingual=true;patched={...init,body:JSON.stringify(body)};}
      if(method==='POST'&&/\/tts(?:\?|$)/.test(url)&&typeof init?.body==='string'){const body=JSON.parse(init.body||'{}');body.teacher='Olivia';body.voice_turbine=selectedTurbine();delete body.language;delete body.tts_language;patched={...init,body:JSON.stringify(body)};}
    }catch(e){remember('fetchPatch',e);}return previousFetch(input,patched);
  };

  const innerRemoteSpeak=remoteSpeak;remoteSpeak=async function(text){return isActive()?await oliviaRemoteSpeak(text):await innerRemoteSpeak(text);};
  const innerStopRemoteVoice=stopRemoteVoice;stopRemoteVoice=function(...args){if(!isActive())return innerStopRemoteVoice(...args);speechSessionSeq++;try{speechSynthesis.cancel();}catch(_){}fallbackUtterance=null;clearAudio();try{if(flowState!==FLOW_STATES.IDLE)setFlowState(FLOW_STATES.IDLE,{force:true,status:'Lista'});}catch(_){}syncControls();return true;};
  const innerUnlockVoice=unlockVoice;unlockVoice=async function(...args){if(!isActive())return await innerUnlockVoice(...args);voiceUnlocked=true;lastSpoken=String(lastSpoken||'').trim()||intro();syncControls();return await oliviaRemoteSpeak(lastSpoken);};
  try{const innerUnlockAndRepeat=unlockAndRepeat;unlockAndRepeat=async function(...args){if(!isActive())return await innerUnlockAndRepeat(...args);voiceUnlocked=true;syncControls();return await oliviaRemoteSpeak(String(lastSpoken||'').trim()||intro());};}catch(e){remember('wrapRepeat',e);}

  runtime.toggleMic=async function(){try{return await toggleRecognition();}catch(e){remember('toggleMic',e);return false;}};
  runtime.stopMic=function(){try{return stopRecognition();}catch(e){remember('stopMic',e);return false;}};
  runtime.unlockVoice=async function(){return await unlockVoice();};
  runtime.repeat=async function(){try{return await unlockAndRepeat();}catch(_){voiceUnlocked=true;return await oliviaRemoteSpeak(lastSpoken||intro());}};
  runtime.toggleHands=function(){try{toggleHandsFree();syncControls();}catch(e){remember('toggleHands',e);}};
  runtime.setTurbine=function(value){const key=String(value||'K').toUpperCase();runtime.voice.turbine=TURBINES[key]?key:'K';const sel=document.querySelector('#voiceTurbineSel');if(sel&&sel.value!==runtime.voice.turbine)sel.value=runtime.voice.turbine;syncControls();return TURBINES[runtime.voice.turbine];};
  runtime.closeRoom=function(){try{stopRecognition();stopRemoteVoice();if(window.FNSNatural){FNSNatural.handsFree=false;clearTimeout(FNSNatural.handsTimer);}removePortal();document.querySelector('#liteModal')?.remove();activeTeacher=null;}catch(e){remember('closeRoom',e);}};
  runtime.health=function(){
    const modal=document.querySelector('#liteModal[data-olivia-v7="true"]'),stage=document.getElementById('oliviaV7Stage'),p=portal(),img=p?.querySelector('#oliviaAvatarImageV7'),pr=p?.getBoundingClientRect(),sr=stage?.getBoundingClientRect();
    return {version:VERSION,active:isActive(),booted:runtime.booted,modal:!!modal,stage:!!stage,portal:!!p,portalBodyChild:p?.parentElement===document.body,portalOutsideModal:!!p&&!modal?.contains(p),image:!!img,imageLoaded:!!(img?.complete&&img?.naturalWidth>0),src:img?.src||'',state:p?.dataset.state||'',portalRect:pr?{left:pr.left,top:pr.top,width:pr.width,height:pr.height}:null,stageRect:sr?{left:sr.left,top:sr.top,width:sr.width,height:sr.height}:null,stt:selectedSttLanguage(),browserLang:browserLanguage(),selectedTurbine:selectedTurbine(),turbineCount:Object.keys(TURBINES).length,mic:{...runtime.mic},voice:{...runtime.voice},assets:{...runtime.assets},portalCreates:runtime.portalCreates,portalPositions:runtime.portalPositions,errors:runtime.errors.slice(-8)};
  };

  function directBoot(){if(!DIRECT_MODE)return;try{primeTeacher();if(typeof live==='function')live();openLiteTeacher(indexOfOlivia(),'A1','conversation','General conversation');}catch(e){remember('directBoot',e);}}
  if(document.readyState==='complete')setTimeout(directBoot,0);else window.addEventListener('load',()=>setTimeout(directBoot,0),{once:true});
})();
