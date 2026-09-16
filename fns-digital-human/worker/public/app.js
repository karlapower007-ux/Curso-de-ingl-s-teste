const FNS_API_BASE=location.hostname.endsWith('workers.dev')?'':'https://fns-stt.karlapower007.workers.dev';
const FNS_STT_URL=FNS_API_BASE+'/stt';
const FNS_CHAT_URL=FNS_API_BASE+'/chat';
const FNS_REPAIR_STT_URL=FNS_API_BASE+'/repair-transcript';
const FNS_TTS_URL=FNS_API_BASE+'/tts';
const teachers=[
{name:'Katya',accent:'American',gender:'female',provider:'LiveAvatar',premium:true,embed:'https://embed.liveavatar.com/v1/c605c6f9-9790-4db2-a3c2-1975926c433d?orientation=horizontal'},
{name:'Emma',accent:'American',gender:'female',provider:'FNS Lite',profile:'20 • United States',portrait:'/emma.jpg'},
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
    return `<div id="avatarFace" class="avatar-face human-avatar" data-avatar-ready="false" style="--mouth-open:0;--mouth-wide:0;--gaze-x:0px;--gaze-y:0px">
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
  const quotaLike=neuralQuotaExhausted||/quota|4006|429/i.test(reason);
  neuralQuotaExhausted=quotaLike;
  browserSttPreferred=quotaLike;
  if(flowState===FLOW_STATES.IDLE){
    refreshFlowControls(reason?'Ouvido do navegador • '+reason:'Ouvido do navegador ativo');
  }
}


function selectedSttLanguage(){
  return document.querySelector('#sttLangSel')?.value||'auto';
}

function inferBrowserSttLanguage(){
  const selected=selectedSttLanguage();
  if(selected==='device')return navigator.language||'en-US';
  if(selected!=='auto')return selected;

  const recent=readBrowserMemory()
    .filter(x=>x.role==='user')
    .slice(-4)
    .map(x=>x.content)
    .join(' ')
    .toLowerCase();

  if(/[áàâãéêíóôõúç]|\b(você|vocês|não|uma|para|com|obrigad[oa]|então|porque)\b/i.test(recent))return 'pt-BR';
  if(/[¿¡ñ]|\b(hola|usted|ustedes|gracias|también|porque|quiero|puedo)\b/i.test(recent))return 'es-ES';
  if(/[àâçéèêëîïôûùüÿœ]|\b(bonjour|merci|avec|pour|parce|je|vous)\b/i.test(recent))return 'fr-FR';
  if(/[äöüß]|\b(hallo|danke|ich|nicht|und|weil)\b/i.test(recent))return 'de-DE';
  if(/\b(ciao|grazie|sono|non|perché|voglio|posso)\b/i.test(recent))return 'it-IT';
  return 'en-US';
}

function normalizeTranscriptText(input){
  return String(input||'')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF\uFFFD]/g,' ')
    .replace(/[^\p{L}\p{M}\p{N}\s'’.,?!:;\-]/gu,' ')
    .replace(/\s+([.,?!:;])/g,'$1')
    .replace(/[ \t]{2,}/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

function bestSpeechAlternative(result){
  const choices=[];
  const total=Math.min(Number(result?.length||0),3);
  for(let i=0;i<total;i++){
    const text=normalizeTranscriptText(result?.[i]?.transcript||'');
    const confidence=Number(result?.[i]?.confidence||0);
    if(text)choices.push({text,confidence:Number.isFinite(confidence)?confidence:0});
  }
  choices.sort((a,b)=>b.confidence-a.confidence);
  return choices[0]||{text:'',confidence:0};
}

function transcriptLooksCorrupt(text,confidence=0){
  const tokens=String(text||'').toLocaleLowerCase().match(/\p{L}[\p{L}\p{M}'’-]*/gu)||[];
  if(tokens.length<7)return false;

  const counts=new Map();
  let maxRun=1;
  let run=1;
  for(let i=0;i<tokens.length;i++){
    counts.set(tokens[i],(counts.get(tokens[i])||0)+1);
    if(i>0 && tokens[i]===tokens[i-1]){
      run++;
      if(run>maxRun)maxRun=run;
    }else{
      run=1;
    }
  }
  const uniqueRatio=counts.size/tokens.length;
  const maxShare=Math.max(...counts.values())/tokens.length;

  return maxRun>=4 ||
    (tokens.length>=9 && uniqueRatio<0.36 && maxShare>=0.30) ||
    (confidence>0 && confidence<0.12 && uniqueRatio<0.50);
}



function languageLabelFromCode(code){
  const labels={'en-US':'English','pt-BR':'Português','es-ES':'Español','fr-FR':'Français','de-DE':'Deutsch','it-IT':'Italiano','ja-JP':'日本語','ko-KR':'한국어','zh-CN':'中文'};
  return labels[code]||'the detected language';
}
function firstThreeWords(input){return (normalizeTranscriptText(input).match(/[\p{L}\p{M}'’-]+/gu)||[]).slice(0,3).join(' ').toLocaleLowerCase();}
function looksLikePortglish(input){const s=normalizeTranscriptText(input).toLocaleLowerCase();return /\b(mai neim|mai name|veri gudi?|tenk ?iu|tenquiu|ai em|ai am|rau ar iu|rrau ar iu|gudi (morning|night)|plesi|plis|sori|ai laik|ai live|ai lave|hau ar iu)\b/i.test(s);}
function detectAutoLanguageFromFirstWords(input){
  const sample=firstThreeWords(input),full=normalizeTranscriptText(input).toLocaleLowerCase();
  if(looksLikePortglish(input))return 'en-US';
  if(/[\u3040-\u30ff]/u.test(sample)||/[\u3040-\u30ff]/u.test(full))return 'ja-JP';
  if(/[\uac00-\ud7af]/u.test(sample)||/[\uac00-\ud7af]/u.test(full))return 'ko-KR';
  if(/[\u3400-\u9fff]/u.test(sample)||/[\u3400-\u9fff]/u.test(full))return 'zh-CN';
  const words=(sample.match(/\p{L}+/gu)||[]),scores={en:0,pt:0,es:0,fr:0,de:0,it:0};
  const sets={
    en:new Set(['i','you','my','name','is','am','are','the','what','how','hello','hi','yes','okay','ok','thanks','thank','good']),
    pt:new Set(['eu','você','voce','meu','minha','nome','é','e','sou','estou','como','que','não','nao','sim','obrigado','obrigada','bom','boa']),
    es:new Set(['yo','usted','tu','tú','mi','nombre','es','soy','estoy','como','cómo','que','sí','si','gracias','hola','bueno']),
    fr:new Set(['je','vous','tu','mon','nom','est','suis','comment','oui','merci','bonjour','bon']),
    de:new Set(['ich','du','sie','mein','name','ist','bin','wie','ja','danke','hallo','gut']),
    it:new Set(['io','tu','lei','mio','nome','è','sono','come','sì','si','grazie','ciao','buono'])
  };
  for(const word of words)for(const [k,set] of Object.entries(sets))if(set.has(word))scores[k]++;
  if(/[ãõçáâêô]/u.test(sample))scores.pt+=3;if(/[ñ¿¡]/u.test(sample))scores.es+=3;if(/[äöüß]/u.test(sample))scores.de+=3;if(/[àâçéèêëîïôûùüÿœ]/u.test(sample))scores.fr+=3;
  const best=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0];
  if(best?.[1]>0)return ({en:'en-US',pt:'pt-BR',es:'es-ES',fr:'fr-FR',de:'de-DE',it:'it-IT'})[best[0]];
  if(/[áàâãéêíóôõúç]|\b(você|não|uma|para|obrigad[oa]|então|meu|nome)\b/i.test(full))return 'pt-BR';
  if(/[¿¡ñ]|\b(hola|usted|gracias|quiero|puedo|mi nombre)\b/i.test(full))return 'es-ES';
  if(/[àâçéèêëîïôûùüÿœ]|\b(bonjour|merci|avec|parce)\b/i.test(full))return 'fr-FR';
  if(/[äöüß]|\b(hallo|danke|ich|nicht)\b/i.test(full))return 'de-DE';
  if(/\b(ciao|grazie|sono|perché|voglio)\b/i.test(full))return 'it-IT';
  return 'en-US';
}
function languageLockForTranscript(input){
  const selected=selectedSttLanguage();
  if(selected==='device'){const code=navigator.language||'en-US';return {code,label:languageLabelFromCode(code),source:'device'};}
  if(selected!=='auto')return {code:selected,label:languageLabelFromCode(selected),source:'manual'};
  const code=detectAutoLanguageFromFirstWords(input);return {code,label:languageLabelFromCode(code),source:'auto-first-3'};
}
function browserRecognitionLanguage(){const selected=selectedSttLanguage();if(selected==='device')return navigator.language||'en-US';if(selected!=='auto')return selected;return inferBrowserSttLanguage();}
function transcriptHasLanguageLeak(input,targetCode){
  const s=normalizeTranscriptText(input).toLocaleLowerCase();
  if(targetCode==='en-US')return /[ãõç]|\b(eu|você|voce|não|nao|uma|para|meu|minha|nome|obrigado|obrigada|muito|bom|boa|estou|sou)\b/i.test(s);
  if(targetCode==='pt-BR')return /\b(i am|i'm|my name|thank you|very good|how are you|hello|good morning)\b/i.test(s);
  if(targetCode==='es-ES')return /\b(i am|my name|thank you|hello)\b/i.test(s)&&!/[ñ¿¡]/u.test(s);
  return false;
}
function strictLanguageInstructionFor(input){
  const lock=languageLockForTranscript(input),map={
    'en-US':'Reply strictly in English. Do not mix Portuguese into the answer unless the user explicitly asks for a translation.',
    'pt-BR':'Responda estritamente em português brasileiro. Não misture inglês na resposta, exceto se o usuário pedir tradução.',
    'es-ES':'Responde estrictamente en español. No mezcles portugués o inglés salvo que el usuario pida una traducción.',
    'fr-FR':'Réponds strictement en français. Ne mélange pas d’autres langues sauf si l’utilisateur demande une traduction.',
    'de-DE':'Antworte strikt auf Deutsch. Mische keine andere Sprache ein, außer der Nutzer bittet ausdrücklich um eine Übersetzung.',
    'it-IT':'Rispondi rigorosamente in italiano. Non mescolare altre lingue salvo richiesta esplicita di traduzione.',
    'ja-JP':'日本語だけで答えてください。ユーザーが翻訳を明示的に求めた場合を除き、他言語を混ぜないでください。',
    'ko-KR':'한국어로만 답하세요. 사용자가 번역을 명시적으로 요청하지 않는 한 다른 언어를 섞지 마세요.',
    'zh-CN':'请严格只用中文回答。除非用户明确要求翻译，否则不要混用其他语言。'
  };
  return map[lock.code]||'Reply strictly in the input language. Do not mix languages unless translation is explicitly requested.';
}

function collapseRepeatedTranscriptPhrases(input){
  let text=normalizeTranscriptText(input);
  if(!text)return '';

  // Plano B: remove loops de uma palavra (4+) e de frases curtas (3+).
  text=text.replace(/\b(\p{L}[\p{L}\p{M}'’-]*)(?:\s+\1){3,}\b/giu,'$1');
  text=text.replace(/\b((?:\p{L}[\p{L}\p{M}'’-]*\s+){1}\p{L}[\p{L}\p{M}'’-]*)(?:\s+\1){2,}\b/giu,'$1');
  text=text.replace(/\b((?:\p{L}[\p{L}\p{M}'’-]*\s+){2}\p{L}[\p{L}\p{M}'’-]*)(?:\s+\1){2,}\b/giu,'$1');

  return normalizeTranscriptText(text);
}

function isLikelySttNoise(input){
  const plain=normalizeTranscriptText(input)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
  if(!plain)return true;
  const words=plain.split(' ').filter(Boolean);
  if(words.length>5)return false;
  const noise=new Set([
    'obrigado','obrigada','muito obrigado','muito obrigada',
    'thanks','thank you','thanks for watching','thank you for watching',
    'legendas','legendas pela comunidade','subtitles','subtitle',
    'music','música','musica','applause','aplausos','silence','silêncio','silencio'
  ]);
  return noise.has(plain);
}

async function repairTranscriptWithLLM(rawText,regexCleaned='',targetLanguage=''){
  const raw=normalizeTranscriptText(rawText).slice(0,700);
  const cleaned=normalizeTranscriptText(regexCleaned).slice(0,700);
  if(!raw)return '';

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('stt-repair-timeout'),2600);
  try{
    const response=await fetch(FNS_REPAIR_STT_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        text:raw,
        cleaned,
        language:targetLanguage||languageLockForTranscript(raw).code,
        phonetic_english:(targetLanguage||languageLockForTranscript(raw).code)==='en-US'&&looksLikePortglish(raw)
      }),
      signal:controller.signal
    });
    if(!response.ok)return '';
    const data=await response.json().catch(()=>({}));
    const repaired=normalizeTranscriptText(data?.text||'');
    if(!repaired||isLikelySttNoise(repaired)||transcriptLooksCorrupt(repaired,1))return '';
    return repaired;
  }catch(error){
    return '';
  }finally{
    clearTimeout(timer);
  }
}

async function recoverTranscriptCandidate(rawText,confidence=0,meta={}){
  const raw=normalizeTranscriptText(rawText);
  if(!raw)return {kind:'empty',text:'',language:''};
  const lock=languageLockForTranscript(raw),targetLanguage=meta?.targetLanguage||lock.code;
  if(isLikelySttNoise(raw))return {kind:'noise',text:'',language:targetLanguage};
  if(meta?.shortAudio===true&&lock.source==='manual'&&!looksLikePortglish(raw)&&!transcriptHasLanguageLeak(raw,targetLanguage))return {kind:'short-locked',text:raw,language:targetLanguage};
  if(looksLikePortglish(raw)||transcriptHasLanguageLeak(raw,targetLanguage)){
    const fixed=await repairTranscriptWithLLM(raw,collapseRepeatedTranscriptPhrases(raw),targetLanguage);
    if(fixed)return {kind:'language-repair',text:fixed,language:targetLanguage};
  }
  if(!transcriptLooksCorrupt(raw,confidence))return {kind:'direct',text:raw,language:targetLanguage};
  const cleaned=collapseRepeatedTranscriptPhrases(raw);
  if(cleaned&&!isLikelySttNoise(cleaned)&&!transcriptLooksCorrupt(cleaned,1)){
    if(transcriptHasLanguageLeak(cleaned,targetLanguage)){
      const fixed=await repairTranscriptWithLLM(raw,cleaned,targetLanguage);
      if(fixed)return {kind:'language-repair',text:fixed,language:targetLanguage};
    }
    return {kind:'regex',text:cleaned,language:targetLanguage};
  }
  const repaired=await repairTranscriptWithLLM(raw,cleaned,targetLanguage);
  if(repaired)return {kind:'llm',text:repaired,language:targetLanguage};
  return {kind:'failed',text:'',language:targetLanguage};
}

function sttGracefulFailureText(){
  const lang=inferBrowserSttLanguage();
  if(lang==='en-US')return "Sorry, I couldn't understand because of the noise. Could you repeat that?";
  if(lang==='es-ES')return 'Lo siento, no pude entenderte por el ruido. ¿Puedes repetirlo?';
  if(lang==='fr-FR')return "Désolée, je n'ai pas pu comprendre à cause du bruit. Peux-tu répéter ?";
  if(lang==='de-DE')return 'Entschuldigung, wegen der Geräusche konnte ich dich nicht verstehen. Kannst du das wiederholen?';
  if(lang==='it-IT')return 'Scusa, non sono riuscita a capire a causa del rumore. Puoi ripetere?';
  return 'Desculpe, não consegui entender devido ao ruído. Pode repetir?';
}

let sttGracefulFailureInFlight=false;
async function gracefulSttFailure(){
  if(sttGracefulFailureInFlight)return false;
  sttGracefulFailureInFlight=true;
  const message=sttGracefulFailureText();
  try{
    if(flowState!==FLOW_STATES.PROCESSING){
      setFlowState(FLOW_STATES.PROCESSING,{force:true,status:'Pode repetir'});
    }
    addMsg('teacher',message);
    const spoken=await speak(message);
    if(!spoken && flowState!==FLOW_STATES.IDLE){
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
    }
    return true;
  }finally{
    sttGracefulFailureInFlight=false;
  }
}


function replyLanguageInstruction(text){
  return strictLanguageInstructionFor(text);
}


function startBrowserOnlySTT(){
  if(flowState!==FLOW_STATES.IDLE || isSpeaking || isProcessing)return false;
  const Ctor=browserSpeechCtor();
  if(!Ctor){
    void gracefulSttFailure();
    return false;
  }

  const session=++browserSessionSeq;
  const r=new Ctor();
  browserFallbackRecognition=r;
  browserFallbackTranscript='';
  browserFallbackActive=false;
  listeningEngine='browser';

  r.continuous=true;
  r.interimResults=true;
  r.maxAlternatives=3;
  r.lang=browserRecognitionLanguage();

  let finalParts=[];
  let interimText='';
  let finalConfidence=[];
  let interimConfidence=0;
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
    interimConfidence=0;
    for(let i=event.resultIndex;i<event.results.length;i++){
      const best=bestSpeechAlternative(event.results[i]);
      if(!best.text)continue;
      if(event.results[i].isFinal){
        finalParts.push(best.text);
        finalConfidence.push(best.confidence);
      }else{
        interimText=best.text;
        interimConfidence=best.confidence;
      }
    }
    browserFallbackTranscript=normalizeTranscriptText(finalParts.join(' ')||interimText);
  };

  r.onerror=(event)=>{
    if(session!==browserSessionSeq || browserFallbackRecognition!==r)return;
    errorCode=String(event?.error||'');
  };

  r.onend=async()=>{
    if(session!==browserSessionSeq || browserFallbackRecognition!==r)return;
    const text=normalizeTranscriptText(finalParts.join(' ')||browserFallbackTranscript||interimText);
    const confidence=finalConfidence.length?finalConfidence.reduce((a,b)=>a+b,0)/finalConfidence.length:interimConfidence;
    detachBrowserRecognition(r);
    const face=document.querySelector('#avatarFace');
    if(face)face.classList.remove('avatar-listening');
    browserFallbackTranscript='';

    if(!text){
      if(errorCode && errorCode!=='aborted' && errorCode!=='no-speech'){
        await gracefulSttFailure();
      }else{
        setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
      }
      return;
    }

    setFlowState(FLOW_STATES.PROCESSING,{force:true,status:'Limpando transcrição'});
    const recovered=await recoverTranscriptCandidate(text,confidence,{targetLanguage:languageLockForTranscript(text).code});

    if(recovered.kind==='noise'||recovered.kind==='empty'){
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
      return;
    }

    if(recovered.text){
      await handleUser(recovered.text,{stateOwned:true});
      return;
    }

    await gracefulSttFailure();
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

function openLiteTeacher(i,level='A1',mode='conversation',topic='General conversation'){activeTeacher={...teachers[i],i,level,mode,topic};document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="liteModal"><div class="room"><button class="close" onclick="stopRecognition();stopRemoteVoice();liteModal.remove()">Encerrar</button><div class="row"><h2 style="margin-right:auto">${activeTeacher.name} • ${activeTeacher.accent}</h2><span class="status"><i id="statusDot" class="dot on"></i><span id="statusText">Ready</span></span></div><div class="chat-shell"><div class="avatar-stage">${avatarVisualMarkup(activeTeacher)}<div class="avatar-label"><b>${activeTeacher.name}</b><br><span class="small">${activeTeacher.accent} English • FNS Lite</span>${activeTeacher.profile?'<br><span class="small">'+activeTeacher.profile+'</span>':''}${activeTeacher.photoCredit?'<br><span class="photo-credit">Visual pilot • '+activeTeacher.photoCredit+'</span>':''}</div></div><div class="chat-panel"><div class="row"><select id="levelSel" style="width:auto">${levels.map(x=>`<option ${x===level?'selected':''}>${x}</option>`).join('')}</select><select id="modeSel" style="width:auto"><option value="conversation">Conversation</option><option value="drill">Drill</option><option value="lesson">Lesson</option><option value="pronunciation">Pronunciation</option><option value="review">Review</option></select><select id="sttLangSel" style="width:auto" title="Idioma do microfone"><option value="auto" selected>🎙️ Auto multilíngue</option><option value="en-US">English</option><option value="pt-BR">Português</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option><option value="it-IT">Italiano</option><option value="ja-JP">日本語</option><option value="ko-KR">한국어</option><option value="zh-CN">中文</option><option value="device">Idioma do aparelho</option></select></div><div id="transcript" class="transcript"><div class="msg system">FNS Lite usa microfone + Whisper remoto gratuito para entender sua fala. Nenhuma API key fica no navegador.</div><div class="msg teacher">Hello! I'm ${activeTeacher.name}. ${openingPrompt(level,topic)}</div></div><div class="row" style="margin-top:10px"><button id="micBtn" class="good" onclick="toggleRecognition()">🎤 Falar</button><button onclick="stopRecognition()">Parar</button><button id="voiceBtn" class="primary" onclick="unlockVoice()">🔊 Ativar voz</button><button onclick="unlockAndRepeat()">🔁 Repetir</button></div><div class="row"><input id="chatInput" placeholder="Digite em inglês..." onkeydown="if(event.key==='Enter')sendTyped()"><button id="sendBtn" class="primary" onclick="sendTyped()">Enviar</button></div><div class="small muted">Primeiro clique uma vez em 🔊 Ativar voz. Depois use 🎤 Falar → diga sua frase → ⏹ Enviar fala. A resposta será falada automaticamente.</div></div></div></div></div>`);document.querySelector('#modeSel').value=mode;setFlowState(FLOW_STATES.IDLE,{force:true});if(neuralQuotaExhausted)enterQuotaRestMode();speak(`Hello! I'm ${activeTeacher.name}. ${openingPrompt(level,topic)}`)}
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
  const normalized=display.replace(/\s+/g,' ').trim();
  if(!normalized)return;

  const last=t.lastElementChild;
  const key=role+'|'+normalized.slice(0,500);
  const now=Date.now();
  if(last?.dataset?.fnsMessageKey===key && (now-Number(last.dataset.fnsMessageTs||0))<4500){
    t.scrollTop=t.scrollHeight;
    return;
  }

  const node=document.createElement('div');
  node.className='msg '+role;
  node.textContent=display;
  node.dataset.fnsMessageKey=key;
  node.dataset.fnsMessageTs=String(now);
  t.appendChild(node);
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


