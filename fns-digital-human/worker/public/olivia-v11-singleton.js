/* FNS OLIVIA V11 — active DOM watcher + cached PNG mouth loop + native/custom voice events. Emma/core untouched. */
(function(){
  'use strict';
  if(window.__FNS_OLIVIA_V11_INSTALLED__) return;
  window.__FNS_OLIVIA_V11_INSTALLED__=true;

  const params=new URLSearchParams(location.search);
  const directV11=params.get('olivia')==='v11';
  const VERSION='v11-20260917';
  const NODE_ID='olivia-standalone-node';
  const IMG_ID='olivia-standalone-image';
  const ASSETS=Object.freeze({
    idle:'/assets/olivia-fechada.png?v='+VERSION,
    listening:'/assets/olivia-falando.png?v='+VERSION,
    talking:'/assets/olivia-aberta.png?v='+VERSION
  });

  const cache={};
  Object.entries(ASSETS).forEach(([key,src])=>{
    const img=new Image();
    img.decoding='sync';
    if(key==='idle') img.fetchPriority='high';
    img.src=src;
    cache[key]=img;
  });

  const stats={
    version:VERSION,
    watcherTicks:0,
    createCount:0,
    reinjections:0,
    repairs:0,
    stateChanges:0,
    talkingEvents:0,
    idleEvents:0,
    listeningEvents:0,
    mouthFrames:0,
    lastSource:'boot',
    lastMissingAt:0,
    lastReinjectedAt:0
  };

  let desiredMode='idle';
  let mouthTimer=null;
  let mouthFlip=false;
  let active=true;

  function isOliviaContext(){
    if(directV11) return true;
    if(document.body?.dataset.oliviaV11Active==='true') return true;
    try{return String(activeTeacher?.name||'').trim().toLowerCase()==='olivia';}catch(_){return false;}
  }

  function forceNodeCss(node){
    if(!node) return;
    const s=node.style;
    s.setProperty('position','fixed','important');
    s.setProperty('top','10%','important');
    s.setProperty('left','5%','important');
    s.setProperty('width','450px','important');
    s.setProperty('height','706px','important');
    s.setProperty('z-index','2147483647','important');
    s.setProperty('pointer-events','none','important');
    s.setProperty('display','block','important');
    s.setProperty('visibility','visible','important');
    s.setProperty('opacity','1','important');
    s.setProperty('overflow','hidden','important');
    s.setProperty('background','#0a1020','important');
    s.setProperty('border-radius','18px','important');
    s.setProperty('transform','none','important');
    s.setProperty('filter','none','important');
    s.setProperty('transition','none','important');
    s.setProperty('animation','none','important');
  }

  function forceImgCss(img){
    if(!img) return;
    const s=img.style;
    s.setProperty('position','absolute','important');
    s.setProperty('inset','0','important');
    s.setProperty('width','100%','important');
    s.setProperty('height','100%','important');
    s.setProperty('object-fit','contain','important');
    s.setProperty('object-position','center center','important');
    s.setProperty('display','block','important');
    s.setProperty('visibility','visible','important');
    s.setProperty('opacity','1','important');
    s.setProperty('transform','none','important');
    s.setProperty('filter','none','important');
    s.setProperty('transition','none','important');
    s.setProperty('animation','none','important');
    s.setProperty('z-index','2','important');
  }

  function frameForMode(){
    if(desiredMode==='listening') return 'listening';
    if(desiredMode==='talking') return mouthFlip?'talking':'listening';
    return 'idle';
  }

  function applyFrame(img,frame){
    if(!img) return;
    const src=ASSETS[frame]||ASSETS.idle;
    img.dataset.frame=frame;
    if(!img.src.includes(src.split('?')[0])) img.src=src;
  }

  function buildOrRepairNode(existing,wasMissing=false){
    if(!document.body) return null;
    let node=existing;
    if(!node){
      node=document.createElement('div');
      node.id=NODE_ID;
      document.body.appendChild(node);
      stats.createCount++;
      if(wasMissing){stats.reinjections++;stats.lastReinjectedAt=performance.now();}
    }
    node.dataset.owner='fns-olivia-v11-watcher';
    node.dataset.visible='true';
    node.dataset.mode=desiredMode;
    node.dataset.instanceId=node.dataset.instanceId||('olivia-v11-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));
    node.setAttribute('aria-hidden','false');
    forceNodeCss(node);

    let img=node.querySelector('#'+IMG_ID);
    if(!img){
      node.replaceChildren();
      img=document.createElement('img');
      img.id=IMG_ID;
      img.alt='Olivia, profesora virtual';
      img.loading='eager';
      img.decoding='sync';
      img.fetchPriority='high';
      node.appendChild(img);
      const badge=document.createElement('div');
      badge.textContent='● LIVE';
      badge.style.cssText='position:absolute !important;top:14px !important;left:14px !important;z-index:4 !important;font-size:11px !important;font-weight:800 !important;letter-spacing:.08em !important;padding:7px 9px !important;border-radius:999px !important;background:#090d18d9 !important;border:1px solid #ffffff24 !important;color:white !important;';
      const label=document.createElement('div');
      label.innerHTML='<b>Olivia</b><br><span>Español • V11 • watcher ativo • 15 turbinas A–O</span>';
      label.style.cssText='position:absolute !important;left:16px !important;right:16px !important;bottom:14px !important;z-index:5 !important;padding:10px 12px !important;border-radius:14px !important;background:#07101fdd !important;border:1px solid #ffffff18 !important;color:white !important;line-height:1.35 !important;text-shadow:0 1px 2px #000 !important;';
      node.appendChild(badge);node.appendChild(label);
      stats.repairs++;
    }
    forceImgCss(img);
    applyFrame(img,frameForMode());
    return node;
  }

  function checkAvatar(){
    stats.watcherTicks++;
    if(!isOliviaContext()) return;
    let node=document.getElementById(NODE_ID);
    const missing=!node||node.parentElement!==document.body;
    if(missing){
      stats.lastMissingAt=performance.now();
      if(node&&node.parentElement) node.parentElement.removeChild(node);
      node=null;
    }
    buildOrRepairNode(node,missing);
  }

  function stopMouthLoop(){
    if(mouthTimer){clearInterval(mouthTimer);mouthTimer=null;}
    mouthFlip=false;
  }

  function startMouthLoop(){
    stopMouthLoop();
    mouthFlip=false;
    checkAvatar();
    const tick=()=>{
      if(desiredMode!=='talking'){stopMouthLoop();return;}
      mouthFlip=!mouthFlip;
      const img=document.getElementById(IMG_ID);
      if(img){applyFrame(img,frameForMode());stats.mouthFrames++;}
    };
    tick();
    mouthTimer=setInterval(tick,115);
  }

  function setAvatarState(state,source='internal'){
    const next=state==='talking'||state==='listening'?state:'idle';
    if(desiredMode!==next){desiredMode=next;stats.stateChanges++;}
    stats.lastSource=source;
    document.body.dataset.oliviaV11Active='true';
    if(next==='talking') startMouthLoop();
    else {stopMouthLoop();checkAvatar();const img=document.getElementById(IMG_ID);applyFrame(img,frameForMode());}
  }

  window.addEventListener('olivia-talking',e=>{stats.talkingEvents++;setAvatarState('talking',String(e?.detail?.source||'olivia-talking'));});
  window.addEventListener('olivia-idle',e=>{stats.idleEvents++;setAvatarState('idle',String(e?.detail?.source||'olivia-idle'));});
  window.addEventListener('olivia-listening',e=>{stats.listeningEvents++;setAvatarState('listening',String(e?.detail?.source||'olivia-listening'));});

  // Emergency STT bridge only. Speaking is driven by olivia-talking/olivia-idle from the engine hooks.
  window.addEventListener('fns:olivia:v8:visual',e=>{
    const type=String(e?.detail?.type||'');
    const source=String(e?.detail?.source||'v8-visual');
    if(type==='listening-start') window.dispatchEvent(new CustomEvent('olivia-listening',{detail:{source}}));
    else if(type==='listening-stop') window.dispatchEvent(new CustomEvent('olivia-idle',{detail:{source}}));
  });

  function bootV11Room(){
    if(!directV11) return;
    try{
      const list=typeof teachers!=='undefined'?teachers:null;
      const opener=typeof openLiteTeacher==='function'?openLiteTeacher:null;
      if(!Array.isArray(list)||!opener||!window.FNS_OLIVIA_V8){setTimeout(bootV11Room,25);return;}
      const i=list.findIndex(t=>String(t?.name||'').trim().toLowerCase()==='olivia');
      if(i<0){setTimeout(bootV11Room,50);return;}
      document.body.dataset.oliviaV11Active='true';
      if(typeof live==='function') live();
      opener(i,'A1','conversation','General conversation');
      const modal=document.querySelector('#liteModal');
      if(modal) modal.dataset.oliviaV11='true';
      const h2=modal?.querySelector('h2');
      if(h2) h2.textContent='Olivia • Español • V11';
      setAvatarState('idle','v11-direct-boot');
    }catch(e){console.error('[FNS OLIVIA V11] boot',e);setTimeout(bootV11Room,50);}
  }

  const watcher=setInterval(checkAvatar,100);
  checkAvatar();
  setTimeout(bootV11Room,0);

  window.FNS_OLIVIA_V11={
    version:VERSION,
    ownsVisuals:true,
    watcher,
    checkAvatar,
    setAvatarState,
    health(){
      const node=document.getElementById(NODE_ID),img=document.getElementById(IMG_ID),cs=node?getComputedStyle(node):null;
      const r=node?.getBoundingClientRect();
      return {
        version:VERSION,
        directV11,
        active:isOliviaContext(),
        singleton:!!node,
        singletonBodyChild:node?.parentElement===document.body,
        owner:node?.dataset.owner||'',
        mode:desiredMode,
        frame:img?.dataset.frame||'',
        src:img?.src||'',
        imageLoaded:!!(img?.complete&&img?.naturalWidth>0),
        visible:!!cs&&cs.display!=='none'&&cs.visibility==='visible'&&Number(cs.opacity)>0,
        zIndex:cs?.zIndex||'',
        rect:r?{left:r.left,top:r.top,width:r.width,height:r.height}:null,
        turbines:window.FNS_OLIVIA_V8?.health?.().turbineCount||0,
        stats:{...stats}
      };
    }
  };
})();
