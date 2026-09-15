window.FNSVisualV3={blinkTimer:null,gazeTimer:null};

function installEmmaFaceRig(){
  const face=document.querySelector('#avatarFace');
  if(!face?.classList.contains('human-avatar'))return;

  if(!face.querySelector('.avatar-mouth-cavity')){
    const mouth=document.createElement('div');
    mouth.className='avatar-mouth-cavity';
    mouth.innerHTML='<i></i>';
    face.appendChild(mouth);
  }

  if(!face.querySelector('.avatar-eyelid.left')){
    const left=document.createElement('div');
    left.className='avatar-eyelid left';
    const right=document.createElement('div');
    right.className='avatar-eyelid right';
    face.append(left,right);
  }

  scheduleEmmaBlink();
  scheduleEmmaGaze();
}

function stopEmmaFaceRig(){
  clearTimeout(FNSVisualV3.blinkTimer);
  clearTimeout(FNSVisualV3.gazeTimer);
  FNSVisualV3.blinkTimer=null;
  FNSVisualV3.gazeTimer=null;
}

function scheduleEmmaBlink(){
  clearTimeout(FNSVisualV3.blinkTimer);
  FNSVisualV3.blinkTimer=setTimeout(()=>{
    const face=document.querySelector('#avatarFace');
    if(face?.classList.contains('human-avatar')){
      face.classList.add('blink-now');
      setTimeout(()=>face?.classList.remove('blink-now'),180);
    }
    scheduleEmmaBlink();
  },2600+Math.random()*3800);
}

function scheduleEmmaGaze(){
  clearTimeout(FNSVisualV3.gazeTimer);
  FNSVisualV3.gazeTimer=setTimeout(()=>{
    const face=document.querySelector('#avatarFace');
    if(face?.classList.contains('human-avatar')){
      const x=(Math.random()-.5)*1.8;
      const y=(Math.random()-.5)*1.1;
      face.style.setProperty('--gaze-x',x.toFixed(2)+'px');
      face.style.setProperty('--gaze-y',y.toFixed(2)+'px');
    }
    scheduleEmmaGaze();
  },1900+Math.random()*2500);
}

const FNS_v3Open=openLiteTeacher;
openLiteTeacher=function(...args){
  const out=FNS_v3Open(...args);
  setTimeout(installEmmaFaceRig,30);
  return out;
};

const FNS_v3End=typeof endNaturalSession==='function'?endNaturalSession:null;
if(FNS_v3End){
  endNaturalSession=function(){
    stopEmmaFaceRig();
    return FNS_v3End();
  };
}