let browserAutoFallbackSeq=0;

function startBrowserFallbackOnce(reason=''){
  const seq=++browserAutoFallbackSeq;
  activateBrowserSttMode(reason||'fallback');
  if(flowState!==FLOW_STATES.IDLE){
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ativando reconhecimento do navegador'});
  }else{
    refreshFlowControls('Ativando reconhecimento do navegador');
  }

  setTimeout(()=>{
    if(seq!==browserAutoFallbackSeq)return;
    if(flowState!==FLOW_STATES.IDLE || isSpeaking || isProcessing || isRecording)return;
    const started=startBrowserOnlySTT();
    if(!started){
      void gracefulSttFailure();
    }
  },80);
}

async function startRecording(){
  if(flowState!==FLOW_STATES.IDLE || isSpeaking || isProcessing)return;
  if(browserSttPreferred||neuralQuotaExhausted){
    startBrowserOnlySTT();
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){
    startBrowserFallbackOnce('MediaRecorder indisponível');
    return;
  }

  const session=++mediaSessionSeq;
  listeningEngine='media';
  setFlowState(FLOW_STATES.LISTENING,{status:'Abrindo microfone'});

  let stream=null;
  try{
    const constraints={
      audio:{
        echoCancellation:true,
        noiseSuppression:true,
        autoGainControl:true,
        channelCount:1
      }
    };
    stream=await navigator.mediaDevices.getUserMedia(constraints);
    if(session!==mediaSessionSeq || flowState!==FLOW_STATES.LISTENING){
      stream.getTracks().forEach(t=>t.stop());
      return;
    }

    const audioTrack=stream.getAudioTracks?.()[0]||null;
    if(!audioTrack){
      stream.getTracks().forEach(t=>t.stop());
      startBrowserFallbackOnce('microfone não detectado');
      return;
    }

    mediaStream=stream;
    audioChunks=[];
    const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
    const mimeType=preferred.find(t=>MediaRecorder.isTypeSupported(t))||'';
    const recorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
    mediaRecorder=recorder;

    recorder.ondataavailable=e=>{
      if(session!==mediaSessionSeq)return;
      if(e.data && e.data.size>0)audioChunks.push(e.data);
    };

    recorder.onstart=()=>{
      if(session!==mediaSessionSeq)return;
      refreshFlowControls('Microfone detectado • ouvindo');
      const face=document.querySelector('#avatarFace');
      if(face)face.classList.add('avatar-listening');
      recordingTimer=setTimeout(()=>stopRecordingAndSend(),45000);
    };

    recorder.onerror=()=>{
      if(session!==mediaSessionSeq)return;
      cancelMediaRecorderSession(session);
      startBrowserFallbackOnce('falha no MediaRecorder');
    };

    recorder.onstop=async()=>{
      if(session!==mediaSessionSeq)return;
      clearTimeout(recordingTimer);
      const mime=recorder.mimeType||mimeType||'audio/webm';
      const blob=new Blob(audioChunks,{type:mime});
      releaseMediaRecorder(recorder,stream,session);
      const face=document.querySelector('#avatarFace');
      if(face)face.classList.remove('avatar-listening');

      if(blob.size<1200){
        startBrowserFallbackOnce('áudio vazio');
        return;
      }

      try{
        setStatus('Áudio captado • processando','busy');
        const wav=await recordingToWav(blob);
        await transcribeWithFNS(wav);
      }catch(error){
        startBrowserFallbackOnce('falha ao preparar áudio');
      }
    };

    recorder.start(250);
  }catch(err){
    if(stream)stream.getTracks().forEach(t=>t.stop());
    if(session===mediaSessionSeq){
      startBrowserFallbackOnce('acesso ao microfone');
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
      headers:{'Content-Type':blob.type||'audio/wav','X-FNS-STT-Language':selectedSttLanguage()},
      body:blob
    });
    const data=await res.json().catch(()=>({}));

    // Plano D: se Whisper/Workers AI falhar ou estourar timeout/cota, use Web Speech.
    if(isSttBackendFailure(data,res.status)){
      if(isQuotaPayload(data,res.status))neuralQuotaExhausted=true;
      startBrowserFallbackOnce('HTTP '+res.status);
      return;
    }

    if(!res.ok)throw new Error(data?.message||data?.error||('HTTP '+res.status));

    const text=normalizeTranscriptText(data?.text||'');
    if(!text){
      startBrowserFallbackOnce('Whisper sem fala');
      return;
    }

    const recovered=await recoverTranscriptCandidate(text,1,{shortAudio:data?.short_audio===true,targetLanguage:(data?.language&&data.language!=='auto')?({'en':'en-US','pt':'pt-BR','es':'es-ES','fr':'fr-FR','de':'de-DE','it':'it-IT','ja':'ja-JP','ko':'ko-KR','zh':'zh-CN'}[data.language]||data.language):languageLockForTranscript(text).code});

    // Plano E: ruído conhecido é ignorado sem bloco de erro.
    if(recovered.kind==='noise'||recovered.kind==='empty'){
      setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
      return;
    }

    if(recovered.text){
      await handleUser(recovered.text,{stateOwned:true});
      return;
    }

    // Se A/B/C não recuperarem, tente D.
    startBrowserFallbackOnce('Whisper irreparável');
  }catch(err){
    startBrowserFallbackOnce('rede indisponível');
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


const FNS_MEMORY_MAX_MESSAGES=60;
const FNS_MEMORY_LOCAL_PREFIX='fns_digital_human_memory_v1_';
const FNS_MEMORY_SESSION_PREFIX='fns_digital_human_session_v1_';

function memoryTeacherSlug(){
  return String(activeTeacher?.name||'Emma').toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,40)||'emma';
}

