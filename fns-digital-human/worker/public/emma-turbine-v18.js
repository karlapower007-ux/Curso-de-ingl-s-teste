/* FNS Emma Expression Turbine v18
   Visual-only DOM-survival rig.
   Does not control audio, STT, TTS, microphone, memory, turn flow or A-P turbines. */
(()=>{
  'use strict';

  const TAG='[FNS TURBINE v18]';
  const STYLE_ID='fns-override-v18';
  const SVG_ID='fns-emma-mouth-svg-v18';
  const NS='http://www.w3.org/2000/svg';

  let host=null;
  let mouth=null;
  let svg=null;
  let cavity=null;
  let teeth=null;
  let lip=null;
  let observer=null;
  let raf=0;
  let debugTimer=0;
  let repairQueued=false;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function installHardOverride(){
    let style=document.getElementById(STYLE_ID);
    if(!style){
      style=document.createElement('style');
      style.id=STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent=`
      #avatarFace.human-avatar .avatar-mouth-motion::before,
      #avatarFace.human-avatar .avatar-mouth-motion::after{
        content:none!important;
        display:none!important;
        visibility:hidden!important;
        opacity:0!important;
        background:none!important;
        border:0!important;
        box-shadow:none!important;
        clip-path:none!important;
      }
      #avatarFace.human-avatar .avatar-mouth-motion{
        position:absolute!important;
        left:50%!important;
        top:58.05%!important;
        width:13.6%!important;
        min-width:13.6%!important;
        max-width:15.8%!important;
        height:12px!important;
        min-height:12px!important;
        overflow:visible!important;
        opacity:1!important;
        visibility:visible!important;
        background:transparent!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        animation:none!important;
        transition:none!important;
        transform:translate(-50%,-50%)!important;
        transform-origin:50% 50%!important;
        pointer-events:none!important;
        z-index:2147483000!important;
      }
      #avatarFace.human-avatar .avatar-fx-layer{
        overflow:visible!important;
        z-index:2147482000!important;
      }
      #${SVG_ID}{
        position:absolute!important;
        inset:0!important;
        width:100%!important;
        height:100%!important;
        display:block!important;
        overflow:visible!important;
        opacity:1!important;
        visibility:visible!important;
        pointer-events:none!important;
        z-index:2147483647!important;
      }
    `;
  }

  async function purgeLegacyCaches(){
    try{
      if('serviceWorker' in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        for(const reg of regs){
          try{await reg.unregister()}catch(e){}
        }
      }
      if('caches' in window){
        const keys=await caches.keys();
        for(const key of keys){
          if(/fns|emma|avatar|visual|static/i.test(key)){
            try{await caches.delete(key)}catch(e){}
          }
        }
      }
    }catch(e){
      console.warn(TAG,'cache purge warning',e);
    }
  }

  function locate(){
    host=document.querySelector('#avatarFace.human-avatar');
    mouth=host?.querySelector('.avatar-mouth-motion')||null;
    return !!(host&&mouth);
  }

  function makePath(fill,stroke,width){
    const p=document.createElementNS(NS,'path');
    if(fill!==null)p.setAttribute('fill',fill);
    if(stroke!==null)p.setAttribute('stroke',stroke);
    if(width!==null)p.setAttribute('stroke-width',String(width));
    p.setAttribute('stroke-linecap','round');
    p.setAttribute('stroke-linejoin','round');
    return p;
  }

  function buildSvg(){
    if(!locate())return false;
    installHardOverride();

    const existing=mouth.querySelector('#'+SVG_ID);
    if(existing){
      svg=existing;
      cavity=svg.querySelector('[data-v18="cavity"]');
      teeth=svg.querySelector('[data-v18="teeth"]');
      lip=svg.querySelector('[data-v18="lip"]');
      if(cavity&&teeth&&lip)return true;
      existing.remove();
    }

    svg=document.createElementNS(NS,'svg');
    svg.id=SVG_ID;
    svg.setAttribute('viewBox','0 0 136 44');
    svg.setAttribute('preserveAspectRatio','none');
    svg.setAttribute('aria-hidden','true');
    svg.style.setProperty('position','absolute','important');
    svg.style.setProperty('inset','0','important');
    svg.style.setProperty('width','100%','important');
    svg.style.setProperty('height','100%','important');
    svg.style.setProperty('display','block','important');
    svg.style.setProperty('overflow','visible','important');
    svg.style.setProperty('opacity','1','important');
    svg.style.setProperty('visibility','visible','important');
    svg.style.setProperty('pointer-events','none','important');
    svg.style.setProperty('z-index','2147483647','important');

    const defs=document.createElementNS(NS,'defs');
    const grad=document.createElementNS(NS,'linearGradient');
    grad.id='fns-mouth-v18-gradient';
    grad.setAttribute('x1','0'); grad.setAttribute('y1','0');
    grad.setAttribute('x2','0'); grad.setAttribute('y2','1');
    [['0%','#54131f'],['58%','#24060b'],['100%','#842a43']].forEach(([offset,color])=>{
      const stop=document.createElementNS(NS,'stop');
      stop.setAttribute('offset',offset);
      stop.setAttribute('stop-color',color);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);

    cavity=makePath('url(#fns-mouth-v18-gradient)','#9f3d59',1.3);
    cavity.dataset.v18='cavity';
    teeth=makePath('#fffdf8',null,null);
    teeth.dataset.v18='teeth';
    lip=makePath('none','#b34a66',1.8);
    lip.dataset.v18='lip';

    svg.appendChild(cavity);
    svg.appendChild(teeth);
    svg.appendChild(lip);
    mouth.replaceChildren(svg);

    mouth.dataset.expressionTurbine='v18';
    host.dataset.expressionRig='turbine-v18';

    return true;
  }

  function readVars(){
    if(!host)return {open:0,wide:0};
    const cs=getComputedStyle(host);
    return {
      open:clamp(parseFloat(cs.getPropertyValue('--mouth-open'))||0,0,1),
      wide:clamp(parseFloat(cs.getPropertyValue('--mouth-wide'))||0,0,1)
    };
  }

  function forceInline(open,wide){
    if(!mouth)return;
    const speaking=host?.classList.contains('avatar-speaking');
    const active=Math.max(open,speaking?.16:0);
    const width=13.6 + wide*1.7 + active*.8;
    const height=10.5 + active*5.2;

    const rules={
      position:'absolute',
      left:'50%',
      top:'58.05%',
      width:width.toFixed(2)+'%',
      minWidth:'13.6%',
      maxWidth:'15.8%',
      height:height.toFixed(2)+'px',
      minHeight:'10.5px',
      overflow:'visible',
      opacity:'1',
      visibility:'visible',
      background:'transparent',
      border:'0',
      borderRadius:'0',
      boxShadow:'none',
      animation:'none',
      transition:'none',
      transform:'translate(-50%,-50%)',
      transformOrigin:'50% 50%',
      pointerEvents:'none',
      zIndex:'2147483000'
    };
    for(const [k,v] of Object.entries(rules))mouth.style.setProperty(k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()),v,'important');
    mouth.dataset.expressionTurbine='v18';
    host.dataset.expressionRig='turbine-v18';
  }

  function draw(open,wide){
    if(!cavity||!teeth||!lip)return;

    const speaking=host?.classList.contains('avatar-speaking');
    const a=Math.max(open,speaking?.16:0);

    // TRUE smile geometry: corners HIGHER (smaller y) than center.
    const cornerY=7.2 - wide*.9 - a*.5;
    const centerTop=19.5 + a*2.8;
    const bottomCenter=24.5 + a*11.0;
    const bottomSide=20.0 + a*4.0;

    const outer=[
      'M',4,cornerY,
      'Q',28,cornerY-2.8,68,centerTop,
      'Q',108,cornerY-2.8,132,cornerY,
      'Q',108,bottomSide,68,bottomCenter,
      'Q',28,bottomSide,4,cornerY,'Z'
    ].join(' ');
    cavity.setAttribute('d',outer);

    const toothLow=centerTop+3.1+a*1.2;
    const tooth=[
      'M',11,cornerY+2.7,
      'Q',34,cornerY+.5,68,centerTop+1.2,
      'Q',102,cornerY+.5,125,cornerY+2.7,
      'Q',102,toothLow,68,toothLow+1.0,
      'Q',34,toothLow,11,cornerY+2.7,'Z'
    ].join(' ');
    teeth.setAttribute('d',tooth);
    teeth.setAttribute('opacity',String(.42+a*.32));

    const lipPath=[
      'M',4,cornerY-1.1,
      'Q',28,cornerY-4.1,68,centerTop-1.4,
      'Q',108,cornerY-4.1,132,cornerY-1.1
    ].join(' ');
    lip.setAttribute('d',lipPath);
  }

  function queueRepair(){
    if(repairQueued)return;
    repairQueued=true;
    queueMicrotask(()=>{
      repairQueued=false;
      installHardOverride();
      buildSvg();
    });
  }

  function attachObserver(){
    observer?.disconnect();
    const target=document.querySelector('#app')||document.body||document.documentElement;
    observer=new MutationObserver((mutations)=>{
      let repair=false;
      for(const m of mutations){
        if(m.type==='childList') repair=true;
        if(m.type==='attributes' && m.target===mouth) repair=true;
        if(repair)break;
      }
      if(!document.getElementById(STYLE_ID) || !document.getElementById(SVG_ID) || !document.querySelector('#avatarFace.human-avatar .avatar-mouth-motion')){
        queueRepair();
      }
    });
    observer.observe(target,{
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['style','class']
    });
  }

  function tick(){
    if(!locate() || !document.getElementById(SVG_ID)){
      buildSvg();
    }
    if(host&&mouth){
      const {open,wide}=readVars();
      forceInline(open,wide);
      draw(open,wide);
    }
    raf=requestAnimationFrame(tick);
  }

  function startDebug(){
    clearInterval(debugTimer);
    debugTimer=setInterval(()=>{
      const {open}=readVars();
      console.warn(TAG,'ATIVA E RODANDO',{mouth_open:open,svg_alive:!!document.getElementById(SVG_ID),mouth_alive:!!document.querySelector('#avatarFace.human-avatar .avatar-mouth-motion')});
    },400);
  }

  function start(){
    installHardOverride();
    purgeLegacyCaches();
    buildSvg();
    attachObserver();
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(tick);
    startDebug();
    console.warn(TAG,'BOOT OK');
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',start,{once:true});
  }else{
    start();
  }

  window.__FNS_EMMA_TURBINE_V18__={
    alive:()=>!!document.getElementById(SVG_ID),
    repair:queueRepair,
    restart:start
  };
})();