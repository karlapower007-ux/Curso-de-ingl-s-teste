/* FNS Olivia PNGTuber FINAL v3 — avatar + Spanish room, sem tocar na Emma/core */
(function () {
  const BASE_PATH = './assets/';
  const CACHE_BUST = '?v=olivia-pngtuber-20260917-v3';

  const IMG_FECHADA = BASE_PATH + 'olivia-fechada.png' + CACHE_BUST;
  const IMG_FALANDO = BASE_PATH + 'olivia-falando.png' + CACHE_BUST;
  const IMG_ABERTA  = BASE_PATH + 'olivia-aberta.png' + CACHE_BUST;

  [IMG_FECHADA, IMG_FALANDO, IMG_ABERTA].forEach((src) => {
    const img = new Image();
    img.src = src;
  });

  function isOliviaActive() {
    try {
      return String(activeTeacher?.name || '').trim().toLowerCase() === 'olivia';
    } catch (_) {
      return false;
    }
  }

  function isOliviaModal(modal) {
    if (!modal) return false;
    const title = modal.querySelector('.row h2')?.textContent?.trim().toLowerCase() || '';
    const label = modal.querySelector('.avatar-label b')?.textContent?.trim().toLowerCase() || '';
    return isOliviaActive() || title.startsWith('olivia') || label === 'olivia';
  }

  function primeOliviaTeacher() {
    try {
      if (typeof teachers === 'undefined' || !Array.isArray(teachers)) return;
      const teacher = teachers.find((item) => String(item?.name || '').toLowerCase() === 'olivia');
      if (!teacher) return;
      teacher.portrait = IMG_FECHADA;
      teacher.profile = teacher.profile || 'Español • FNS Lite';
    } catch (_) {}
  }

  function oliviaOpeningPrompt(level = 'A1', topic = 'General conversation') {
    if (topic && topic !== 'General conversation') {
      return 'Hoy practicaremos el tema de esta lección. Cuéntame qué sabes sobre él y te ayudaré paso a paso.';
    }
    return level === 'A1'
      ? 'Empecemos de forma sencilla. ¿Cómo te llamas?'
      : 'Cuéntame cómo fue tu día y te ayudaré a mejorar tu español.';
  }

  function oliviaIntroText() {
    let level = 'A1';
    let topic = 'General conversation';
    try {
      level = String(activeTeacher?.level || 'A1');
      topic = String(activeTeacher?.topic || 'General conversation');
    } catch (_) {}
    return `¡Hola! Soy Olivia. ${oliviaOpeningPrompt(level, topic)}`;
  }

  function installOpeningPromptPatch() {
    if (window.__FNS_OLIVIA_OPENING_PATCH__) return;
    try {
      if (typeof openingPrompt !== 'function') return;
      const coreOpeningPrompt = openingPrompt;
      openingPrompt = function (level, topic) {
        if (isOliviaActive()) return oliviaOpeningPrompt(level, topic);
        return coreOpeningPrompt(level, topic);
      };
      window.__FNS_OLIVIA_OPENING_PATCH__ = true;
    } catch (_) {}
  }

  function ensureOliviaLastSpoken() {
    if (!isOliviaActive()) return;
    try {
      const current = String(lastSpoken || '').trim();
      if (!current || /^Hello!\s*I['’]?m\s+Olivia\b/i.test(current)) {
        lastSpoken = oliviaIntroText();
      }
    } catch (_) {}
  }

  function installVoiceUnlockPatch() {
    if (window.__FNS_OLIVIA_VOICE_PATCH__) return;
    try {
      if (typeof unlockVoice !== 'function') return;
      const coreUnlockVoice = unlockVoice;
      unlockVoice = async function (...args) {
        if (isOliviaActive()) ensureOliviaLastSpoken();
        const result = await coreUnlockVoice(...args);
        if (isOliviaActive()) {
          const button = document.querySelector('#voiceBtn');
          if (button) button.textContent = '🔊 Voz activada';
        }
        return result;
      };
      window.__FNS_OLIVIA_VOICE_PATCH__ = true;
    } catch (_) {}
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
          alt="Olivia, profesora virtual"
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

    face.classList.add('avatar-face', 'human-avatar');
    face.dataset.teacher = 'olivia';
    face.dataset.avatarReady = 'true';
    face.dataset.avatarVisualMode = 'image-swapping';

    const img = face.querySelector('img');
    if (img) {
      img.classList.add('avatar-photo', 'avatar-photo-base');
      if (!img.src.includes('olivia-')) img.src = IMG_FECHADA;
    }

    return face;
  }

  function seedSpanishIntro(modal) {
    if (!modal || modal.dataset.fnsOliviaIntroReady === 'true') return;
    const intro = oliviaIntroText();
    const teacherMessage = modal.querySelector('#transcript .msg.teacher');
    if (teacherMessage) teacherMessage.textContent = intro;
    ensureOliviaLastSpoken();
    modal.dataset.fnsOliviaIntroReady = 'true';
  }

  function lockOliviaLanguageUI(modal) {
    const sel = modal.querySelector('#sttLangSel');
    if (sel) {
      sel.value = 'es-ES';
      sel.disabled = true;
      sel.dataset.fnsOliviaLock = 'true';
      sel.title = 'Olivia • solo español';
      const option = [...sel.options].find((item) => item.value === 'es-ES');
      if (option) option.textContent = '🇪🇸 Español Only • Olivia';
    }

    const heading = modal.querySelector('.row h2');
    if (heading) heading.textContent = 'Olivia • Español';

    const label = modal.querySelector('.avatar-label');
    if (label) {
      const firstSmall = label.querySelector('.small');
      if (firstSmall) firstSmall.textContent = 'Español • FNS Lite';
      if (!label.querySelector('.fns-olivia-lock')) {
        label.insertAdjacentHTML(
          'beforeend',
          '<br><span class="small fns-olivia-lock">🇪🇸 Español Only • Olivia</span>'
        );
      }
    }

    const input = modal.querySelector('#chatInput');
    if (input) input.placeholder = 'Escribe en español...';

    const hint = modal.querySelector('.conversation-hint') || input?.parentElement?.nextElementSibling;
    if (hint) {
      hint.textContent = 'Activa la voz una vez. Después usa 🎤 Hablar; Olivia responderá y hablará automáticamente en español.';
    }

    const mic = modal.querySelector('#micBtn');
    if (mic) {
      if (/Emma falando/i.test(mic.textContent)) mic.textContent = '🔊 Olivia hablando';
      else if (/^🎤\s*Falar/i.test(mic.textContent)) mic.textContent = mic.textContent.replace(/Falar.*/i, 'Hablar');
      else if (/Parar|Enviar fala/i.test(mic.textContent)) mic.textContent = '⏹ Enviar voz';
    }

    const voice = modal.querySelector('#voiceBtn');
    if (voice && !/activada/i.test(voice.textContent)) voice.textContent = '🔊 Activar voz';
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
        seedSpanishIntro(modal);
        lockOliviaLanguageUI(modal);
        applyState(face);
      }
    }

    requestAnimationFrame(tick);
  }

  primeOliviaTeacher();
  installOpeningPromptPatch();
  installVoiceUnlockPatch();

  window.FNS_OLIVIA_PNGTUBER = {
    version: 'v3',
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
            src: face.querySelector('img')?.src || '',
            spanishLocked: document.querySelector('#sttLangSel')?.value === 'es-ES'
          }
        : null;
    }
  };

  requestAnimationFrame(tick);
})();
