window.FNSNatural={history:[],handsFree:false,handsTimer:null,ambientTimer:null};

function restoreHumanAvatar(){
  const face=document.querySelector('#avatarFace');
  if(!face)return;
  face.classList.add('avatar-face');
  if(activeTeacher?.portrait)face.classList.add('human-avatar');
}
function setNaturalAvatarState(state='idle'){
  const face=document.querySelector('#avatarFace');
  if(!face)return;
  restoreHumanAvatar();
  face.classList.remove('avatar-listening','avatar-speaking','avatar-thinking');
  if(state==='listening')face.classList.add('avatar-listening');
  if(state==='speaking')face.classList.add('avatar-speaking');
  if(state==='thinking')face.classList.add('avatar-thinking');
}
function stopNaturalAmbient(){
  clearTimeout(FNSNatural.ambientTimer);
  FNSNatural.ambientTimer=null;
}
function startNaturalAmbient(){
  stopNaturalAmbient();
  const schedule=()=>{
    FNSNatural.ambientTimer=setTimeout(()=>{
      const face=document.querySelector('#avatarFace');
      if(face?.classList.contains('human-avatar')&&!face.classList.contains('avatar-speaking')){
        face.classList.add('avatar-micro-expression');
        setTimeout(()=>face?.classList.remove('avatar-micro-expression'),380);
      }
      schedule();
    },2600+Math.random()*3400);
  };
  schedule();
}
function updateHandsButton(){
  const b=document.querySelector('#handsBtn');
  if(!b)return;
  b.textContent=FNSNatural.handsFree?'🎧 Contínuo ON':'🎧 Contínuo OFF';
  b.classList.toggle('hands-on',FNSNatural.handsFree);
}
function toggleHandsFree(){
  FNSNatural.handsFree=!FNSNatural.handsFree;
  updateHandsButton();
  if(FNSNatural.handsFree&&voiceUnlocked&&!recognizing&&(!currentVoiceAudio||currentVoiceAudio.paused)){
    clearTimeout(FNSNatural.handsTimer);
    FNSNatural.handsTimer=setTimeout(()=>document.querySelector('#liteModal')&&startRecording(),500);
  }
}
function endNaturalSession(){
  FNSNatural.handsFree=false;
  clearTimeout(FNSNatural.handsTimer);
  stopNaturalAmbient();
  stopRecognition();
  stopRemoteVoice();
  document.querySelector('#liteModal')?.remove();
}

const FNS_coreOpenLiteTeacher=openLiteTeacher;
openLiteTeacher=function(...args){
  FNSNatural.history=[];
  FNSNatural.handsFree=false;
  const out=FNS_coreOpenLiteTeacher(...args);
  restoreHumanAvatar();
  startNaturalAmbient();
  const mic=document.querySelector('#micBtn');
  const row=mic?.parentElement;
  if(row&&!document.querySelector('#handsBtn')){
    const b=document.createElement('button');
    b.id='handsBtn'; b.type='button'; b.onclick=toggleHandsFree;
    row.appendChild(b);
  }
  const close=document.querySelector('#liteModal .close');
  if(close)close.onclick=endNaturalSession;
  const hint=document.querySelector('#chatInput')?.parentElement?.nextElementSibling;
  if(hint){
    hint.textContent='Modo contínuo: Emma fala, o microfone abre sozinho e a conversa continua naturalmente.';
    hint.classList.add('conversation-hint');
  }
  updateHandsButton();
  return out;
};