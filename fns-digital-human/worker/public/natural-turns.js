const FNS_coreStartRecording=startRecording;
startRecording=async function(){
  if(currentVoiceAudio&&!currentVoiceAudio.paused)stopRemoteVoice();
  const result=FNS_coreStartRecording();
  let tries=0;
  const watcher=setInterval(()=>{
    restoreHumanAvatar();
    if(recognizing){
      setNaturalAvatarState('listening');
      clearInterval(watcher);
    }
    if(++tries>30)clearInterval(watcher);
  },80);
  return result;
};

const FNS_coreStopRemoteVoice=stopRemoteVoice;
stopRemoteVoice=function(){
  FNS_coreStopRemoteVoice();
  restoreHumanAvatar();
  setNaturalAvatarState('idle');
};

const FNS_coreRemoteSpeak=remoteSpeak;
remoteSpeak=async function(text){
  const result=await FNS_coreRemoteSpeak(text);
  const audio=currentVoiceAudio;
  if(audio){
    restoreHumanAvatar();
    setNaturalAvatarState('speaking');
    audio.addEventListener('ended',()=>{
      restoreHumanAvatar();
      setNaturalAvatarState('idle');
      if(FNSNatural.handsFree&&document.querySelector('#liteModal')){
        clearTimeout(FNSNatural.handsTimer);
        FNSNatural.handsTimer=setTimeout(()=>{
          if(FNSNatural.handsFree&&!recognizing&&document.querySelector('#liteModal'))startRecording();
        },650);
      }
    },{once:true});
  }
  return result;
};

/* FNS STT POST-PROCESS LANGUAGE LOCK v1
   Surgical guard only: preserves manual EN/PT/ES after Whisper and rejects
   repair/fallback output that drifts into another language. No visual code. */
