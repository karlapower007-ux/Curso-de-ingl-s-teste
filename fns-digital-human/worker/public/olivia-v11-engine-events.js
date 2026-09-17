/* FNS OLIVIA V11 — authoritative voice event bridge. No DOM <audio> guessing. */
(function(){
  'use strict';
  if(window.__FNS_OLIVIA_V11_ENGINE_EVENTS__) return;
  window.__FNS_OLIVIA_V11_ENGINE_EVENTS__=true;

  function oliviaActive(){
    if(new URLSearchParams(location.search).get('olivia')==='v11') return true;
    if(document.body?.dataset.oliviaV11Active==='true') return true;
    try{return String(activeTeacher?.name||'').trim().toLowerCase()==='olivia';}catch(_){return false;}
  }

  function fire(name,source,extra={}){
    if(!oliviaActive()) return;
    window.dispatchEvent(new CustomEvent(name,{detail:{source,at:performance.now(),...extra}}));
  }

  // Aura-2 remote path: olivia-core-v8 already emits this event from the exact audio.onplay/audio.onended callbacks.
  // V11 translates that authoritative engine signal to the dedicated visual events requested by the V11 renderer.
  window.addEventListener('fns:olivia:v8:visual',event=>{
    const type=String(event?.detail?.type||'');
    const source=String(event?.detail?.source||'v8-engine');
    if(type==='speaking-start') fire('olivia-talking',source,{engine:'aura-or-engine'});
    else if(type==='speaking-stop'||type==='idle') fire('olivia-idle',source,{engine:'aura-or-engine'});
  });

  // Native SpeechSynthesis fallback: attach directly to each utterance's native start/end/error events.
  if('speechSynthesis' in window && typeof speechSynthesis.speak==='function'){
    const nativeSpeak=speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak=function(utterance){
      if(utterance && typeof utterance.addEventListener==='function' && oliviaActive() && !utterance.__fnsOliviaV11Bound){
        utterance.__fnsOliviaV11Bound=true;
        utterance.addEventListener('start',()=>fire('olivia-talking','speechSynthesis:native-start',{engine:'speechSynthesis'}),{once:true});
        utterance.addEventListener('end',()=>fire('olivia-idle','speechSynthesis:native-end',{engine:'speechSynthesis'}),{once:true});
        utterance.addEventListener('error',()=>fire('olivia-idle','speechSynthesis:native-error',{engine:'speechSynthesis'}),{once:true});
      }
      return nativeSpeak(utterance);
    };
  }

  window.FNS_OLIVIA_V11_ENGINE_EVENTS={
    version:'v11-20260917',
    fireTalking:(source='manual')=>fire('olivia-talking',source),
    fireIdle:(source='manual')=>fire('olivia-idle',source),
    health:()=>({installed:true,oliviaActive:oliviaActive(),nativeSpeechWrapped:!!speechSynthesis?.speak})
  };
})();
