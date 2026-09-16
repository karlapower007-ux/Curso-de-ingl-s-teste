const FNS_API_BASE=location.hostname.endsWith('workers.dev')?'':'https://fns-stt.karlapower007.workers.dev';
const FNS_STT_URL=FNS_API_BASE+'/stt';
const FNS_CHAT_URL=FNS_API_BASE+'/chat';
const FNS_TTS_URL=FNS_API_BASE+'/tts';
const teachers=[
{name:'Katya',accent:'American',gender:'female',provider:'LiveAvatar',premium:true,embed:'https://embed.liveavatar.com/v1/c605c6f9-9790-4db2-a3c2-1975926c433d?orientation=horizontal'},
{name:'Emma',accent:'American',gender:'female',provider:'FNS Lite',profile:'20 • United States',portrait:'data:image/jpeg;base64,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'},
{name:'Olivia',accent:'American',gender:'female',provider:'FNS Lite'},
{name:'Sophia',accent:'American',gender:'female',provider:'FNS Lite'},
{name:'Charlotte',accent:'British',gender:'female',provider:'FNS Lite'},
{name:'James',accent:'British',gender:'male',provider:'FNS Lite'},
{name:'Daniel',accent:'American',gender:'male',provider:'FNS Lite'},
{name:'William',accent:'British',gender:'male',provider:'FNS Lite'},
{name:'Ethan',accent:'American',gender:'male',provider:'FNS Lite'},
{name:'Noah',accent:'American',gender:'male',provider:'FNS Lite'}
];

