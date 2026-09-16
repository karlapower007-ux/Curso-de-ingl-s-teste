const FNS_API_BASE=location.hostname.endsWith('workers.dev')?'':'https://fns-stt.karlapower007.workers.dev';
const FNS_STT_URL=FNS_API_BASE+'/stt';
const FNS_CHAT_URL=FNS_API_BASE+'/chat';
const FNS_TTS_URL=FNS_API_BASE+'/tts';
const teachers=[
{name:'Katya',accent:'American',gender:'female',provider:'LiveAvatar',premium:true,embed:'https://embed.liveavatar.com/v1/c605c6f9-9790-4db2-a3c2-1975926c433d?orientation=horizontal'},
{name:'Emma',accent:'American',gender:'female',provider:'FNS Lite',profile:'20 • United States',portrait:'data:image/jpeg;base64,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[... ELLIPSIZATION ...]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'},
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
    return `<div id="avatarFace" class="avatar-face human-avatar" style="--mouth-open:0;--gaze-x:0px;--gaze-y:0px">
      <img class="avatar-photo avatar-photo-base" src="${t.portrait}" alt="${t.name}, professora virtual" loading="eager" referrerpolicy="no-referrer">
      <img class="avatar-photo avatar-photo-jaw" src="${t.portrait}" alt="" aria-hidden="true" referrerpolicy="no-referrer">
      <img class="avatar-photo avatar-eye-layer avatar-eye-left" src="${t.portrait}" alt="" aria-hidden="true" referrerpolicy="no-referrer">
      <img class="avatar-photo avatar-eye-layer avatar-eye-right" src="${t.portrait}" alt="" aria-hidden="true" referrerpolicy="no-referrer">
      <div class="avatar-eyelid avatar-eyelid-left" aria-hidden="true"></div>
      <div class="avatar-eyelid avatar-eyelid-right" aria-hidden="true"></div>
      <div class="avatar-mouth-cavity" aria-hidden="true"></div>
      <div class="avatar-camera-vignette"></div>
      <div class="avatar-live-badge">● LIVE</div>
    </div>`;
  }
  return `<div id="avatarFace" class="avatar-face avatar-initials">${t.name.slice(0,2).toUpperCase()}</div>`;
}
let activeTeacher=null,recognizing=false;
let mediaStream=null,mediaRecorder=null,audioChunks=[],recordingTimer=null;
function openLiteTeacher(i,level='A1',mode='conversation',topic='General conversation'){activeTeacher={...teachers[i],i,level,mode,topic};document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="liteModal"><div class="room"><button class="close" onclick="stopRecognition();stopRemoteVoice();liteModal.remove()">Encerrar</button><div class="row"><h2 style="margin-right:auto">${activeTeacher.name} • ${activeTeacher.accent}</h2><span class="status"><i id="statusDot" class="dot on"></i><span id="statusText">Ready</span></span></div><div class="chat-shell"><div class="avatar-stage">${avatarVisualMarkup(activeTeacher)}<div class="avatar-label"><b>${activeTeacher.name}</b><br><span class="small">${activeTeacher.accent} English • FNS Lite</span>${activeTeacher.profile?'<br><span class="small">'+activeTeacher.profile+'</span>':''}${activeTeacher.photoCredit?'<br><span class="photo-credit">Visual pilot • '+activeTeacher.photoCredit+'</span>':''}</div></div><div class="chat-panel"><div class="row"><select id="levelSel" style="width:auto">${levels.map(x=>`<option ${x===level?'selected':''}>${x}</option>`).join('')}</select><select id="modeSel" style="width:auto"><option value="conversation">Conversation</option><option value="drill">Drill</option><option value="lesson">Lesson</option><option value="pronunciation">Pronunciation</option><option value="review">Review</option></select></div><div id="transcript" class="transcript"><div class="msg system">FNS Lite usa microfone + Whisper remoto gratuito para entender sua fala. Nenhuma API key fica no navegador.</div><div class="msg teacher">Hello! I'm ${activeTeacher.name}. ${openingPrompt(level,topic)}</div></div><div class="row" style="margin-top:10px"><button id="micBtn" class="good" onclick="toggleRecognition()">🎤 Falar</button><button onclick="stopRecognition()">Parar</button><button id="voiceBtn" class="primary" onclick="unlockVoice()">🔊 Ativar voz</button><button onclick="unlockAndRepeat()">🔁 Repetir</button></div><div class="row"><input id="chatInput" placeholder="Digite em inglês..." onkeydown="if(event.key==='Enter')sendTyped()"><button class="primary" onclick="sendTyped()">Enviar</button></div><div class="small muted">Primeiro clique uma vez em 🔊 Ativar voz. Depois use 🎤 Falar → diga sua frase → ⏹ Enviar fala. A resposta será falada automaticamente.</div></div></div></div></div>`);document.querySelector('#modeSel').value=mode;speak(`Hello! I'm ${activeTeacher.name}. ${openingPrompt(level,topic)}`)}
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
function toggleRecognition(){recognizing?stopRecordingAndSend():startRecording()}
async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){
    addMsg('system','Este navegador não oferece gravação de áudio compatível. Você pode digitar sua frase.');
    return;
  }
  try{
    setStatus('Microfone','busy');
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[];
    const preferred=[
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus'
    ];
    const mimeType=preferred.find(t=>MediaRecorder.isTypeSupported(t))||'';
    mediaRecorder=mimeType?new MediaRecorder(mediaStream,{mimeType}):new MediaRecorder(mediaStream);

    mediaRecorder.ondataavailable=e=>{
      if(e.data && e.data.size>0) audioChunks.push(e.data);
    };

    mediaRecorder.onstart=()=>{
      recognizing=true;
      setStatus('Listening','on');
      if(document.querySelector('#avatarFace')) avatarFace.className='avatar-face human-avatar avatar-listening';
      if(document.querySelector('#micBtn')) micBtn.textContent='⏹ Enviar fala';
      recordingTimer=setTimeout(()=>stopRecordingAndSend(),12000);
    };

    mediaRecorder.onerror=e=>{
      addMsg('system','Falha ao gravar o microfone. Você também pode digitar.');
      cleanupRecorder();
    };

    mediaRecorder.onstop=async()=>{
      clearTimeout(recordingTimer);
      if(document.querySelector('#micBtn')) micBtn.textContent='🎤 Falar';
      if(document.querySelector('#avatarFace')) avatarFace.className='avatar-face human-avatar';
      const blob=new Blob(audioChunks,{type:mediaRecorder?.mimeType||'audio/webm'});
      cleanupRecorder(false);
      if(blob.size<1000){
        addMsg('system','Não consegui captar áudio suficiente. Tente falar por 1–3 segundos.');
        setStatus('Ready','on');
        return;
      }
      try {
        setStatus('Preparando áudio','busy');
        const wav = await recordingToWav(blob);
        await transcribeWithFNS(wav);
      } catch (error) {
        addMsg('system','Não foi possível preparar o áudio: '+error.message+'. Tente novamente ou digite.');
        setStatus('Ready','on');
      }
    };

    mediaRecorder.start(250);
  }catch(err){
    addMsg('system','Não consegui acessar o microfone: '+(err?.message||err));
    cleanupRecorder();
  }
}
function stopRecordingAndSend(){
  if(mediaRecorder && mediaRecorder.state==='recording'){
    setStatus('Enviando áudio','busy');
    mediaRecorder.stop();
  }
}
function cleanupRecorder(stopTracks=true){
  recognizing=false;
  clearTimeout(recordingTimer);
  if(stopTracks && mediaStream){
    mediaStream.getTracks().forEach(t=>t.stop());
  }
  if(mediaStream && (!mediaRecorder || mediaRecorder.state==='inactive')){
    mediaStream.getTracks().forEach(t=>t.stop());
  }
  mediaStream=null;
  mediaRecorder=null;
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
  setStatus('Transcribing','busy');
  try{
    const res=await fetch(FNS_STT_URL,{
      method:'POST',
      headers:{'Content-Type':blob.type||'audio/webm'},
      body:blob
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      throw new Error(data?.error||('HTTP '+res.status));
    }
    const text=(data?.text||'').trim();
    if(!text){
      addMsg('system','O Whisper não detectou fala. Tente novamente falando um pouco mais perto do microfone.');
      setStatus('Ready','on');
      return;
    }
    handleUser(text);
  }catch(err){
    addMsg('system','FNS STT: '+(err?.message||err)+'. Você também pode digitar.');
    setStatus('Ready','on');
  }
}
function stopRecognition(){stopRecordingAndSend()}
function sendTyped(){const el=document.querySelector('#chatInput');if(!el||!el.value.trim())return;const text=el.value.trim();el.value='';handleUser(text)}
async function handleUser(text){
  addMsg('user',text);
  addPracticeMessage();
  setStatus('Thinking','busy');

  try{
    const response=await fetch(
      FNS_CHAT_URL,
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          message:text,
          teacher:activeTeacher?.name||'Emma',
          level:document.querySelector('#levelSel')?.value||'A1',
          accent:activeTeacher?.accent||'British'
        })
      }
    );

    const data=await response.json();

    if(!response.ok || !data.ok){
      throw new Error(data?.error||'Erro na IA');
    }

    const reply=data.reply||'Could you say that again?';

    addMsg('teacher',reply);
    setStatus('Ready','on');

    try{
      speak(reply);
    }catch(e){}

  }catch(error){
    setStatus('AI error','busy');

    const fallback=teacherReply(text);
    addMsg('teacher',fallback);

    addMsg(
      'system',
      'FNS AI: '+(error?.message||error)
    );
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
    face.classList.remove('avatar-talking');
  }
  avatarAnalyser=null;
  avatarMediaSource=null;
  if(avatarAudioContext){
    try{avatarAudioContext.close()}catch(e){}
    avatarAudioContext=null;
  }
}

