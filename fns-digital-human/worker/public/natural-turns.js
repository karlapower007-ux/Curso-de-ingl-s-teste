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