const levelData={
A1:{name:'A1 — Fundamentos',units:['Greetings & introductions','Numbers, age & personal info','Family & people','Daily routines','Home & objects','Food & drinks','Time & schedules','Places in town','Shopping basics','Weather & clothes','Free time & hobbies','A1 review & assessment']},
A2:{name:'A2 — Básico',units:['Past experiences','Travel & transport','Health & body','Plans & intentions','Comparatives','Work & study','Restaurants','Directions','Technology basics','Invitations','Life events','A2 review & assessment']},
B1:{name:'B1 — Intermediário',units:['Narrating stories','Opinions & reasons','Problem solving','Workplace English','Travel situations','Media & news','Relationships','Learning strategies','Environment','Culture','Presentations','B1 review & assessment']},
B2:{name:'B2 — Intermediário alto',units:['Debate & argument','Nuance & register','Complex narratives','Negotiation','Academic discussion','Professional meetings','Current affairs','Hypothetical situations','Idioms in context','Persuasion','Critical listening','B2 review & assessment']},
C1:{name:'C1 — Avançado',units:['Precision & style','Advanced discourse','Formal presentations','Critical analysis','Abstract topics','Leadership communication','Advanced writing','Rhetorical strategies','Cross-cultural nuance','Professional fluency','Advanced listening','C1 review & assessment']},
C2:{name:'C2 — Domínio',units:['Near-native interaction','Subtle meaning','Humor & irony','Specialist discussion','Fast spontaneous speech','Complex negotiation','Editorial language','Advanced storytelling','High-level pronunciation','Idiomatic mastery','Independent mastery','C2 capstone assessment']}
};
const levels=Object.keys(levelData);
let cards=JSON.parse(localStorage.getItem('fns_cards')||'[]');
let progressData=JSON.parse(localStorage.getItem('fns_progress')||'{"minutes":0,"messages":0,"units":{}}');
const app=document.querySelector('#app');
function layout(x){app.innerHTML='<section class="wrap">'+x+'</section>'}
function saveProgress(){localStorage.setItem('fns_progress',JSON.stringify(progressData))}
function addPracticeMessage(){progressData.messages++; progressData.minutes=Math.min(999,Math.round(progressData.messages*0.35)); saveProgress()}
function home(){layout(`<section class="hero"><div class="eyebrow">IMERSÃO DIÁRIA • ARQUITETURA HÍBRIDA</div><h1>Seu inglês.<br>Em prática real.</h1><p>Curso A1–C2, professores digitais, flashcards, mídia e progresso em uma interface leve. Katya usa LiveAvatar; os demais já funcionam em modo FNS Lite sem API e sem servidor.</p><button class="primary" onclick="live()">Conversar agora</button></section><div class="grid"><div class="card"><div class="stat">72</div><p>Unidades originais A1–C2.</p></div><div class="card"><div class="stat">10</div><p>Professores configurados.</p></div><div class="card"><div class="stat">${progressData.minutes} min</div><p>Prática registrada neste navegador.</p></div><div class="card"><div class="stat">FNS AI</div><p>Whisper, IA e voz neural remotos; nada pesado roda no seu notebook.</p></div></div>`)}
function course(){layout(`<h1>Curso completo A1–C2</h1><p class="muted">72 unidades originais, organizadas por nível. Clique numa unidade para abrir objetivos e iniciar prática.</p>${levels.map(l=>`<h2>${levelData[l].name}</h2><div class="level-grid">${levelData[l].units.map((u,i)=>`<div class="card unit" onclick="openUnit('${l}',${i})"><span class="tag">${l} • UNIDADE ${i+1}</span><h3>${u}</h3><p>Vocabulário • diálogo • gramática • pronúncia • prática.</p></div>`).join('')}</div>`).join('')}`)}
function openUnit(level,index){const title=levelData[level].units[index];document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="lessonModal"><div class="room lesson-modal"><button class="close" onclick="lessonModal.remove()">Fechar</button><h2>${level} • ${title}</h2><p class="muted">Plano de aula FNS original</p><div class="lesson-list"><div><b>Objetivo:</b> usar o tema em comunicação real.</div><div><b>Vocabulário:</b> 12–20 itens em contexto.</div><div><b>Gramática:</b> estrutura adequada ao nível ${level}.</div><div><b>Pronúncia:</b> repetição, ritmo e entonação.</div><div><b>Drill:</b> perguntas e respostas rápidas.</div><div><b>Produção:</b> conversa guiada sobre “${title}”.</div></div><br><button class="primary" onclick="lessonModal.remove();openLiteTeacher(1,'${level}','lesson','${title.replace(/'/g,"\\'")}')">Praticar agora com Emma</button></div></div>`)}
function live(){layout(`<h1>Prática ao vivo</h1><p>Katya usa LiveAvatar. Os outros nove professores usam FNS Lite: microfone, Whisper remoto, IA conversacional e voz neural pelo gateway FNS.</p><div class="grid">${teachers.map((t,i)=>`<div class="card teacher"><span class="tag">${t.provider}${t.premium?' • PREMIUM':' • GRATUITO'}</span><h3>${t.name}</h3><div>${t.accent} English</div><p class="small muted">${t.premium?'Avatar premium em tempo real.':'Conversa por voz e texto, com correção pedagógica local.'}</p><button class="primary" onclick="openTeacher(${i})">Abrir professor</button></div>`).join('')}</div>`)}
function openTeacher(i){let t=teachers[i]; if(t.embed){document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><div class="room"><button class="close" onclick="modal.remove()">Encerrar</button><h2>${t.name} • ${t.accent}</h2><iframe src="${t.embed}" allow="microphone; autoplay"></iframe></div></div>`)}else openLiteTeacher(i,'A1','conversation','General conversation')}
function avatarVisualMarkup(t){
  if(t?.portrait){
    return `<div id="avatarFace" class="avatar-face human-avatar avatar-style-3d" data-avatar-style="3d-animated" data-avatar-ready="false" style="--mouth-open:0;--mouth-wide:0;--gaze-x:0px;--gaze-y:0px">
      <img id="emmaPortrait" class="avatar-photo avatar-photo-base" src="${t.portrait}" alt="${t.name}, professora virtual" loading="eager" decoding="sync"
        onload="this.closest('.human-avatar')?.setAttribute('data-avatar-ready','true')"
        onerror="this.closest('.human-avatar')?.setAttribute('data-avatar-ready','error')">
      <div class="avatar-fx-layer" aria-hidden="true">
        <div class="avatar-gaze avatar-gaze-left"></div>
        <div class="avatar-gaze avatar-gaze-right"></div>
        <div class="avatar-eyelid avatar-eyelid-left"></div>
        <div class="avatar-eyelid avatar-eyelid-right"></div>
        <div class="avatar-mouth-motion"></div>
      </div>
      <div class="avatar-camera-vignette"></div>
      <div class="avatar-live-badge">● LIVE</div>
    </div>`;
  }
  return `<div id="avatarFace" class="avatar-face avatar-initials">${t.name.slice(0,2).toUpperCase()}</div>`;
}
let activeTeacher=null,recognizing=false;
let mediaStream=null,mediaRecorder=null,audioChunks=[],recordingTimer=null;
let neuralQuotaExhausted=false;
let quotaResetTimer=null;
let browserFallbackRecognition=null;
let browserFallbackTranscript='';
let browserFallbackActive=false;
let browserSttPreferred=false;

const FLOW_STATES=Object.freeze({
  IDLE:'idle',
  LISTENING:'listening',
  PROCESSING:'processing',
  SPEAKING:'speaking'
});
let flowState=FLOW_STATES.IDLE;
let isSpeaking=false;
let isRecording=false;
let isProcessing=false;
let listeningEngine='none';
let mediaSessionSeq=0;
let browserSessionSeq=0;
let conversationTurnSeq=0;

const FLOW_TRANSITIONS={
  [FLOW_STATES.IDLE]:new Set([FLOW_STATES.LISTENING,FLOW_STATES.PROCESSING]),
  [FLOW_STATES.LISTENING]:new Set([FLOW_STATES.PROCESSING,FLOW_STATES.IDLE]),
  [FLOW_STATES.PROCESSING]:new Set([FLOW_STATES.SPEAKING,FLOW_STATES.IDLE]),
  [FLOW_STATES.SPEAKING]:new Set([FLOW_STATES.IDLE])
};

const QUOTA_NOTICE_TEXT='Modo de emergência ativo: o MediaRecorder foi desligado. A partir de agora, o microfone usa somente o reconhecimento de voz do navegador, um turno por clique.';

function syncFlowFlags(){
  isSpeaking=flowState===FLOW_STATES.SPEAKING;
  isRecording=flowState===FLOW_STATES.LISTENING;
  isProcessing=flowState===FLOW_STATES.PROCESSING;
  recognizing=isRecording;
}

function refreshFlowControls(statusOverride=''){
  syncFlowFlags();
  const mic=document.querySelector('#micBtn');
  const input=document.querySelector('#chatInput');
  const send=document.querySelector('#sendBtn');
  const voice=document.querySelector('#voiceBtn');
  const busy=isProcessing||isSpeaking;

  if(mic){
    mic.disabled=busy;
    if(isSpeaking) mic.textContent='🔊 Emma falando';
    else if(isProcessing) mic.textContent='⏳ Processando';
    else if(isRecording) mic.textContent=listeningEngine==='browser'?'⏹ Parar':'⏹ Enviar fala';
    else mic.textContent=browserSttPreferred?'🎤 Falar (navegador)':'🎤 Falar';
  }
  if(input) input.disabled=busy||isRecording;
  if(send) send.disabled=busy||isRecording;
  if(voice) voice.disabled=isSpeaking||isRecording||isProcessing;

  if(statusOverride){
    setStatus(statusOverride,busy?'busy':'on');
  }else if(isSpeaking){
    setStatus('Speaking','busy');
  }else if(isProcessing){
    setStatus('Processing','busy');
  }else if(isRecording){
    setStatus(listeningEngine==='browser'?'Listening • browser STT':'Listening','on');
  }else{
    setStatus(browserSttPreferred?'Ready • browser STT':'Ready','on');
  }
}

function setFlowState(next,{force=false,status=''}={}){
  if(next===flowState){
    refreshFlowControls(status);
    return true;
  }
  if(!force && !FLOW_TRANSITIONS[flowState]?.has(next)){
    console.warn('FNS blocked invalid flow transition',flowState,'→',next);
    return false;
  }
  flowState=next;
  if(next!==FLOW_STATES.LISTENING) listeningEngine='none';
  refreshFlowControls(status);
  return true;
}

function browserSpeechCtor(){
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function detachBrowserRecognition(r,{abort=false}={}){
  if(!r)return;
  r.onstart=null;
  r.onresult=null;
  r.onerror=null;
  r.onend=null;
  if(browserFallbackRecognition===r)browserFallbackRecognition=null;
  browserFallbackActive=false;
  try{if(abort)r.abort()}catch(e){}
}

function activateBrowserSttMode(reason=''){
  browserSttPreferred=true;
  neuralQuotaExhausted=neuralQuotaExhausted||/quota|4006|429/i.test(reason);
  if(flowState===FLOW_STATES.IDLE){
    refreshFlowControls(reason?'Ouvido do navegador • '+reason:'Ouvido do navegador ativo');
  }
}

function startBrowserOnlySTT(){
  if(flowState!==FLOW_STATES.IDLE || isSpeaking || isProcessing)return false;
  const Ctor=browserSpeechCtor();
  if(!Ctor){
    addMsg('system','Este navegador não oferece SpeechRecognition. Você ainda pode digitar sua mensagem normalmente.');
    refreshFlowControls('Digite sua mensagem');
    return false;
  }

  const session=++browserSessionSeq;
  const r=new Ctor();
  browserFallbackRecognition=r;
  browserFallbackTranscript='';
  browserFallbackActive=false;
  listeningEngine='browser';

  r.continuous=false;
  r.interimResults=true;
  r.maxAlternatives=1;
  r.lang=navigator.language || 'pt-BR';

  let finalParts=[];
  let interimText='';
  let errorCode='';

  r.onstart=()=>{
    if(session!==browserSessionSeq || browserFallbackRecognition!==r)return;
    browserFallbackActive=true;
    refreshFlowControls();
    const face=document.querySelector('#avatarFace');
    if(face)face.classList.add('avatar-listening');
  };

  r.onresult=(event)=>{
    if(session!==browserSessionSeq || browserFallbackRecognition!==r)return;
    interimText='';
    for(let i=event.resultIndex;i<event.results.length;i++){
      const piece=String(event.results[i]?.[0]?.transcript||'').trim();
      if(!piece)continue;
      if(event.results[i].isFinal) finalParts.push(piece);
      else interimText=piece;
    }
    browserFallbackTranscript=(finalParts.join(' ')||interimText).trim();
  };

  r.onerror=(event)=>{
    if(session!==browserSessionSeq || browserFallbackRecognition!==r)return;
    errorCode=String(event?.error||'');
  };

  r.onend=async()=>{
    if(session!==browserSessionSeq || browserFallbackRecognition!==r)return;
    const text=(finalParts.join(' ')||browserFallbackTranscript||interimText).trim();
    detachBrowserRecognition(r);
    const face=document.querySelector('#avatarFace');
    if(face)face.classList.remove('avatar-listening');

    if(errorCode && errorCode!=='aborted' && errorCode!=='no-speech'){
      addMsg('system','O reconhecimento de voz do navegador falhou ('+errorCode+'). Tente novamente ou digite.');
    }

    if(!text){
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
      return;
    }

    browserFallbackTranscript='';
    setFlowState(FLOW_STATES.PROCESSING,{force:true,status:'Processing'});
    await handleUser(text,{stateOwned:true});
  };

  try{
    setFlowState(FLOW_STATES.LISTENING,{status:'Listening • browser STT'});
    r.start();
    return true;
  }catch(e){
    browserSessionSeq++;
    detachBrowserRecognition(r,{abort:true});
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
    return false;
  }
}

function nextUtcMidnightMs(){
  const now=new Date();
  return Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1,0,0,0)-Date.now();
}
function isQuotaPayload(data,status=0){
  const raw=(()=>{try{return JSON.stringify(data||'')}catch{return String(data||'')}})();
  return status===429 || data?.quota_exhausted===true || data?.code==='FNS_DAILY_NEURON_QUOTA' ||
    /4006|daily free allocation|10\s*,?\s*000\s+neurons|neurons.*(quota|limit|allocation)/i.test(raw);
}
function isSttBackendFailure(data,status=0){
  return isQuotaPayload(data,status) || status===502 || status===503 || status===504;
}
function enterQuotaRestMode({preserveFlow=false}={}){
  neuralQuotaExhausted=true;
  browserSttPreferred=true;

  const transcript=document.querySelector('#transcript');
  if(transcript && !transcript.querySelector('.quota-notice')){
    transcript.insertAdjacentHTML('beforeend','<div class="msg system quota-notice">'+escapeHtml(QUOTA_NOTICE_TEXT)+'</div>');
    transcript.scrollTop=transcript.scrollHeight;
  }

  if(!preserveFlow && flowState!==FLOW_STATES.SPEAKING){
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Modo emergência • toque para falar'});
  }else if(preserveFlow){
    refreshFlowControls('Cérebro rápido de emergência');
  }

  if(quotaResetTimer)clearTimeout(quotaResetTimer);
  quotaResetTimer=setTimeout(()=>{
    neuralQuotaExhausted=false;
    browserSttPreferred=false;
    if(flowState===FLOW_STATES.IDLE)refreshFlowControls('Ready');
  },Math.max(1000,nextUtcMidnightMs()+1500));
}

function openLiteTeacher(i,level='A1',mode='conversation',topic='General conversation'){activeTeacher={...teachers[i],i,level,mode,topic};document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="liteModal"><div class="room"><button class="close" onclick="stopRecognition();stopRemoteVoice();liteModal.remove()">Encerrar</button><div class="row"><h2 style="margin-right:auto">${activeTeacher.name} • ${activeTeacher.accent}</h2><span class="status"><i id="statusDot" class="dot on"></i><span id="statusText">Ready</span></span></div><div class="chat-shell"><div class="avatar-stage">${avatarVisualMarkup(activeTeacher)}<div class="avatar-label"><b>${activeTeacher.name}</b><br><span class="small">${activeTeacher.accent} English • FNS Lite</span>${activeTeacher.profile?'<br><span class="small">'+activeTeacher.profile+'</span>':''}${activeTeacher.photoCredit?'<br><span class="photo-credit">Visual pilot • '+activeTeacher.photoCredit+'</span>':''}</div></div><div class="chat-panel"><div class="row"><select id="levelSel" style="width:auto">${levels.map(x=>`<option ${x===level?'selected':''}>${x}</option>`).join('')}</select><select id="modeSel" style="width:auto"><option value="conversation">Conversation</option><option value="drill">Drill</option><option value="lesson">Lesson</option><option value="pronunciation">Pronunciation</option><option value="review">Review</option></select></div><div id="transcript" class="transcript"><div class="msg system">FNS Lite usa microfone + Whisper remoto gratuito para entender sua fala. Nenhuma API key fica no navegador.</div><div class="msg teacher">Hello! I'm ${activeTeacher.name}. ${openingPrompt(level,topic)}</div></div><div class="row" style="margin-top:10px"><button id="micBtn" class="good" onclick="toggleRecognition()">🎤 Falar</button><button onclick="stopRecognition()">Parar</button><button id="voiceBtn" class="primary" onclick="unlockVoice()">🔊 Ativar voz</button><button onclick="unlockAndRepeat()">🔁 Repetir</button></div><div class="row"><input id="chatInput" placeholder="Digite em inglês..." onkeydown="if(event.key==='Enter')sendTyped()"><button id="sendBtn" class="primary" onclick="sendTyped()">Enviar</button></div><div class="small muted">Primeiro clique uma vez em 🔊 Ativar voz. Depois use 🎤 Falar → diga sua frase → ⏹ Enviar fala. A resposta será falada automaticamente.</div></div></div></div></div>`);document.querySelector('#modeSel').value=mode;setFlowState(FLOW_STATES.IDLE,{force:true});if(neuralQuotaExhausted)enterQuotaRestMode();speak(`Hello! I'm ${activeTeacher.name}. ${openingPrompt(level,topic)}`)}
function openingPrompt(level,topic){if(topic&&topic!=='General conversation')return `Today we'll practice ${topic}. Tell me one thing you already know about it.`;return level==='A1'?'Let’s start simply. What is your name?':'Tell me about your day, and I will help you improve your English.'}
function setStatus(text,type='on'){const d=document.querySelector('#statusDot'),s=document.querySelector('#statusText');if(!d||!s)return;d.className='dot '+type;s.textContent=text}
function sanitizeChatText(input){
  let text=String(input||'');
  text=text.replace(/```[\s\S]*?```/g,' ');
  text=text.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1');
  text=text.replace(/\/(?:[^\/\n]|\\.){1,160}\//g,' ');
  text=text.replace(/[*_~^#>|\`]/g,' ');
  text=text.replace(/[\[\]{}()<>]/g,' ');
  text=text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu,' ');
  return text
    .replace(/\s+([.,!?;:])/g,'$1')
    .replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}
function addMsg(role,text){
  const t=document.querySelector('#transcript');
  if(!t)return;
  const display=role==='user'?String(text||''):sanitizeChatText(text);
  t.insertAdjacentHTML('beforeend',`<div class="msg ${role}">${escapeHtml(display)}</div>`);
  t.scrollTop=t.scrollHeight;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function toggleRecognition(){
  if(isSpeaking||isProcessing)return;
  if(isRecording){
    stopRecognition();
    return;
  }
  if(browserSttPreferred||neuralQuotaExhausted){
    activateBrowserSttMode(neuralQuotaExhausted?'quota':'fallback');
    startBrowserOnlySTT();
    return;
  }
  startRecording();
}

async function startRecording(){
  if(flowState!==FLOW_STATES.IDLE || isSpeaking || isProcessing)return;
  if(browserSttPreferred||neuralQuotaExhausted){
    startBrowserOnlySTT();
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){
    addMsg('system','Este navegador não oferece gravação MediaRecorder compatível. Ativando apenas o reconhecimento de voz do navegador.');
    activateBrowserSttMode('MediaRecorder indisponível');
    return;
  }

  const session=++mediaSessionSeq;
  listeningEngine='media';
  setFlowState(FLOW_STATES.LISTENING,{status:'Abrindo microfone'});

  let stream=null;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(session!==mediaSessionSeq || flowState!==FLOW_STATES.LISTENING){
      stream.getTracks().forEach(t=>t.stop());
      return;
    }

    mediaStream=stream;
    audioChunks=[];
    const preferred=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
    const mimeType=preferred.find(t=>MediaRecorder.isTypeSupported(t))||'';
    const recorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
    mediaRecorder=recorder;

    recorder.ondataavailable=e=>{
      if(session!==mediaSessionSeq)return;
      if(e.data && e.data.size>0)audioChunks.push(e.data);
    };

    recorder.onstart=()=>{
      if(session!==mediaSessionSeq)return;
      refreshFlowControls('Listening');
      const face=document.querySelector('#avatarFace');
      if(face)face.classList.add('avatar-listening');
      recordingTimer=setTimeout(()=>stopRecordingAndSend(),20000);
    };

    recorder.onerror=()=>{
      if(session!==mediaSessionSeq)return;
      addMsg('system','Falha ao gravar o microfone. Você pode tentar novamente ou digitar.');
      cancelMediaRecorderSession(session);
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
    };

    recorder.onstop=async()=>{
      if(session!==mediaSessionSeq)return;
      clearTimeout(recordingTimer);
      const mime=recorder.mimeType||'audio/webm';
      const blob=new Blob(audioChunks,{type:mime});
      releaseMediaRecorder(recorder,stream,session);
      const face=document.querySelector('#avatarFace');
      if(face)face.classList.remove('avatar-listening');

      if(blob.size<1000){
        addMsg('system','Não consegui captar áudio suficiente. Tente falar por 1–3 segundos.');
        setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
        return;
      }

      try{
        const wav=await recordingToWav(blob);
        await transcribeWithFNS(wav);
      }catch(error){
        addMsg('system','Não foi possível preparar o áudio: '+(error?.message||error)+'. Tente novamente ou digite.');
        setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
      }
    };

    recorder.start(250);
  }catch(err){
    if(stream)stream.getTracks().forEach(t=>t.stop());
    if(session===mediaSessionSeq){
      addMsg('system','Não consegui acessar o microfone: '+(err?.message||err));
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
    }
  }
}

function releaseMediaRecorder(recorder,stream,session){
  clearTimeout(recordingTimer);
  recordingTimer=null;
  if(recorder){
    recorder.ondataavailable=null;
    recorder.onstart=null;
    recorder.onerror=null;
    recorder.onstop=null;
  }
  if(stream)stream.getTracks().forEach(t=>t.stop());
  if(session===mediaSessionSeq){
    mediaRecorder=null;
    mediaStream=null;
    audioChunks=[];
  }
}

function cancelMediaRecorderSession(session=mediaSessionSeq){
  mediaSessionSeq++;
  clearTimeout(recordingTimer);
  recordingTimer=null;
  const recorder=mediaRecorder;
  const stream=mediaStream;
  if(recorder){
    recorder.ondataavailable=null;
    recorder.onstart=null;
    recorder.onerror=null;
    recorder.onstop=null;
    try{if(recorder.state==='recording')recorder.stop()}catch(e){}
  }
  if(stream)stream.getTracks().forEach(t=>t.stop());
  mediaRecorder=null;
  mediaStream=null;
  audioChunks=[];
}

function stopRecordingAndSend(){
  if(flowState!==FLOW_STATES.LISTENING || listeningEngine!=='media')return;
  const recorder=mediaRecorder;
  if(!recorder || recorder.state!=='recording'){
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
    return;
  }
  clearTimeout(recordingTimer);
  setFlowState(FLOW_STATES.PROCESSING,{status:'Enviando áudio'});
  try{recorder.stop()}catch(e){
    cancelMediaRecorderSession();
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
  }
}

function cleanupRecorder(){
  cancelMediaRecorderSession();
}

// Decode the complete recording, mix to mono and render at Whisper's 16 kHz.
async function recordingToWav(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const renderer = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = renderer.createBufferSource();
    source.buffer = decoded;
    source.connect(renderer.destination);
    source.start();
    const rendered = await renderer.startRendering();
    return encodePcmWav(rendered.getChannelData(0), 16000);
  } finally {
    await context.close();
  }
}
function encodePcmWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for(let i=0;i<text.length;i++) view.setUint8(offset+i,text.charCodeAt(i)); };
  write(0,'RIFF'); view.setUint32(4,buffer.byteLength-8,true);
  write(8,'WAVE'); write(12,'fmt '); view.setUint32(16,16,true);
  view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true);
  write(36,'data'); view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++) {
    const value = Math.max(-1,Math.min(1,samples[i]));
    view.setInt16(44+i*2,value<0?value*32768:value*32767,true);
  }
  return new Blob([buffer],{type:'audio/wav'});
}
async function transcribeWithFNS(blob){
  setFlowState(FLOW_STATES.PROCESSING,{force:true,status:'Transcribing'});
  try{
    const res=await fetch(FNS_STT_URL,{
      method:'POST',
      headers:{'Content-Type':blob.type||'audio/wav'},
      body:blob
    });
    const data=await res.json().catch(()=>({}));

    if(isSttBackendFailure(data,res.status)){
      if(isQuotaPayload(data,res.status))neuralQuotaExhausted=true;
      activateBrowserSttMode('HTTP '+res.status);
      addMsg('system','O ouvido neural ficou indisponível. O modo de emergência foi ativado sem reiniciar o microfone sozinho. Toque em “Falar (navegador)” e diga sua frase uma vez.');
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Modo emergência • toque para falar'});
      return;
    }

    if(!res.ok)throw new Error(data?.message||data?.error||('HTTP '+res.status));

    const text=String(data?.text||'').trim();
    if(!text){
      addMsg('system','O Whisper não detectou fala. Tente novamente falando um pouco mais perto do microfone.');
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
      return;
    }

    await handleUser(text,{stateOwned:true});
  }catch(err){
    activateBrowserSttMode('rede indisponível');
    addMsg('system','O reconhecimento neural falhou. O modo de navegador foi ativado, mas não será aberto automaticamente. Toque em “Falar (navegador)” e repita sua frase.');
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Modo emergência • toque para falar'});
  }
}

