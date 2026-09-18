(() => {
  if (window.__FNS_AVATAR_FABIANO_WIDGET_V2__) return;
  window.__FNS_AVATAR_FABIANO_WIDGET_V2__ = true;

  const API = 'https://avatar-fabiano-api.onrender.com';
  const PROFILE = API + '/static/avatar-fabiano-perfil.png';
  const DEBATE = API + '/static/avatar-fabiano-debatendo.png';
  const STYLE_ID = 'fns-avatar-fabiano-widget-v2-style';

  [PROFILE, DEBATE].forEach(src => { const image = new Image(); image.src = src; });

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #fns-fabiano-launcher{position:fixed;right:18px;bottom:18px;z-index:2147483000;border:1px solid rgba(214,179,106,.7);background:#11151f;color:#f0d9a0;border-radius:999px;padding:7px 15px 7px 7px;font:700 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.4);cursor:pointer;display:flex;align-items:center;gap:10px;max-width:min(340px,calc(100vw - 24px))}
      #fns-fabiano-launcher img{width:46px;height:46px;aspect-ratio:1/1;flex:0 0 46px;object-fit:cover;object-position:center;border-radius:50%;display:block;border:2px solid rgba(214,179,106,.76)}
      #fns-fabiano-panel{position:fixed;right:18px;bottom:84px;z-index:2147483001;width:min(430px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 110px));overflow:auto;background:#0d1118;color:#f3f3f3;border:1px solid #343c4f;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.55);padding:18px;display:none;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
      #fns-fabiano-panel[data-open="1"]{display:block}
      #fns-fabiano-panel .fns-head{display:flex;gap:13px;align-items:center;margin-bottom:12px}
      #fns-fabiano-panel .fns-head img{width:78px;height:78px;aspect-ratio:1/1;object-fit:cover;object-position:center;border-radius:50%;border:3px solid #d6b36a;display:block;transition:opacity .16s ease,transform .16s ease}
      #fns-fabiano-panel .fns-head img.switching{opacity:.72;transform:scale(1.015)}
      #fns-fabiano-panel h3{margin:0;font-size:20px;color:#fff}#fns-fabiano-panel .fns-status{color:#f0d9a0;font-size:12px;margin-top:4px}
      #fns-fabiano-panel textarea{width:100%;min-height:100px;resize:vertical;background:#1a1f2c;color:#fff;border:1px solid #3a4253;border-radius:10px;padding:11px;font:inherit}
      #fns-fabiano-panel button.fns-send{width:100%;margin-top:9px;border:0;border-radius:10px;padding:12px;background:linear-gradient(135deg,#f0d9a0,#d6b36a);color:#17140f;font-weight:800;cursor:pointer}
      #fns-fabiano-panel button:disabled{opacity:.55;cursor:not-allowed}
      #fns-fabiano-panel .fns-answer{display:none;margin-top:12px;padding:13px;border-left:4px solid #d6b36a;border-radius:9px;background:#151a24;white-space:pre-wrap}
      #fns-fabiano-panel audio{width:100%;display:none;margin-top:12px}
      #fns-fabiano-panel .fns-close{position:absolute;right:9px;top:8px;border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer}
      @media(max-width:700px){#fns-fabiano-launcher{right:10px;bottom:10px}#fns-fabiano-launcher img{width:40px;height:40px;flex-basis:40px}#fns-fabiano-panel{right:10px;bottom:72px;width:calc(100vw - 20px);max-height:calc(100vh - 90px)}}
    `;
    document.head.appendChild(style);
  }

  const launcher = document.createElement('button');
  launcher.id = 'fns-fabiano-launcher';
  launcher.type = 'button';
  launcher.innerHTML = '<img src="' + PROFILE + '" alt=""><span>Avatar Fabiano • Pergunte agora</span>';

  const panel = document.createElement('section');
  panel.id = 'fns-fabiano-panel';
  panel.setAttribute('aria-label','Avatar Fabiano');
  panel.innerHTML = `
    <button class="fns-close" type="button" aria-label="Fechar">×</button>
    <div class="fns-head">
      <img class="fns-avatar" src="${PROFILE}" alt="Avatar Fabiano">
      <div><h3>Avatar Fabiano</h3><div class="fns-status">Pronto para analisar</div></div>
    </div>
    <textarea class="fns-question" placeholder="Digite sua pergunta..."></textarea>
    <button class="fns-send" type="button">Perguntar</button>
    <div class="fns-answer"></div>
    <audio class="fns-audio" controls preload="none"></audio>
  `;

  const launcherImg = launcher.querySelector('img');
  const avatar = panel.querySelector('.fns-avatar');
  const status = panel.querySelector('.fns-status');
  const question = panel.querySelector('.fns-question');
  const send = panel.querySelector('.fns-send');
  const answer = panel.querySelector('.fns-answer');
  const audio = panel.querySelector('.fns-audio');
  let busy = false;

  function swap(src) {
    [avatar, launcherImg].forEach(img => {
      if (img.src === src) return;
      img.classList && img.classList.add('switching');
      img.src = src;
      if (img.classList) {
        const done = () => img.classList.remove('switching');
        if (img.complete) requestAnimationFrame(done);
        else img.addEventListener('load', done, {once:true});
      }
    });
  }

  function setBusy(active) {
    busy = active;
    send.disabled = active;
    send.textContent = active ? 'Analisando...' : 'Perguntar';
    status.textContent = active ? 'Debatendo e consultando a biblioteca...' : 'Pronto para analisar';
    swap(active ? DEBATE : PROFILE);
  }

  function audioUrl(path) {
    const u = new URL(path, API);
    u.searchParams.set('_ts', String(Date.now()));
    return u.toString();
  }

  async function ask() {
    if (busy) return;
    const pergunta = question.value.trim();
    if (!pergunta) return;

    answer.style.display = 'block';
    answer.textContent = 'Consultando a biblioteca...';
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.style.display = 'none';
    setBusy(true);

    try {
      const r = await fetch(API + '/perguntar', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pergunta})
      });

      let data = {};
      try { data = await r.json(); } catch (_) {}
      setBusy(false);

      if (!r.ok) throw new Error(data.detail || ('Falha HTTP ' + r.status));
      answer.textContent = data.resposta || 'Resposta recebida.';

      if (data.audio_url) {
        audio.src = audioUrl(data.audio_url);
        audio.load();
        audio.style.display = 'block';
        try { await audio.play(); } catch (_) {}
      }
      status.textContent = 'Análise concluída';
    } catch (err) {
      answer.textContent = 'Erro: ' + err.message;
      status.textContent = 'Falha na análise';
    } finally {
      if (busy) setBusy(false);
      swap(PROFILE);
    }
  }

  launcher.addEventListener('click', () => {
    panel.dataset.open = panel.dataset.open === '1' ? '0' : '1';
    if (panel.dataset.open === '1') setTimeout(() => question.focus(), 0);
  });
  panel.querySelector('.fns-close').addEventListener('click', () => { panel.dataset.open = '0'; swap(PROFILE); });
  send.addEventListener('click', ask);
  question.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') ask(); });

  document.body.append(panel, launcher);
})();