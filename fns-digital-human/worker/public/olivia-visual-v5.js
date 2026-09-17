/* FNS OLIVIA VISUAL V5 — anti-blackout guard loaded AFTER all natural wrappers */
(function(){
  'use strict';
  if(window.__FNS_OLIVIA_VISUAL_V5__) return;
  window.__FNS_OLIVIA_VISUAL_V5__=true;

  const VERSION='v5-20260917';
  const FRAMES=Object.freeze({
    closed:'/assets/olivia-fechada.png?v='+VERSION,
    talking:'/assets/olivia-falando.png?v='+VERSION,
    open:'/assets/olivia-aberta.png?v='+VERSION
  });
  const ready={closed:false,talking:false,open:false};
  const failed={closed:false,talking:false,open:false};
  const runtime={version:VERSION,repairs:0,lastRepair:'',lastState:'closed',errors:[]};
  window.FNS_OLIVIA_VISUAL_V5=runtime;

  function err(where,e){
    runtime.errors.push({where,message:String(e?.message||e||'error'),at:Date.now()});
    if(runtime.errors.length>12)runtime.errors.shift();
    console.error('[FNS OLIVIA VISUAL V5]',where,e);
  }

  Object.entries(FRAMES).forEach(([key,src])=>{
    const im=new Image();
    im.onload=()=>{ready[key]=true;failed[key]=false;};
    im.onerror=()=>{failed[key]=true;err('preload:'+key,new Error('asset failed '+src));};
    im.src=src;
  });

  function isOlivia(){
    try{
      if(String(activeTeacher?.name||'').toLowerCase()==='olivia')return true;
    }catch(_){}
    const modal=document.querySelector('#liteModal');
    return !!modal&&(modal.dataset.fnsOliviaV4==='true'||/olivia/i.test(modal.querySelector('.row h2')?.textContent||''));
  }

  function setImportant(el,prop,value){
    if(!el)return;
    if(el.style.getPropertyValue(prop)!==value||el.style.getPropertyPriority(prop)!=='important'){
      el.style.setProperty(prop,value,'important');
    }
  }

  function avatarMarkup(){
    return `<div id="avatarFace" class="avatar-face human-avatar" data-teacher="olivia" data-avatar-ready="false" data-avatar-visual-mode="image-swapping" data-olivia-visual-version="v5" style="--mouth-open:0;--mouth-wide:0;--gaze-x:0px;--gaze-y:0px">
      <img id="oliviaPortrait" class="avatar-photo avatar-photo-base" src="${FRAMES.closed}" alt="Olivia, profesora virtual" loading="eager" decoding="sync">
      <div class="avatar-live-badge">● LIVE</div>
    </div>`;
  }

  function desiredFrame(face){
    const level=parseFloat(getComputedStyle(face).getPropertyValue('--mouth-open'))||0;
    if(level>=0.60&&!failed.open)return ['open',FRAMES.open];
    if(level>=0.15&&!failed.talking)return ['talking',FRAMES.talking];
    return ['closed',FRAMES.closed];
  }

  function ensureStageVisible(modal){
    const room=modal?.querySelector('.room');
    const shell=modal?.querySelector('.chat-shell');
    const stage=modal?.querySelector('.avatar-stage');
    if(!modal||!room||!shell||!stage)return null;

    modal.dataset.fnsOliviaVisualV5='true';
    setImportant(modal,'display','flex');
    setImportant(modal,'visibility','visible');
    setImportant(modal,'opacity','1');

    setImportant(room,'display','block');
    setImportant(room,'visibility','visible');
    setImportant(room,'opacity','1');
    setImportant(room,'position','relative');

    setImportant(shell,'visibility','visible');
    setImportant(shell,'opacity','1');

    setImportant(stage,'display','block');
    setImportant(stage,'visibility','visible');
    setImportant(stage,'opacity','1');
    setImportant(stage,'position','relative');
    setImportant(stage,'overflow','hidden');
    setImportant(stage,'background','#0a1020');
    setImportant(stage,'z-index','1');

    // No loading/mask element is allowed to sit over Olivia after boot.
    stage.querySelectorAll('.loading,.loader,.avatar-loading,.avatar-overlay,.loading-overlay,.avatar-loading-overlay,[data-loading-overlay]').forEach(node=>{
      if(node.closest('.human-avatar[data-teacher="olivia"]'))return;
      setImportant(node,'display','none');
      setImportant(node,'opacity','0');
      setImportant(node,'visibility','hidden');
      setImportant(node,'pointer-events','none');
    });
    return stage;
  }

  function ensureFace(reason='watchdog'){
    if(!isOlivia())return null;
    const modal=document.querySelector('#liteModal');
    const stage=ensureStageVisible(modal);
    if(!stage)return null;

    let face=stage.querySelector('.human-avatar[data-teacher="olivia"]');
    if(!face){
      stage.querySelector('#avatarFace')?.remove();
      stage.insertAdjacentHTML('afterbegin',avatarMarkup());
      face=stage.querySelector('.human-avatar[data-teacher="olivia"]');
      runtime.repairs++;
      runtime.lastRepair='face-rebuilt:'+reason;
    }
    if(!face)return null;

    face.id='avatarFace';
    face.dataset.teacher='olivia';
    face.dataset.avatarVisualMode='image-swapping';
    face.dataset.oliviaVisualVersion='v5';
    face.classList.add('avatar-face','human-avatar');

    setImportant(face,'display','block');
    setImportant(face,'visibility','visible');
    setImportant(face,'opacity','1');
    setImportant(face,'position','relative');
    setImportant(face,'width','100%');
    setImportant(face,'height','100%');
    setImportant(face,'min-height',matchMedia('(max-width:820px)').matches?'420px':'520px');
    setImportant(face,'overflow','hidden');
    setImportant(face,'background','#0a1020');
    setImportant(face,'z-index','2');
    setImportant(face,'transform','none');
    setImportant(face,'filter','none');

    // Remove legacy visual layers if a wrapper accidentally recreates them.
    face.querySelectorAll('.avatar-fx-layer,.avatar-camera-vignette,.avatar-webgl-layer,.avatar-mouth-motion,canvas,video').forEach(n=>n.remove());

    let img=face.querySelector('img.avatar-photo-base');
    if(!img){
      const live=face.querySelector('.avatar-live-badge');
      const holder=document.createElement('div');
      holder.innerHTML=`<img id="oliviaPortrait" class="avatar-photo avatar-photo-base" src="${FRAMES.closed}" alt="Olivia, profesora virtual" loading="eager" decoding="sync">`;
      img=holder.firstElementChild;
      face.insertBefore(img,live||face.firstChild);
      runtime.repairs++;
      runtime.lastRepair='image-rebuilt:'+reason;
    }

    img.id='oliviaPortrait';
    img.classList.add('avatar-photo','avatar-photo-base');
    setImportant(img,'display','block');
    setImportant(img,'visibility','visible');
    setImportant(img,'opacity','1');
    setImportant(img,'position','absolute');
    setImportant(img,'inset','0');
    setImportant(img,'width','100%');
    setImportant(img,'height','100%');
    setImportant(img,'min-width','100%');
    setImportant(img,'min-height','100%');
    setImportant(img,'max-width','100%');
    setImportant(img,'max-height','100%');
    setImportant(img,'object-fit','contain');
    setImportant(img,'object-position','center center');
    setImportant(img,'z-index','2');
    setImportant(img,'transform','none');
    setImportant(img,'filter','none');
    setImportant(img,'clip-path','none');
    setImportant(img,'mask','none');
    setImportant(img,'mix-blend-mode','normal');

    const known=Object.values(FRAMES).some(src=>img.src.includes(src.split('?')[0]));
    if(!known){
      img.src=FRAMES.closed;
      runtime.repairs++;
      runtime.lastRepair='src-restored:'+reason;
    }

    img.onload=()=>{face.dataset.avatarReady='true';};
    img.onerror=()=>{
      face.dataset.avatarReady='error';
      if(!img.src.includes('olivia-fechada.png'))img.src=FRAMES.closed+'&fallback='+Date.now();
    };

    const badge=face.querySelector('.avatar-live-badge');
    if(badge){
      setImportant(badge,'display','block');
      setImportant(badge,'visibility','visible');
      setImportant(badge,'opacity','1');
      setImportant(badge,'z-index','4');
    }
    const label=stage.querySelector('.avatar-label');
    if(label){
      setImportant(label,'display','block');
      setImportant(label,'visibility','visible');
      setImportant(label,'opacity','1');
      setImportant(label,'z-index','5');
    }
    return face;
  }

  function maintainFrame(){
    if(!isOlivia())return;
    const face=ensureFace('frame');
    if(!face)return;
    const img=face.querySelector('img.avatar-photo-base');
    if(!img)return;
    const [state,target]=desiredFrame(face);
    runtime.lastState=state;
    face.dataset.pngtuberState=state;
    face.dataset.pngtuberLevel=(parseFloat(getComputedStyle(face).getPropertyValue('--mouth-open'))||0).toFixed(3);

    // Swap only to assets that are known-good; closed frame is the fail-safe.
    const key=state;
    const safeTarget=(ready[key]&&!failed[key])?target:FRAMES.closed;
    const expected=safeTarget.split('?')[0];
    if(!img.src.includes(expected))img.src=safeTarget;

    // If another wrapper hid or collapsed the node, recover before the next paint.
    const rect=face.getBoundingClientRect();
    const ir=img.getBoundingClientRect();
    if(rect.width<32||rect.height<32||ir.width<32||ir.height<32){
      ensureFace('zero-size');
    }
  }

  let scheduled=false;
  function scheduleRepair(reason){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      try{ensureFace(reason);}catch(e){err('repair:'+reason,e);}
    });
  }

  const observer=new MutationObserver(mutations=>{
    if(!isOlivia())return;
    if(mutations.some(m=>m.type==='childList'))scheduleRepair('dom-mutation');
  });
  observer.observe(document.body,{childList:true,subtree:true});

  // Run after natural-state/natural-turns and reinforce each state transition.
  try{
    const coreSetNaturalAvatarState=window.setNaturalAvatarState;
    if(typeof coreSetNaturalAvatarState==='function'){
      window.setNaturalAvatarState=function(state='idle'){
        const out=coreSetNaturalAvatarState(state);
        scheduleRepair('natural-state:'+state);
        return out;
      };
    }
  }catch(e){err('wrap:setNaturalAvatarState',e);}

  try{
    const coreSetFlowState=window.setFlowState;
    if(typeof coreSetFlowState==='function'){
      window.setFlowState=function(next,opts){
        const out=coreSetFlowState(next,opts);
        scheduleRepair('flow:'+next);
        return out;
      };
    }
  }catch(e){err('wrap:setFlowState',e);}

  let frames=0;
  function loop(){
    try{
      if(isOlivia()){
        maintainFrame();
        if(++frames%60===0)ensureFace('periodic');
      }
    }catch(e){err('loop',e);}
    requestAnimationFrame(loop);
  }

  runtime.health=function(){
    const modal=document.querySelector('#liteModal');
    const stage=modal?.querySelector('.avatar-stage');
    const face=stage?.querySelector('.human-avatar[data-teacher="olivia"]');
    const img=face?.querySelector('img.avatar-photo-base');
    const cs=face?getComputedStyle(face):null;
    const is=img?getComputedStyle(img):null;
    const rect=face?.getBoundingClientRect();
    const ir=img?.getBoundingClientRect();
    return {
      version:VERSION,active:isOlivia(),modal:!!modal,stage:!!stage,face:!!face,image:!!img,
      faceDisplay:cs?.display||'',faceVisibility:cs?.visibility||'',faceOpacity:cs?.opacity||'',
      imageDisplay:is?.display||'',imageVisibility:is?.visibility||'',imageOpacity:is?.opacity||'',
      faceRect:rect?{width:rect.width,height:rect.height}:null,
      imageRect:ir?{width:ir.width,height:ir.height}:null,
      src:img?.src||'',loaded:!!(img?.complete&&img?.naturalWidth>0&&img?.naturalHeight>0),
      naturalWidth:img?.naturalWidth||0,naturalHeight:img?.naturalHeight||0,
      state:face?.dataset.pngtuberState||'',ready:{...ready},failed:{...failed},
      repairs:runtime.repairs,lastRepair:runtime.lastRepair,errors:runtime.errors.slice(-8)
    };
  };

  scheduleRepair('boot');
  requestAnimationFrame(loop);
})();
