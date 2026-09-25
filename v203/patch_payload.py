from pathlib import Path
import json, hashlib, re, sys
root=Path(sys.argv[1] if len(sys.argv)>1 else 'payload')

def edit(rel, fn):
    p=root/rel; s=p.read_text(encoding='utf-8'); ns=fn(s)
    if ns==s: raise SystemExit(f'patch made no change: {rel}')
    p.write_text(ns,encoding='utf-8')

# app.js — true hold-to-talk, voice session stays alive for response playback.
def patch_app(s):
    s=s.replace('  let voice = null;','  let voice = null;\n  let pttHeld = false;',1)
    old='''          <button class="btn ghost" id="switchTeacher">Trocar professor</button>\n          <button class="mic-btn" id="micBtn" title="Iniciar conversa por voz">🎙</button>\n          <button class="btn ghost" id="muteBtn" disabled>🔇 Parar</button>'''
    new='''          <button class="btn ghost" id="switchTeacher">Trocar professor</button>\n          <div class="ptt-wrap">\n            <button class="mic-btn ptt-btn" id="micBtn" type="button" title="Segure para falar" aria-label="Segure para falar" aria-pressed="false">🎙</button>\n            <span class="ptt-label" id="pttLabel">SEGURE PARA FALAR<small>Solte para eu responder</small></span>\n          </div>\n          <button class="btn ghost" id="muteBtn" disabled>■ Encerrar voz</button>'''
    if old not in s: raise SystemExit('voice controls anchor missing')
    s=s.replace(old,new,1)
    s=s.replace('O áudio do microfone é transmitido para a IA somente durante uma sessão de voz e não é salvo localmente pelo app.','O áudio é transmitido somente enquanto você mantém o botão de fala pressionado. O áudio bruto não é salvo localmente pelo app.',1)
    old="    $('#micBtn').onclick = () => voice?.active ? stopVoice() : startVoice();\n    $('#muteBtn').onclick = stopVoice;"
    new="""    const micBtn=$('#micBtn');
    const beginPTT=e=>{ if(e){e.preventDefault();try{micBtn.setPointerCapture?.(e.pointerId)}catch(_){}} beginPushToTalk(); };
    const endPTT=e=>{ if(e)e.preventDefault(); releasePushToTalk(); };
    micBtn.addEventListener('pointerdown',beginPTT);micBtn.addEventListener('pointerup',endPTT);micBtn.addEventListener('pointercancel',endPTT);micBtn.addEventListener('lostpointercapture',()=>{if(pttHeld)releasePushToTalk();});
    micBtn.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();beginPushToTalk();}});
    micBtn.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();releasePushToTalk();}});
    micBtn.addEventListener('contextmenu',e=>e.preventDefault());
    $('#muteBtn').onclick = ()=>stopVoice();"""
    if old not in s: raise SystemExit('mic click anchor missing')
    s=s.replace(old,new,1)
    old="voice = { active:true, stream, inputCtx, outputCtx, source, processor, silent, ws, queueTime:0, sources:[], assistantTranscript:'', userTranscript:'', speaking:false, currentResponseId:'', cancelledResponseId:'' };\n      $('#micBtn').classList.add('live'); $('#micBtn').textContent='●'; $('#muteBtn').disabled=false; setAvatarState('listening','OUVINDO');\n      ws.onopen = () => { processor.onaudioprocess = ev => { if (!voice?.active || ws.readyState!==1) return; const samples=ev.inputBuffer.getChannelData(0); const pcm=resampleToPCM16(samples,inputCtx.sampleRate,16000); if(pcm.byteLength) ws.send(pcm); }; };"
    new="""voice = { active:true, recording:pttHeld, pendingRelease:false, stream, inputCtx, outputCtx, source, processor, silent, ws, queueTime:0, sources:[], assistantTranscript:'', userTranscript:'', speaking:false, currentResponseId:'', cancelledResponseId:'' };
      for(const tr of stream.getAudioTracks?.()||[]) tr.enabled=!!pttHeld;
      updatePTTUI(); $('#muteBtn').disabled=false; setAvatarState(pttHeld?'listening':'',''+(pttHeld?'OUVINDO':'PRONTO PARA FALAR'));
      ws.onopen = () => { processor.onaudioprocess = ev => { if (!voice?.active || !voice.recording || ws.readyState!==1) return; const samples=ev.inputBuffer.getChannelData(0); const pcm=resampleToPCM16(samples,inputCtx.sampleRate,16000); if(pcm.byteLength) ws.send(pcm); }; if(!pttHeld&&voice?.active) flushPTTSilence(); };"""
    if old not in s: raise SystemExit('voice object anchor missing')
    s=s.replace(old,new,1)
    marker='  function resampleToPCM16(input, inputRate, targetRate) {'
    helpers=r'''  function updatePTTUI() {
    const mic=$('#micBtn'),label=$('#pttLabel'); if(!mic)return;
    const held=!!pttHeld&&!!voice?.recording;mic.classList.toggle('live',held);mic.classList.toggle('is-held',held);mic.setAttribute('aria-pressed',held?'true':'false');mic.textContent=held?'●':'🎙';
    if(label) label.innerHTML=held?'FALANDO…<small>Solte para eu responder</small>':(voice?.active?'SEGURE PARA FALAR<small>Sessão de voz pronta</small>':'SEGURE PARA FALAR<small>Solte para eu responder</small>');
  }
  function flushPTTSilence(){
    if(!voice?.active||voice.ws?.readyState!==1)return;try{voice.ws.send(new Int16Array(12800).buffer);}catch(_){}
  }
  async function beginPushToTalk(){
    if(pttHeld)return;pttHeld=true;
    if(!config?.provider_ready){pttHeld=false;toast('Para voz ao vivo, execute “Configurar Alibaba Cloud” instalado com o aplicativo.',4200);updatePTTUI();return;}
    if(voice?.active){
      if(voice.speaking){voice.interrupted=true;clearPlayback();avatarController?.stopSpeaking();if(voice.ws?.readyState===1)try{voice.ws.send(JSON.stringify({type:'app.cancel'}));}catch(_){}}
      voice.recording=true;for(const tr of voice.stream?.getAudioTracks?.()||[])tr.enabled=true;setAvatarState('listening','OUVINDO');updatePTTUI();return;
    }
    await startVoice();
    if(!pttHeld&&voice?.active)releasePushToTalk();else if(voice?.active){voice.recording=true;for(const tr of voice.stream?.getAudioTracks?.()||[])tr.enabled=true;setAvatarState('listening','OUVINDO');updatePTTUI();}
  }
  function releasePushToTalk(){
    if(!pttHeld&&!voice?.recording)return;pttHeld=false;
    if(!voice?.active){updatePTTUI();return;}
    voice.recording=false;for(const tr of voice.stream?.getAudioTracks?.()||[])tr.enabled=false;flushPTTSilence();setAvatarState('thinking','PENSANDO');updatePTTUI();
  }

'''
    if marker not in s: raise SystemExit('resample anchor missing')
    s=s.replace(marker,helpers+marker,1)
    s=s.replace("} catch (e) { console.error(e); toast('Não foi possível iniciar o microfone: ' + e.message, 4000); stopVoice(false); }","} catch (e) { console.error(e); pttHeld=false; toast('Não foi possível iniciar o microfone: ' + e.message, 4000); stopVoice(false); updatePTTUI(); }",1)
    s=s.replace("if (last) avatarController?.reactToAssistant(last, {after:'listening'});\n      else setAvatarState('listening','OUVINDO');","if (last) avatarController?.reactToAssistant(last, {after:'idle'});\n      else setAvatarState('', 'PRONTO PARA FALAR');\n      updatePTTUI();",1)
    s=s.replace("const v=voice; voice=null; try{v.processor.onaudioprocess=null;v.processor.disconnect();}catch(_){}","const v=voice; voice=null; pttHeld=false; try{v.processor.onaudioprocess=null;v.processor.disconnect();}catch(_){}",1)
    s=s.replace("const mic=$('#micBtn'), mute=$('#muteBtn'); if(mic){mic.classList.remove('live');mic.textContent='🎙';} if(mute)mute.disabled=true; setAvatarState('', 'PRONTO PARA CONVERSAR'); avatarController?.mode('idle');","const mic=$('#micBtn'), mute=$('#muteBtn'); if(mic){mic.classList.remove('live','is-held');mic.textContent='🎙';mic.setAttribute('aria-pressed','false');} if(mute)mute.disabled=true; updatePTTUI(); setAvatarState('', 'PRONTO PARA CONVERSAR'); avatarController?.mode('idle');",1)
    return s
