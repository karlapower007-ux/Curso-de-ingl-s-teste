/* Professores IA v2.1 — Native Rive bridge.
   Loads only local, pinned runtime/assets. If anything is missing or invalid,
   the accepted raster renderer remains active as a safe fallback. */
(function(root){
  'use strict';

  const RUNTIME_URL='/static/vendor/rive.min.js';
  const STATE_MACHINE='AvatarStateMachine';
  const ASSETS={
    original:'/static/avatars/rive/lily.riv',
    british:'/static/avatars/rive/oliver.riv',
    american:'/static/avatars/rive/sara.riv',
    latina:'/static/avatars/rive/sofia.riv'
  };

  let runtimePromise=null;
  const hasRuntime=()=>!!(root.rive?.Rive || root.Rive?.Rive || root.Rive);

  function loadRuntime(){
    if(hasRuntime()) return Promise.resolve(root.rive || root.Rive);
    if(runtimePromise) return runtimePromise;
    runtimePromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=RUNTIME_URL; s.async=true; s.dataset.professoresRive='runtime';
      s.onload=()=>hasRuntime()?resolve(root.rive || root.Rive):reject(new Error('Rive runtime global ausente'));
      s.onerror=()=>reject(new Error('Rive runtime local indisponível'));
      document.head.appendChild(s);
    });
    return runtimePromise;
  }

  async function assetExists(url){
    try{
      const r=await fetch(url,{method:'HEAD',cache:'no-store'});
      return r.ok;
    }catch(_){return false;}
  }

  function getCtor(){
    return root.rive?.Rive || root.Rive?.Rive || (typeof root.Rive==='function'?root.Rive:null);
  }

  function hideFallback(rig,enabled){
    rig?.classList.toggle('rive-native-active',!!enabled);
    const canvas=rig?.querySelector('.rive-avatar-canvas');
    if(canvas) canvas.hidden=!enabled;
  }

  async function attach({controller,teacherId,rig,canvas,label,status}={}){
    const src=ASSETS[teacherId];
    if(!controller || !rig || !canvas || !src) return {ok:false,reason:'missing-target'};
    if(!(await assetExists(src))) return {ok:false,reason:'asset-missing',src};

    try{
      await loadRuntime();
      const Ctor=getCtor();
      if(!Ctor) throw new Error('Construtor Rive não encontrado');

      return await new Promise((resolve)=>{
        let settled=false;
        const fail=(error)=>{
          if(settled)return; settled=true; hideFallback(rig,false);
          try{instance?.cleanup?.();}catch(_){}
          resolve({ok:false,reason:'load-failed',error:String(error?.message||error)});
        };
        let instance;
        try{
          instance=new Ctor({
            src,
            canvas,
            autoplay:true,
            stateMachines:STATE_MACHINE,
            onLoad:()=>{
              try{
                instance.resizeDrawingSurfaceToCanvas?.();
                const inputs=instance.stateMachineInputs?.(STATE_MACHINE)||[];
                const Avatar=root.ProfessoresAvatar;
                if(!Avatar?.RiveAvatarAdapter) throw new Error('RiveAvatarAdapter indisponível');
                const adapter=new Avatar.RiveAvatarAdapter(
                  Avatar.PERSONALITY_PROFILES[teacherId]||Avatar.PERSONALITY_PROFILES.american,
                  instance,
                  {rig,canvas,label,status,stateMachine:STATE_MACHINE}
                );
                adapter.bindInputs(inputs);
                controller.upgradeAdapter(adapter);
                hideFallback(rig,true);
                rig.dataset.renderer='rive';
                if(status) status.dataset.renderer='rive';
                settled=true;
                resolve({ok:true,renderer:'rive',src,inputNames:inputs.map(i=>i.name)});
              }catch(e){fail(e);}
            },
            onLoadError:(e)=>fail(e||new Error('Falha ao carregar .riv'))
          });
        }catch(e){fail(e);}
      });
    }catch(error){
      hideFallback(rig,false);
      return {ok:false,reason:'runtime-failed',error:String(error?.message||error)};
    }
  }

  function detach(rig){
    hideFallback(rig,false);
    if(rig) delete rig.dataset.renderer;
  }

  root.ProfessoresRive=Object.freeze({
    attach,detach,ASSETS,RUNTIME_URL,STATE_MACHINE
  });
})(typeof globalThis!=='undefined'?globalThis:window);
