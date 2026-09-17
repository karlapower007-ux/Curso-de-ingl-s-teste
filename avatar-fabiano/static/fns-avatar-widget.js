(() => {
  if (window.__FNS_AVATAR_FABIANO_WIDGET__) return;
  window.__FNS_AVATAR_FABIANO_WIDGET__ = true;

  const API = 'https://avatar-fabiano-api.onrender.com';
  const STYLE_ID = 'fns-avatar-fabiano-widget-style';

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #fns-fabiano-launcher{position:fixed;right:22px;bottom:22px;z-index:2147483000;border:1px solid rgba(214,179,106,.65);background:#11151f;color:#f0d9a0;border-radius:999px;padding:12px 18px;font:700 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.38);cursor:pointer}
      #fns-fabiano-layer{position:fixed;inset:0;z-index:2147483001;background:rgba(2,4,8,.82);backdrop-filter:blur(5px);display:none;padding:18px}
      #fns-fabiano-layer[data-open="1"]{display:grid;place-items:center}
      #fns-fabiano-shell{width:min(1100px,100%);height:min(880px,94vh);background:#080a10;border:1px solid #343a48;border-radius:20px;overflow:hidden;box-shadow:0 28px 90px rgba(0,0,0,.58);position:relative}
      #fns-fabiano-frame{width:100%;height:100%;border:0;background:#080a10}
      #fns-fabiano-close{position:absolute;right:12px;top:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:1px solid #444;background:rgba(8,10,16,.9);color:#fff;font:700 22px/1 system-ui;cursor:pointer}
      @media(max-width:700px){#fns-fabiano-launcher{right:12px;bottom:12px}#fns-fabiano-layer{padding:0}#fns-fabiano-shell{width:100%;height:100vh;border-radius:0;border:0}}
    `;
    document.head.appendChild(style);
  }

  const launcher = document.createElement('button');
  launcher.id = 'fns-fabiano-launcher';
  launcher.type = 'button';
  launcher.textContent = 'Avatar Fabiano • Livre Pensador';
  launcher.setAttribute('aria-haspopup', 'dialog');

  const layer = document.createElement('div');
  layer.id = 'fns-fabiano-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', 'Avatar Fabiano — O Livre Pensador');
  layer.innerHTML = `<div id="fns-fabiano-shell"><button id="fns-fabiano-close" type="button" aria-label="Fechar">×</button><iframe id="fns-fabiano-frame" title="Avatar Fabiano — O Livre Pensador" src="${API}/" allow="autoplay"></iframe></div>`;

  const open = () => { layer.dataset.open = '1'; document.documentElement.style.overflow = 'hidden'; };
  const close = () => { layer.dataset.open = '0'; document.documentElement.style.overflow = ''; launcher.focus(); };

  launcher.addEventListener('click', open);
  layer.addEventListener('click', (event) => { if (event.target === layer) close(); });
  layer.querySelector('#fns-fabiano-close').addEventListener('click', close);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && layer.dataset.open === '1') close(); });

  document.body.append(launcher, layer);
})();