edit('static/app.js',patch_app)

# avatar-engine.js — remove synthetic SVG mouth and restore real viseme sprites with per-person alignment.
def patch_avatar(s):
    boxes={
      "visemeBox:{left:33.5,top:45.7,width:33.0,height:15.6}":"visemeBox:{left:43.90,top:45.10,width:12.20,height:10.20,rotate:0,clipTop:39.1}",
      "visemeBox:{left:33.0,top:48.5,width:34.0,height:15.2}":"visemeBox:{left:38.20,top:56.60,width:23.20,height:16.43,rotate:-1.5,clipTop:39.0}",
      "visemeBox:{left:33.0,top:45.8,width:34.0,height:15.5}":"visemeBox:{left:40.00,top:51.22,width:24.80,height:20.30,rotate:6.5,clipTop:39.3}",
      "visemeBox:{left:33.0,top:45.6,width:34.0,height:15.5}":"visemeBox:{left:41.90,top:51.75,width:22.50,height:18.63,rotate:5.5,clipTop:40.0}",
    }
    for a,b in boxes.items():
        if a not in s: raise SystemExit('viseme box anchor missing: '+a)
        s=s.replace(a,b,1)
    old="this._configureRig();this._configureFaceLayers();this._createParametricMouth();this._createMuscleOverlay();this._createBodyLayers();\n      if(this.visemeImg){this.visemeImg.classList.remove('active');this.visemeImg.hidden=true;}"
    new="this._configureRig();this._configureFaceLayers();this._createMuscleOverlay();this._createBodyLayers();\n      if(this.visemeImg){this.visemeImg.hidden=false;this.visemeImg.classList.remove('active');this.visemeImg.src=`${this.basePath}visemes/${this.profile.slug}/REST.webp`;this.visemeImg.dataset.viseme='REST';}"
    if old not in s: raise SystemExit('constructor mouth anchor missing')
    s=s.replace(old,new,1)
    s=s.replace("destroy(){ if(this.mouthRoot?.remove)this.mouthRoot.remove(); if(this.bodyBreath?.remove)this.bodyBreath.remove(); }","destroy(){ if(this.bodyBreath?.remove)this.bodyBreath.remove(); }",1)
    old="this.rig.style.setProperty('--mouth-left',`${b.left}%`);this.rig.style.setProperty('--mouth-top',`${b.top}%`);this.rig.style.setProperty('--mouth-width',`${b.width}%`);this.rig.style.setProperty('--mouth-height',`${b.height}%`);"
    new=old+"this.rig.style.setProperty('--mouth-rotate',`${b.rotate||0}deg`);this.rig.style.setProperty('--mouth-clip-top',`${b.clipTop||0}%`);"
    if old not in s: raise SystemExit('rig mouth vars anchor missing')
    s=s.replace(old,new,1)
    start=s.index('    _createParametricMouth(){')
    end=s.index('    _createMuscleOverlay(){',start)
    s=s[:start]+"    _createParametricMouth(){ /* v2.0.3: removido. A boca usa sprites reais com máscara suave, sem SVG/tampão. */ }\n"+s[end:]
    old="this._applyBrow('browLeft',s.browLeftY,s.browLeftAngle,s.browInnerRaise,s.browFrown);this._applyBrow('browRight',s.browRightY,s.browRightAngle,s.browInnerRaise,s.browFrown);this._applyMouth(s);"
    new="this._applyBrow('browLeft',s.browLeftY,s.browLeftAngle,s.browInnerRaise,s.browFrown);this._applyBrow('browRight',s.browRightY,s.browRightAngle,s.browInnerRaise,s.browFrown);this.viseme(ctx.viseme||'REST',Math.max(s.jawOpen||0,s.mouthRound||0,s.mouthWidth||0));"
    if old not in s: raise SystemExit('apply mouth anchor missing')
    s=s.replace(old,new,1)
    old="    viseme(){/* v1.7: visemas viraram alvos paramétricos; sprites ficam somente preservados como fallback legado. */}"
    new="""    viseme(v='REST',amount=0){
      if(!this.visemeImg)return;const safe=VISEMES.includes(v)?v:'REST';
      if(this.visemeImg.dataset.viseme!==safe){this.visemeImg.src=`${this.basePath}visemes/${this.profile.slug}/${safe}.webp`;this.visemeImg.dataset.viseme=safe;}
      const active=this.currentMode==='speaking'&&safe!=='REST'&&clamp(amount)>.04;
      this.visemeImg.classList.toggle('active',active);this.visemeImg.style.setProperty('--viseme-strength',clamp(amount).toFixed(3));
    }"""
    if old not in s: raise SystemExit('viseme method anchor missing')
    return s.replace(old,new,1)
