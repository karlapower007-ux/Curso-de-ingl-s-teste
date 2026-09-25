/* Professores IA v1.7 — Emotion + Performance Engine com rig paramétrico contínuo e camadas simultâneas.
   Sem dependencias pagas. Compatível com camada visual raster atual e com futuro rig Rive.
   A IA NUNCA recebe acesso direto ao DOM: todo plano passa por schema/validação local. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProfessoresAvatar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const Performance = (typeof require === 'function' ? (()=>{try{return require('./performance-engine.js')}catch(_){return null}})() : null) || (typeof globalThis!=='undefined' ? globalThis.ProfessoresPerformance : null);
  if (!Performance) throw new Error('Performance Engine v1.7 não carregado');

  const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(Number(n)) ? Number(n) : a));
  const now = () => Date.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)] || arr[0];

  const EMOTIONS = Object.freeze([
    'neutral','happy','amused','encouraging','excited','curious','thinking','confused',
    'surprised','annoyed','frustrated','sarcastic','disappointed','sad','serious','proud'
  ]);
  const MODES = Object.freeze(['idle','listening','thinking','speaking']);
  const GESTURES = Object.freeze(['none','blink','blink_left','blink_right','look_side','look_up','head_nod','head_tilt','sigh','laugh','brow_raise','brow_frown','micro_smile']);
  const VISEMES = Object.freeze(['REST','A','E','I','O','U','MBP','FV','L','TH','SZ','SHCH']);

  const PERSONALITY_PROFILES = Object.freeze({
    original: {
      id:'original', slug:'lily', name:'Lily', language:'english', accent:'american',
      sarcasm:.85, warmth:.35, patience:.45, expressiveness:.55, enthusiasm:.25,
      baseline:'serious', blink:[3.2,6.4], gazeWander:.26, nodRate:.10, sighRate:.17,
      responseStyle:'dry', visemeBox:{left:33.5,top:45.7,width:33.0,height:15.6},
      faceRig:{gazeMax:2.3,browMax:3.1,eyes:{left:{left:29.6,top:34.0,width:18.8,height:11.4,rotate:-2.5},right:{left:53.6,top:35.0,width:18.6,height:11.4,rotate:1.5}},brows:{left:{left:29.0,top:27.1,width:20.5,height:8.6,rotate:4.0},right:{left:52.7,top:28.7,width:21.0,height:8.7,rotate:-1.8}}},
      labels:{ neutral:'Neutra', happy:'Satisfeita', amused:'Divertida', encouraging:'Aprovando', excited:'Animada', curious:'Curiosa', thinking:'Analisando', confused:'Confusa', surprised:'Surpresa', annoyed:'Irritada', frustrated:'Frustrada', sarcastic:'Sarcástica', disappointed:'Desapontada', sad:'Triste', serious:'Séria', proud:'Orgulhosa' },
      frames:{ neutral:'neutral', happy:'smile', amused:'smirk', encouraging:'smile', excited:'smile', curious:'serious', thinking:'serious', confused:'stern', surprised:'surprise', annoyed:'stern', frustrated:'stern', sarcastic:'smirk', disappointed:'sigh', sad:'sigh', serious:'main', proud:'smile', speaking:'speaking', blink:'sigh', sigh:'sigh', laugh:'smirk', listening:'neutral' }
    },
    british: {
      id:'british', slug:'oliver', name:'Oliver', language:'english', accent:'british',
      sarcasm:.40, warmth:.75, patience:.85, expressiveness:.50, enthusiasm:.55,
      baseline:'neutral', blink:[3.6,7.0], gazeWander:.20, nodRate:.24, sighRate:.05,
      responseStyle:'calm', visemeBox:{left:33.0,top:48.5,width:34.0,height:15.2},
      faceRig:{gazeMax:2.0,browMax:2.6,eyes:{left:{left:22.5,top:43.0,width:21.5,height:11.8,rotate:-8.0},right:{left:51.7,top:39.1,width:20.8,height:11.5,rotate:-7.0}},brows:{left:{left:20.8,top:35.4,width:23.0,height:9.3,rotate:-11.0},right:{left:49.0,top:31.8,width:23.2,height:9.0,rotate:-8.5}}},
      labels:{ neutral:'Neutro', happy:'Satisfeito', amused:'Divertido', encouraging:'Encorajador', excited:'Animado', curious:'Curioso', thinking:'Pensativo', confused:'Confuso', surprised:'Surpreso', annoyed:'Contrariado', frustrated:'Frustrado', sarcastic:'Irônico', disappointed:'Desapontado', sad:'Triste', serious:'Sério', proud:'Orgulhoso' },
      frames:{ neutral:'main', happy:'smile', amused:'laugh', encouraging:'agree', excited:'laugh', curious:'thinking', thinking:'thinking', confused:'thinking', surprised:'surprise', annoyed:'thinking', frustrated:'sigh', sarcastic:'smile', disappointed:'sigh', sad:'sigh', serious:'neutral', proud:'agree', speaking:'speaking', blink:'neutral', sigh:'sigh', laugh:'laugh', listening:'neutral' }
    },
    american: {
      id:'american', slug:'sara', name:'Sara', language:'english', accent:'american',
      sarcasm:.15, warmth:.95, patience:.90, expressiveness:.85, enthusiasm:.90,
      baseline:'happy', blink:[2.8,5.7], gazeWander:.16, nodRate:.38, sighRate:.03,
      responseStyle:'warm', visemeBox:{left:33.0,top:45.8,width:34.0,height:15.5},
      faceRig:{gazeMax:2.2,browMax:3.0,eyes:{left:{left:30.8,top:34.5,width:22.5,height:12.9,rotate:8.0},right:{left:63.1,top:41.4,width:22.2,height:12.8,rotate:8.5}},brows:{left:{left:38.7,top:25.3,width:22.0,height:9.4,rotate:12.0},right:{left:65.6,top:31.3,width:22.0,height:9.2,rotate:12.0}}},
      labels:{ neutral:'Neutra', happy:'Alegre', amused:'Divertida', encouraging:'Incentivando', excited:'Entusiasmada', curious:'Curiosa', thinking:'Pensativa', confused:'Confusa', surprised:'Surpresa', annoyed:'Irritada', frustrated:'Frustrada', sarcastic:'Brincalhona', disappointed:'Desapontada', sad:'Triste', serious:'Séria', proud:'Orgulhosa' },
      frames:{ neutral:'main', happy:'smile', amused:'laugh', encouraging:'animated', excited:'animated', curious:'neutral', thinking:'neutral', confused:'neutral', surprised:'surprise', annoyed:'neutral', frustrated:'sigh', sarcastic:'smile', disappointed:'sigh', sad:'sigh', serious:'neutral', proud:'smile', speaking:'speaking', blink:'blink', sigh:'sigh', laugh:'laugh', listening:'neutral' }
    },
    latina: {
      id:'latina', slug:'sofia', name:'Sofía', language:'spanish', accent:'spanish',
      sarcasm:.20, warmth:.90, patience:.85, expressiveness:.95, enthusiasm:.88,
      baseline:'happy', blink:[2.5,5.3], gazeWander:.22, nodRate:.34, sighRate:.04,
      responseStyle:'expressive', visemeBox:{left:33.0,top:45.6,width:34.0,height:15.5},
      faceRig:{gazeMax:2.5,browMax:3.4,eyes:{left:{left:34.7,top:35.6,width:22.0,height:13.0,rotate:8.0},right:{left:65.0,top:42.4,width:22.0,height:13.0,rotate:8.0}},brows:{left:{left:42.0,top:27.0,width:22.0,height:9.5,rotate:11.5},right:{left:69.0,top:33.2,width:21.5,height:9.4,rotate:12.5}}},
      labels:{ neutral:'Neutra', happy:'Alegre', amused:'Divertida', encouraging:'Acolhedora', excited:'Entusiasmada', curious:'Curiosa', thinking:'Pensativa', confused:'Confusa', surprised:'Surpresa', annoyed:'Irritada', frustrated:'Frustrada', sarcastic:'Brincalhona', disappointed:'Desapontada', sad:'Triste', serious:'Séria', proud:'Orgulhosa' },
      frames:{ neutral:'main', happy:'smile', amused:'laugh', encouraging:'animated', excited:'animated', curious:'thinking', thinking:'thinking', confused:'thinking', surprised:'surprise', annoyed:'thinking', frustrated:'thinking', sarcastic:'smile', disappointed:'thinking', sad:'thinking', serious:'neutral', proud:'smile', speaking:'speaking', blink:'blink', sigh:'thinking', laugh:'laugh', listening:'neutral' }
    }
  });

  const COMMON_STATE_MACHINE = Object.freeze({
    initial:'idle',
    states:{
      idle:{to:['listening','thinking','speaking'], overlays:['blink','breath','gaze','microexpression']},
      listening:{to:['thinking','speaking','idle'], overlays:['blink','breath','gaze','head_nod','emotion']},
      thinking:{to:['speaking','listening','idle'], overlays:['blink','breath','look_side','brow','emotion']},
      speaking:{to:['listening','thinking','idle'], overlays:['breath','viseme','emotion','blink','gaze','head']}
    }
  });
  const STATE_MACHINES = Object.freeze(Object.fromEntries(Object.keys(PERSONALITY_PROFILES).map(k => [k, COMMON_STATE_MACHINE])));

  const EMOTION_SCHEMA = Object.freeze({
    type:'object', required:['emotion','intensity','energy','smile','eye_contact','eye_squint','eye_x','eye_y','brow_frown','brow_raise','head_tilt','patience'],
    properties:{
      emotion:{enum:EMOTIONS}, intensity:{minimum:0,maximum:1}, energy:{minimum:0,maximum:1}, smile:{minimum:0,maximum:1},
      eye_contact:{minimum:0,maximum:1}, eye_squint:{minimum:0,maximum:1}, eye_x:{minimum:-1,maximum:1}, eye_y:{minimum:-1,maximum:1}, brow_frown:{minimum:0,maximum:1}, brow_raise:{minimum:0,maximum:1},
      head_tilt:{minimum:-1,maximum:1}, patience:{minimum:0,maximum:1}, decay:{minimum:0,maximum:1}
    }
  });
  const ANIMATION_SCHEMA = Object.freeze({
    type:'object', required:['mode','emotion','emotion_intensity','animation','events'],
    properties:{ mode:{enum:MODES}, emotion:{enum:EMOTIONS}, emotion_intensity:{minimum:0,maximum:1},
      animation:{properties:{smile:{minimum:0,maximum:1},head_nod:{minimum:0,maximum:1},head_tilt:{minimum:-1,maximum:1},brow_raise:{minimum:0,maximum:1},brow_frown:{minimum:0,maximum:1},eye_contact:{minimum:0,maximum:1},eye_squint:{minimum:0,maximum:1},eye_x:{minimum:-1,maximum:1},eye_y:{minimum:-1,maximum:1}}},
      events:{items:{properties:{type:{enum:GESTURES},time:{minimum:0,maximum:30},strength:{minimum:0,maximum:1}}}}
    }
  });

  function emotionVector(emotion, intensity, profile) {
    const i = clamp(intensity);
    const base = {energy:.35,smile:.05,eye_contact:.82,eye_squint:.08,eye_x:0,eye_y:0,brow_frown:.04,brow_raise:.05,head_tilt:0,patience:profile.patience};
    const v = {
      neutral:{}, happy:{energy:.62,smile:.78,brow_raise:.12}, amused:{energy:.68,smile:.70,eye_squint:.20,brow_raise:.15},
      encouraging:{energy:.58,smile:.62,eye_contact:.94,brow_raise:.14}, excited:{energy:.92,smile:.90,eye_contact:.93,brow_raise:.36},
      curious:{energy:.50,smile:.20,eye_contact:.88,eye_x:.10,eye_y:-.04,brow_raise:.34,head_tilt:.18}, thinking:{energy:.28,smile:.04,eye_contact:.46,eye_x:.24,eye_y:-.22,brow_frown:.15,head_tilt:.13},
      confused:{energy:.38,smile:.01,eye_contact:.70,eye_x:.15,eye_y:-.08,brow_frown:.36,brow_raise:.24,head_tilt:.24}, surprised:{energy:.86,smile:.18,eye_contact:.94,eye_x:0,eye_y:0,brow_raise:.78},
      annoyed:{energy:.40,smile:0,eye_contact:.90,eye_squint:.42,eye_x:-.08,eye_y:.02,brow_frown:.52,head_tilt:-.14,patience:profile.patience*.65},
      frustrated:{energy:.55,smile:0,eye_contact:.76,eye_squint:.34,brow_frown:.68,head_tilt:-.10,patience:profile.patience*.52},
      sarcastic:{energy:.42,smile:.22,eye_contact:.80,eye_squint:.36,eye_x:-.18,eye_y:.03,brow_raise:.42,head_tilt:-.20}, disappointed:{energy:.24,smile:0,eye_contact:.62,eye_x:-.05,eye_y:.10,brow_frown:.30,head_tilt:-.06},
      sad:{energy:.18,smile:0,eye_contact:.64,eye_squint:.15,brow_frown:.22,head_tilt:-.08}, serious:{energy:.34,smile:0,eye_contact:.91,eye_squint:.17,brow_frown:.16},
      proud:{energy:.62,smile:.52,eye_contact:.92,brow_raise:.14,head_tilt:.04}
    }[emotion] || {};
    const out = {...base};
    for (const [k,val] of Object.entries(v)) out[k] = (k === 'head_tilt' || k === 'eye_x' || k === 'eye_y') ? clamp(val*i, -1, 1) : clamp(base[k] + (val-base[k])*i);
    out.intensity=i; out.emotion=emotion;
    return out;
  }

  function textEmotion(text, role, profile) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return {emotion:profile.baseline,intensity:.25,reason:'empty'};
    const has = re => re.test(t);
    if (has(/(haha|hahaha|jajaja|kkk|😂|🤣|funny|engraç|gracios)/i)) return {emotion:'amused',intensity:.72,reason:'humour'};
    if (has(/(parab[eé]ns|excelente|perfect|perfecto|awesome|amazing|great job|muito bem|muy bien|you did it|lo lograste|proud)/i)) return {emotion:'proud',intensity:.72,reason:'success'};
    if (has(/(sinto muito|lo siento|sorry|sad|triste|morreu|died|perdi|lost|hurt|doeu|chor|cry)/i)) return {emotion:'sad',intensity:.62,reason:'sadness'};
    if (has(/(wow|uau|no way|really\?|s[eé]rio\?|incr[ií]vel|incre[ií]ble|surpres)/i)) return {emotion:'surprised',intensity:.65,reason:'surprise'};
    if (has(/(angry|raiva|irritad|enojad|furioso|absurdo|rid[ií]cul|annoy)/i)) return {emotion: profile.id==='original'?'annoyed':'serious', intensity:.58, reason:'anger-context'};
    if (has(/(de novo|again|otra vez|wrong|errado|incorreto|not quite|preste aten[cç][aã]o|careful)/i)) return {emotion:profile.id==='original'?'sarcastic':'thinking',intensity:profile.id==='original'?.66:.46,reason:'correction'};
    if (has(/(não entendi|nao entendi|i don.?t understand|no entiendo|confus|como assim|what do you mean)/i)) return {emotion:'confused',intensity:.52,reason:'confusion'};
    if (/[!?¡¿]/.test(t) && /[!¡]/.test(t)) return {emotion:profile.enthusiasm>.7?'excited':'happy',intensity:.56,reason:'energy'};
    if (/[?¿]/.test(t)) return {emotion:'curious',intensity:.42,reason:'question'};
    if (role==='assistant' && profile.id==='original') return {emotion:'serious',intensity:.35,reason:'lily-baseline'};
    return {emotion:profile.baseline,intensity:.30,reason:'baseline'};
  }

  class EmotionEngine {
    constructor(profile, options={}) {
      this.profile = typeof profile === 'string' ? PERSONALITY_PROFILES[profile] : profile;
      if (!this.profile) throw new Error('Perfil de professor inválido');
      this.storage = options.storage || null;
      this.storageKey = options.storageKey || `professoresIA.emotion.${this.profile.id}`;
      this.decay = clamp(options.decay ?? .08);
      this.state = this._restore() || this._base();
    }
    _base(){ const v=emotionVector(this.profile.baseline,.25,this.profile); return {...v, previous:'neutral', decay:this.decay, updatedAt:now(), reason:'baseline'}; }
    _restore(){
      if (!this.storage) return null;
      try { const x=JSON.parse(this.storage.getItem(this.storageKey)||'null'); if(!x || now()-(x.updatedAt||0)>15*60*1000) return null; return this._sanitizeState(x); } catch(_){ return null; }
    }
    _persist(){ if(!this.storage)return; try{this.storage.setItem(this.storageKey,JSON.stringify(this.state));}catch(_){} }
    _sanitizeState(x){ const e=EMOTIONS.includes(x.emotion)?x.emotion:this.profile.baseline; const v=emotionVector(e,x.intensity??.3,this.profile); return {...v,previous:EMOTIONS.includes(x.previous)?x.previous:'neutral',decay:clamp(x.decay??this.decay),updatedAt:Number(x.updatedAt)||now(),reason:String(x.reason||'restore')}; }
    transition(emotion,intensity=.5,reason='manual'){
      if(!EMOTIONS.includes(emotion)) emotion=this.profile.baseline;
      const target = emotionVector(emotion, intensity, this.profile);
      const cur=this.state||this._base();
      // Suaviza intensidade e canais: evita neutral -> angry instantâneo.
      const maxStep = .24 + this.profile.expressiveness*.10;
      const nextI = cur.emotion===emotion ? cur.intensity + (target.intensity-cur.intensity)*.48 : Math.min(target.intensity, cur.intensity+maxStep);
      const vec=emotionVector(emotion,nextI,this.profile);
      this.state={...vec,previous:cur.emotion,decay:this.decay,updatedAt:now(),reason}; this._persist(); return this.snapshot();
    }
    ingest({text='',role='assistant',event=null,intensity=null}={}){
      let hint = event ? {emotion:event,intensity:intensity??.6,reason:'event'} : textEmotion(text,role,this.profile);
      // personalidade modula o mesmo estímulo
      if (hint.emotion==='excited') hint.intensity*=.60+.45*this.profile.enthusiasm;
      if (hint.emotion==='sad') hint.intensity*=.72+.28*this.profile.warmth;
      if (hint.emotion==='annoyed' || hint.emotion==='sarcastic') hint.intensity*=.55+.55*this.profile.sarcasm;
      return this.transition(hint.emotion, clamp(hint.intensity), hint.reason);
    }
    decayTick(dtMs=1000){
      const s=this.state, base=this.profile.baseline; if(!s)return this._base();
      const amount=clamp((dtMs/1000)*s.decay*.12,0,.12);
      let i=Math.max(.20,s.intensity-amount);
      let emotion=s.emotion;
      if(i<=.28 && emotion!==base) emotion=base;
      const vec=emotionVector(emotion,i,this.profile);
      this.state={...vec,previous:s.previous,decay:s.decay,updatedAt:now(),reason:'decay'}; this._persist(); return this.snapshot();
    }
    snapshot(){ return JSON.parse(JSON.stringify(this.state)); }
  }

  class AnimationPlanner {
    constructor(profile){ this.profile=typeof profile==='string'?PERSONALITY_PROFILES[profile]:profile; }
    plan(emotionState, mode='idle', options={}){
      const m=MODES.includes(mode)?mode:'idle'; const e=EMOTIONS.includes(emotionState?.emotion)?emotionState.emotion:this.profile.baseline;
      const i=clamp(emotionState?.intensity??.3);
      const events=[];
      const p=this.profile;
      if (options.forceEvent && GESTURES.includes(options.forceEvent)) events.push({type:options.forceEvent,time:0,strength:clamp(options.strength??i)});
      if(m==='listening' && Math.random()<p.nodRate*.35) events.push({type:'head_nod',time:rand(.35,1.2),strength:clamp(.15+p.warmth*.35)});
      if(m==='thinking' && Math.random()<.52) events.push({type:Math.random()<.5?'look_side':'look_up',time:rand(.10,.45),strength:clamp(.18+p.expressiveness*.28)});
      if(e==='annoyed' && p.id==='original' && Math.random()<.42) events.push({type:'sigh',time:rand(.15,.70),strength:clamp(.25+i*.45)});
      if((e==='amused'||e==='excited') && Math.random()<.35) events.push({type:'laugh',time:rand(.12,.65),strength:clamp(.25+i*.55)});
      const out={
        mode:m, emotion:e, emotion_intensity:i,
        animation:{
          smile:clamp(emotionState?.smile??0), head_nod:0, head_tilt:clamp(emotionState?.head_tilt??0,-1,1),
          brow_raise:clamp(emotionState?.brow_raise??0), brow_frown:clamp(emotionState?.brow_frown??0),
          eye_contact:clamp(emotionState?.eye_contact??.8), eye_squint:clamp(emotionState?.eye_squint??0), eye_x:clamp(emotionState?.eye_x??0,-1,1), eye_y:clamp(emotionState?.eye_y??0,-1,1), energy:clamp(emotionState?.energy??.4)
        }, events:events.slice(0,4)
      };
      return this.validate(out);
    }
    validate(plan){
      const p=plan||{}; const mode=MODES.includes(p.mode)?p.mode:'idle'; const emotion=EMOTIONS.includes(p.emotion)?p.emotion:this.profile.baseline;
      const a=p.animation||{}; const events=Array.isArray(p.events)?p.events:[];
      return { mode, emotion, emotion_intensity:clamp(p.emotion_intensity??.3), animation:{
        smile:clamp(a.smile),head_nod:clamp(a.head_nod),head_tilt:clamp(a.head_tilt,-1,1),brow_raise:clamp(a.brow_raise),brow_frown:clamp(a.brow_frown),eye_contact:clamp(a.eye_contact??.8),eye_squint:clamp(a.eye_squint),eye_x:clamp(a.eye_x??0,-1,1),eye_y:clamp(a.eye_y??0,-1,1),energy:clamp(a.energy??.4)
      }, events:events.filter(x=>x&&GESTURES.includes(x.type)).slice(0,6).map(x=>({type:x.type,time:clamp(x.time??0,0,30),strength:clamp(x.strength??.4)})) };
    }
  }

  class VisemeEngine {
    constructor(){ this.last='REST'; this.index=0; }
    fromAmplitude(samples){
      if(!samples || !samples.length) return {viseme:'REST',amount:0};
      let sum=0,z=0,prev=samples[0]||0;
      for(let i=0;i<samples.length;i++){const v=samples[i]/32768;sum+=v*v;if((v>=0)!=(prev>=0))z++;prev=v;}
      const rms=Math.sqrt(sum/samples.length); const amount=clamp((rms-.006)*10.5);
      if(amount<.08) return {viseme:'REST',amount};
      const zcr=z/samples.length;
      const seq = zcr>.16 ? ['SZ','SHCH','E','I'] : zcr>.08 ? ['A','E','O','FV'] : ['A','O','U','MBP','L'];
      this.index=(this.index+1)%seq.length; this.last=seq[this.index]; return {viseme:this.last,amount};
    }
    fromTimed(viseme){ const v=VISEMES.includes(viseme)?viseme:'REST'; this.last=v; return {viseme:v,amount:v==='REST'?0:.7}; }
  }

  class RasterAvatarAdapter {
    constructor(profile, els={}){
      this.profile=profile;this.rig=els.rig;this.img=els.img;this.visemeImg=els.visemeImg;this.label=els.label;this.status=els.status;
      this.basePath='/static/avatars/';this.facePatches={};this.currentMode='idle';this.currentEmotion=profile.baseline||'neutral';this.lastRig=null;this.pulses={brow:0,smile:0};
      this._configureRig();this._configureFaceLayers();this._createParametricMouth();this._createMuscleOverlay();this._createBodyLayers();
      if(this.visemeImg){this.visemeImg.classList.remove('active');this.visemeImg.hidden=true;}
      if(this.img){this.img.src=`${this.basePath}${profile.slug}-main.jpg`;}
    }
    destroy(){ if(this.mouthRoot?.remove)this.mouthRoot.remove(); if(this.bodyBreath?.remove)this.bodyBreath.remove(); }
    _configureRig(){
      if(!this.rig)return;const b=this.profile.visemeBox||{left:33,top:46,width:34,height:16};
      this.rig.style.setProperty('--mouth-left',`${b.left}%`);this.rig.style.setProperty('--mouth-top',`${b.top}%`);this.rig.style.setProperty('--mouth-width',`${b.width}%`);this.rig.style.setProperty('--mouth-height',`${b.height}%`);
      const skin={original:'#e7a07c',british:'#e5a17f',american:'#e49a75',latina:'#e59a72'}[this.profile.id]||'#e39a76';this.rig.style.setProperty('--skin-tone',skin);
    }
    _configureFaceLayers(){
      if(!this.rig)return;const cfg=this.profile.faceRig||{};const map={eyeLeft:['eye-left',cfg.eyes?.left],eyeRight:['eye-right',cfg.eyes?.right],browLeft:['brow-left',cfg.brows?.left],browRight:['brow-right',cfg.brows?.right]};
      for(const [key,[name,box]] of Object.entries(map)){
        const patch=this.rig.querySelector(`[data-face-patch="${name}"]`);if(!patch||!box)continue;const pic=patch.querySelector('img');this.facePatches[key]={patch,pic,box};
        patch.style.left=`${box.left}%`;patch.style.top=`${box.top}%`;patch.style.width=`${box.width}%`;patch.style.height=`${box.height}%`;patch.style.setProperty('--patch-rot',`${box.rotate||0}deg`);
        if(pic){pic.src=`${this.basePath}${this.profile.slug}-main.jpg`;pic.style.width=`${(10000/box.width).toFixed(4)}%`;pic.style.height=`${(10000/box.height).toFixed(4)}%`;pic.style.left=`${(-box.left*100/box.width).toFixed(4)}%`;pic.style.top=`${(-box.top*100/box.height).toFixed(4)}%`;}
      }
    }
    _createParametricMouth(){
      if(!this.rig||typeof document==='undefined')return;const stack=this.rig.querySelector('.performance-stack')||this.rig;
      const root=document.createElement('div');root.className='parametric-mouth';root.setAttribute('aria-hidden','true');
      root.innerHTML=`<svg viewBox="0 0 100 54" preserveAspectRatio="none"><defs><radialGradient id="skin_${this.profile.slug}" cx="50%" cy="48%" r="64%"><stop offset="0" stop-color="var(--skin-tone)" stop-opacity=".98"/><stop offset="72%" stop-color="var(--skin-tone)" stop-opacity=".94"/><stop offset="100%" stop-color="var(--skin-tone)" stop-opacity="0"/></radialGradient></defs><ellipse class="mouth-skin" cx="50" cy="27" rx="49" ry="25" fill="url(#skin_${this.profile.slug})"/><path class="mouth-opening" fill="#4a1d25"/><path class="mouth-teeth" fill="#fffaf4" opacity=".96"/><path class="mouth-tongue" fill="#d46f77"/><path class="lip-upper" fill="#b95964"/><path class="lip-lower" fill="#c96570"/></svg>`;
      stack.appendChild(root);this.mouthRoot=root;this.mouthSvg=root.querySelector('svg');this.mouthParts={opening:root.querySelector('.mouth-opening'),teeth:root.querySelector('.mouth-teeth'),tongue:root.querySelector('.mouth-tongue'),upper:root.querySelector('.lip-upper'),lower:root.querySelector('.lip-lower')};
    }
    _createMuscleOverlay(){
      if(!this.rig||typeof document==='undefined')return;const stack=this.rig.querySelector('.performance-stack')||this.rig;const layer=document.createElement('div');layer.className='face-muscle-layer';layer.setAttribute('aria-hidden','true');layer.innerHTML='<span class="cheek-muscle cheek-left"></span><span class="cheek-muscle cheek-right"></span><span class="nose-muscle"><i></i><i></i><i></i></span>';stack.appendChild(layer);this.muscles={layer,left:layer.querySelector('.cheek-left'),right:layer.querySelector('.cheek-right'),nose:layer.querySelector('.nose-muscle')};
    }
    _createBodyLayers(){
      if(!this.rig||typeof document==='undefined')return;const stack=this.rig.querySelector('.performance-stack');if(!stack||!this.img)return;
      const lower=document.createElement('div');lower.className='body-breath-layer';lower.innerHTML=`<img src="${this.img.src}" alt="" aria-hidden="true">`;stack.insertBefore(lower,stack.firstChild);this.bodyBreath=lower;
    }
    _applyEye(key,x,y,open,squint,upperLid=0,lowerLid=0){const p=this.facePatches[key];if(!p)return;const max=this.profile.faceRig?.gazeMax||2.2;const gx=x*max,gy=y*max*.72;const sy=Math.max(.04,clamp(open)*(1-clamp(squint)*.28));p.patch.style.setProperty('--gaze-x',`${gx.toFixed(2)}px`);p.patch.style.setProperty('--gaze-y',`${gy.toFixed(2)}px`);p.patch.style.setProperty('--eye-open',sy.toFixed(3));p.patch.style.setProperty('--upper-lid',clamp(upperLid).toFixed(3));p.patch.style.setProperty('--lower-lid',clamp(lowerLid).toFixed(3));}
    _applyBrow(key,y,angle,inner,frown){const p=this.facePatches[key];if(!p)return;const max=this.profile.faceRig?.browMax||3;const shift=(-y-inner*.42+frown*.35)*max;const rot=(angle+(key==='browLeft'?-1:1)*(-inner*.08+frown*.11))*13;p.patch.style.setProperty('--brow-y',`${shift.toFixed(2)}px`);p.patch.style.setProperty('--brow-r',`${rot.toFixed(2)}deg`);}
    _mouthPath(state){
      const jaw=clamp(state.jawOpen),width=clamp(state.mouthWidth),round=clamp(state.mouthRound),press=clamp(state.lipPress),smile=clamp(state.smile),frown=clamp(state.frown),l=clamp(state.lipCornerLeft,-1,1),r=clamp(state.lipCornerRight,-1,1);
      const w=22+width*52-round*10;const h=Math.max(1.2,(2+jaw*25)*(1-press*.88));const cx=50,cy=27;const x0=cx-w/2,x1=cx+w/2;const cornerBase=(frown-smile)*5.8;const yl=cy+cornerBase-l*5.0,yr=cy+cornerBase-r*5.0;const midTop=cy-h/2-smile*1.2+round*1.0-clamp(state.lipUpperRaise)*3.0;const midBot=cy+h/2+frown*1.0+clamp(state.lipLowerDrop)*3.4;
      const opening=`M ${x0.toFixed(2)} ${yl.toFixed(2)} C ${(cx-w*.22).toFixed(2)} ${midTop.toFixed(2)}, ${(cx+w*.22).toFixed(2)} ${midTop.toFixed(2)}, ${x1.toFixed(2)} ${yr.toFixed(2)} C ${(cx+w*.20).toFixed(2)} ${midBot.toFixed(2)}, ${(cx-w*.20).toFixed(2)} ${midBot.toFixed(2)}, ${x0.toFixed(2)} ${yl.toFixed(2)} Z`;
      const lip=.7+round*.8;const upper=`M ${x0.toFixed(2)} ${yl.toFixed(2)} C ${(cx-w*.19).toFixed(2)} ${(midTop-lip*2).toFixed(2)}, ${(cx+w*.19).toFixed(2)} ${(midTop-lip*2).toFixed(2)}, ${x1.toFixed(2)} ${yr.toFixed(2)} C ${(cx+w*.20).toFixed(2)} ${(midTop+lip*.2).toFixed(2)}, ${(cx-w*.20).toFixed(2)} ${(midTop+lip*.2).toFixed(2)}, ${x0.toFixed(2)} ${yl.toFixed(2)} Z`;
      const lower=`M ${x0.toFixed(2)} ${yl.toFixed(2)} C ${(cx-w*.22).toFixed(2)} ${(midBot+lip*2.2).toFixed(2)}, ${(cx+w*.22).toFixed(2)} ${(midBot+lip*2.2).toFixed(2)}, ${x1.toFixed(2)} ${yr.toFixed(2)} C ${(cx+w*.20).toFixed(2)} ${(midBot-lip*.1).toFixed(2)}, ${(cx-w*.20).toFixed(2)} ${(midBot-lip*.1).toFixed(2)}, ${x0.toFixed(2)} ${yl.toFixed(2)} Z`;
      const teethH=Math.max(0,h*.28*(1-state.tongue*.25));const teeth=`M ${(x0+3).toFixed(2)} ${(midTop+.8).toFixed(2)} Q ${cx} ${(midTop+teethH+1).toFixed(2)} ${(x1-3).toFixed(2)} ${(midTop+.8).toFixed(2)} Q ${cx} ${(midTop+teethH*.25).toFixed(2)} ${(x0+3).toFixed(2)} ${(midTop+.8).toFixed(2)} Z`;
      const tongueY=midBot-2;const tongueW=w*.42*(state.tongue||0);const tongue=`M ${(cx-tongueW/2).toFixed(2)} ${tongueY.toFixed(2)} Q ${cx} ${(tongueY-6*(state.tongue||0)).toFixed(2)} ${(cx+tongueW/2).toFixed(2)} ${tongueY.toFixed(2)} Q ${cx} ${(tongueY+4).toFixed(2)} ${(cx-tongueW/2).toFixed(2)} ${tongueY.toFixed(2)} Z`;
      return {opening,upper,lower,teeth,tongue,teethOpacity:jaw>.18?.94:0,tongueOpacity:(state.tongue||0)>.12?.9:0};
    }
    _applyMouth(s){if(!this.mouthRoot)return;const m=this._mouthPath(s);this.mouthParts.opening.setAttribute('d',m.opening);this.mouthParts.upper.setAttribute('d',m.upper);this.mouthParts.lower.setAttribute('d',m.lower);this.mouthParts.teeth.setAttribute('d',m.teeth);this.mouthParts.tongue.setAttribute('d',m.tongue);this.mouthParts.teeth.style.opacity=m.teethOpacity;this.mouthParts.tongue.style.opacity=m.tongueOpacity;this.mouthRoot.style.opacity=(this.currentMode==='speaking'||s.jawOpen>.06||s.smile>.08||s.frown>.08)?'1':'.82';}
    apply(plan){if(!this.rig)return;this.currentMode=plan.mode;this.currentEmotion=plan.emotion;this.rig.dataset.mode=plan.mode;this.rig.dataset.emotion=plan.emotion;this.rig.className=`avatar-rig teacher-${this.profile.slug} emotion-${plan.emotion} mode-${plan.mode}`;if(this.label)this.label.textContent=`${this.profile.labels[plan.emotion]||plan.emotion} · ${Math.round(plan.emotion_intensity*100)}%`;}
    applyRig(s,ctx={}){if(!this.rig)return;this.lastRig=s;this.currentMode=ctx.mode||this.currentMode;this.currentEmotion=ctx.emotion||this.currentEmotion;const stack=this.rig.querySelector('.performance-stack');if(stack){stack.style.setProperty('--head-yaw',`${(s.headYaw*4.2).toFixed(2)}deg`);stack.style.setProperty('--head-pitch',`${(s.headPitch*3.8).toFixed(2)}deg`);stack.style.setProperty('--head-roll',`${(s.headRoll*4.2).toFixed(2)}deg`);stack.style.setProperty('--neck-follow',`${(s.neckFollow*1.8).toFixed(2)}px`);stack.style.setProperty('--chest-breath',s.chestBreath.toFixed(3));stack.style.setProperty('--shoulder-lift',s.shoulderLift.toFixed(3));stack.style.setProperty('--posture',s.posture.toFixed(3));}
      this._applyEye('eyeLeft',s.eyeLeftX,s.eyeLeftY,s.eyeOpenLeft,s.eyeSquintLeft,s.upperLidLeft,s.lowerLidLeft);this._applyEye('eyeRight',s.eyeRightX,s.eyeRightY,s.eyeOpenRight,s.eyeSquintRight,s.upperLidRight,s.lowerLidRight);
      this._applyBrow('browLeft',s.browLeftY,s.browLeftAngle,s.browInnerRaise,s.browFrown);this._applyBrow('browRight',s.browRightY,s.browRightAngle,s.browInnerRaise,s.browFrown);this._applyMouth(s);
      if(this.muscles){const puff=clamp(s.cheekPuff);this.muscles.left.style.opacity=clamp(s.cheekRaiseLeft*.52+puff*.22).toFixed(3);this.muscles.right.style.opacity=clamp(s.cheekRaiseRight*.52+puff*.22).toFixed(3);this.muscles.left.style.transform=`translateY(${(-s.cheekRaiseLeft*2.2).toFixed(2)}px) scale(${(1+puff*.06).toFixed(3)})`;this.muscles.right.style.transform=`translateY(${(-s.cheekRaiseRight*2.2).toFixed(2)}px) scale(${(1+puff*.06).toFixed(3)})`;this.muscles.nose.style.opacity=clamp(s.noseWrinkle*.78).toFixed(3);this.muscles.nose.style.transform=`scaleY(${(1+s.noseWrinkle*.09).toFixed(3)})`;}
      this.rig.style.setProperty('--cheek-left',s.cheekRaiseLeft.toFixed(3));this.rig.style.setProperty('--cheek-right',s.cheekRaiseRight.toFixed(3));this.rig.style.setProperty('--energy',s.bodyEnergy.toFixed(3));this.rig.dataset.viseme=ctx.viseme||'REST';this.rig.dataset.gaze=ctx.gaze||'LOOK_USER';}
    pulseBrow(strength=.3){if(!this.rig)return;this.rig.classList.add('pulse-brow');setTimeout(()=>this.rig?.classList.remove('pulse-brow'),380);}
    pulseSmile(strength=.3){if(!this.rig)return;this.rig.classList.add('pulse-smile');setTimeout(()=>this.rig?.classList.remove('pulse-smile'),520);}
    event(type,strength=.4){if(type==='laugh'){this.rig?.classList.add('event-laugh');setTimeout(()=>this.rig?.classList.remove('event-laugh'),700);}if(type==='sigh'){this.rig?.classList.add('event-sigh');setTimeout(()=>this.rig?.classList.remove('event-sigh'),900);}}
    viseme(){/* v1.7: visemas viraram alvos paramétricos; sprites ficam somente preservados como fallback legado. */}
    lookAt(x=0,y=0){/* controlado pelo GazeEngine do PerformanceEngine */}
  }

  // Native Rive adapter. The same PerformanceEngine drives both renderers,
  // so conversation/emotion logic is renderer-independent.
  class RiveAvatarAdapter {
    constructor(profile, riveInstance, options={}){
      this.profile=profile; this.rive=riveInstance; this.inputs={};
      this.rig=options.rig||null; this.canvas=options.canvas||null;
      this.label=options.label||null; this.status=options.status||null;
      this.stateMachine=options.stateMachine||'AvatarStateMachine';
      this.currentMode='idle'; this.currentEmotion=profile.baseline||'neutral';
    }
    bindInputs(inputs){
      this.inputs={};
      for(const i of inputs||[]) if(i?.name) this.inputs[i.name]=i;
      return Object.keys(this.inputs);
    }
    has(name){return !!this.inputs[name];}
    set(name,value){
      const i=this.inputs[name]; if(!i)return false;
      try{
        if(typeof i.fire==='function' && value===true){i.fire();return true;}
        if('value' in i){i.value=value;return true;}
      }catch(_){}
      return false;
    }
    _setMany(names,value){for(const n of names)this.set(n,value);}
    _mode(mode){
      this.currentMode=MODES.includes(mode)?mode:'idle';
      this.set('mode',MODES.indexOf(this.currentMode));
      for(const m of MODES)this.set('is'+m[0].toUpperCase()+m.slice(1),m===this.currentMode);
    }
    _emotion(emotion,intensity){
      this.currentEmotion=EMOTIONS.includes(emotion)?emotion:this.profile.baseline;
      this.set('emotion',EMOTIONS.indexOf(this.currentEmotion));
      this._setMany(['emotion_intensity','emotionStrength'],clamp(intensity));
      const emotional=['happy','encouraging','surprised','confused','serious'];
      for(const e of emotional)this.set('is'+e[0].toUpperCase()+e.slice(1),e===this.currentEmotion);
      this.set('isEmpathetic',['sad','disappointed'].includes(this.currentEmotion));
    }
    apply(plan){
      const a=plan.animation||{};
      this._mode(plan.mode); this._emotion(plan.emotion,plan.emotion_intensity);
      this.set('smile',a.smile??0); this.set('eye_contact',a.eye_contact??0);
      this.set('eye_squint',a.eye_squint??0); this.set('eye_x',a.eye_x??0); this.set('eye_y',a.eye_y??0);
      this.set('brow_raise',a.brow_raise??0); this.set('brow_frown',a.brow_frown??0); this.set('head_tilt',a.head_tilt??0);
      if(this.rig){this.rig.dataset.mode=this.currentMode;this.rig.dataset.emotion=this.currentEmotion;}
      if(this.label)this.label.textContent=`${this.profile.labels[this.currentEmotion]||this.currentEmotion} · ${Math.round(clamp(plan.emotion_intensity)*100)}%`;
    }
    applyRig(state,ctx={}){
      for(const k of Performance.RIG_CHANNELS||[]) this.set(k,state[k]);
      const viseme=ctx.viseme&&Performance.VISEMES.includes(ctx.viseme)?ctx.viseme:'REST';
      const visemeIndex=Performance.VISEMES.indexOf(viseme);
      this._setMany(['viseme','visemeIndex'],visemeIndex);
      const talk=Math.max(clamp(state.jawOpen||0),clamp(state.mouthRound||0)*.55);
      this._setMany(['mouth_amount','visemeStrength','talkIntensity'],this.currentMode==='speaking'?talk:0);
      this.set('energyLevel',clamp(state.bodyEnergy??ctx.energy??.35));
      this.set('headTurnX',clamp(state.headYaw??0,-1,1)); this.set('headTurnY',clamp(state.headPitch??0,-1,1));
      this.set('eyeTargetX',clamp(((state.eyeLeftX??0)+(state.eyeRightX??0))/2,-1,1));
      this.set('eyeTargetY',clamp(((state.eyeLeftY??0)+(state.eyeRightY??0))/2,-1,1));
      this.set('breathLevel',clamp(state.chestBreath??0));
    }
    pulseBrow(strength=.3){this.set('browInnerRaise',clamp(strength));}
    pulseSmile(strength=.3){this.set('smile',clamp(strength));}
    event(type,strength=.4){this.set('gesture_strength',clamp(strength));this.set(type,true);}
    viseme(v,amount=.7){
      const name=VISEMES.includes(v)?v:'REST';
      this._setMany(['viseme','visemeIndex'],VISEMES.indexOf(name));
      this._setMany(['mouth_amount','visemeStrength','talkIntensity'],clamp(amount));
    }
    lookAt(x=0,y=0){this.set('eyeTargetX',clamp(x,-1,1));this.set('eyeTargetY',clamp(y,-1,1));}
    destroy(){
      try{this.rive?.cleanup?.();}catch(_){}
      if(this.rig){this.rig.classList.remove('rive-native-active');delete this.rig.dataset.renderer;}
    }
  }

  class AvatarController {
    constructor({teacherId,rig,img,visemeImg,label,status,storage=null,adapter=null}={}){
      this.profile=PERSONALITY_PROFILES[teacherId]||PERSONALITY_PROFILES.american;this.teacherId=this.profile.id;
      this.engine=new EmotionEngine(this.profile,{storage});this.planner=new AnimationPlanner(this.profile);this.visemes=new VisemeEngine();
      this.adapter=adapter||new RasterAvatarAdapter(this.profile,{rig,img,visemeImg,label,status});this.performance=new Performance.PerformanceEngine(this.profile,{adapter:this.adapter,autoStart:false,seed:({original:17,british:29,american:41,latina:53}[this.profile.id]||61)});
      this.modeState='idle';this.destroyed=false;this.decayTimer=null;this.lastEvent={};this.demoTimers=[];
    }
    mount(){this.destroyed=false;this._apply();this.performance.start();this.decayTimer=setInterval(()=>{if(this.modeState==='idle'){this.engine.decayTick(1000);this._apply();}},1000);return this;}
    destroy(){this.destroyed=true;clearInterval(this.decayTimer);this.demoTimers.forEach(clearTimeout);this.demoTimers=[];this.performance.destroy();this.adapter.destroy?.();}
    snapshot(){return {emotion:this.engine.snapshot(),performance:this.performance.snapshot()};}
    upgradeAdapter(adapter){
      if(!adapter) return this;
      const previous=this.adapter;
      this.adapter=adapter;
      this.performance.adapter=adapter;
      try{previous?.destroy?.();}catch(_){}
      this._apply();
      return this;
    }
    _apply(extra={}){const e=this.engine.snapshot();const plan=this.planner.plan(e,this.modeState,extra);this.adapter.apply(plan);this.performance.setMode(this.modeState);this.performance.setEmotionState({emotion:e.emotion,intensity:e.intensity,energy:e.energy});return plan;}
    mode(mode){this.modeState=MODES.includes(mode)?mode:'idle';return this._apply();}
    setEmotion(emotion,intensity=.5,reason='manual'){this.engine.transition(emotion,intensity,reason);return this._apply();}
    reactToUser(text){this.engine.ingest({text,role:'user'});this.modeState='listening';return this._apply();}
    reactToAssistant(text,{after='idle'}={}){this.engine.ingest({text,role:'assistant'});this.modeState='speaking';const plan=this._apply();const t=setTimeout(()=>{if(this.destroyed)return;this.modeState=after;this.performance.lip.reset();this._apply();},Math.min(4200,1100+String(text||'').length*15));this.demoTimers.push(t);return plan;}
    applyExternalPlan(plan){const safe=this.planner.validate(plan);this.engine.transition(safe.emotion,safe.emotion_intensity,'external-validated');this.modeState=safe.mode;this.adapter.apply(safe);this.performance.setMode(safe.mode);this.performance.setEmotionState({emotion:safe.emotion,intensity:safe.emotion_intensity,energy:safe.animation.energy});return safe;}
    startSpeaking(){this.modeState='speaking';return this._apply();}
    stopSpeaking(){this.modeState='listening';this.performance.lip.reset();return this._apply();}
    feedPCM16(samples){const v=this.visemes.fromAmplitude(samples);this.performance.feedViseme(v.viseme,v.amount,110);return v;}
    feedTimedViseme(viseme,amount=.7){const v=this.visemes.fromTimed(viseme);v.amount=clamp(amount);this.performance.feedViseme(v.viseme,v.amount,150);return v;}
    feedPhonemeTimeline(items,startMs){return this.performance.setPhonemeTimeline(items,startMs);}
    reactEvent(type,count=1){const r=this.performance.triggerReaction({type,count});this.engine.transition(r.emotion,r.intensity,`reaction:${type}`);this._apply();return r;}
    _rate(type,minMs){const t=now();if(t-(this.lastEvent[type]||0)<minMs)return false;this.lastEvent[type]=t;return true;}
    blink(type='single'){if(this._rate('blink',650))this.performance.triggerBlink(type,'both');}
    blinkLeft(){if(this._rate('blink_left',650))this.performance.triggerBlink('single','left');}
    blinkRight(){if(this._rate('blink_right',650))this.performance.triggerBlink('single','right');}
    smile(strength=.5){this.setEmotion('happy',strength,'method-smile');}
    laugh(strength=.6){if(this._rate('laugh',1400)){this.setEmotion('amused',strength,'method-laugh');this.adapter.event('laugh',strength);}}
    sigh(strength=.4){if(this._rate('sigh',2600)){this.adapter.event('sigh',strength);this.performance.head.nudge('tilt',strength*.2);}}
    lookAt(x=0,y=0){this.performance.lookAt(clamp(x,-1,1),clamp(y,-1,1),.9);}
    nod(strength=.4){if(this._rate('head_nod',700))this.performance.head.nudge('nod',strength);}
    tiltHead(strength=.3){this.performance.head.nudge('tilt',strength);}
    runDemo(kind,onDone){this.demoTimers.forEach(clearTimeout);this.demoTimers=[];const done=(ms)=>{const t=setTimeout(()=>{onDone?.(this.performance.metricsSnapshot());},ms);this.demoTimers.push(t);};
      if(kind==='idle'){this.mode('idle');this.setEmotion('neutral',.3,'demo-idle');done(30000);return 30000;}
      if(kind==='listening'){this.mode('listening');this.setEmotion(this.profile.id==='original'?'serious':'encouraging',.42,'demo-listening');done(20000);return 20000;}
      if(kind==='speaking'){this.mode('speaking');this.setEmotion(this.profile.id==='original'?'sarcastic':'encouraging',.58,'demo-speaking');const seq=['A','E','MBP','O','TH','I','FV','U','L','SZ','SHCH'];let n=0;const loop=()=>{if(this.destroyed||this.modeState!=='speaking')return;this.feedTimedViseme(seq[n++%seq.length],.72);const t=setTimeout(loop,110);this.demoTimers.push(t);};loop();done(12000);return 12000;}
      if(kind==='transition'){const steps=[['neutral',.25],['happy',.58],['surprised',.68],['annoyed',.62],['neutral',.28]];steps.forEach(([e,i],idx)=>{const t=setTimeout(()=>this.setEmotion(e,i,'demo-transition'),idx*1500);this.demoTimers.push(t);});done(7800);return 7800;}
      if(kind==='repeated-error'){this.mode('listening');this.reactEvent('repeated_error',4);done(4200);return 4200;}
      if(kind==='long'){this.mode('speaking');this.setEmotion(this.profile.baseline,.42,'demo-long');const seq=['A','E','I','O','U','MBP','FV','L','TH','SZ','SHCH','REST'];let n=0;const loop=()=>{if(this.destroyed||this.modeState!=='speaking')return;this.feedTimedViseme(seq[n++%seq.length],.58+((n%3)*.1));if(n%17===0)this.blink(n%34===0?'double':'single');if(n%31===0)this.performance.gaze.setState(n%62===0?'LOOK_SIDE':'RETURN_TO_USER');const t=setTimeout(loop,130);this.demoTimers.push(t);};loop();done(180000);return 180000;}
      return 0;
    }
  }


  return {EMOTIONS,MODES,GESTURES,VISEMES,PERSONALITY_PROFILES,STATE_MACHINES,EMOTION_SCHEMA,ANIMATION_SCHEMA,EmotionEngine,AnimationPlanner,VisemeEngine,RasterAvatarAdapter,RiveAvatarAdapter,AvatarController,Performance};
});
