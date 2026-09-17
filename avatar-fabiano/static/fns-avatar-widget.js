(() => {
  if (window.__FNS_AVATAR_FABIANO_WIDGET__) return;
  window.__FNS_AVATAR_FABIANO_WIDGET__ = true;

  const API = 'https://avatar-fabiano-api.onrender.com';
  const API_ORIGIN = new URL(API).origin;
  const AVATAR_PERFIL = `${API}/static/avatar-fabiano-perfil.png`;
  const AVATAR_DEBATENDO = `${API}/static/avatar-fabiano-debatendo.png`;
  const STYLE_ID = 'fns-avatar-fabiano-widget-style';

  [AVATAR_PERFIL, AVATAR_DEBATENDO].forEach((src) => {
    const image = new Image();
    image.src = src;
  });

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #fns-fabiano-launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;border:1px solid rgba(214,179,106,.65);background:#11151f;color:#f0d9a0;border-radius:999px;padding:7px 16px 7px 7px;font:700 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.38);cursor:pointer;display:flex;align-items:center;gap:10px;max-width:min(330px,calc(100vw - 24px))}
      #fns-fabiano-launcher-img{width:46px;height:46px;aspect-ratio:1/1;flex:0 0 46px;object-fit:cover;object-position:center;border-radius:50%;display:block;border:2px solid rgba(214,179,106,.72);transition:opacity .16s ease,transform .16s ease;will-change:opacity,transform}
      #fns-fabiano-launcher[data-avatar-state="debatendo"] #fns-fabiano-launcher-img{transform:scale(1.035)}
      #fns-fabiano-layer{position:fixed;inset:0;z-index:2147483001;background:rgba(2,4,8,.82);backdrop-filter:blur(5px);display:none;padding:18px}
      #fns-fabiano-layer[data-open="1"]{display:grid;place-items:center}
      #fns-fabiano-shell{width:min(1100px,100%);height:min(880px,94vh);background:#080a10;border:1px solid #343a48;border-radius:20px;overflow:hidden;box-shadow:0 28px 90px rgba(0,0,0,.58);position:relative}
      #fns-fabiano-frame{width:100%;height:100%;border:0;background:#080a10}
      #fns-fabiano-close{position:absolute;right:12px;top:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:1px solid #444;background:rgba(8,10,16,.9);color:#fff;font:700 22px/1 system-ui;cursor:pointer}
      @media(max-width:700px){#fns-fabiano-launcher{right:12px;bottom:12px;padding:6px 13px 6px 6px}#fns-fabiano-launcher-img{width:40px;height:40px;flex-basis:40px;object-fit:cover;border-radius:50%}#fns-fabiano-layer{padding:0}#fns-fabiano-shell{width:100%;height:100vh;border-radius:0;border:0}}
    `;
    document.head.appendChild(style);
  }

  const launcher = document.createElement('button');
  launcher.id = 'fns-fabiano-launcher';
  launcher.type = 'button';
  launcher.dataset.avatarState = 'perfil';
  launcher.innerHTML = `<img id="fns-fabiano-launcher-img" src="${AVATAR_PERFIL}" alt=""><span>Avatar Fabiano • Livre Pensador</span>`;
  launcher.setAttribute('aria-haspopup', 'dialog');

  const layer = document.createElement('div');
  layer.id = 'fns-fabiano-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', 'Avatar Fabiano — O Livre Pensador');
  layer.innerHTML = `<div id="fns-fabiano-shell"><button id="fns-fabiano-close" type="button" aria-label="Fechar">×</button><iframe id="fns-fabiano-frame" title="Avatar Fabiano — O Livre Pensador" src="${API}/" allow="autoplay"></iframe></div>`;

  const launcherImg = launcher.querySelector('#fns-fabiano-launcher-img');
  const frame = layer.querySelector('#fns-fabiano-frame');

  const setAvatarState = (state) => {
    const debating = state === 'debatendo';
    launcher.dataset.avatarState = debating ? 'debatendo' : 'perfil';
    const next = debating ? AVATAR_DEBATENDO : AVATAR_PERFIL;
    if (launcherImg.src !== next) launcherImg.src = next;
  };

  const open = () => {
    layer.dataset.open = '1';
    document.documentElement.style.overflow = 'hidden';
  };

  const close = () => {
    layer.dataset.open = '0';
    document.documentElement.style.overflow = '';
    setAvatarState('perfil');
    launcher.focus();
  };

  launcher.addEventListener('click', open);
  layer.addEventListener('click', (event) => { if (event.target === layer) close(); });
  layer.querySelector('#fns-fabiano-close').addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && layer.dataset.open === '1') close();
  });
  frame.addEventListener('load', () => setAvatarState('perfil'));

  window.addEventListener('message', (event) => {
    if (event.origin !== API_ORIGIN || event.source !== frame.contentWindow) return;
    if (!event.data || event.data.source !== 'fns-avatar-fabiano') return;
    if (event.data.type === 'request-start') setAvatarState('debatendo');
    if (event.data.type === 'request-end') setAvatarState('perfil');
  });

  document.body.append(launcher, layer);
})();