edit('static/avatar-engine.js',patch_avatar)

# styles.css — hide synthetic layer, size/clip actual sprite, add walkie-talkie control.
def patch_css(s):
    if '.viseme-layer{display:none!important}' not in s: raise SystemExit('viseme display anchor missing')
    s=s.replace('.viseme-layer{display:none!important}', '.viseme-layer{display:block!important}',1)
    s += r'''

/* =========================================================
   v2.0.3 — boca corrigida + push-to-talk
   - remove a boca SVG artificial (o "tampão")
   - usa os recortes de visema reais no tamanho/posição de cada personagem
   - recorta a porção superior do sprite para não sobrepor o nariz
   ========================================================= */
.parametric-mouth{display:none!important}
.avatar-rig .viseme-layer{
  display:block!important;position:absolute!important;z-index:8!important;
  left:var(--mouth-left,44%)!important;top:var(--mouth-top,50%)!important;
  width:var(--mouth-width,16%)!important;height:var(--mouth-height,8%)!important;
  max-width:none!important;margin:0!important;border-radius:0!important;object-fit:fill!important;
  opacity:0!important;transform:rotate(var(--mouth-rotate,0deg)) scale(.995)!important;
  transform-origin:50% 50%!important;filter:saturate(.985) contrast(.995)!important;
  clip-path:inset(var(--mouth-clip-top,0%) 0 0 0 round 12% 12% 34% 34%);
  -webkit-mask-image:radial-gradient(ellipse at 50% 73%,#000 48%,rgba(0,0,0,.96) 61%,rgba(0,0,0,.60) 78%,transparent 98%);
  mask-image:radial-gradient(ellipse at 50% 73%,#000 48%,rgba(0,0,0,.96) 61%,rgba(0,0,0,.60) 78%,transparent 98%);
  pointer-events:none!important;transition:opacity 45ms linear!important;animation:none!important;
}
.avatar-rig.mode-speaking .viseme-layer.active{opacity:.97!important}
.avatar-rig:not(.mode-speaking) .viseme-layer,.avatar-rig[data-viseme="REST"] .viseme-layer{opacity:0!important}
.voice-controls{align-items:center}
.ptt-wrap{display:flex;flex-direction:column;align-items:center;gap:7px;user-select:none;-webkit-user-select:none;touch-action:none}
.mic-btn.ptt-btn{width:92px;height:92px;font-size:34px;border:4px solid rgba(255,255,255,.9);box-shadow:0 16px 34px rgba(108,76,255,.34),0 0 0 2px rgba(108,76,255,.18);cursor:pointer;touch-action:none;outline:none}
.mic-btn.ptt-btn:focus-visible{box-shadow:0 0 0 5px rgba(108,76,255,.25),0 16px 34px rgba(108,76,255,.34)}
.mic-btn.ptt-btn.live,.mic-btn.ptt-btn.is-held{transform:scale(.96);background:linear-gradient(135deg,#e94a68,#ff8d75);animation:micPulse .9s infinite}
.ptt-label{font-size:11px;font-weight:900;letter-spacing:.04em;color:#55458b;text-align:center;line-height:1.25}
.ptt-label small{display:block;font-size:9px;font-weight:700;color:var(--muted);letter-spacing:0;margin-top:2px}
@media(max-width:540px){.mic-btn.ptt-btn{width:86px;height:86px;font-size:32px}}
'''
    return s
