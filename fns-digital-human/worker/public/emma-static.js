/* Emma Phase 2 procedural face rig. No browser TTS; visual animation only. */
window.FNS_EMMA_VISUAL_RIG=true;

(()=>{
  let blinkTimer=null;
  let gazeTimer=null;
  let rigFace=null;

  function clearRigTimers(){
    if(blinkTimer){clearTimeout(blinkTimer);blinkTimer=null;}
    if(gazeTimer){clearTimeout(gazeTimer);gazeTimer=null;}
  }

  function setBlink(face,amount){
    face.querySelectorAll('.avatar-eyelid').forEach(el=>{
      el.style.opacity=String(Math.max(0,Math.min(1,amount)));
      el.style.transform='scaleY('+Math.max(.08,amount)+')';
    });
  }

  function scheduleBlink(face){
    const next=1800+Math.random()*4200;
    blinkTimer=setTimeout(async()=>{
      if(!face.isConnected)return;
      setBlink(face,.9);
      await new Promise(r=>setTimeout(r,72));
      setBlink(face,1);
      await new Promise(r=>setTimeout(r,58));
      setBlink(face,.38);
      await new Promise(r=>setTimeout(r,58));
      setBlink(face,0);

      if(Math.random()<.16){
        await new Promise(r=>setTimeout(r,120));
        setBlink(face,.82);
        await new Promise(r=>setTimeout(r,80));
        setBlink(face,0);
      }
      scheduleBlink(face);
    },next);
  }

  function scheduleGaze(face){
    const next=900+Math.random()*2300;
    gazeTimer=setTimeout(()=>{
      if(!face.isConnected)return;
      const speaking=face.classList.contains('avatar-speaking');
      const listening=face.classList.contains('avatar-listening');
      const span=speaking?1.15:listening?1.4:.85;
      const x=((Math.random()*2)-1)*span;
      const y=((Math.random()*2)-1)*span*.58;
      face.style.setProperty('--gaze-x',x.toFixed(2)+'px');
      face.style.setProperty('--gaze-y',y.toFixed(2)+'px');
      scheduleGaze(face);
    },next);
  }

  function install(face){
    if(!face||!face.classList.contains('human-avatar'))return;
    if(rigFace===face)return;
    clearRigTimers();
    rigFace=face;
    face.dataset.fnsRig='active';
    face.style.setProperty('--mouth-open','0');
    face.style.setProperty('--gaze-x','0px');
    face.style.setProperty('--gaze-y','0px');
    setBlink(face,0);
    scheduleBlink(face);
    scheduleGaze(face);
  }

  function scan(){
    const face=document.querySelector('#avatarFace.human-avatar');
    if(face)install(face);
    else if(rigFace&&!rigFace.isConnected){
      clearRigTimers();
      rigFace=null;
    }
  }

  const observer=new MutationObserver(scan);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)clearRigTimers();
    else {rigFace=null;scan();}
  });
  scan();
})();