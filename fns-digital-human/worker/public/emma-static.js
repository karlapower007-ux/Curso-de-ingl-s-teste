/* FNS Emma PNGTuber v1 — visual-only image swapping.
   Uses the existing RMS-derived --mouth-open signal produced by app.js.
   Never changes audio, TTS, STT, microphone, memory or turn flow. */
window.FNS_EMMA_VISUAL_RIG=true;

(()=>{
  // ===== PREENCHER ESTAS 3 URLs QUANDO AS IMAGENS ESTIVEREM PRONTAS =====
  // closed já usa a Emma atual como fallback seguro para não gerar 404.
  const EMMA_FRAME_URLS={
    closed:'/emma.jpg',          // depois: '/emma-fechada.png'
    talking:'',                  // depois: '/emma-falando.png'
    open:''                      // depois: '/emma-aberta.png'
  };

  // --mouth-open já é normalizado de 0 a 1 pelo AnalyserNode/RMS existente.
  const SILENCE_THRESHOLD=0.035;
  const OPEN_THRESHOLD=0.42;

  let raf=0;
  let activeFace=null;
  let activePortrait=null;
  let currentState='';
  let lastRequestedUrl='';

  function removeLegacyMouthArtifacts(face){
    // Mata qualquer resto das versões CSS/v17/v18/v19 sem tocar no core de áudio.
    document.getElementById('fns-pseudo-killer')?.remove();
    document.getElementById('fns-override-v19')?.remove();
    document.getElementById('fns-nova-boca-v19')?.remove();

    face?.querySelectorAll(
      '.avatar-mouth-motion,.avatar-webgl-layer,.avatar-gaze,.avatar-eyelid'
    ).forEach(node=>node.remove());

    // A camada facial antiga só existia para olhos/boca desenhados.
    const fx=face?.querySelector('.avatar-fx-layer');
    if(fx)fx.remove();
  }

  function resolveFrameUrl(state){
    const chosen=String(EMMA_FRAME_URLS[state]||'').trim();
    return chosen || EMMA_FRAME_URLS.closed || '/emma.jpg';
  }

  function preloadConfiguredFrames(){
    Object.values(EMMA_FRAME_URLS).forEach(url=>{
      if(!url)return;
      const img=new Image();
      img.decoding='async';
      img.src=url;
    });
  }

  function signalLevel(face){
    const raw=getComputedStyle(face).getPropertyValue('--mouth-open');
    const value=Number.parseFloat(raw);
    if(!Number.isFinite(value))return 0;
    return Math.max(0,Math.min(1,value));
  }

  function chooseState(level){
    if(level<=SILENCE_THRESHOLD)return 'closed';
    if(level>=OPEN_THRESHOLD)return 'open';
    return 'talking';
  }

  function applyFrame(state){
    if(!activePortrait)return;
    const url=resolveFrameUrl(state);

    activePortrait.dataset.pngtuberState=state;
    activePortrait.dataset.pngtuberLevel=signalLevel(activeFace).toFixed(3);

    if(state===currentState && url===lastRequestedUrl)return;
    currentState=state;
    lastRequestedUrl=url;

    // Quando talking/open ainda estiverem vazios, continua usando a imagem fechada.
    // Assim o motor já pode ir ao ar antes das 3 PNGs definitivas existirem.
    if(activePortrait.getAttribute('src')!==url){
      activePortrait.src=url;
    }
  }

  function bindCurrentEmma(){
    const face=document.querySelector('#avatarFace.human-avatar');
    if(!face)return false;
    const portrait=face.querySelector('#emmaPortrait');
    if(!portrait)return false;

    if(face!==activeFace || portrait!==activePortrait){
      activeFace=face;
      activePortrait=portrait;
      currentState='';
      lastRequestedUrl='';
      removeLegacyMouthArtifacts(face);

      portrait.onerror=()=>{
        const fallback=EMMA_FRAME_URLS.closed||'/emma.jpg';
        if(portrait.getAttribute('src')!==fallback)portrait.src=fallback;
      };

      face.dataset.expressionRig='pngtuber-v1';
      face.dataset.avatarVisualMode='image-swapping';
      face.dataset.avatarReady='true';
      applyFrame('closed');
    }
    return true;
  }

  function tick(){
    if(bindCurrentEmma()){
      // O valor vem diretamente do RMS do TTS já calculado em app.js.
      const level=signalLevel(activeFace);
      applyFrame(chooseState(level));
    }else{
      activeFace=null;
      activePortrait=null;
      currentState='';
      lastRequestedUrl='';
    }
    raf=requestAnimationFrame(tick);
  }

  preloadConfiguredFrames();
  raf=requestAnimationFrame(tick);

  // Interface pequena para preencher/testar os frames sem mexer no áudio.
  window.FNS_EMMA_PNGTUBER={
    frameUrls:EMMA_FRAME_URLS,
    thresholds:{silence:SILENCE_THRESHOLD,open:OPEN_THRESHOLD},
    setFrames(next={}){
      if(typeof next.closed==='string')EMMA_FRAME_URLS.closed=next.closed;
      if(typeof next.talking==='string')EMMA_FRAME_URLS.talking=next.talking;
      if(typeof next.open==='string')EMMA_FRAME_URLS.open=next.open;
      preloadConfiguredFrames();
      currentState='';
      lastRequestedUrl='';
      if(activeFace)applyFrame(chooseState(signalLevel(activeFace)));
      return {...EMMA_FRAME_URLS};
    },
    getState(){
      return {
        state:currentState||'closed',
        level:activeFace?signalLevel(activeFace):0,
        frames:{...EMMA_FRAME_URLS}
      };
    }
  };
})();
