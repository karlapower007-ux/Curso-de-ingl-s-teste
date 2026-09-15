const FNS_coreLipSync=startAvatarLipSync;

startAvatarLipSync=function(audio){
  const face=document.querySelector('#avatarFace');
  if(!face?.classList.contains('human-avatar')){
    return FNS_coreLipSync(audio);
  }

  stopAvatarLipSync();

  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;

    avatarAudioContext=new AudioCtx();
    avatarMediaSource=avatarAudioContext.createMediaElementSource(audio);
    avatarAnalyser=avatarAudioContext.createAnalyser();

    avatarAnalyser.fftSize=1024;
    avatarAnalyser.smoothingTimeConstant=.86;

    avatarMediaSource.connect(avatarAnalyser);
    avatarAnalyser.connect(avatarAudioContext.destination);

    const wave=new Uint8Array(avatarAnalyser.fftSize);
    let envelope=0;
    let lastTarget=0;

    face.classList.add('avatar-talking');

    const tick=()=>{
      if(!avatarAnalyser||!currentVoiceAudio||currentVoiceAudio.paused){
        face.style.setProperty('--mouth-open','0');
        return;
      }

      avatarAnalyser.getByteTimeDomainData(wave);

      let sum=0;
      for(let i=0;i<wave.length;i++){
        const v=(wave[i]-128)/128;
        sum+=v*v;
      }

      const rms=Math.sqrt(sum/wave.length);

      /* Strong noise gate so silence does not make the mouth tremble. */
      let target=(rms-.016)/.075;
      target=Math.max(0,Math.min(.68,target));

      /* Slow target movement removes the "vibrating mouth" effect. */
      target=lastTarget+(target-lastTarget)*.28;
      lastTarget=target;

      const attack=target>envelope?.22:.075;
      envelope+=(target-envelope)*attack;

      if(envelope<.035)envelope=0;
      if(envelope>.62)envelope=.62;

      face.style.setProperty('--mouth-open',envelope.toFixed(3));
      avatarLipRAF=requestAnimationFrame(tick);
    };

    tick();
  }catch(e){
    stopAvatarLipSync();
  }
};