function stopRecognition(){
  if(flowState!==FLOW_STATES.LISTENING)return;

  if(listeningEngine==='media'){
    stopRecordingAndSend();
    return;
  }

  if(listeningEngine==='browser' && browserFallbackRecognition){
    try{browserFallbackRecognition.stop()}catch(e){
      browserSessionSeq++;
      detachBrowserRecognition(browserFallbackRecognition,{abort:true});
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
    }
  }
}

function sendTyped(){
  const el=document.querySelector('#chatInput');
  if(!el||!el.value.trim()||flowState!==FLOW_STATES.IDLE)return;
  const text=el.value.trim();
  el.value='';
  setFlowState(FLOW_STATES.PROCESSING,{status:'Thinking'});
  handleUser(text,{stateOwned:true});
}

async function pollinationsBrowserReply(text){
  const userText=String(text||'').trim().slice(0,700);
  if(!userText)throw new Error('Mensagem vazia.');

  const level=document.querySelector('#levelSel')?.value||activeTeacher?.level||'A1';
  const mode=document.querySelector('#modeSel')?.value||activeTeacher?.mode||'conversation';
  const lang=/[áéíóúãõç]|\b(você|não|uma|para|porque)\b/i.test(userText)
    ?'Responda em português brasileiro.'
    :/[¿¡ñ]|\b(hola|usted|gracias|porque)\b/i.test(userText)
      ?'Responde en español.'
      :'Reply in natural English.';

  const prompt=[
    'You are Emma, a friendly concise language tutor.',
    lang,
    'CEFR '+level+'. Mode: '+mode+'.',
    'Correct language mistakes gently when useful.',
    'User: '+userText,
    'Emma:'
  ].join('\n');

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort('pollinations-browser-timeout'),8500);

  try{
    const response=await fetch('https://text.pollinations.ai/'+encodeURIComponent(prompt),{
      method:'GET',
      mode:'cors',
      credentials:'omit',
      cache:'no-store',
      referrerPolicy:'strict-origin-when-cross-origin',
      headers:{'Accept':'text/plain,*/*'},
      signal:controller.signal
    });
    if(!response.ok)throw new Error('Pollinations HTTP '+response.status);
    const reply=String(await response.text()).trim();
    if(!reply||/^\s*</.test(reply))throw new Error('Resposta pública inválida.');
    if(/api key|key budget|raise the key budget|unauthorized|forbidden|quota exceeded|rate.?limit|insufficient (credits|balance)/i.test(reply)){
      throw new Error('Serviço público temporariamente limitado.');
    }
    return reply;
  }finally{
    clearTimeout(timeout);
  }
}