edit('static/styles.css',patch_css)

# service-worker cache bump — avoids loading the old UI after update.
def patch_sw(s):
    if "const CACHE='professores-ia-v2.0.2'" in s:
        return s.replace("const CACHE='professores-ia-v2.0.2'","const CACHE='professores-ia-v2.0.3-v203'",1)
    return re.sub(r"const CACHE='[^']+'", "const CACHE='professores-ia-v2.0.3-v203'", s, count=1)
edit('static/sw.js',patch_sw)

(root/'VERSION.txt').write_text('2.0.3\n',encoding='ascii')
rp=root/'LEIA_PRIMEIRO.txt';r=rp.read_text(encoding='utf-8').replace('PROFESSORES IA 2.0.2 HOTFIX','PROFESSORES IA 2.0.3 VISUAL + VOZ').replace('Professores_IA_v2.0.2_FORBIDDEN_FIX_Setup.exe','Professores_IA_v2.0.3_CORRIGIDA_Setup.exe')
r += '\n6) CONTROLE DE VOZ v2.0.3\nNa conversa, mantenha o botão grande de microfone pressionado enquanto fala e solte para a professora responder.\nA camada SVG artificial da boca da v2.0.2 foi removida.\n'
rp.write_text(r,encoding='utf-8')

# Regenerate schema-4 manifest after every changed byte.
man=root/'manifest.sha256.json';obj=json.loads(man.read_text(encoding='utf-8'));obj['version']='2.0.3';files={}
for p in sorted(root.rglob('*')):
    if not p.is_file() or p==man: continue
    rel=p.relative_to(root).as_posix();b=p.read_bytes();files[rel]={'sha256':hashlib.sha256(b).hexdigest(),'size':len(b)}
obj['files']=files;man.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'version':'2.0.3','files':len(files),'app_js':files['static/app.js']['sha256'],'avatar_js':files['static/avatar-engine.js']['sha256'],'styles':files['static/styles.css']['sha256'],'sw':files['static/sw.js']['sha256']},indent=2))
