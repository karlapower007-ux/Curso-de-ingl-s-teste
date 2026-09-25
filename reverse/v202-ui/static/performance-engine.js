/* Professores IA v1.7 — Performance Engine
   Continuous, layered facial/body performance. No paid dependency; no remote SDK.
   The engine is renderer-agnostic: it can drive the current 2.5D DOM rig or a future .riv rig.
*/
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  if(root) root.ProfessoresPerformance=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,Number.isFinite(+n)?+n:a));
  const lerp=(a,b,t)=>a+(b-a)*clamp(t);
  const mix=(a,b,t)=>lerp(a,b,t);
  const expLerp=(a,b,dt,speed=12)=>lerp(a,b,1-Math.exp(-Math.max(0,dt)*speed));
  const copy=o=>JSON.parse(JSON.stringify(o));
  const TAU=Math.PI*2;

  function mulberry32(seed){let a=(seed>>>0)||1;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  const rand=(rng,a,b)=>a+rng()*(b-a);
  const pick=(rng,arr)=>arr[Math.floor(rng()*arr.length)%arr.length];

  const GAZE_STATES=Object.freeze(['LOOK_USER','LOOK_SIDE','LOOK_UP','LOOK_DOWN','THINK','AVOID_GAZE','RETURN_TO_USER']);
  const VISEMES=Object.freeze(['REST','A','E','I','O','U','MBP','FV','L','TH','SZ','SHCH']);

  const BASE_RIG=Object.freeze({
    eyeLeftX:0,eyeLeftY:0,eyeRightX:0,eyeRightY:0,
    eyeOpenLeft:1,eyeOpenRight:1,eyeSquintLeft:0,eyeSquintRight:0,
    blinkLeft:0,blinkRight:0,upperLidLeft:0,upperLidRight:0,lowerLidLeft:0,lowerLidRight:0,
    browLeftY:0,browRightY:0,browLeftAngle:0,browRightAngle:0,browInnerRaise:0,browFrown:0,
    jawOpen:.015,mouthWidth:.48,mouthRound:.05,lipUpperRaise:0,lipLowerDrop:0,lipPress:.05,
    lipCornerLeft:0,lipCornerRight:0,smile:0,frown:0,tongue:0,
    cheekRaiseLeft:0,cheekRaiseRight:0,cheekPuff:0,noseWrinkle:0,
    headYaw:0,headPitch:0,headRoll:0,neckFollow:0,
    chestBreath:0,shoulderLift:0,posture:0,bodyEnergy:.35
  });

  const VISEME_TARGETS=Object.freeze({
    REST:{jawOpen:.015,mouthWidth:.48,mouthRound:.05,lipPress:.08,tongue:0},
    A:{jawOpen:.76,mouthWidth:.57,mouthRound:.08,lipPress:0,lipLowerDrop:.20,tongue:.03},
    E:{jawOpen:.40,mouthWidth:.82,mouthRound:.02,lipPress:0,lipCornerLeft:.08,lipCornerRight:.08,tongue:.02},
    I:{jawOpen:.27,mouthWidth:.90,mouthRound:0,lipPress:0,lipCornerLeft:.10,lipCornerRight:.10,tongue:.02},
    O:{jawOpen:.49,mouthWidth:.30,mouthRound:.94,lipPress:0,lipLowerDrop:.12,tongue:0},
    U:{jawOpen:.25,mouthWidth:.24,mouthRound:.98,lipPress:0,tongue:0},
    MBP:{jawOpen:.02,mouthWidth:.47,mouthRound:.04,lipPress:.97,tongue:0},
    FV:{jawOpen:.15,mouthWidth:.57,mouthRound:.03,lipPress:.10,lipUpperRaise:.10,lipLowerDrop:.03,tongue:0},
    L:{jawOpen:.42,mouthWidth:.60,mouthRound:.03,lipPress:0,lipUpperRaise:.05,tongue:.72},
    TH:{jawOpen:.28,mouthWidth:.53,mouthRound:.02,lipPress:0,tongue:.96},
    SZ:{jawOpen:.16,mouthWidth:.73,mouthRound:.02,lipPress:.04,lipCornerLeft:.05,lipCornerRight:.05,tongue:.04},
    SHCH:{jawOpen:.24,mouthWidth:.39,mouthRound:.72,lipPress:.03,tongue:.04}
  });

  const PHONEME_MAP=Object.freeze({
    'a':'A','ɑ':'A','æ':'A','ʌ':'A','ɐ':'A','ə':'A',
    'e':'E','ɛ':'E','ɜ':'E','ɚ':'E','ɝ':'E',
    'i':'I','ɪ':'I','y':'I',
    'o':'O','ɔ':'O','ɒ':'O',
    'u':'U','ʊ':'U',
    'm':'MBP','b':'MBP','p':'MBP',
    'f':'FV','v':'FV',
    'l':'L','ɫ':'L',
    'θ':'TH','ð':'TH',
    's':'SZ','z':'SZ',
    'ʃ':'SHCH','ʒ':'SHCH','tʃ':'SHCH','dʒ':'SHCH','ch':'SHCH','sh':'SHCH'
  });

  const RIG_CHANNELS=Object.freeze(Object.keys(BASE_RIG));
  function sanitizeRig(partial={}){
    const out={};
    for(const k of RIG_CHANNELS){
      if(!(k in partial)) continue;
      const v=+partial[k]; if(!Number.isFinite(v)) continue;
      if(['headYaw','headPitch','headRoll','browLeftY','browRightY','browLeftAngle','browRightAngle','lipCornerLeft','lipCornerRight','posture','neckFollow','eyeLeftX','eyeLeftY','eyeRightX','eyeRightY'].includes(k)) out[k]=clamp(v,-1,1);
      else out[k]=clamp(v,0,1);
    }
    return out;
  }
  function addLayer(dst,layer,weight=1){
    for(const [k,v] of Object.entries(layer||{})){
      if(!RIG_CHANNELS.includes(k)||!Number.isFinite(+v)) continue;
      const signed=['headYaw','headPitch','headRoll','browLeftY','browRightY','browLeftAngle','browRightAngle','lipCornerLeft','lipCornerRight','posture','neckFollow','eyeLeftX','eyeLeftY','eyeRightX','eyeRightY'].includes(k);
      if(k==='eyeOpenLeft'||k==='eyeOpenRight') dst[k]=clamp(dst[k]*Math.max(0,1-(1-v)*weight));
      else dst[k]=(dst[k]??0)+v*weight;
      dst[k]=signed?clamp(dst[k],-1,1):clamp(dst[k],0,1);
    }
    return dst;
  }
  function blendRig(a,b,t){
    const out={...BASE_RIG}; for(const k of RIG_CHANNELS) out[k]=mix(a?.[k]??BASE_RIG[k],b?.[k]??BASE_RIG[k],t); return out;
  }

  function emotionToRig(emotion='neutral',intensity=.3,profile={}){
    const i=clamp(intensity); const expressive=clamp(profile.expressiveness??.6); const amp=.72+.45*expressive;
    const v={};
    switch(emotion){
      case 'happy': case 'encouraging': case 'proud': v.smile=.68*i;v.lipCornerLeft=.20*i;v.lipCornerRight=.22*i;v.cheekRaiseLeft=.30*i;v.cheekRaiseRight=.32*i;v.browInnerRaise=.08*i;break;
      case 'amused': v.smile=.76*i;v.eyeSquintLeft=.20*i;v.eyeSquintRight=.23*i;v.cheekRaiseLeft=.35*i;v.cheekRaiseRight=.37*i;v.headRoll=.05*i;break;
      case 'excited': v.smile=.84*i;v.browInnerRaise=.34*i;v.cheekRaiseLeft=.42*i;v.cheekRaiseRight=.44*i;v.bodyEnergy=.42*i;break;
      case 'curious': v.browInnerRaise=.32*i;v.browLeftY=.12*i;v.headRoll=.16*i;v.mouthRound=.08*i;break;
      case 'thinking': v.browFrown=.16*i;v.browLeftAngle=-.08*i;v.browRightAngle=.07*i;v.headPitch=-.08*i;v.lipPress=.10*i;break;
      case 'confused': v.browFrown=.28*i;v.browInnerRaise=.24*i;v.headRoll=.22*i;v.mouthRound=.08*i;break;
      case 'surprised': v.browInnerRaise=.65*i;v.upperLidLeft=.02*i;v.upperLidRight=.02*i;v.jawOpen=.30*i;v.mouthRound=.30*i;break;
      case 'annoyed': v.eyeSquintLeft=.25*i;v.eyeSquintRight=.27*i;v.browFrown=.44*i;v.lipPress=.18*i;v.headRoll=-.08*i;v.noseWrinkle=.08*i;break;
      case 'frustrated': v.eyeSquintLeft=.29*i;v.eyeSquintRight=.31*i;v.browFrown=.58*i;v.lipPress=.28*i;v.frown=.22*i;v.headPitch=.06*i;break;
      case 'sarcastic': v.eyeSquintLeft=.14*i;v.eyeSquintRight=.24*i;v.browLeftY=.22*i;v.browLeftAngle=-.18*i;v.lipCornerLeft=.18*i;v.lipCornerRight=-.04*i;v.headRoll=-.13*i;break;
      case 'disappointed': v.frown=.25*i;v.browInnerRaise=.18*i;v.headPitch=.09*i;v.lipPress=.16*i;break;
      case 'sad': v.frown=.36*i;v.browInnerRaise=.28*i;v.upperLidLeft=.12*i;v.upperLidRight=.13*i;v.headPitch=.12*i;v.posture=.12*i;break;
      case 'serious': v.lipPress=.10*i;v.browFrown=.12*i;v.eyeSquintLeft=.06*i;v.eyeSquintRight=.06*i;break;
    }
    for(const k of Object.keys(v)) v[k]*=amp;
    if(profile.id==='original'){v.smile=(v.smile||0)*.55;v.headRoll=(v.headRoll||0)*.75;}
    if(profile.id==='american'){v.smile=(v.smile||0)*1.16;v.browInnerRaise=(v.browInnerRaise||0)*1.10;}
    if(profile.id==='british'){v.headRoll=(v.headRoll||0)*.60;v.bodyEnergy=(v.bodyEnergy||0)*.72;}
    if(profile.id==='latina'){v.headRoll=(v.headRoll||0)*1.18;v.browInnerRaise=(v.browInnerRaise||0)*1.18;}
    return sanitizeRig(v);
  }

  class LipSyncEngine{
    constructor(opts={}){this.current={...VISEME_TARGETS.REST};this.target={...VISEME_TARGETS.REST};this.timeline=[];this.startedAt=0;this.manual=null;this.anticipation=clamp(opts.anticipation??.055,.02,.12);this.smoothing=opts.smoothing??24;this.lastViseme='REST';}
    phonemeToViseme(p){const s=String(p||'').trim().toLowerCase();return PHONEME_MAP[s]||PHONEME_MAP[s[0]]||'REST';}
    setTimeline(items=[],startMs=0){this.timeline=(Array.isArray(items)?items:[]).map(x=>({phoneme:String(x.phoneme||''),viseme:x.viseme&&VISEMES.includes(x.viseme)?x.viseme:this.phonemeToViseme(x.phoneme),start:Math.max(0,+x.start||0),end:Math.max(+x.start||0,+x.end||(+x.start||0)+.08)})).sort((a,b)=>a.start-b.start);this.startedAt=startMs;this.manual=null;return this.timeline;}
    feedViseme(viseme,amount=.7,holdMs=120,nowMs=0){const v=VISEMES.includes(viseme)?viseme:'REST';this.manual={viseme:v,amount:clamp(amount),until:nowMs+Math.max(20,holdMs)};this.lastViseme=v;}
    _sampleTimeline(nowMs){if(!this.timeline.length)return {viseme:'REST',target:VISEME_TARGETS.REST,amount:0};const t=Math.max(0,(nowMs-this.startedAt)/1000);let idx=-1;for(let i=0;i<this.timeline.length;i++){if(t>=this.timeline[i].start&&t<=this.timeline[i].end+.08){idx=i;break;}if(t>this.timeline[i].end)idx=i;}
      if(idx<0)return {viseme:'REST',target:VISEME_TARGETS.REST,amount:0};const cur=this.timeline[Math.min(idx,this.timeline.length-1)];const next=this.timeline[idx+1];let target={...VISEME_TARGETS[cur.viseme]};let label=cur.viseme;
      if(next){const blendStart=Math.max(cur.start,next.start-this.anticipation);if(t>=blendStart){const f=clamp((t-blendStart)/Math.max(.025,next.start-blendStart+.035));target=blendRig(VISEME_TARGETS[cur.viseme],VISEME_TARGETS[next.viseme],f);label=f>.55?next.viseme:cur.viseme;}}
      if(t>cur.end&&!next){const f=clamp((t-cur.end)/.12);target=blendRig(VISEME_TARGETS[cur.viseme],VISEME_TARGETS.REST,f);if(f>.65)label='REST';}
      return {viseme:label,target,amount:label==='REST'?0:1};
    }
    tick(dt,nowMs){let sample;if(this.manual&&nowMs<=this.manual.until){sample={viseme:this.manual.viseme,target:blendRig(VISEME_TARGETS.REST,VISEME_TARGETS[this.manual.viseme],this.manual.amount),amount:this.manual.amount};}else{this.manual=null;sample=this._sampleTimeline(nowMs);}this.lastViseme=sample.viseme;for(const k of Object.keys(VISEME_TARGETS.REST)){this.current[k]=expLerp(this.current[k]??BASE_RIG[k]??0,sample.target[k]??BASE_RIG[k]??0,dt,this.smoothing);}return {state:sanitizeRig(this.current),viseme:sample.viseme,amount:sample.amount};}
    reset(){this.timeline=[];this.manual=null;this.current={...VISEME_TARGETS.REST};this.lastViseme='REST';}
  }

  class GazeEngine{
    constructor(profile,rng=Math.random){this.profile=profile;this.rng=rng;this.state='LOOK_USER';this.x=0;this.y=0;this.tx=0;this.ty=0;this.nextShift=1.8;this.hold=0;}
    setState(s){if(GAZE_STATES.includes(s))this.state=s;this._chooseTarget(true);}
    _chooseTarget(force=false){const p=this.profile;switch(this.state){case'LOOK_SIDE':this.tx=this.rng()<.5?-.58:.58;this.ty=rand(this.rng,-.08,.09);break;case'LOOK_UP':this.tx=rand(this.rng,-.18,.25);this.ty=-.58;break;case'LOOK_DOWN':this.tx=rand(this.rng,-.12,.15);this.ty=.46;break;case'THINK':this.tx=p.id==='original'?-.34:.26;this.ty=-.30;break;case'AVOID_GAZE':this.tx=p.id==='original'?(this.rng()<.72?-.48:.44):(this.rng()<.5?-.38:.38);this.ty=.04;break;default:this.tx=rand(this.rng,-.07,.07);this.ty=rand(this.rng,-.04,.05);break;}if(force){this.x=this.tx;this.y=this.ty;}}
    tick(dt,ctx={}){this.nextShift-=dt;this.hold=Math.max(0,this.hold-dt);if(ctx.mode==='thinking'&&this.state==='LOOK_USER'){this.state='THINK';this._chooseTarget();this.hold=rand(this.rng,.45,1.4);}else if(ctx.mode!=='thinking'&&this.state==='THINK'&&this.hold<=0){this.state='RETURN_TO_USER';this._chooseTarget();}
      if(this.nextShift<=0&&this.hold<=0){const wander=clamp(this.profile.gazeWander??.2);if(this.rng()<wander){this.state=pick(this.rng,['LOOK_SIDE','LOOK_USER','LOOK_USER','LOOK_UP']);this._chooseTarget();this.hold=rand(this.rng,.22,.78);}else{this.state='LOOK_USER';this._chooseTarget();}this.nextShift=rand(this.rng,1.2,3.6);}
      if(this.state==='RETURN_TO_USER'){this.tx=0;this.ty=0;if(Math.abs(this.x)<.03&&Math.abs(this.y)<.03)this.state='LOOK_USER';}
      const speed=this.state==='LOOK_USER'?8:5.5;this.x=expLerp(this.x,this.tx,dt,speed);this.y=expLerp(this.y,this.ty,dt,speed);const asym=rand(this.rng,-.018,.018);return {eyeLeftX:clamp(this.x+asym,-1,1),eyeLeftY:clamp(this.y,-1,1),eyeRightX:clamp(this.x-asym,-1,1),eyeRightY:clamp(this.y+asym*.5,-1,1)};}
  }

  class BlinkEngine{
    constructor(profile,rng=Math.random){this.profile=profile;this.rng=rng;this.time=0;this.next=this._nextInterval();this.phase=null;this.count=0;this.lastType='single';this.side='both';}
    _nextInterval(){const r=Math.max(.04,Math.min(.96,this.rng()));const base=-Math.log(1-r);const [a,b]=this.profile.blink||[2.8,6.5];return clamp(a+base*(b-a)*.52,a,b*1.35);}
    trigger(type='single',side='both'){this.phase={type,t:0,d:type==='slow'?.34:type==='half'?.19:.15};this.side=['left','right','both'].includes(side)?side:'both';this.lastType=type;this.count++;}
    tick(dt,ctx={}){this.time+=dt;this.next-=dt;if(!this.phase&&this.next<=0){let pool=['single','single','single','double','half'];if(ctx.emotion==='sad'||ctx.emotion==='thinking')pool.push('slow');if(ctx.emotion==='excited')pool.push('double');this.trigger(pick(this.rng,pool));this.next=this._nextInterval();}
      let l=0,r=0;if(this.phase){this.phase.t+=dt;const {type,t,d}=this.phase;const one=(x)=>Math.sin(Math.PI*clamp(x/d));if(type==='double'){const u=t<d?one(t):t<d+.08?0:one(t-d-.08);l=clamp(u);r=clamp(one(Math.max(0,t-.018))+(t>d+.08?one(Math.max(0,t-d-.10)):0));if(t>2*d+.12)this.phase=null;}else{const amp=type==='half'?.52:1;l=one(t)*amp;r=one(Math.max(0,t-.022))*amp;if(t>d+.04)this.phase=null;}if(this.side==='left')r=0;else if(this.side==='right')l=0;}
      return {blinkLeft:l,blinkRight:r,eyeOpenLeft:1-l,eyeOpenRight:1-r,upperLidLeft:l*.82,upperLidRight:r*.82,lowerLidLeft:l*.18,lowerLidRight:r*.18};}
  }

  class MicroExpressionEngine{
    constructor(profile,rng=Math.random){this.profile=profile;this.rng=rng;this.timer=rand(rng,1.5,3.8);this.active=null;this.history=[];}
    _allowed(ctx){const p=this.profile.id;if(p==='original')return ['brow_single','lip_press','squint','micro_sigh','side_smirk'];if(p==='american')return ['micro_smile','brow_up','soft_nod','cheek_raise','warm_smile'];if(p==='british')return ['micro_smile','brow_up','soft_nod','thoughtful','lip_press'];return ['brow_up','micro_smile','head_tilt','cheek_raise','bright_eyes','soft_nod'];}
    _start(ctx){let choices=this._allowed(ctx).filter(x=>!this.history.slice(-2).includes(x));if(!choices.length)choices=this._allowed(ctx);const type=pick(this.rng,choices);const dur=rand(this.rng,.28,.78);this.active={type,t:0,dur,strength:rand(this.rng,.10,.30)*(this.profile.expressiveness??.7)};this.history.push(type);this.history=this.history.slice(-8);return type;}
    tick(dt,ctx={}){this.timer-=dt;if(!this.active&&this.timer<=0){this._start(ctx);this.timer=rand(this.rng,1.8,5.4)/(ctx.mode==='listening'?1.25:1);}const out={};if(this.active){this.active.t+=dt;const a=this.active;const envelope=Math.sin(Math.PI*clamp(a.t/a.dur))*a.strength;switch(a.type){case'brow_single':out.browLeftY=envelope;out.browLeftAngle=-envelope*.8;break;case'lip_press':out.lipPress=envelope;break;case'squint':out.eyeSquintLeft=envelope;out.eyeSquintRight=envelope*.8;break;case'micro_sigh':out.headPitch=envelope*.35;out.lipPress=envelope*.45;break;case'side_smirk':out.lipCornerLeft=envelope;out.lipCornerRight=-envelope*.18;break;case'micro_smile':case'warm_smile':out.smile=envelope;out.lipCornerLeft=envelope*.6;out.lipCornerRight=envelope*.68;break;case'brow_up':out.browInnerRaise=envelope;break;case'soft_nod':out.headPitch=envelope*.32;break;case'cheek_raise':out.cheekRaiseLeft=envelope;out.cheekRaiseRight=envelope*.92;break;case'thoughtful':out.browFrown=envelope*.45;out.headRoll=envelope*.28;break;case'head_tilt':out.headRoll=envelope*.45;break;case'bright_eyes':out.browInnerRaise=envelope*.4;out.lowerLidLeft=envelope*.06;out.lowerLidRight=envelope*.05;break;}if(a.t>=a.dur)this.active=null;}return out;}
  }

  class HeadEngine{
    constructor(profile,rng=Math.random){this.profile=profile;this.rng=rng;this.yaw=0;this.pitch=0;this.roll=0;this.ty=0;this.tp=0;this.tr=0;this.timer=0;this.event={yaw:0,pitch:0,roll:0,ttl:0};}
    nudge(kind,strength=.3){const s=clamp(strength);if(kind==='nod'){this.event={yaw:0,pitch:.30*s,roll:0,ttl:.42};}else if(kind==='tilt'){this.event={yaw:0,pitch:0,roll:(this.rng()<.5?-1:1)*.34*s,ttl:.65};}}
    tick(dt,ctx={}){this.timer-=dt;if(this.timer<=0){const amp=(this.profile.id==='latina'?.14:this.profile.id==='american'?.10:this.profile.id==='original'?.055:.065)*(ctx.mode==='speaking'?1.25:1);this.ty=rand(this.rng,-amp,amp);this.tp=rand(this.rng,-amp*.7,amp*.7);this.tr=rand(this.rng,-amp*.6,amp*.6);this.timer=rand(this.rng,.8,2.4);}
      this.yaw=expLerp(this.yaw,this.ty,dt,1.8);this.pitch=expLerp(this.pitch,this.tp,dt,1.7);this.roll=expLerp(this.roll,this.tr,dt,1.6);let e={yaw:0,pitch:0,roll:0};if(this.event.ttl>0){this.event.ttl-=dt;const env=Math.sin(Math.PI*clamp(this.event.ttl/.65));e=this.event;}return {headYaw:clamp(this.yaw+e.yaw,-1,1),headPitch:clamp(this.pitch+e.pitch,-1,1),headRoll:clamp(this.roll+e.roll,-1,1),neckFollow:clamp((this.yaw*.35+this.roll*.25),-1,1)};}
  }

  class BreathingEngine{
    constructor(profile){this.profile=profile;this.phase=0;}
    tick(dt,ctx={}){let bpm=ctx.emotion==='excited'?18:ctx.emotion==='annoyed'||ctx.emotion==='frustrated'?17:ctx.emotion==='sad'?9:12; bpm*=.94+(this.profile.enthusiasm??.5)*.12;this.phase=(this.phase+dt*bpm/60*TAU)%TAU;const wave=(Math.sin(this.phase-Math.PI/2)+1)/2;const amp=ctx.emotion==='excited'?.70:ctx.emotion==='sad'?.42:ctx.emotion==='annoyed'?.50:.55;return {chestBreath:wave*amp,shoulderLift:wave*amp*.24,neckFollow:(wave-.5)*amp*.10,headPitch:(wave-.5)*amp*.025};}
  }

  class BodyEngine{
    constructor(profile,rng=Math.random){this.profile=profile;this.rng=rng;this.posture=0;this.target=0;this.timer=1;}
    tick(dt,ctx={}){this.timer-=dt;if(this.timer<=0){const amp=this.profile.id==='latina'?.11:this.profile.id==='american'?.085:this.profile.id==='original'?.045:.05;this.target=rand(this.rng,-amp,amp)+(ctx.emotion==='sad'?.12:0);this.timer=rand(this.rng,1.8,4.5);}this.posture=expLerp(this.posture,this.target,dt,1.2);return {posture:this.posture,bodyEnergy:clamp((ctx.energy??.4)*(.78+(this.profile.expressiveness??.6)*.30))};}
  }

  class ReactionPlanner{
    constructor(profile){this.profile=profile;}
    plan(event={}){const type=event.type||'generic';const count=+event.count||0;const p=this.profile.id;if(type==='repeated_error'&&count>=4){
      if(p==='original')return {emotion:'annoyed',intensity:.58,sequence:[['gaze','LOOK_SIDE',0],['sigh',.34,.38],['gaze','RETURN_TO_USER',.82],['brow',.46,1.04]],tag:'lily-fourth-error'};
      if(p==='american')return {emotion:'encouraging',intensity:.70,sequence:[['gaze','LOOK_USER',0],['smile',.48,.18],['nod',.38,.44]],tag:'sara-fourth-error'};
      if(p==='british')return {emotion:'thinking',intensity:.45,sequence:[['pause',.28,0],['brow',.24,.34],['nod',.20,.72]],tag:'oliver-fourth-error'};
      return {emotion:'surprised',intensity:.52,sequence:[['brow',.42,0],['head_tilt',.42,.18],['smile',.30,.58]],tag:'sofia-fourth-error'};
    }
    if(type==='success'){return {emotion:p==='original'?'proud':'encouraging',intensity:p==='original'?.42:.72,sequence:p==='original'?[['smile',.20,0],['brow',.18,.16]]:[['smile',.52,0],['nod',.34,.24]],tag:`${p}-success`};}
    return {emotion:'neutral',intensity:.3,sequence:[],tag:`${p}-${type}`};}
  }

  class PerformanceEngine{
    constructor(profile,{adapter=null,autoStart=true,rng=null,seed=0xC0FFEE}={}){this.profile=profile||{};this.adapter=adapter;this.rng=rng||mulberry32(seed);this.mode='idle';this.emotionState={emotion:profile?.baseline||'neutral',intensity:.3,energy:.4};this.lip=new LipSyncEngine();this.gaze=new GazeEngine(profile,this.rng);this.blink=new BlinkEngine(profile,this.rng);this.micro=new MicroExpressionEngine(profile,this.rng);this.head=new HeadEngine(profile,this.rng);this.breath=new BreathingEngine(profile);this.body=new BodyEngine(profile,this.rng);this.reactions=new ReactionPlanner(profile);this.current={...BASE_RIG};this.target={...BASE_RIG};this.running=false;this.raf=0;this.lastTs=0;this.nowMs=0;this.pending=[];this.metrics={frames:0,blinks:0,gazeStates:new Set(),micro:new Set(),mouthSamples:0,headMin:1,headMax:-1,breathMin:1,breathMax:0,reactions:[]};if(autoStart&&typeof requestAnimationFrame==='function')this.start();}
    start(){if(this.running)return;this.running=true;this.lastTs=performance.now();const loop=(ts)=>{if(!this.running)return;const dt=Math.min(.05,Math.max(.001,(ts-this.lastTs)/1000));this.lastTs=ts;this.tick(dt,ts);this.raf=requestAnimationFrame(loop);};this.raf=requestAnimationFrame(loop);}
    stop(){this.running=false;if(typeof cancelAnimationFrame==='function'&&this.raf)cancelAnimationFrame(this.raf);this.raf=0;}
    destroy(){this.stop();this.pending=[];}
    setMode(m){this.mode=['idle','listening','thinking','speaking'].includes(m)?m:'idle';if(this.mode==='thinking')this.gaze.setState('THINK');if(this.mode==='listening')this.gaze.setState('LOOK_USER');if(this.mode==='speaking'&&this.gaze.state==='THINK')this.gaze.setState('RETURN_TO_USER');return this.mode;}
    lookAt(x=0,y=0,holdSec=.9){this.gaze.state='LOOK_USER';this.gaze.tx=clamp(x,-1,1);this.gaze.ty=clamp(y,-1,1);this.gaze.hold=Math.max(0,holdSec);this.gaze.nextShift=Math.max(this.gaze.nextShift,holdSec);}

    setEmotionState(s={}){this.emotionState={...this.emotionState,...s,emotion:String(s.emotion||this.emotionState.emotion),intensity:clamp(s.intensity??this.emotionState.intensity),energy:clamp(s.energy??this.emotionState.energy??.4)};}
    feedViseme(v,amount=.7,holdMs=120){this.lip.feedViseme(v,amount,holdMs,this.nowMs);}
    setPhonemeTimeline(items,startMs=this.nowMs){return this.lip.setTimeline(items,startMs);}
    schedule(atSeconds,fn){this.pending.push({at:this.nowMs+Math.max(0,atSeconds)*1000,fn});this.pending.sort((a,b)=>a.at-b.at);}
    triggerReaction(event){const r=this.reactions.plan(event);this.metrics.reactions.push(r.tag);this.setEmotionState({emotion:r.emotion,intensity:r.intensity});for(const [kind,val,at=0] of r.sequence){this.schedule(at,()=>{if(kind==='gaze')this.gaze.setState(val);else if(kind==='sigh')this.head.nudge('tilt',val*.35);else if(kind==='nod')this.head.nudge('nod',val);else if(kind==='head_tilt')this.head.nudge('tilt',val);else if(kind==='brow')this.adapter?.pulseBrow?.(val);else if(kind==='smile')this.adapter?.pulseSmile?.(val);});}return r;}
    triggerBlink(type='single',side='both'){this.blink.trigger(type,side);}
    _runPending(){while(this.pending.length&&this.pending[0].at<=this.nowMs){const x=this.pending.shift();try{x.fn();}catch(_){}}}
    tick(dt=.016,nowMs=null){this.nowMs=nowMs==null?this.nowMs+dt*1000:nowMs;this._runPending();const ctx={mode:this.mode,emotion:this.emotionState.emotion,intensity:this.emotionState.intensity,energy:this.emotionState.energy};
      const base={...BASE_RIG};base.bodyEnergy=ctx.energy;
      const emotion=emotionToRig(ctx.emotion,ctx.intensity,this.profile);
      const gaze=this.gaze.tick(dt,ctx);const blink=this.blink.tick(dt,ctx);const micro=this.micro.tick(dt,ctx);const head=this.head.tick(dt,ctx);const breath=this.breath.tick(dt,ctx);const body=this.body.tick(dt,ctx);const lip=this.mode==='speaking'?this.lip.tick(dt,this.nowMs):this.lip.tick(dt,this.nowMs);
      let target={...base};addLayer(target,emotion,1);addLayer(target,body,1);addLayer(target,breath,1);addLayer(target,head,1);addLayer(target,gaze,1);addLayer(target,blink,1);addLayer(target,micro,1);
      // Speech mouth geometry is an absolute deformation target, not an additive sprite/state.
      const speech=this.mode==='speaking'?lip.state:VISEME_TARGETS.REST;
      for(const k of ['jawOpen','mouthWidth','mouthRound','lipUpperRaise','lipLowerDrop','lipPress','tongue']) target[k]=clamp(speech[k]??BASE_RIG[k]);
      target.lipCornerLeft=clamp(target.lipCornerLeft+((speech.lipCornerLeft??0)-(VISEME_TARGETS.REST.lipCornerLeft??0))*.45,-1,1);
      target.lipCornerRight=clamp(target.lipCornerRight+((speech.lipCornerRight??0)-(VISEME_TARGETS.REST.lipCornerRight??0))*.45,-1,1);
      // Listening is alive, but subtler than speaking.
      if(this.mode==='listening'){target.headYaw*=.74;target.headPitch*=.76;target.headRoll*=.78;}
      if(this.mode==='idle'){target.headYaw*=.62;target.headPitch*=.62;target.headRoll*=.62;}
      // Asymmetry: tiny stable differences, never perfectly mirrored.
      const asym=(this.profile.id==='original'?.018:this.profile.id==='latina'?.030:.024);target.lipCornerLeft=clamp(target.lipCornerLeft+asym,-1,1);target.browLeftY=clamp(target.browLeftY+asym*.45,-1,1);
      this.target=sanitizeRig(target);for(const k of RIG_CHANNELS){const speed=k.startsWith('mouth')||k.startsWith('jaw')||k.startsWith('lip')?24:k.startsWith('blink')||k.startsWith('eyeOpen')?34:10;this.current[k]=expLerp(this.current[k]??BASE_RIG[k],this.target[k]??BASE_RIG[k],dt,speed);}this.adapter?.applyRig?.(this.current,{...ctx,viseme:lip.viseme,gaze:this.gaze.state});this._measure(lip);return this.snapshot();}
    _measure(lip){this.metrics.frames++;if(this.blink.phase&&this.blink.phase.t<.04)this.metrics.blinks++;this.metrics.gazeStates.add(this.gaze.state);if(this.micro.active)this.metrics.micro.add(this.micro.active.type);if(lip.viseme!=='REST')this.metrics.mouthSamples++;this.metrics.headMin=Math.min(this.metrics.headMin,this.current.headRoll);this.metrics.headMax=Math.max(this.metrics.headMax,this.current.headRoll);this.metrics.breathMin=Math.min(this.metrics.breathMin,this.current.chestBreath);this.metrics.breathMax=Math.max(this.metrics.breathMax,this.current.chestBreath);}
    snapshot(){return {mode:this.mode,emotion:copy(this.emotionState),rig:copy(this.current),gaze:this.gaze.state,viseme:this.lip.lastViseme};}
    metricsSnapshot(){return {...this.metrics,gazeStates:[...this.metrics.gazeStates],micro:[...this.metrics.micro]};}
  }

  return {BASE_RIG,RIG_CHANNELS,VISEMES,VISEME_TARGETS,PHONEME_MAP,GAZE_STATES,sanitizeRig,blendRig,emotionToRig,LipSyncEngine,GazeEngine,BlinkEngine,MicroExpressionEngine,HeadEngine,BreathingEngine,BodyEngine,ReactionPlanner,PerformanceEngine,mulberry32};
});
