/* Emma Phase 2.1: stable procedural face rig after portrait preload. */
window.FNS_EMMA_VISUAL_RIG=true;

(()=>{
  let blinkTimer=null;
  let gazeTimer=null;
  let rigFace=null;
  let installToken=0;

  function clearRigTimers(){
    if(blinkTimer){clearTimeout(blinkTimer);blinkTimer=null;}
    if(gazeTimer){clearTimeout(gazeTimer);gazeTimer=null;}
  }

  function setBlink(face,amount){
    if(!face||face.dataset.avatarReady!=='true')return;
    face.querySelectorAll('.avatar-eyelid').forEach(el=>{
      el.style.opacity=String(Math.max(0,Math.min(1,amount)));
      el.style.transform='scaleY('+Math.max(.06,amount)+')';
    });
  }

  function scheduleBlink(face,token){
    const next=2200+Math.random()*4200;
    blinkTimer=setTimeout(async()=>{
      if(token!==installToken||!face.isConnected||face.dataset.avatarReady!=='true')return;
      setBlink(face,.78);
      await new Promise(r=>setTimeout(r,62));
      setBlink(face,1);
      await new Promise(r=>setTimeout(r,54));
      setBlink(face,.28);
      await new Promise(r=>setTimeout(r,50));
      setBlink(face,0);
      scheduleBlink(face,token);
    },next);
  }

  function scheduleGaze(face,token){
    const next=1300+Math.random()*2400;
    gazeTimer=setTimeout(()=>{
      if(token!==installToken||!face.isConnected||face.dataset.avatarReady!=='true')return;
      const speaking=face.classList.contains('avatar-speaking');
      const listening=face.classList.contains('avatar-listening');
      const span=speaking?.8:listening?1.0:.55;
      const x=((Math.random()*2)-1)*span;
      const y=((Math.random()*2)-1)*span*.45;
      face.style.setProperty('--gaze-x',x.toFixed(2)+'px');
      face.style.setProperty('--gaze-y',y.toFixed(2)+'px');
      scheduleGaze(face,token);
    },next);
  }

  function activate(face){
    if(!face||!face.isConnected)return;
    const portrait=face.querySelector('#emmaPortrait');
    if(!portrait)return;

    if(!(portrait.complete&&portrait.naturalWidth>0)){
      const token=++installToken;
      const onLoad=()=>{
        if(token!==installToken)return;
        face.dataset.avatarReady='true';
        activate(face);
      };
      const onError=()=>{
        if(token!==installToken)return;
        face.dataset.avatarReady='error';
        clearRigTimers();
      };
      portrait.addEventListener('load',onLoad,{once:true});
      portrait.addEventListener('error',onError,{once:true});
      return;
    }

    if(rigFace===face && face.dataset.fnsRig==='active')return;

    clearRigTimers();
    rigFace=face;
    const token=++installToken;
    face.dataset.avatarReady='true';
    face.dataset.fnsRig='active';
    face.style.setProperty('--mouth-open','0');
    face.style.setProperty('--mouth-wide','0');
    face.style.setProperty('--gaze-x','0px');
    face.style.setProperty('--gaze-y','0px');
    setBlink(face,0);
    scheduleBlink(face,token);
    scheduleGaze(face,token);
  }

  function scan(){
    const face=document.querySelector('#avatarFace.human-avatar');
    if(face)activate(face);
    else if(rigFace&&!rigFace.isConnected){
      clearRigTimers();
      rigFace=null;
      installToken++;
    }
  }

  const observer=new MutationObserver(scan);
  observer.observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('visibilitychange',()=>{
    clearRigTimers();
    installToken++;
    if(!document.hidden){
      rigFace=null;
      scan();
    }
  });

  scan();
})();