/* FNS ROOMS V15 — restore teacher hub without touching Emma or isolated Olivia. */
(function(){
  'use strict';
  if(window.__FNS_ROOMS_V15_INSTALLED__) return;
  window.__FNS_ROOMS_V15_INSTALLED__=true;

  const VERSION='FNS-ROOMS-V15';
  const OLIVIA_ROUTE='/?avatar=olivia&v=18';

  function listTeachers(){
    try { return Array.isArray(teachers) ? teachers : []; } catch (_) { return []; }
  }

  function teacherIndexByName(name){
    const wanted=String(name||'').trim().toLowerCase();
    return listTeachers().findIndex(t=>String(t?.name||'').trim().toLowerCase()===wanted);
  }

  function removeLegacyOliviaOverlay(){
    document.getElementById('olivia-standalone-node')?.remove();
    try { delete document.body.dataset.oliviaV11Active; } catch (_) {}
  }

  function decorateTeacherHub(){
    document.querySelectorAll('.card.teacher').forEach(card=>{
      const name=String(card.querySelector('h3')?.textContent||'').trim().toLowerCase();
      if(name!=='olivia') return;

      const tag=card.querySelector('.tag');
      if(tag) tag.textContent='FNS ISOLADA • ESPAÑOL';

      const h3=card.querySelector('h3');
      const info=h3?.nextElementSibling;
      if(info) info.textContent='Español • A1';

      const p=card.querySelector('p');
      if(p) p.textContent='Sala espanhola isolada, com avatar, memória, voz e fallback próprios.';

      const button=card.querySelector('button.primary');
      if(button) button.textContent='Abrir Olivia';
    });
  }

  function goOlivia(){
    const next=new URL(OLIVIA_ROUTE, location.origin);
    location.assign(next.toString());
  }

  const originalOpenTeacher = typeof openTeacher==='function' ? openTeacher : null;

  function openRoomByIndex(index){
    const list=listTeachers();
    const t=list[index];
    if(!t) return false;

    if(String(t.name||'').trim().toLowerCase()==='olivia'){
      goOlivia();
      return true;
    }

    removeLegacyOliviaOverlay();
    if(typeof live==='function'){
      live();
      decorateTeacherHub();
    }
    if(originalOpenTeacher){
      setTimeout(()=>originalOpenTeacher(index),0);
      return true;
    }
    return false;
  }

  function openRoomByName(name){
    const i=teacherIndexByName(name);
    return i>=0 ? openRoomByIndex(i) : false;
  }

  // Replace only the room dispatcher. The original Emma/other room implementation remains byte-for-byte untouched.
  if(originalOpenTeacher){
    window.openTeacher=function(index){
      return openRoomByIndex(Number(index));
    };
  }

  function showTeacherHub(){
    removeLegacyOliviaOverlay();
    if(typeof live==='function'){
      live();
      decorateTeacherHub();
      return true;
    }
    return false;
  }

  function bootRoute(){
    const params=new URLSearchParams(location.search);
    if(params.get('avatar')) return; // isolated avatar routes own themselves

    const room=String(params.get('room')||'').trim();
    if(room){
      if(room.toLowerCase()==='olivia'){
        goOlivia();
        return;
      }
      showTeacherHub();
      setTimeout(()=>openRoomByName(room),0);
      return;
    }

    if(params.get('professores')==='1' || params.get('teachers')==='1'){
      showTeacherHub();
    } else {
      removeLegacyOliviaOverlay();
    }
  }

  window.FNS_ROOMS_V15=Object.freeze({
    version:VERSION,
    oliviaRoute:OLIVIA_ROUTE,
    showTeacherHub,
    openRoomByName,
    health(){
      const list=listTeachers();
      return {
        version:VERSION,
        teacherCount:list.length,
        names:list.map(t=>t.name),
        premium:list.filter(t=>t.premium).map(t=>t.name),
        emmaCoreUntouched:typeof FNS_EMMA_PNGTUBER!=='undefined' || !!window.FNS_EMMA_PNGTUBER,
        legacyOliviaOverlayPresent:!!document.getElementById('olivia-standalone-node')
      };
    }
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootRoute,{once:true});
  else setTimeout(bootRoute,0);
})();