async function llm7BrowserReply(text,timeoutMs=2200){
  const userText=String(text||'').trim().slice(0,700);
  if(!userText)throw new Error('Mensagem vazia para o cérebro LLM7.');

  const level=document.querySelector('#levelSel')?.value||activeTeacher?.level||'A1';
  const mode=document.querySelector('#modeSel')?.value||activeTeacher?.mode||'conversation';
  const system=[
    'You are Emma, a friendly multilingual language teacher.',
    'Reply naturally and briefly for spoken conversation.',
    'Use the user\'s language unless they ask for another language.',
    'Correct language mistakes gently when useful.',
    'CEFR level: '+level+'. Mode: '+mode+'.',
    'Avoid markdown.'
  ].join(' ');

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('llm7-browser-timeout'),timeoutMs);

  try{
    const response=await fetch('https://api.llm7.io/v1/chat/completions',{
      method:'POST',
      mode:'cors',
      credentials:'omit',
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json'
      },
      body:JSON.stringify({
        model:'codestral-latest',
        messages:[
          {role:'system',content:system},
          {role:'user',content:userText}
        ],
        temperature:.55,
        max_tokens:220,
        stream:false
      }),
      signal:controller.signal
    });

    const raw=await response.text();
    if(!response.ok)throw new Error('LLM7 HTTP '+response.status+': '+raw.slice(0,160));

    let data={};
    try{data=JSON.parse(raw)}catch{throw new Error('LLM7 retornou JSON inválido.');}
    const reply=String(data?.choices?.[0]?.message?.content||data?.choices?.[0]?.text||'').trim();
    if(!reply)throw new Error('LLM7 retornou resposta vazia.');
    if(/api key|unauthorized|forbidden|quota exceeded|rate.?limit|missing_api_key/i.test(reply)){
      throw new Error('LLM7 retornou erro de autenticação/cota.');
    }
    return reply;
  }finally{
    clearTimeout(timer);
  }
}