function memoryStorageKey(){
  return FNS_MEMORY_LOCAL_PREFIX+memoryTeacherSlug();
}

function memorySessionKey(){
  return FNS_MEMORY_SESSION_PREFIX+memoryTeacherSlug();
}

function normalizeBrowserMemory(items){
  if(!Array.isArray(items))return [];
  const clean=items
    .filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string')
    .map(x=>({
      role:x.role,
      content:String(x.content).trim().slice(0,1600),
      ts:Number.isFinite(Number(x.ts))?Number(x.ts):0
    }))
    .filter(x=>x.content)
    .sort((a,b)=>(a.ts||0)-(b.ts||0));

  const deduped=[];
  for(const item of clean){
    const prev=deduped[deduped.length-1];
    const same=prev&&prev.role===item.role&&prev.content===item.content;
    const close=same&&(!prev.ts||!item.ts||Math.abs(item.ts-prev.ts)<15000);
    if(close){
      if((item.ts||0)>=(prev.ts||0))deduped[deduped.length-1]=item;
      continue;
    }
    deduped.push(item);
  }
  return deduped.slice(-FNS_MEMORY_MAX_MESSAGES);
}

function readBrowserMemory(){
  const key=memoryStorageKey();
  const stores=[];
  try{stores.push(localStorage)}catch(e){}
  try{stores.push(sessionStorage)}catch(e){}
  for(const store of stores){
    try{
      const raw=store.getItem(key);
      if(!raw)continue;
      const parsed=normalizeBrowserMemory(JSON.parse(raw));
      if(parsed.length)return parsed;
    }catch(e){}
  }
  return [];
}

