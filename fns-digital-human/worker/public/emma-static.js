/* Emma V5: preserve STT/chat/TTS; disable facial/lip rig until next phase. */
window.FNS_EMMA_STATIC_FACE=true;
if(typeof startAvatarLipSync==='function'){
  startAvatarLipSync=function(){
    const face=document.querySelector('#avatarFace');
    if(face)face.style.setProperty('--mouth-open','0');
  };
}
if(typeof installEmmaFaceRig==='function'){
  installEmmaFaceRig=function(){
    const face=document.querySelector('#avatarFace');
    if(!face)return;
    face.querySelectorAll('.avatar-mouth-cavity,.avatar-eyelid').forEach(el=>el.remove());
    face.style.setProperty('--mouth-open','0');
    face.style.setProperty('--gaze-x','0px');
    face.style.setProperty('--gaze-y','0px');
  };
}