async function emergencyBrainReply(text){
  enterQuotaRestMode({preserveFlow:true});
  try{
    return await pollinationsBrowserReply(text);
  }catch(pollinationsError){
    try{
      return await llm7BrowserReply(text);
    }catch(llm7Error){
      return teacherReply(text);
    }
  }
}

async function handleUser(text,{stateOwned=false}={}){
  text=String(text||'').trim();
  if(!text)return;

  if(isSpeaking||isRecording)return;
  if(!stateOwned){
    if(flowState!==FLOW_STATES.IDLE)return;
    if(!setFlowState(FLOW_STATES.PROCESSING,{status:'Thinking'}))return;
  }else if(flowState!==FLOW_STATES.PROCESSING){
    setFlowState(FLOW_STATES.PROCESSING,{force:true,status:'Thinking'});
  }

  const turn=++conversationTurnSeq;
  addMsg('user',text);
  addPracticeMessage();

  let reply='';

  try{
    if(browserSttPreferred||neuralQuotaExhausted){
      reply=await emergencyBrainReply(text);
    }else{
      const response=await fetch(FNS_CHAT_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        message:text,
        teacher:activeTeacher?.name||'Emma',
        level:document.querySelector('#levelSel')?.value||'A1',
        accent:activeTeacher?.accent||'British'
      })
    });

    const data=await response.json().catch(()=>({}));
    if(turn!==conversationTurnSeq)return;

    if(isQuotaPayload(data,response.status) || data?.browser_fallback===true || data?.code==='FNS_BROWSER_POLLINATIONS'){
      reply=await emergencyBrainReply(text);
    }else if(!response.ok||!data.ok){
      reply=await emergencyBrainReply(text);
    }else{
      reply=String(data.reply||'Could you say that again?').trim();
    }
    }
  }catch(error){
    if(turn!==conversationTurnSeq)return;
    reply=await emergencyBrainReply(text);
  }

  if(turn!==conversationTurnSeq)return;
  reply=String(reply||teacherReply(text)).trim();
  addMsg('teacher',reply);

  const spoken=await speak(reply,{fromProcessing:true});
  if(turn===conversationTurnSeq && !spoken && flowState===FLOW_STATES.PROCESSING){
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
  }
}
function teacherReply(text){const x=text.trim(),low=x.toLowerCase(),level=document.querySelector('#levelSel')?.value||activeTeacher.level,mode=document.querySelector('#modeSel')?.value||activeTeacher.mode;let correction='';
if(/\bi am have\b/i.test(x))correction='Small correction: say “I have”, not “I am have”. ';
else if(/\bhe go\b/i.test(x))correction='Small correction: say “he goes”. ';
else if(/\byesterday.*\bgo\b/i.test(x))correction='For the past, use “went”: “Yesterday I went…”. ';
if(mode==='pronunciation')return correction+`Good. Say it again slowly: “${x}”. Focus on rhythm and clear final sounds.`;
if(mode==='drill'){const qs=['What do you do every morning?','What did you do yesterday?','What are you going to do tomorrow?','What do you like doing in your free time?'];return correction+qs[progressData.messages%qs.length]}
if(mode==='lesson')return correction+`Good. Now expand your answer with one reason and one example. Topic: ${activeTeacher.topic}.`;
if(low.includes('my name is')||low.startsWith("i'm ")||low.startsWith('i am '))return correction+`Nice to meet you! Where are you from, and what do you like doing in your free time?`;
if(low.includes('how are you'))return correction+`I'm doing well, thank you. Now tell me: how are you feeling today, and why?`;
if(low.includes('i like'))return correction+`Great. Why do you like it? Try to answer in two complete sentences.`;
if(low.includes('because'))return correction+`Good use of “because”. Can you give me one more detail?`;
if(level==='A1')return correction+`Good. Now answer one more simple question: What do you usually do in the morning?`;
if(level==='A2')return correction+`Good answer. Tell me when that happened and how you felt.`;
if(level==='B1')return correction+`Nice. Can you explain your opinion and give one example?`;
if(level==='B2')return correction+`Good. Now contrast that idea with an alternative point of view.`;
if(level==='C1')return correction+`Strong answer. Reformulate it in a more precise and natural way, using a linking expression.`;
return correction+`Excellent. Add nuance: what assumption or implication is hidden in that idea?`}
let lastSpoken='';
let voiceUnlocked=false;
let currentVoiceAudio=null;
let currentVoiceUrl='';
let avatarAudioContext=null;
let avatarAnalyser=null;
let avatarLipRAF=null;
let avatarMediaSource=null;

