const FNS_coreStartRecording=startRecording;
startRecording=async function(){
  if(currentVoiceAudio&&!currentVoiceAudio.paused)stopRemoteVoice();
  const result=FNS_coreStartRecording();
  let tries=0;
  const watcher=setInterval(()=>{
    restoreHumanAvatar();
    if(recognizing){
      setNaturalAvatarState('listening');
      clearInterval(watcher);
    }
    if(++tries>30)clearInterval(watcher);
  },80);
  return result;
};

const FNS_coreStopRemoteVoice=stopRemoteVoice;
stopRemoteVoice=function(){
  FNS_coreStopRemoteVoice();
  restoreHumanAvatar();
  setNaturalAvatarState('idle');
};

const FNS_coreRemoteSpeak=remoteSpeak;
remoteSpeak=async function(text){
  const result=await FNS_coreRemoteSpeak(text);
  const audio=currentVoiceAudio;
  if(audio){
    restoreHumanAvatar();
    setNaturalAvatarState('speaking');
    audio.addEventListener('ended',()=>{
      restoreHumanAvatar();
      setNaturalAvatarState('idle');
      if(FNSNatural.handsFree&&document.querySelector('#liteModal')){
        clearTimeout(FNSNatural.handsTimer);
        FNSNatural.handsTimer=setTimeout(()=>{
          if(FNSNatural.handsFree&&!recognizing&&document.querySelector('#liteModal'))startRecording();
        },650);
      }
    },{once:true});
  }
  return result;
};