function writeBrowserMemory(history){
  const clean=normalizeBrowserMemory(history);
  const raw=JSON.stringify(clean);
  try{localStorage.setItem(memoryStorageKey(),raw)}catch(e){}
  try{sessionStorage.setItem(memoryStorageKey(),raw)}catch(e){}
  return clean;
}

function rememberExchange(userText,assistantText){
  const now=Date.now();
  return writeBrowserMemory([
    ...readBrowserMemory(),
    {role:'user',content:String(userText||'').trim(),ts:now},
    {role:'assistant',content:String(assistantText||'').trim(),ts:now+1}
  ]);
}

function getMemorySessionId(){
  const key=memorySessionKey();
  let id='';
  try{id=localStorage.getItem(key)||''}catch(e){}
  if(!id){
    try{id=sessionStorage.getItem(key)||''}catch(e){}
  }
  if(!id){
    id=(globalThis.crypto?.randomUUID?.()||('fns-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,14))).replace(/[^a-zA-Z0-9_-]/g,'');
    try{localStorage.setItem(key,id)}catch(e){}
    try{sessionStorage.setItem(key,id)}catch(e){}
  }
  return id;
}

function memoryMessagesForProvider(history=readBrowserMemory(),limit=24){
  return normalizeBrowserMemory(history).slice(-limit).map(x=>({role:x.role,content:x.content}));
}

function memoryTextForPrompt(history=readBrowserMemory(),limit=24){
  return memoryMessagesForProvider(history,limit)
    .map(x=>(x.role==='assistant'?'Emma: ':'User: ')+x.content)
    .join('\n');
}

function previousUserMemory(history=readBrowserMemory()){
  const clean=normalizeBrowserMemory(history);
  for(let i=clean.length-1;i>=0;i--){
    if(clean[i].role==='user')return clean[i].content;
  }
  return '';
}

function sendTyped(){
  const el=document.querySelector('#chatInput');
  if(!el||!el.value.trim()||flowState!==FLOW_STATES.IDLE)return;
  const text=el.value.trim();
  el.value='';
  setFlowState(FLOW_STATES.PROCESSING,{status:'Thinking'});
  handleUser(text,{stateOwned:true});
}

async function pollinationsBrowserReply(text,history=readBrowserMemory()){
  const userText=String(text||'').trim().slice(0,700);
  if(!userText)throw new Error('Mensagem vazia.');

  const level=document.querySelector('#levelSel')?.value||activeTeacher?.level||'A1';
  const mode=document.querySelector('#modeSel')?.value||activeTeacher?.mode||'conversation';
  const lock=languageLockForTranscript(userText);
  const lang=replyLanguageInstruction(userText);
  const invisibleLanguageTag='[Input language locked to '+lock.label+': "'+userText.replace(/"/g,'')+'"]';
  const remembered=memoryTextForPrompt(history,24);

  const prompt=[
    'You are Emma, a friendly concise language tutor.',
    lang,
    'CEFR '+level+'. Mode: '+mode+'.',
    'Correct language mistakes gently when useful.',
    'Continue the same topic unless the user clearly changes it.',
    'If a transcript looks garbled or repetitive, ask for repetition instead of guessing or quoting garbage.',
    'Never mix languages unless the user explicitly asks for translation.',
    invisibleLanguageTag,
    remembered?'Recent conversation:\n'+remembered:'',
    'User: '+userText,
    'Emma:'
  ].filter(Boolean).join('\n');

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

async function llm7BrowserReply(text,history=readBrowserMemory(),timeoutMs=2200){
  const userText=String(text||'').trim().slice(0,700);
  if(!userText)throw new Error('Mensagem vazia para o cérebro LLM7.');

  const level=document.querySelector('#levelSel')?.value||activeTeacher?.level||'A1';
  const mode=document.querySelector('#modeSel')?.value||activeTeacher?.mode||'conversation';
  const lock=languageLockForTranscript(userText);
  const strictLanguage=strictLanguageInstructionFor(userText);
  const system=[
    'You are Emma, a friendly multilingual language teacher.',
    'Reply naturally and briefly for spoken conversation.',
    strictLanguage,
    'Never mix languages unless the user explicitly asks for translation.',
    'Correct language mistakes gently when useful.',
    'Keep continuity with the recent conversation history and stay on the same topic until the user changes it.',
    'If the user message looks garbled or mechanically repetitive, ask them to repeat instead of inventing meaning.',
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
          ...memoryMessagesForProvider(history,24),
          {role:'system',content:'[Input language locked to '+lock.label+': "'+userText.replace(/"/g,'')+'"]'},
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

async function emergencyBrainReply(text,history=readBrowserMemory()){
  enterQuotaRestMode({preserveFlow:true});
  try{
    return await pollinationsBrowserReply(text,history);
  }catch(pollinationsError){
    try{
      return await llm7BrowserReply(text,history);
    }catch(llm7Error){
      return teacherReply(text,history);
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
  const memoryBefore=readBrowserMemory();
  const memorySessionId=getMemorySessionId();
  const inputLanguageLock=languageLockForTranscript(text);
  addMsg('user',text);
  addPracticeMessage();

  let reply='';

  try{
    if(browserSttPreferred||neuralQuotaExhausted){
      reply=await emergencyBrainReply(text,memoryBefore);
    }else{
      const response=await fetch(FNS_CHAT_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          message:text,
          teacher:activeTeacher?.name||'Emma',
          level:document.querySelector('#levelSel')?.value||'A1',
          accent:activeTeacher?.accent||'British',
          session_id:memorySessionId,
          input_language:inputLanguageLock.code,
          input_language_label:inputLanguageLock.label,
          history:memoryBefore
        })
      });

      const data=await response.json().catch(()=>({}));
      if(turn!==conversationTurnSeq)return;

      if(isQuotaPayload(data,response.status) || data?.browser_fallback===true || data?.code==='FNS_BROWSER_POLLINATIONS'){
        reply=await emergencyBrainReply(text,memoryBefore);
      }else if(!response.ok||!data.ok){
        reply=await emergencyBrainReply(text,memoryBefore);
      }else{
        reply=String(data.reply||'Could you say that again?').trim();
      }
    }
  }catch(error){
    if(turn!==conversationTurnSeq)return;
    reply=await emergencyBrainReply(text,memoryBefore);
  }

  if(turn!==conversationTurnSeq)return;
  reply=String(reply||teacherReply(text,memoryBefore)).trim();
  rememberExchange(text,reply);
  addMsg('teacher',reply);

  const spoken=await speak(reply,{fromProcessing:true});
  if(turn===conversationTurnSeq && !spoken && flowState===FLOW_STATES.PROCESSING){
    setFlowState(FLOW_STATES.IDLE,{force:true,status:'Ready'});
  }
}
function teacherReply(text,history=readBrowserMemory()){const x=text.trim(),low=x.toLowerCase(),level=document.querySelector('#levelSel')?.value||activeTeacher.level,mode=document.querySelector('#modeSel')?.value||activeTeacher.mode,previousUser=previousUserMemory(history),lock=languageLockForTranscript(x);let correction='';
if(lock.code==='pt-BR')return 'Entendi. Vamos continuar exatamente no mesmo assunto. Conte mais um detalhe.';
if(lock.code==='es-ES')return 'Entiendo. Sigamos exactamente con el mismo tema. Cuéntame un detalle más.';
if(lock.code==='fr-FR')return 'Je comprends. Restons exactement sur le même sujet. Donne-moi un détail de plus.';
if(lock.code==='de-DE')return 'Verstanden. Bleiben wir genau bei demselben Thema. Erzähl mir noch ein Detail.';
if(lock.code==='it-IT')return 'Capisco. Restiamo esattamente sullo stesso argomento. Dimmi un dettaglio in più.';
if(lock.code==='ja-JP')return 'わかりました。同じ話題を続けましょう。もう一つ詳しく教えてください。';
if(lock.code==='ko-KR')return '알겠습니다. 같은 주제를 계속 이야기해요. 한 가지 더 자세히 말해 주세요.';
if(lock.code==='zh-CN')return '明白了。我们继续同一个话题。请再告诉我一个细节。';
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
if(previousUser){
  const anchor=normalizeTranscriptText(previousUser).replace(/\s+/g,' ').slice(0,110);
  if(anchor&&!transcriptLooksCorrupt(anchor,1)){
    return correction+`Let's stay with the same topic. You were talking about “${anchor}”. What happened next?`;
  }
  return correction+'Let’s stay with the same topic. Please add one more detail.';
}
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

      const target=Math.max(0,Math.min(1,(rms-.008)/.075));
      const frameScale=lastTs?Math.min(1,(ts-lastTs)/16.67):1;
      const attack=.32*frameScale;
      const release=.15*frameScale;
      const alpha=target>smoothOpen?attack:release;
      smoothOpen=smoothOpen+(target-smoothOpen)*alpha;
      lastTs=ts;

      face.style.setProperty('--mouth-open',smoothOpen.toFixed(3));
      face.style.setProperty('--mouth-wide',Math.min(.62,smoothOpen*.76).toFixed(3));
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
