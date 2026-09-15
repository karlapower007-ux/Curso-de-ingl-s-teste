const FNS_API_BASE=location.hostname.endsWith('workers.dev')?'':'https://fns-stt.karlapower007.workers.dev';
const FNS_STT_URL=FNS_API_BASE+'/stt';
const FNS_CHAT_URL=FNS_API_BASE+'/chat';
const FNS_TTS_URL=FNS_API_BASE+'/tts';
const teachers=[
{name:'Katya',accent:'American',gender:'female',provider:'LiveAvatar',premium:true,embed:'https://embed.liveavatar.com/v1/c605c6f9-9790-4db2-a3c2-1975926c433d?orientation=horizontal'},
{name:'Emma',accent:'American',gender:'female',provider:'FNS Lite',profile:'20 • United States',portrait:'emma.jpg'},
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
    return `<div id="avatarFace" class="avatar-face human-avatar" style="--mouth-open:0">
      <img class="avatar-photo avatar-photo-base" src="${t.portrait}" alt="${t.name}, professora virtual" loading="eager" referrerpolicy="no-referrer">
      <img class="avatar-photo avatar-photo-jaw" src="${t.portrait}" alt="" aria-hidden="true" referrerpolicy="no-referrer">
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
function addMsg(role,text){const t=document.querySelector('#transcript');if(!t)return;t.insertAdjacentHTML('beforeend',`<div class="msg ${role}">${escapeHtml(text)}</div>`);t.scrollTop=t.scrollHeight}
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
      if(document.querySelector('#avatarFace')) avatarFace.className='avatar-face avatar-listening';
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
      if(document.querySelector('#avatarFace')) avatarFace.className='avatar-face';
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
  if(face)face.className='avatar-face';
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
        lang:'en'
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
      if(face)face.className='avatar-face avatar-speaking';
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
