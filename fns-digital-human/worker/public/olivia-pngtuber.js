/* FNS Olivia PNGTuber FINAL — sem tocar na Emma, sem tocar no core */
(function () {
  const BASE_PATH = './assets/';
  const CACHE_BUST = '?v=olivia-pngtuber-20260917';

  const IMG_FECHADA = BASE_PATH + 'olivia-fechada.png' + CACHE_BUST;
  const IMG_FALANDO = BASE_PATH + 'olivia-falando.png' + CACHE_BUST;
  const IMG_ABERTA  = BASE_PATH + 'olivia-aberta.png' + CACHE_BUST;

  [IMG_FECHADA, IMG_FALANDO, IMG_ABERTA].forEach((src) => {
    const img = new Image();
    img.src = src;
  });

  function isOliviaModal(modal) {
    if (!modal) return false;
    const title = modal.querySelector('.row h2')?.textContent?.trim().toLowerCase() || '';
    const label = modal.querySelector('.avatar-label b')?.textContent?.trim().toLowerCase() || '';
    return title.startsWith('olivia') || label === 'olivia';
  }

  function buildOliviaAvatarHtml() {
    return `
      <div
        id="avatarFace"
        class="avatar-face human-avatar"
        data-avatar-ready="true"
        data-avatar-visual-mode="image-swapping"
        data-teacher="olivia"
        style="--mouth-open:0;--mouth-wide:0;--gaze-x:0px;--gaze-y:0px"
      >
        <img
          class="avatar-photo avatar-photo-base"
          src="${IMG_FECHADA}"
          alt="Olivia, professora virtual"
          loading="eager"
          decoding="sync"
        >
        <div class="avatar-live-badge">● LIVE</div>
      </div>
    `;
  }

  function ensureOliviaAvatar(modal) {
    if (!isOliviaModal(modal)) return null;

    const stage = modal.querySelector('.avatar-stage');
    if (!stage) return null;

    let face = stage.querySelector('#avatarFace');

    if (!face || !face.classList.contains('human-avatar') || face.dataset.teacher !== 'olivia') {
      if (face) face.remove();
      stage.insertAdjacentHTML('afterbegin', buildOliviaAvatarHtml());
      face = stage.querySelector('#avatarFace');
    }

    face.dataset.teacher = 'olivia';
    face.dataset.avatarReady = 'true';
    face.dataset.avatarVisualMode = 'image-swapping';

    return face;
  }

  function lockOliviaLanguageUI(modal) {
    const sel = modal.querySelector('#sttLangSel');
    if (sel) {
      sel.value = 'es-ES';
      sel.disabled = true;
      sel.dataset.fnsOliviaLock = 'true';
      sel.title = 'Olivia bloqueada en español';
    }

    const label = modal.querySelector('.avatar-label');
    if (label && !label.querySelector('.fns-olivia-lock')) {
      label.insertAdjacentHTML(
        'beforeend',
        '<br><span class="small fns-olivia-lock">🇪🇸 Español Only • Olivia</span>'
      );
    }
  }

  function applyState(face) {
    if (!face) return;

    const mouthOpen = parseFloat(getComputedStyle(face).getPropertyValue('--mouth-open')) || 0;

    let targetSrc = IMG_FECHADA;
    let state = 'closed';

    if (mouthOpen >= 0.15 && mouthOpen < 0.60) {
      targetSrc = IMG_FALANDO;
      state = 'talking';
    } else if (mouthOpen >= 0.60) {
      targetSrc = IMG_ABERTA;
      state = 'open';
    }

    face.dataset.pngtuberState = state;
    face.dataset.pngtuberLevel = Math.max(0, Math.min(1, mouthOpen)).toFixed(3);

    const img = face.querySelector('img');
    const expected = targetSrc.replace('./', '');

    if (img && !img.src.includes(expected)) {
      img.src = targetSrc;
    }
  }

  function tick() {
    const modal = document.querySelector('#liteModal');
    if (modal && isOliviaModal(modal)) {
      const face = ensureOliviaAvatar(modal);
      if (face) {
        lockOliviaLanguageUI(modal);
        applyState(face);
      }
    }

    requestAnimationFrame(tick);
  }

  window.FNS_OLIVIA_PNGTUBER = {
    frames: {
      closed: IMG_FECHADA,
      talking: IMG_FALANDO,
      open: IMG_ABERTA
    },
    thresholds: {
      talking: 0.15,
      open: 0.60
    },
    getState() {
      const face = document.querySelector('.human-avatar[data-teacher="olivia"]');
      return face
        ? {
            state: face.dataset.pngtuberState || 'closed',
            level: parseFloat(getComputedStyle(face).getPropertyValue('--mouth-open')) || 0,
            src: face.querySelector('img')?.src || ''
          }
        : null;
    }
  };

  requestAnimationFrame(tick);
})();
