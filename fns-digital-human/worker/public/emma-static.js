/* FNS Digital Human — Emma visual layer.
   Strictly visual: reads DOM/state classes and CSS variables only.
   Never controls audio, microphone, speech recognition, page or turn flow. */
window.FNS_EMMA_VISUAL_RIG=true;

(()=>{
  const TEXTURE_URL='/emma.jpg';
  const CACHE_NAME='fns-emma-visual-v3';
  const STATE_INDEX={idle:0,listening:1,processing:2,speaking:3};
  let manager=null;
  let installToken=0;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const wait=ms=>new Promise(r=>setTimeout(r,ms));

  class AvatarManager{
    constructor(face){
      this.face=face;
      this.portrait=face.querySelector('#emmaPortrait');
      this.canvas=null;
      this.gl=null;
      this.program=null;
      this.texture=null;
      this.raf=0;
      this.lastHealthyFrame=0;
      this.failed=false;
      this.contextLost=false;
      this.state='idle';
      this.blinkTimer=null;
      this.gazeTimer=null;
      this.watchdog=null;
      this.token=++installToken;
      this.uniforms={};
    }

    readState(){
      if(!this.face?.isConnected)return 'idle';
      if(this.face.classList.contains('avatar-speaking'))return 'speaking';
      if(this.face.classList.contains('avatar-listening'))return 'listening';
      const status=String(document.querySelector('#statusText')?.textContent||'').toLowerCase();
      if(/processing|thinking|generating|transcrib/.test(status))return 'processing';
      return 'idle';
    }

    readMouth(){
      return clamp(Number.parseFloat(getComputedStyle(this.face).getPropertyValue('--mouth-open'))||0,0,1);
    }

    async warmTextureCache(){
      if(!('caches' in window))return;
      try{
        const cache=await caches.open(CACHE_NAME);
        if(await cache.match(TEXTURE_URL))return;
        const response=await fetch(TEXTURE_URL,{cache:'force-cache'});
        if(response.ok)await cache.put(TEXTURE_URL,response.clone());
      }catch(e){}
    }

    async ensurePortrait(){
      const portrait=this.portrait;
      if(!portrait)return false;
      if(portrait.complete&&portrait.naturalWidth>0)return true;
      return await new Promise(resolve=>{
        let settled=false;
        const done=ok=>{if(settled)return;settled=true;resolve(ok)};
        portrait.addEventListener('load',()=>done(true),{once:true});
        portrait.addEventListener('error',()=>done(false),{once:true});
        setTimeout(()=>done(portrait.complete&&portrait.naturalWidth>0),4000);
      });
    }

    injectCanvas(){
      if(this.canvas?.isConnected)return;
      const canvas=document.createElement('canvas');
      canvas.className='avatar-webgl-layer';
      canvas.setAttribute('aria-hidden','true');
      canvas.setAttribute('data-avatar-webgl','emma-v3');
      this.face.insertBefore(canvas,this.face.querySelector('.avatar-fx-layer'));
      this.canvas=canvas;
      canvas.addEventListener('webglcontextlost',event=>{
        event.preventDefault();
        this.contextLost=true;
        this.useFallback('context-lost');
        this.watchdog?.scheduleRecovery();
      });
      canvas.addEventListener('webglcontextrestored',()=>{
        this.contextLost=false;
        this.recover();
      });
    }

    compile(gl,type,source){
      const shader=gl.createShader(type);
      gl.shaderSource(shader,source);
      gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
        const info=gl.getShaderInfoLog(shader)||'shader compile failed';
        gl.deleteShader(shader);
        throw new Error(info);
      }
      return shader;
    }

    initWebGL(){
      if(!this.canvas||!this.portrait)return false;
      const gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false});
      if(!gl)return false;

      const vs=`
        attribute vec2 aPosition;
        attribute vec2 aUv;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uState;
        uniform float uMouth;
        void main(){
          float idle=sin(uTime*0.00105)*0.006;
          float listen=sin(uTime*0.0022)*0.010;
          float think=sin(uTime*0.0017)*0.013;
          float talk=sin(uTime*0.0032)*0.010;
          float motion=uState<0.5?idle:(uState<1.5?listen:(uState<2.5?think:talk));
          float yaw=sin(uTime*(uState>1.5?0.00085:0.00048))*0.035;
          if(uState>0.5&&uState<1.5)yaw+=0.012;
          if(uState>1.5&&uState<2.5)yaw-=0.018;
          float curve=(1.0-aPosition.x*aPosition.x)*0.060;
          float z=curve;
          float cy=cos(yaw),sy=sin(yaw);
          float rx=aPosition.x*cy+z*sy;
          float rz=-aPosition.x*sy+z*cy;
          float perspective=1.0/(1.0+rz*0.22);
          vec2 p=vec2(rx*perspective,(aPosition.y+motion)*perspective);
          p.y-=uMouth*0.0015;
          gl_Position=vec4(p,rz*0.08,1.0);
          vUv=aUv;
        }`;

      const fs=`
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D uTexture;
        uniform float uState;
        uniform float uMouth;
        uniform float uViewportAspect;
        uniform float uTextureAspect;
        void main(){
          vec2 uv=vUv;
          if(uViewportAspect>uTextureAspect){
            float scale=uTextureAspect/uViewportAspect;
            uv.y=(uv.y-.5)*scale+.5;
          }else{
            float scale=uViewportAspect/uTextureAspect;
            uv.x=(uv.x-.5)*scale+.5;
          }
          vec4 tex=texture2D(uTexture,uv);
          vec3 c=tex.rgb;
          float luma=dot(c,vec3(.299,.587,.114));
          float levels=10.0;
          c=floor(c*levels+.5)/levels;
          c=mix(c,vec3(luma)*.10+c*.90,.16);
          c=pow(c,vec3(.93));
          if(uState>1.5&&uState<2.5)c*=vec3(.985,.995,1.035);
          if(uState>2.5)c*=1.0+uMouth*.018;
          float vignette=smoothstep(.80,.18,distance(vUv,vec2(.5,.48)));
          c*=.93+.07*vignette;
          gl_FragColor=vec4(c,1.0);
        }`;

      const program=gl.createProgram();
      gl.attachShader(program,this.compile(gl,gl.VERTEX_SHADER,vs));
      gl.attachShader(program,this.compile(gl,gl.FRAGMENT_SHADER,fs));
      gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'program link failed');

      const positions=new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);
      const uvs=new Float32Array([0,1,1,1,0,0,0,0,1,1,1,0]);

      gl.useProgram(program);
      const pbuf=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,pbuf);
      gl.bufferData(gl.ARRAY_BUFFER,positions,gl.STATIC_DRAW);
      const aPosition=gl.getAttribLocation(program,'aPosition');
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition,2,gl.FLOAT,false,0,0);

      const ubuf=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,ubuf);
      gl.bufferData(gl.ARRAY_BUFFER,uvs,gl.STATIC_DRAW);
      const aUv=gl.getAttribLocation(program,'aUv');
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv,2,gl.FLOAT,false,0,0);

      const texture=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.portrait);

      this.gl=gl;
      this.program=program;
      this.texture=texture;
      this.uniforms={
        time:gl.getUniformLocation(program,'uTime'),
        state:gl.getUniformLocation(program,'uState'),
        mouth:gl.getUniformLocation(program,'uMouth'),
        viewportAspect:gl.getUniformLocation(program,'uViewportAspect'),
        textureAspect:gl.getUniformLocation(program,'uTextureAspect')
      };
      return true;
    }

    resize(){
      if(!this.canvas||!this.gl)return;
      const dpr=Math.min(window.devicePixelRatio||1,1.6);
      const rect=this.face.getBoundingClientRect();
      const width=Math.max(2,Math.round(rect.width*dpr));
      const height=Math.max(2,Math.round(rect.height*dpr));
      if(this.canvas.width!==width||this.canvas.height!==height){
        this.canvas.width=width;
        this.canvas.height=height;
        this.gl.viewport(0,0,width,height);
      }
    }

    render=(now)=>{
      if(this.failed||!this.gl||!this.face?.isConnected)return;
      this.resize();
      this.state=this.readState();
      this.face.dataset.avatarState=this.state;
      const gl=this.gl;
      gl.useProgram(this.program);
      gl.uniform1f(this.uniforms.time,now);
      gl.uniform1f(this.uniforms.state,STATE_INDEX[this.state]??0);
      gl.uniform1f(this.uniforms.mouth,this.readMouth());
      gl.uniform1f(this.uniforms.viewportAspect,this.canvas.width/Math.max(1,this.canvas.height));
      gl.uniform1f(this.uniforms.textureAspect,(this.portrait.naturalWidth||1)/Math.max(1,this.portrait.naturalHeight||1));
      gl.drawArrays(gl.TRIANGLES,0,6);
      this.lastHealthyFrame=performance.now();
      this.raf=requestAnimationFrame(this.render);
    }

    setBlink(amount){
      this.face.querySelectorAll('.avatar-eyelid').forEach(el=>{
        el.style.opacity=String(clamp(amount,0,1));
        el.style.transform='scaleY('+Math.max(.06,amount)+')';
      });
    }

    scheduleBlink(){
      clearTimeout(this.blinkTimer);
      const state=this.readState();
      const baseDelay=state==='speaking'?2600:state==='listening'?3000:3400;
      const spread=state==='speaking'?3000:3800;
      this.blinkTimer=setTimeout(async()=>{
        if(this.failed||!this.face?.isConnected)return;
        this.setBlink(.68);await wait(48);
        this.setBlink(1);await wait(46);
        this.setBlink(.34);await wait(42);
        this.setBlink(0);
        if(Math.random()<.07){
          await wait(145);
          this.setBlink(.62);await wait(44);
          this.setBlink(0);
        }
        this.scheduleBlink();
      },baseDelay+Math.random()*spread);
    }

    scheduleGaze(){
      clearTimeout(this.gazeTimer);
      this.gazeTimer=setTimeout(()=>{
        if(this.failed||!this.face?.isConnected)return;
        const state=this.readState();
        const span=state==='speaking'?.58:state==='listening'?.52:state==='processing'?.40:.30;
        const x=((Math.random()*2)-1)*span;
        const y=((Math.random()*2)-1)*span*.32;
        this.face.style.setProperty('--gaze-x',x.toFixed(2)+'px');
        this.face.style.setProperty('--gaze-y',y.toFixed(2)+'px');
        this.face.style.setProperty('--cheek-lift',state==='speaking'?'1':'0');
        this.scheduleGaze();
      },1750+Math.random()*2600);
    }

    useFallback(reason='fallback'){
      this.failed=true;
      cancelAnimationFrame(this.raf);
      this.raf=0;
      if(this.canvas)this.canvas.classList.add('avatar-webgl-failed');
      this.face.dataset.avatarVisualMode='fallback-2d';
      this.face.dataset.avatarVisualReason=reason;
      if(this.portrait){
        this.portrait.style.display='block';
        this.portrait.style.opacity='1';
        this.portrait.style.visibility='visible';
      }
    }

    async recover(){
      if(!this.face?.isConnected)return false;
      try{
        this.failed=false;
        this.contextLost=false;
        this.canvas?.remove();
        this.canvas=null;this.gl=null;this.program=null;this.texture=null;
        this.injectCanvas();
        if(!this.initWebGL())throw new Error('webgl unavailable');
        this.canvas.classList.remove('avatar-webgl-failed');
        this.face.dataset.avatarVisualMode='webgl';
        this.lastHealthyFrame=performance.now();
        this.raf=requestAnimationFrame(this.render);
        return true;
      }catch(error){
        this.useFallback('recovery-failed');
        return false;
      }
    }

    destroy(){
      cancelAnimationFrame(this.raf);
      clearTimeout(this.blinkTimer);
      clearTimeout(this.gazeTimer);
      this.watchdog?.stop();
      this.canvas?.remove();
      this.raf=0;
    }

    async start(){
      await this.warmTextureCache();
      const ready=await this.ensurePortrait();
      if(!ready){this.useFallback('portrait-load-failed');return}
      this.face.dataset.avatarReady='true';
      this.face.dataset.fnsRig='active';
      this.face.dataset.expressionRig='natural-v12';
      this.face.style.setProperty('--gaze-x','0px');
      this.face.style.setProperty('--gaze-y','0px');
      this.setBlink(0);
      this.scheduleBlink();
      this.scheduleGaze();

      this.injectCanvas();
      try{
        if(!this.initWebGL())throw new Error('webgl unavailable');
        this.face.dataset.avatarVisualMode='webgl';
        this.lastHealthyFrame=performance.now();
        this.raf=requestAnimationFrame(this.render);
      }catch(error){
        this.useFallback('webgl-init-failed');
      }

      this.watchdog=new AvatarWatchdog(this);
      this.watchdog.start();
    }

    static selfTest(){
      const sequence=['idle','listening','processing','speaking','idle'];
      let observed=0;
      for(let turn=0;turn<20;turn++){
        for(const state of sequence){
          if(!(state in STATE_INDEX))return false;
          observed++;
        }
      }
      return observed===100;
    }
  }

  class AvatarWatchdog{
    constructor(manager){
      this.manager=manager;
      this.timer=0;
      this.recoveryTimer=0;
      this.failures=0;
    }
    start(){
      this.stop();
      this.timer=setInterval(()=>{
        const m=this.manager;
        if(!m.face?.isConnected){this.stop();return}
        if(m.failed||m.contextLost)return;
        if(m.raf&&performance.now()-m.lastHealthyFrame>4500){
          m.useFallback('render-heartbeat');
          this.scheduleRecovery();
        }
      },1800);
    }
    stop(){
      clearInterval(this.timer);
      clearTimeout(this.recoveryTimer);
      this.timer=0;this.recoveryTimer=0;
    }
    scheduleRecovery(){
      clearTimeout(this.recoveryTimer);
      if(this.failures>=3)return;
      this.recoveryTimer=setTimeout(async()=>{
        this.failures++;
        const ok=await this.manager.recover();
        if(ok)this.failures=0;
      },700+this.failures*900);
    }
  }

  window.AvatarManager=AvatarManager;
  window.AvatarWatchdog=AvatarWatchdog;
  window.__FNS_AVATAR_SELF_TEST__=()=>AvatarManager.selfTest();

  function scan(){
    const face=document.querySelector('#avatarFace.human-avatar');
    if(face){
      if(manager?.face===face&&face.dataset.avatarManager==='active')return;
      manager?.destroy();
      manager=new AvatarManager(face);
      face.dataset.avatarManager='active';
      manager.start();
    }else if(manager){
      manager.destroy();
      manager=null;
    }
  }

  const observer=new MutationObserver(scan);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)return;
    if(manager?.failed)manager.watchdog?.scheduleRecovery();
    else scan();
  });
  scan();
})();
