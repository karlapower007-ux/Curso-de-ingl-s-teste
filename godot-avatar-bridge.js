(function(root){
  'use strict';
  const clamp=(n,a=-1,b=1)=>Math.min(b,Math.max(a,Number.isFinite(Number(n))?Number(n):0));
  const teacherSlug=(profile)=>profile?.slug||({original:'lily',british:'oliver',american:'sara',latina:'sofia'}[profile?.id]||'lily');

  class GodotAvatarAdapter {
    constructor(profile,{frame,rig,label,status}={}){
      this.profile=profile;this.frame=frame;this.rig=rig;this.label=label;this.status=status;
      this.ready=false;this.destroyed=false;this.queue=[];this.lastViseme='REST';this.lastMode='idle';this.lastEmotion='neutral';
      this.lastRigAt=0;this.wasBlinking=false;this.onMessage=this._onMessage.bind(this);
      window.addEventListener('message',this.onMessage);
    }
    _onMessage(ev){
      if(this.destroyed||ev.source!==this.frame?.contentWindow)return;
      if(ev.data?.type==='professores-godot-ready'){
        this.ready=true;this.rig?.classList.add('godot-native-active');
        if(this.frame){this.frame.hidden=false;this.frame.setAttribute('aria-hidden','false');}
        this.send({type:'set_teacher',teacher:teacherSlug(this.profile)});
        this._flush();
      }
    }
    send(command){
      if(this.destroyed)return;
      const w=this.frame?.contentWindow;
      if(this.ready&&w&&typeof w._professoresGodotCommand==='function'){
        try{w._professoresGodotCommand(JSON.stringify(command));return;}catch(_){this.ready=false;}
      }
      this.queue.push(command);if(this.queue.length>24)this.queue=this.queue.slice(-24);
    }
    _flush(){const q=this.queue.splice(0);for(const c of q)this.send(c);}
    apply(plan){
      if(!plan)return;
      if(this.lastMode!==plan.mode){this.lastMode=plan.mode;this.send({type:'set_mode',mode:plan.mode});}
      if(this.lastEmotion!==plan.emotion||Math.abs((this.lastStrength||0)-(plan.emotion_intensity||0))>.06){
        this.lastEmotion=plan.emotion;this.lastStrength=plan.emotion_intensity||0;
        this.send({type:'set_emotion',emotion:plan.emotion,strength:plan.emotion_intensity||0});
      }
      if(this.label)this.label.textContent=(this.profile.labels?.[plan.emotion]||plan.emotion)+' · '+Math.round((plan.emotion_intensity||0)*100)+'%';
    }
    applyRig(s,ctx={}){
      const now=performance.now();
      const blinkNow=Math.min(Number(s?.eyeOpenLeft??1),Number(s?.eyeOpenRight??1))<.30;
      if(blinkNow&&!this.wasBlinking)this.send({type:'blink'});
      this.wasBlinking=blinkNow;
      if(now-this.lastRigAt>38){
        this.lastRigAt=now;
        this.send({type:'set_head',x:clamp(Number(s?.headYaw||0),-1,1),y:clamp(Number(s?.headPitch||0),-1,1)});
        this.send({type:'set_gaze',x:clamp(Number(s?.eyeLeftX||0),-1,1),y:clamp(Number(s?.eyeLeftY||0),-1,1)});
      }
      const v=ctx.viseme||'REST';
      if(v!==this.lastViseme){this.lastViseme=v;this.send({type:'set_viseme',viseme:v,strength:Math.max(.45,Number(s?.jawOpen||.7))});}
    }
    viseme(v='REST',amount=.7){this.lastViseme=v;this.send({type:'set_viseme',viseme:v,strength:amount});}
    pulseBrow(){}
    pulseSmile(){}
    event(type,strength=.4){
      if(type==='laugh')this.send({type:'set_emotion',emotion:'amused',strength});
      if(type==='sigh')this.send({type:'set_emotion',emotion:'disappointed',strength});
    }
    lookAt(x=0,y=0){this.send({type:'set_gaze',x,y});}
    destroy(){
      this.destroyed=true;window.removeEventListener('message',this.onMessage);
      this.rig?.classList.remove('godot-native-active');
      if(this.frame){this.frame.hidden=true;this.frame.setAttribute('aria-hidden','true');}
    }
  }

  function attach({controller,teacherId,rig,frame,label,status,timeoutMs=9000}={}){
    return new Promise(resolve=>{
      if(!controller||!rig||!frame){resolve({ok:false,reason:'missing-elements'});return;}
      const profile=controller.profile;
      const adapter=new GodotAvatarAdapter(profile,{frame,rig,label,status});
      let settled=false;
      const finish=(ok,reason='')=>{
        if(settled)return;settled=true;
        if(ok){controller.upgradeAdapter?.(adapter);adapter.send({type:'set_teacher',teacher:teacherId||teacherSlug(profile)});}
        else adapter.destroy();
        resolve({ok,reason,adapter});
      };
      const handler=ev=>{
        if(ev.source===frame.contentWindow&&ev.data?.type==='professores-godot-ready'){
          window.removeEventListener('message',handler);adapter.ready=true;rig.classList.add('godot-native-active');
          frame.hidden=false;frame.setAttribute('aria-hidden','false');finish(true);
        }
      };
      window.addEventListener('message',handler);
      const poll=setInterval(()=>{
        try{
          const w=frame.contentWindow;
          if(w?.ProfessoresGodot?.ready&&typeof w._professoresGodotCommand==='function'){
            clearInterval(poll);window.removeEventListener('message',handler);adapter.ready=true;rig.classList.add('godot-native-active');
            frame.hidden=false;frame.setAttribute('aria-hidden','false');finish(true);
          }
        }catch(_){}
      },120);
      setTimeout(()=>{clearInterval(poll);window.removeEventListener('message',handler);if(!settled)finish(false,'timeout');},timeoutMs);
    });
  }

  root.ProfessoresGodotBridge={GodotAvatarAdapter,attach};
})(globalThis);