function startAvatarLipSync(audio){
  const face=document.querySelector('#avatarFace');
  if(!face?.classList.contains('human-avatar'))return;
  stopAvatarLipSync();
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;
    avatarAudioContext=new AudioCtx();
    avatarMediaSource=avatarAudioContext.createMediaElementSource(audio);
    avatarAnalyser=avatarAudioContext.createAnalyser();
    avatarAnalyser.fftSize=256;
    avatarAnalyser.smoothingTimeConstant=.55;
    avatarMediaSource.connect(avatarAnalyser);
    avatarAnalyser.connect(avatarAudioContext.destination);
    const bins=new Uint8Array(avatarAnalyser.frequencyBinCount);
    face.classList.add('avatar-talking');

    const tick=()=>{
      if(!avatarAnalyser||!currentVoiceAudio||currentVoiceAudio.paused){
        if(face)face.style.setProperty('--mouth-open','0');
        return;
      }
      avatarAnalyser.getByteFrequencyData(bins);
      let sum=0;
      const limit=Math.min(36,bins.length);
      for(let i=2;i<limit;i++)sum+=bins[i];
      const avg=sum/Math.max(1,limit-2);
      const open=Math.max(0,Math.min(1,(avg-12)/72));
      face.style.setProperty('--mouth-open',open.toFixed(3));
      avatarLipRAF=requestAnimationFrame(tick);
    };
    tick();
  }catch(e){
    stopAvatarLipSync();
  }
}