function stopAvatarLipSync(){
  if(avatarLipRAF){cancelAnimationFrame(avatarLipRAF);avatarLipRAF=null;}
  const face=document.querySelector('#avatarFace');
  if(face){
    face.style.setProperty('--mouth-open','0');
    face.style.setProperty('--mouth-wide','0');
    face.classList.remove('avatar-talking','avatar-mouth-simulated');
  }
  avatarAnalyser=null;
  avatarMediaSource=null;
  if(avatarAudioContext){
    try{avatarAudioContext.close()}catch(e){}
    avatarAudioContext=null;
  }
}

function startSimulatedLipSync(audio){
  const face=document.querySelector('#avatarFace');
  if(!face?.classList.contains('human-avatar'))return;
  if(currentVoiceAudio!==audio || audio.paused || audio.ended)return;
  face.classList.add('avatar-talking','avatar-mouth-simulated');
}

async function startAvatarLipSync(audio){
  const face=document.querySelector('#avatarFace');
  if(!face?.classList.contains('human-avatar'))return;

  startSimulatedLipSync(audio);

  const portrait=face.querySelector('#emmaPortrait');
  if(portrait && (!portrait.complete || !portrait.naturalWidth || face.dataset.avatarReady!=='true')){
    const resume=()=>{ if(currentVoiceAudio===audio && !audio.paused) startAvatarLipSync(audio); };
    portrait?.addEventListener('load',resume,{once:true});
    return;
  }

  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;

    avatarAudioContext=new AudioCtx();
    if(avatarAudioContext.state==='suspended'){
      try{await avatarAudioContext.resume()}catch(e){}
    }
    if(avatarAudioContext.state!=='running'){
      startSimulatedLipSync(audio);
      return;
    }

    avatarMediaSource=avatarAudioContext.createMediaElementSource(audio);
    avatarAnalyser=avatarAudioContext.createAnalyser();
    avatarAnalyser.fftSize=1024;
    avatarAnalyser.smoothingTimeConstant=.68;
    avatarMediaSource.connect(avatarAnalyser);
    avatarAnalyser.connect(avatarAudioContext.destination);

    const samples=new Uint8Array(avatarAnalyser.fftSize);
    face.classList.add('avatar-talking');
    let smoothOpen=0;
    let lastTs=0;
    let signalFrames=0;
    let silentFrames=0;

    const tick=(ts=0)=>{
      if(!avatarAnalyser||currentVoiceAudio!==audio||audio.paused||audio.ended)return;

      avatarAnalyser.getByteTimeDomainData(samples);
      let sum=0;
      for(let i=0;i<samples.length;i++){
        const v=(samples[i]-128)/128;
        sum+=v*v;
      }
      const rms=Math.sqrt(sum/samples.length);

      if(rms>.012){
        signalFrames++;
        silentFrames=0;
      }else{
        silentFrames++;
        signalFrames=Math.max(0,signalFrames-1);
      }

      if(signalFrames>=3)face.classList.remove('avatar-mouth-simulated');
      if(silentFrames>=12)face.classList.add('avatar-mouth-simulated');

      const target=Math.max(0,Math.min(.72,(rms-.018)/.16));
      const frameScale=lastTs?Math.min(1,(ts-lastTs)/16.67):1;
      const attack=.24*frameScale;
      const release=.15*frameScale;
      const alpha=target>smoothOpen?attack:release;
      smoothOpen=smoothOpen+(target-smoothOpen)*alpha;
      lastTs=ts;

      face.style.setProperty('--mouth-open',smoothOpen.toFixed(3));
      face.style.setProperty('--mouth-wide',Math.min(.5,smoothOpen*.62).toFixed(3));
      avatarLipRAF=requestAnimationFrame(tick);
    };

    avatarLipRAF=requestAnimationFrame(tick);
  }catch(e){
    avatarAnalyser=null;
    avatarMediaSource=null;
    startSimulatedLipSync(audio);
  }
}