(()=>{
  const MANUAL_LANGUAGES=new Set(['en-US','pt-BR','es-ES']);
  const TOKEN_SETS={
    'en-US':new Set(['i','my','you','your','am','is','are','the','this','that','please','thank','thanks','hello','hi','can','could','would','want','need','wait','where','who','what','when','why','how']),
    'pt-BR':new Set(['eu','meu','minha','você','voce','sou','estou','não','nao','obrigado','obrigada','quero','preciso','pode','aguarde','hoje','portaria','crachá','cracha']),
    'es-ES':new Set(['yo','usted','tú','tu','soy','estoy','gracias','quiero','necesito','puede','espere','hoy','recepción','recepcion','credencial'])
  };

  function languageScores(input){
    const words=(normalizeTranscriptText(input).toLocaleLowerCase().match(/\p{L}[\p{L}\p{M}'’-]*/gu)||[]);
    const scores={'en-US':0,'pt-BR':0,'es-ES':0};
    for(const word of words){
      for(const code of Object.keys(TOKEN_SETS)){
        if(TOKEN_SETS[code].has(word))scores[code]++;
      }
    }
    return scores;
  }

  function sameLanguageOrNeutral(input,targetLanguage){
    const text=normalizeTranscriptText(input);
    if(!text||!MANUAL_LANGUAGES.has(targetLanguage))return true;
    const lower=text.toLocaleLowerCase();
    const scores=languageScores(text);
    const own=scores[targetLanguage]||0;

    const strong={
      'en-US':/\b(my name is|i am|i'm|thank you|how are you|can you|could you|please wait)\b/i,
      'pt-BR':/\b(meu nome (é|e)|eu sou|eu estou|muito obrigado|muito obrigada|você pode|voce pode|por favor aguarde)\b/i,
      'es-ES':/\b(me llamo|mi nombre es|yo soy|yo estoy|muchas gracias|usted puede|por favor espere)\b/i
    };

    for(const code of MANUAL_LANGUAGES){
      if(code===targetLanguage)continue;
      const other=scores[code]||0;
      if(strong[code].test(lower)&&!strong[targetLanguage].test(lower))return false;
      if(other>=3&&other>=own+2)return false;
    }
    return true;
  }

  const FNS_coreRepairTranscriptWithLLM=repairTranscriptWithLLM;
  repairTranscriptWithLLM=async function(rawText,regexCleaned='',targetLanguage=''){
    const raw=normalizeTranscriptText(rawText).slice(0,700);
    const cleaned=normalizeTranscriptText(regexCleaned).slice(0,700);
    const selected=selectedSttLanguage();
    const target=targetLanguage||languageLockForTranscript(raw).code;
    const manual=MANUAL_LANGUAGES.has(selected)&&selected===target;

    // Manual language selection wins. Valid text never enters a generic repair LLM.
    if(manual&&raw&&!looksLikePortglish(raw)&&!transcriptLooksCorrupt(raw,1)&&sameLanguageOrNeutral(raw,target)){
      return raw;
    }

    const repaired=await FNS_coreRepairTranscriptWithLLM(raw,cleaned,target);
    if(!repaired)return '';

    // Absolute post-repair language gate: never allow a repair to translate EN/PT/ES.
    if(MANUAL_LANGUAGES.has(target)&&!sameLanguageOrNeutral(repaired,target)){
      console.warn('[FNS STT LOCK] repair rejected because language drifted from',target);
      return '';
    }
    return repaired;
  };

  const FNS_coreRecoverTranscriptCandidate=recoverTranscriptCandidate;
  recoverTranscriptCandidate=async function(rawText,confidence=0,meta={}){
    const raw=normalizeTranscriptText(rawText);
    const selected=selectedSttLanguage();
    const manual=MANUAL_LANGUAGES.has(selected);
    const target=manual?selected:(meta?.targetLanguage||languageLockForTranscript(raw).code);

    if(!raw)return {kind:'empty',text:'',language:target};

    // Bypass de segurança: EN/PT/ES manual + transcrição íntegra = texto cru do STT.
    if(manual&&!isLikelySttNoise(raw)&&!looksLikePortglish(raw)&&!transcriptLooksCorrupt(raw,confidence)&&sameLanguageOrNeutral(raw,target)){
      return {kind:'manual-direct',text:raw,language:target};
    }

    const result=await FNS_coreRecoverTranscriptCandidate(raw,confidence,{...meta,targetLanguage:target});
    if(!manual||!result?.text)return result;

    if(sameLanguageOrNeutral(result.text,target)){
      return {...result,language:target};
    }

    // If an intermediate repair leaks language, prefer deterministic cleanup only.
    const cleaned=collapseRepeatedTranscriptPhrases(raw);
    if(cleaned&&!isLikelySttNoise(cleaned)&&!transcriptLooksCorrupt(cleaned,confidence)&&sameLanguageOrNeutral(cleaned,target)){
      return {kind:'manual-regex-bypass',text:cleaned,language:target};
    }

    console.warn('[FNS STT LOCK] post-processing language leak blocked for',target);
    return {kind:'failed',text:'',language:target};
  };

  window.FNS_STT_LANGUAGE_GUARD={
    version:'v1',
    manualLanguages:[...MANUAL_LANGUAGES],
    languageScores,
    sameLanguageOrNeutral,
    selected(){return selectedSttLanguage();}
  };
})();

/* FNS EMMA OUTPUT LANGUAGE LOCK A-H FRONTEND
   Output-only containment. Does not modify the PNGTuber image engine. */
(()=>{
  const CONFIG=Object.freeze({
    strict:true,
    strict_language:'en-US',
    label:'English Only',
    temperature:0.25,
    version:'A-H-v1'
  });
  const CRITICAL_RULE='CRITICAL RULE: You are Emma. You MUST reply EXCLUSIVELY in English. Use simple, introductory A1 CEFR level English suitable for workplace scenarios and daily interactions. Under NO circumstances are you allowed to generate Portuguese text. Ignore any implicit requests to change language.';
  const USER_SUFFIX='[System note: Reply ONLY in English, adapting to an A1 English learner practicing workplace dialogues].';
  const PT_WORDS=new Set(['que','para','você','voce','não','nao','uma','um','com','meu','minha','seu','sua','sou','estou','vamos','sobre','igreja','trabalho','condomínio','condominio','portaria','claro','pode','por','favor','também','tambem','muito','bom','boa','obrigado','obrigada','conversar','falar','como','isso','aqui','hoje','agora','então','entao','nosso','nossa','preciso','quero','gostaria']);
  const ES_WORDS=new Set(['que','para','usted','ustedes','tú','tu','una','uno','con','mi','mis','soy','estoy','vamos','sobre','iglesia','trabajo','condominio','recepción','recepcion','claro','puede','por','favor','también','tambien','mucho','bueno','buena','gracias','hablar','como','esto','aquí','aqui','hoy','ahora','quiero','necesito']);

  function emmaStrict(){
    return CONFIG.strict&&String(activeTeacher?.name||'').toLocaleLowerCase()==='emma'&&!!document.querySelector('#liteModal');
  }

  function wordsOf(input){
    return String(input||'').toLocaleLowerCase().match(/\p{L}[\p{L}\p{M}'’-]*/gu)||[];
  }

  function outputReport(input){
    const text=String(input||'').trim();
    const words=wordsOf(text),total=Math.max(1,words.length);
    const ptHits=words.reduce((n,w)=>n+(PT_WORDS.has(w)?1:0),0);
    const esHits=words.reduce((n,w)=>n+(ES_WORDS.has(w)?1:0),0);
    const portugueseChars=/[ãõç]/iu.test(text);
    const spanishChars=/[ñ¿¡]/iu.test(text);
    const ptRatio=ptHits/total,esRatio=esHits/total;
    const portugueseLeak=portugueseChars||(ptHits>=2&&ptRatio>0.10)||(/[áàâéêíóôú]/iu.test(text)&&ptHits>=1&&ptRatio>0.08);
    const spanishLeak=spanishChars||(esHits>=2&&esRatio>0.12);
    return {text,ptHits,esHits,ptRatio,esRatio,portugueseChars,portugueseLeak,spanishLeak,pass:!!text&&!portugueseLeak&&!spanishLeak};
  }

  function strictEnglishPass(input){return outputReport(input).pass;}

  function safeEnglishFallback(input=''){
    const low=String(input||'').toLocaleLowerCase();
    if(/\b(job|work|condominium|reception|security|doorman|concierge|visitor|access)\b/i.test(low))return 'Of course. Tell me about your job at the condominium. What do you usually do there?';
    if(/\b(church|faith|religion|scripture|god|jesus)\b/i.test(low))return 'Of course. We can talk about that in English. What would you like to tell me first?';
    return 'Of course. Let us continue in English. Please tell me more about that.';
  }

  function purgeHistory(history){
    if(!Array.isArray(history))return [];
    if(!emmaStrict())return history;
    return history.filter(x=>x&&typeof x.content==='string'&&strictEnglishPass(x.content));
  }

  function enforceEnglishUi(){
    if(!emmaStrict())return;
    const select=document.querySelector('#sttLangSel');
    if(!select)return;
    select.value='en-US';
    select.disabled=true;
    select.dataset.fnsStrictLanguage='en-US';
    select.title='Emma • English Only';
    const option=[...select.options].find(x=>x.value==='en-US');
    if(option)option.textContent='🇺🇸 English Only • Emma';
  }

  const FNS_outputCoreOpenLiteTeacher=openLiteTeacher;
  openLiteTeacher=function(...args){
    const result=FNS_outputCoreOpenLiteTeacher(...args);
    enforceEnglishUi();
    return result;
  };

  document.addEventListener('change',event=>{
    if(event.target?.id==='sttLangSel'&&emmaStrict())enforceEnglishUi();
  },true);

  const uiObserver=new MutationObserver(()=>{
    if(emmaStrict())enforceEnglishUi();
  });
  uiObserver.observe(document.documentElement,{childList:true,subtree:true});

  const FNS_outputCoreLanguageLock=languageLockForTranscript;
  languageLockForTranscript=function(input){
    if(emmaStrict())return {code:'en-US',label:'English',source:'emma-strict-output'};
    return FNS_outputCoreLanguageLock(input);
  };

  const FNS_outputCoreStrictInstruction=strictLanguageInstructionFor;
  strictLanguageInstructionFor=function(input){
    if(emmaStrict())return CRITICAL_RULE+' Never translate the user into Portuguese or Spanish. Keep the answer in natural English only.';
    return FNS_outputCoreStrictInstruction(input);
  };

  const FNS_outputCoreMemoryMessages=memoryMessagesForProvider;
  memoryMessagesForProvider=function(history=readBrowserMemory(),limit=24){
    const filtered=purgeHistory(history);
    return FNS_outputCoreMemoryMessages(filtered,limit);
  };

  const FNS_outputCoreMemoryText=memoryTextForPrompt;
  memoryTextForPrompt=function(history=readBrowserMemory(),limit=24){
    const filtered=purgeHistory(history);
    return FNS_outputCoreMemoryText(filtered,limit);
  };

  const FNS_outputCoreEmergencyBrain=emergencyBrainReply;
  emergencyBrainReply=async function(text,history=readBrowserMemory()){
    const filtered=purgeHistory(history);
    let reply=await FNS_outputCoreEmergencyBrain(text,filtered);
    if(emmaStrict()&&!strictEnglishPass(reply)){
      console.warn('[FNS OUTPUT LOCK] public brain leaked language; retrying strict LLM7');
      try{reply=await llm7BrowserReply(text,filtered,4500);}catch(e){reply='';}
    }
    if(emmaStrict()&&!strictEnglishPass(reply))reply=safeEnglishFallback(text);
    return reply;
  };

  const FNS_outputNativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    if(!emmaStrict())return FNS_outputNativeFetch(input,init);
    let url='';
    try{url=new URL(typeof input==='string'?input:input.url,location.href).href;}catch(e){return FNS_outputNativeFetch(input,init);}

    if((url===new URL(FNS_CHAT_URL,location.href).href||/\/chat(?:\?|$)/.test(url))&&String(init?.method||'GET').toUpperCase()==='POST'&&typeof init?.body==='string'){
      try{
        const body=JSON.parse(init.body);
        body.teacher='Emma';
        body.input_language='en-US';
        body.input_language_label='English';
        body.strict_language='en-US';
        body.strict_language_enabled=true;
        body.history=purgeHistory(body.history);
        init={...init,body:JSON.stringify(body)};
      }catch(e){}
    }

    if(url.includes('api.llm7.io/v1/chat/completions')&&String(init?.method||'GET').toUpperCase()==='POST'&&typeof init?.body==='string'){
      try{
        const body=JSON.parse(init.body);
        const prior=Array.isArray(body.messages)?body.messages:[];
        const clean=prior.filter(m=>m?.role==='system'||strictEnglishPass(m?.content||''));
        body.messages=[{role:'system',content:CRITICAL_RULE},...clean];
        const lastUser=[...body.messages].reverse().find(m=>m?.role==='user');
        if(lastUser)lastUser.content=String(lastUser.content||'')+'\n\n'+USER_SUFFIX;
        body.temperature=0.25;
        body.max_tokens=Math.min(Number(body.max_tokens||220),220);
        init={...init,body:JSON.stringify(body)};
      }catch(e){}
    }

    return FNS_outputNativeFetch(input,init);
  };

  const FNS_outputCoreRemoteSpeak=remoteSpeak;
  remoteSpeak=async function(text){
    if(emmaStrict()&&!strictEnglishPass(text)){
      console.error('[FNS OUTPUT LOCK] TTS kill switch blocked non-English output',outputReport(text));
      if(flowState!==FLOW_STATES.IDLE)setFlowState(FLOW_STATES.IDLE,{force:true,status:'English-only guard'});
      return false;
    }
    return FNS_outputCoreRemoteSpeak(text);
  };

  window.FNS_EMMA_STRICT_OUTPUT={
    config:CONFIG,
    criticalRule:CRITICAL_RULE,
    userSuffix:USER_SUFFIX,
    outputReport,
    strictEnglishPass,
    purgeHistory,
    safeEnglishFallback,
    enforceEnglishUi,
    active:emmaStrict
  };
})();