function stopRemoteVoice(){
  stopAvatarLipSync();
  if(currentVoiceAudio){
    try{currentVoiceAudio.pause(); currentVoiceAudio.currentTime=0}catch(e){}
    currentVoiceAudio=null;
  }
  if(currentVoiceUrl){
    try{URL.revokeObjectURL(currentVoiceUrl)}catch(e){}
    currentVoiceUrl='';
  }
  const face=document.querySelector('#avatarFace');
  if(face)face.className='avatar-face human-avatar';
}

async function remoteSpeak(text){
  text=String(text||'').trim();
  if(!text)return;
  lastSpoken=text;

  if(!voiceUnlocked){
    setStatus('Clique em Ativar voz','busy');
    return;
  }

  stopRemoteVoice();
  setStatus('Generating voice','busy');

  try{
    const response=await fetch(FNS_TTS_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        text,
        teacher:activeTeacher?.name||'Emma',
      })
    });

    if(!response.ok){
      const errText=await response.text().catch(()=> '');
      throw new Error('TTS HTTP '+response.status+(errText?': '+errText.slice(0,160):''));
    }

    const blob=await response.blob();
    if(!blob.size)throw new Error('O servidor TTS retornou áudio vazio.');

    const url=URL.createObjectURL(blob);
    const audio=new Audio(url);
    audio.preload='auto';
    currentVoiceAudio=audio;
    currentVoiceUrl=url;

    audio.onplay=()=>{
      startAvatarLipSync(audio);
      setStatus('Speaking','busy');
      const face=document.querySelector('#avatarFace');
      if(face)face.className='avatar-face human-avatar avatar-speaking';
    };

    const finish=()=>{
      stopAvatarLipSync();
      if(currentVoiceAudio===audio)currentVoiceAudio=null;
      if(currentVoiceUrl===url){
        try{URL.revokeObjectURL(url)}catch(e){}
        currentVoiceUrl='';
      }
      setStatus('Ready','on');
      const face=document.querySelector('#avatarFace');
      if(face)face.className='avatar-face';
    };

    audio.onended=finish;
    audio.onerror=()=>{
      finish();
      addMsg('system','FNS VOICE: não foi possível reproduzir o áudio neural recebido.');
    };

    await audio.play();
  }catch(error){
    stopRemoteVoice();
    setStatus('TTS error','busy');
    addMsg('system','FNS VOICE: '+(error?.message||error));
  }
}

async function unlockVoice(){
  voiceUnlocked=true;
  const b=document.querySelector('#voiceBtn');
  if(b)b.textContent='🔊 Voz ativada';
  const text=lastSpoken||`Hello! I'm ${activeTeacher?.name||'your teacher'}. Voice is ready.`;
  await remoteSpeak(text);
}

async function unlockAndRepeat(){
  voiceUnlocked=true;
  const b=document.querySelector('#voiceBtn');
  if(b)b.textContent='🔊 Voz ativada';
  if(lastSpoken)await remoteSpeak(lastSpoken);
}

function speak(text){
  lastSpoken=String(text||'').trim();
  if(!voiceUnlocked){
    setStatus('Clique em Ativar voz','busy');
    return;
  }
  remoteSpeak(lastSpoken);
}

function speakNow(text){
  lastSpoken=String(text||'').trim();
  if(!voiceUnlocked)return;
  remoteSpeak(lastSpoken);
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