function stopRemoteVoice(){
  speechSessionSeq++;
  stopAvatarLipSync();

  const audio=currentVoiceAudio;
  const url=currentVoiceUrl;
  currentVoiceAudio=null;
  currentVoiceUrl='';

  if(audio){
    audio.onplay=null;
    audio.onended=null;
    audio.onerror=null;
    try{audio.pause()}catch(e){}
  }
  if(url){
    try{URL.revokeObjectURL(url)}catch(e){}
  }

  const face=document.querySelector('#avatarFace');
  if(face)face.classList.remove('avatar-speaking','avatar-talking','avatar-listening');

  if(flowState===FLOW_STATES.SPEAKING||flowState===FLOW_STATES.PROCESSING){
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
  }
}

let speechSessionSeq=0;

async function remoteSpeak(text){
  text=String(text||'').trim();
  if(!text)return false;
  lastSpoken=text;

  if(!voiceUnlocked){
    if(flowState===FLOW_STATES.PROCESSING)setFlowState(FLOW_STATES.IDLE,{force:true});
    refreshFlowControls('Clique em Ativar voz');
    return false;
  }

  if(isSpeaking||isRecording)return false;
  if(flowState===FLOW_STATES.IDLE){
    if(!setFlowState(FLOW_STATES.PROCESSING,{status:'Generating voice'}))return false;
  }else if(flowState!==FLOW_STATES.PROCESSING){
    return false;
  }else{
    refreshFlowControls('Generating voice');
  }

  const session=++speechSessionSeq;

  try{
    const response=await fetch(FNS_TTS_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text,teacher:activeTeacher?.name||'Emma'})
    });

    if(session!==speechSessionSeq)return false;

    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      if(isQuotaPayload(data,response.status)){
        enterQuotaRestMode();
        return false;
      }
      throw new Error(data?.message||'A voz da Emma está temporariamente indisponível.');
    }

    const blob=await response.blob();
    if(session!==speechSessionSeq)return false;
    if(!blob.size)throw new Error('O servidor TTS retornou áudio vazio.');

    const url=URL.createObjectURL(blob);
    const audio=new Audio();
    audio.crossOrigin='anonymous';
    audio.preload='auto';
    audio.src=url;
    currentVoiceAudio=audio;
    currentVoiceUrl=url;

    return await new Promise((resolve,reject)=>{
      let settled=false;

      const finish=(ok,error=null)=>{
        if(settled)return;
        settled=true;

        audio.onplay=null;
        audio.onended=null;
        audio.onerror=null;

        if(session===speechSessionSeq){
          stopAvatarLipSync();
          const face=document.querySelector('#avatarFace');
          if(face)face.classList.remove('avatar-speaking','avatar-talking');

          if(currentVoiceAudio===audio)currentVoiceAudio=null;
          if(currentVoiceUrl===url)currentVoiceUrl='';
          try{URL.revokeObjectURL(url)}catch(e){}

          // This is the only normal path that releases the mic after speech.
          setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
        }else{
          try{URL.revokeObjectURL(url)}catch(e){}
        }

        if(ok)resolve(true);
        else reject(error||new Error('Falha ao reproduzir a voz.'));
      };

      audio.onplay=()=>{
        if(session!==speechSessionSeq){
          finish(false,new Error('Sessão de voz cancelada.'));
          return;
        }
        setFlowState(FLOW_STATES.SPEAKING,{status:'Speaking'});
        startAvatarLipSync(audio).catch(()=>startSimulatedLipSync(audio));
        const face=document.querySelector('#avatarFace');
        if(face)face.classList.add('avatar-speaking');
      };

      audio.onended=()=>finish(true);
      audio.onerror=()=>finish(false,new Error('Falha de reprodução do áudio neural.'));

      audio.play().catch(error=>finish(false,error));
    });
  }catch(error){
    if(session===speechSessionSeq){
      if(currentVoiceUrl){
        try{URL.revokeObjectURL(currentVoiceUrl)}catch(e){}
      }
      currentVoiceAudio=null;
      currentVoiceUrl='';
      stopAvatarLipSync();
      if(isQuotaPayload(error,0))enterQuotaRestMode();
      else{
        addMsg('system','A voz da Emma está temporariamente indisponível. O texto da resposta continua disponível.');
        setFlowState(FLOW_STATES.IDLE,{force:true,status:'Voz indisponível'});
      }
    }
    return false;
  }
}

