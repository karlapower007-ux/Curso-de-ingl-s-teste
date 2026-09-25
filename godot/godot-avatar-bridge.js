/* Professores IA — Godot real-art adapter v2.2.0.
   Same-origin iframe bridge. Keeps the accepted raster renderer as automatic fallback. */
(() => {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a=-1, b=1) => Math.max(a, Math.min(b, Number(v)||0));

  class GodotAvatarAdapter {
    constructor({controller, profile, rig, frame, label, status}){
      this.controller=controller;
      this.profile=profile;
      this.rig=rig;
      this.frame=frame;
      this.label=label;
      this.status=status;
      this.ready=false;
      this.destroyed=false;
      this.queue=[];
      this.last={};
      this.lastRigAt=0;
    }
    _send(command){
      if(this.destroyed) return;
      const payload=JSON.stringify(command);
      const fn=this.frame?.contentWindow?._professoresGodotCommand;
      if(typeof fn === 'function'){
        try{ fn(payload); this.ready=true; return true; }catch(_){}
      }
      this.queue.push(command);
      if(this.queue.length>60) this.queue.splice(0,this.queue.length-60);
      return false;
    }
    flush(){
      if(this.destroyed) return false;
      const fn=this.frame?.contentWindow?._professoresGodotCommand;
      if(typeof fn !== 'function') return false;
      const q=this.queue.splice(0);
      for(const cmd of q){ try{ fn(JSON.stringify(cmd)); }catch(_){} }
      this.ready=true;
      return true;
    }
    teacher(slug){ this._send({type:'set_teacher',teacher:slug}); }
    apply(plan){
      if(!plan) return;
      this._send({type:'set_mode',mode:plan.mode||'idle'});
      this._send({type:'set_emotion',emotion:plan.emotion||'neutral',strength:plan.emotion_intensity??.35});
      if(this.label){
        const human=this.profile?.labels?.[plan.emotion]||plan.emotion||'neutral';
        this.label.textContent=`${human} · ${Math.round((plan.emotion_intensity??.35)*100)}%`;
      }
    }
    applyRig(state,ctx={}){
      if(!state) return;
      const now=performance.now();
      if(now-this.lastRigAt<34) return;
      this.lastRigAt=now;
      const hx=clamp((state.headYaw||0)*.65 + (state.headRoll||0)*.35);
      const hy=clamp((state.headPitch||0)*.70);
      const gx=clamp(((state.eyeLeftX||0)+(state.eyeRightX||0))/2);
      const gy=clamp(((state.eyeLeftY||0)+(state.eyeRightY||0))/2);
      if(Math.abs((this.last.hx??9)-hx)>.025 || Math.abs((this.last.hy??9)-hy)>.025){
        this._send({type:'set_head',x:hx,y:hy}); this.last.hx=hx; this.last.hy=hy;
      }
      if(Math.abs((this.last.gx??9)-gx)>.035 || Math.abs((this.last.gy??9)-gy)>.035){
        this._send({type:'set_gaze',x:gx,y:gy}); this.last.gx=gx; this.last.gy=gy;
      }
      if(ctx.viseme && ctx.viseme!==this.last.viseme){
        this.viseme(ctx.viseme, ctx.mouthAmount??ctx.amount??.7);
      }
    }
    event(type,strength=.5){ this._send({type:'event',event:type,strength}); }
    viseme(v,amount=.7){
      const key=String(v||'REST').toUpperCase();
      const a=Math.max(0,Math.min(1,Number(amount)||0));
      this.last.viseme=key;
      this._send({type:'set_viseme',viseme:key,strength:a});
    }
    destroy(){
      this.destroyed=true;
      this.queue.length=0;
      this.rig?.classList.remove('godot-native-active');
      if(this.frame) this.frame.hidden=true;
    }
  }

  async function waitReady(frame, timeoutMs=12000){
    const start=performance.now();
    while(performance.now()-start<timeoutMs){
      try{
        if(typeof frame?.contentWindow?._professoresGodotCommand==='function' ||
           frame?.contentWindow?.ProfessoresGodot?.ready) return true;
      }catch(_){}
      await sleep(120);
    }
    return false;
  }

  async function attach({controller,teacherId,rig,frame,label,status}={}){
    if(!controller || !rig || !frame) return {ok:false,reason:'missing-elements'};
    const profile=controller.profile||{};
    const adapter=new GodotAvatarAdapter({controller,profile,rig,frame,label,status});
    frame.hidden=false;
    const ok=await waitReady(frame);
    if(!ok){
      frame.hidden=true;
      return {ok:false,reason:'godot-timeout'};
    }
    adapter.flush();
    adapter.teacher(profile.slug || teacherId || 'sara');

    const previous=controller.adapter;
    controller.adapter=adapter;
    if(controller.performance) controller.performance.adapter=adapter;
    try{ previous?.destroy?.(); }catch(_){}
    try{ controller._apply?.(); }catch(_){}
    rig.classList.add('godot-native-active');
    rig.dataset.renderer='godot';
    if(status) status.textContent='PRONTO PARA CONVERSAR';
    return {ok:true,adapter};
  }

  window.ProfessoresGodotBridge={attach,GodotAvatarAdapter};
})();