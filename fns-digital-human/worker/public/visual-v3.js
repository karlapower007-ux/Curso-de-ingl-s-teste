window.FNSVisualV4={blinkTimer:null};

function installEmmaFaceRig(){
  const face=document.querySelector('#avatarFace');
  if(!face?.classList.contains('human-avatar'))return;

  /* Keep the visual locked straight toward the camera. */
  face.style.setProperty('--gaze-x','0px');
  face.style.setProperty('--gaze-y','0px');

  /* Remove the old synthetic mouth overlay if an older cached layer created it. */
  face.querySelectorAll('.avatar-mouth-cavity').forEach(el=>el.remove());

  if(!face.querySelector('.avatar-eyelid.left')){
    const left=document.createElement('div');
    left.className='avatar-eyelid left';
    const right=document.createElement('div');
    right.className='avatar-eyelid right';
    face.append(left,right);
  }

  scheduleEmmaBlink();
}

function stopEmmaFaceRig(){
  clearTimeout(FNSVisualV4.blinkTimer);
  FNSVisualV4.blinkTimer=null;
}

function scheduleEmmaBlink(){
  clearTimeout(FNSVisualV4.blinkTimer);
  FNSVisualV4.blinkTimer=setTimeout(()=>{
    const face=document.querySelector('#avatarFace');
    if(face?.classList.contains('human-avatar')){
      face.classList.add('blink-now');
      setTimeout(()=>face?.classList.remove('blink-now'),165);
    }
    scheduleEmmaBlink();
  },3000+Math.random()*3400);
}

const FNS_v4Open=openLiteTeacher;
openLiteTeacher=function(...args){
  const out=FNS_v4Open(...args);
  setTimeout(installEmmaFaceRig,40);
  return out;
};

if(typeof endNaturalSession==='function'){
  const FNS_v4End=endNaturalSession;
  endNaturalSession=function(){
    stopEmmaFaceRig();
    return FNS_v4End();
  };
}