async function unlockVoice(){
  if(flowState!==FLOW_STATES.IDLE)return;
  voiceUnlocked=true;
  const b=document.querySelector('#voiceBtn');
  if(b)b.textContent='🔊 Voz ativada';
  const text=lastSpoken||`Hello! I'm ${activeTeacher?.name||'your teacher'}. Voice is ready.`;
  await remoteSpeak(text);
}

async function unlockAndRepeat(){
  if(flowState!==FLOW_STATES.IDLE)return;
  voiceUnlocked=true;
  const b=document.querySelector('#voiceBtn');
  if(b)b.textContent='🔊 Voz ativada';
  if(lastSpoken)await remoteSpeak(lastSpoken);
}

async function speak(text){
  lastSpoken=String(text||'').trim();
  if(!lastSpoken)return false;
  if(!voiceUnlocked){
    if(flowState===FLOW_STATES.PROCESSING)setFlowState(FLOW_STATES.IDLE,{force:true});
    refreshFlowControls('Clique em Ativar voz');
    return false;
  }
  return await remoteSpeak(lastSpoken);
}

async function speakNow(text){
  lastSpoken=String(text||'').trim();
  if(!voiceUnlocked||flowState!==FLOW_STATES.IDLE)return false;
  return await remoteSpeak(lastSpoken);
}

function cardsView(){layout(`<h1>Flashcards</h1><div class="grid"><div class="card"><h2>Novo cartão</h2><input id="front" placeholder="Frente / inglês"><textarea id="back" placeholder="Verso / tradução, explicação"></textarea><button class="primary" onclick="saveCard()">SALVAR FLASHCARD</button></div><div class="card"><h2>Seus cartões</h2><div id="cardlist">${cards.length?cards.map((c,i)=>`<div class="card"><b>${escapeHtml(c.f)}</b><p>${escapeHtml(c.b)}</p><div class="row"><button onclick="speakCard(${i})">🔊 Ouvir</button><button onclick="delCard(${i})">Excluir</button></div></div>`).join(''):'Nenhum cartão ainda.'}</div></div></div>`)}
function saveCard(){let f=front.value.trim(),b=back.value.trim();if(!f)return;cards.push({f,b});localStorage.setItem('fns_cards',JSON.stringify(cards));cardsView()}
function delCard(i){cards.splice(i,1);localStorage.setItem('fns_cards',JSON.stringify(cards));cardsView()}
function speakCard(i){activeTeacher=teachers[2];speak(cards[i].f)}
function library(){layout(`<h1>Biblioteca</h1><div class="grid"><div class="card"><h2>Vídeos</h2><p>Área preparada para catálogo e links de vídeo.</p></div><div class="card"><h2>MP3</h2><p>Reprodução local no navegador.</p><input type="file" accept="audio/*" onchange="playAudio(this)"><div id="audio"></div></div><div class="card"><h2>Materiais</h2><p>Organize seus conteúdos por coleção e nível.</p></div></div>`)}

function playAudio(input){
  const file=input?.files?.[0];
  const box=document.querySelector('#audio');
  if(!file||!box)return;
  const url=URL.createObjectURL(file);
  box.innerHTML=`<audio controls src="${url}" style="width:100%;margin-top:12px"></audio>`;
}

function progress(){
  layout(`
    <h1>Progresso</h1>
    <div class="grid">
      <div class="card"><div class="stat">${progressData.minutes} min</div><p>Tempo aproximado de prática.</p></div>
      <div class="card"><div class="stat">${progressData.messages}</div><p>Mensagens praticadas.</p></div>
      <div class="card"><div class="stat">${cards.length}</div><p>Flashcards salvos.</p></div>
      <div class="card"><div class="stat">A1–C2</div><p>Trilha completa disponível.</p></div>
    </div>
  `);
}

const views={home,course,live,cards:cardsView,library,progress};
document.querySelectorAll('nav button[data-view]').forEach(button=>{
  button.addEventListener('click',()=>{
    const fn=views[button.dataset.view]||home;
    fn();
  });
});
home();
