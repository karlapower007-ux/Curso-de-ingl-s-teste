/* FNS OLIVIA CORE V4 — native room bootstrap, Spanish STT/TTS, PNGTuber and browser voice fallback */
(function () {
  'use strict';

  if (window.__FNS_OLIVIA_CORE_V4_INSTALLED__) return;
  window.__FNS_OLIVIA_CORE_V4_INSTALLED__ = true;

  const VERSION = 'v4-20260917';
  const PARAMS = new URLSearchParams(location.search);
  const DIRECT_MODE = PARAMS.has('olivia');
  const CACHE_BUST = '?v=' + VERSION;
  const ASSETS = Object.freeze({
    closed: '/assets/olivia-fechada.png' + CACHE_BUST,
    talking: '/assets/olivia-falando.png' + CACHE_BUST,
    open: '/assets/olivia-aberta.png' + CACHE_BUST
  });

  const runtime = {
    version: VERSION,
    directMode: DIRECT_MODE,
    assets: ASSETS,
    assetStatus: { closed: 'pending', talking: 'pending', open: 'pending' },
    errors: [],
    browserVoiceFallbackCount: 0,
    lastBrowserVoice: '',
    booted: false
  };
  window.FNS_OLIVIA_CORE_V4 = runtime;

  function rememberError(where, error) {
    const message = String(error?.message || error || 'unknown error');
    runtime.errors.push({ where, message, at: Date.now() });
    if (runtime.errors.length > 20) runtime.errors.shift();
    console.error('[FNS OLIVIA V4]', where, error);
  }

  function isOliviaName(value) {
    return String(value || '').trim().toLocaleLowerCase() === 'olivia';
  }

  function isOliviaActive() {
    try { return isOliviaName(activeTeacher?.name); }
    catch (_) { return false; }
  }

  function oliviaIndex() {
    try {
      const index = teachers.findIndex((t) => isOliviaName(t?.name));
      return index >= 0 ? index : 2;
    } catch (_) {
      return 2;
    }
  }

  function primeOliviaTeacher() {
    try {
      const index = oliviaIndex();
      const teacher = teachers?.[index];
      if (!teacher) throw new Error('Olivia teacher profile not found');
      teacher.name = 'Olivia';
      teacher.accent = 'Español';
      teacher.gender = 'female';
      teacher.provider = 'FNS Lite';
      teacher.profile = 'Español • FNS Lite';
      teacher.portrait = ASSETS.closed;
      teacher.language = 'es-ES';
      teacher.strict_language = 'es-ES';
      return teacher;
    } catch (error) {
      rememberError('primeOliviaTeacher', error);
      return null;
    }
  }

  function spanishPrompt(level = 'A1', topic = 'General conversation') {
    if (topic && topic !== 'General conversation') {
      return 'Hoy practicaremos este tema. Cuéntame qué sabes y te ayudaré paso a paso.';
    }
    return String(level || 'A1') === 'A1'
      ? 'Empecemos de forma sencilla. ¿Cómo te llamas?'
      : 'Cuéntame cómo fue tu día y te ayudaré a mejorar tu español.';
  }

  function spanishIntro() {
    let level = 'A1';
    let topic = 'General conversation';
    try {
      level = activeTeacher?.level || document.querySelector('#levelSel')?.value || 'A1';
      topic = activeTeacher?.topic || 'General conversation';
    } catch (_) {}
    return '¡Hola! Soy Olivia. ' + spanishPrompt(level, topic);
  }

  function oliviaAvatarMarkup() {
    return `<div id="avatarFace" class="avatar-face human-avatar" data-avatar-ready="false" data-avatar-visual-mode="image-swapping" data-teacher="olivia" style="--mouth-open:0;--mouth-wide:0;--gaze-x:0px;--gaze-y:0px">
      <img id="oliviaPortrait" class="avatar-photo avatar-photo-base" src="${ASSETS.closed}" alt="Olivia, profesora virtual" loading="eager" decoding="sync"
        onload="this.closest('.human-avatar')?.setAttribute('data-avatar-ready','true')"
        onerror="this.closest('.human-avatar')?.setAttribute('data-avatar-ready','error')">
      <div class="avatar-live-badge">● LIVE</div>
    </div>`;
  }

  function showRoomError(message) {
    try {
      const transcript = document.querySelector('#liteModal #transcript');
      if (!transcript) return;
      const existing = transcript.querySelector('[data-olivia-runtime-error]');
      if (existing) existing.remove();
      const node = document.createElement('div');
      node.className = 'msg system';
      node.dataset.oliviaRuntimeError = 'true';
      node.textContent = message;
      transcript.appendChild(node);
      transcript.scrollTop = transcript.scrollHeight;
    } catch (error) {
      rememberError('showRoomError', error);
    }
  }

  function localizeControls() {
    if (!isOliviaActive()) return;
    const modal = document.querySelector('#liteModal');
    if (!modal) return;

    try {
      const select = modal.querySelector('#sttLangSel');
      if (select) {
        select.value = 'es-ES';
        select.disabled = true;
        select.dataset.fnsOliviaLock = 'true';
        select.dataset.fnsStrictLanguage = 'es-ES';
        select.title = 'Olivia • solo español';
        const option = [...select.options].find((item) => item.value === 'es-ES');
        if (option) option.textContent = '🇪🇸 Español Only • Olivia';
      }

      const heading = modal.querySelector('.row h2');
      if (heading) heading.textContent = 'Olivia • Español';

      const label = modal.querySelector('.avatar-label');
      if (label) {
        const bold = label.querySelector('b');
        if (bold) bold.textContent = 'Olivia';
        const small = label.querySelector('.small');
        if (small) small.textContent = 'Español • FNS Lite';
        if (!label.querySelector('.fns-olivia-lock')) {
          label.insertAdjacentHTML('beforeend', '<br><span class="small fns-olivia-lock">🇪🇸 Español Only • Olivia</span>');
        }
      }

      const input = modal.querySelector('#chatInput');
      if (input) input.placeholder = 'Escribe en español...';

      const voice = modal.querySelector('#voiceBtn');
      if (voice) voice.textContent = voiceUnlocked ? '🔊 Voz activada' : '🔊 Activar voz';

      const mic = modal.querySelector('#micBtn');
      if (mic) {
        const text = String(mic.textContent || '');
        if (/Emma falando|Emma speaking|Olivia falando/i.test(text)) mic.textContent = '🔊 Olivia hablando';
        else if (/^🎤\s*Falar/i.test(text)) mic.textContent = '🎤 Hablar';
        else if (/navegador/i.test(text) && /^🎤/i.test(text)) mic.textContent = '🎤 Hablar (navegador)';
        else if (/Enviar fala|Enviar voz/i.test(text)) mic.textContent = '⏹ Enviar voz';
      }

      const stop = [...modal.querySelectorAll('button')].find((b) => String(b.textContent || '').trim() === 'Parar');
      if (stop) stop.textContent = 'Parar';

      const repeat = [...modal.querySelectorAll('button')].find((b) => /Repetir/i.test(String(b.textContent || '')));
      if (repeat) repeat.textContent = '🔁 Repetir';

      const hint = modal.querySelector('.conversation-hint') || input?.parentElement?.nextElementSibling;
      if (hint) hint.textContent = 'Activa la voz una vez. Después usa 🎤 Hablar. Olivia escuchará y responderá en español.';
    } catch (error) {
      rememberError('localizeControls', error);
    }
  }

  function localizeRoom() {
    if (!isOliviaActive()) return;
    const modal = document.querySelector('#liteModal');
    if (!modal) return;

    try {
      const face = modal.querySelector('#avatarFace');
      if (!face || !face.classList.contains('human-avatar')) {
        const stage = modal.querySelector('.avatar-stage');
        if (stage) {
          face?.remove();
          stage.insertAdjacentHTML('afterbegin', oliviaAvatarMarkup());
        }
      }

      const oliviaFace = modal.querySelector('#avatarFace');
      if (oliviaFace) {
        oliviaFace.classList.add('avatar-face', 'human-avatar');
        oliviaFace.dataset.teacher = 'olivia';
        oliviaFace.dataset.avatarVisualMode = 'image-swapping';
        const image = oliviaFace.querySelector('img');
        if (image && !image.src.includes('olivia-')) image.src = ASSETS.closed;
      }

      const intro = spanishIntro();
      const firstTeacherMessage = modal.querySelector('#transcript .msg.teacher');
      if (firstTeacherMessage && !firstTeacherMessage.dataset.fnsOliviaIntro) {
        firstTeacherMessage.textContent = intro;
        firstTeacherMessage.dataset.fnsOliviaIntro = 'true';
      }

      try {
        if (!String(lastSpoken || '').trim() || /Hello!\s*I['’]?m\s+Olivia/i.test(String(lastSpoken || ''))) {
          lastSpoken = intro;
        }
      } catch (_) {}

      modal.dataset.fnsOliviaV4 = 'true';
      localizeControls();
      runtime.booted = true;
    } catch (error) {
      rememberError('localizeRoom', error);
      showRoomError('Olivia no pudo iniciar correctamente. Recarga la página e inténtalo de nuevo.');
    }
  }

  function desiredFrame(level) {
    const value = Math.max(0, Math.min(1, Number(level) || 0));
    if (value >= 0.60) return ['open', ASSETS.open];
    if (value >= 0.15) return ['talking', ASSETS.talking];
    return ['closed', ASSETS.closed];
  }

  function applyFrame() {
    try {
      const face = document.querySelector('#liteModal .human-avatar[data-teacher="olivia"]');
      if (!face) return;
      const level = parseFloat(getComputedStyle(face).getPropertyValue('--mouth-open')) || 0;
      const [state, src] = desiredFrame(level);
      const image = face.querySelector('img');
      face.dataset.pngtuberState = state;
      face.dataset.pngtuberLevel = Math.max(0, Math.min(1, level)).toFixed(3);
      if (image && !image.src.includes(src.split('?')[0])) image.src = src;
    } catch (error) {
      rememberError('applyFrame', error);
    }
  }

  function frameLoop() {
    applyFrame();
    requestAnimationFrame(frameLoop);
  }

  function preloadAssets() {
    Object.entries(ASSETS).forEach(([key, src]) => {
      try {
        const image = new Image();
        image.onload = () => { runtime.assetStatus[key] = 'ok'; };
        image.onerror = () => {
          runtime.assetStatus[key] = 'error';
          rememberError('asset:' + key, new Error('Failed to load ' + src));
          if (isOliviaActive()) showRoomError('No se pudo cargar una imagen de Olivia.');
        };
        image.src = src;
      } catch (error) {
        runtime.assetStatus[key] = 'error';
        rememberError('preload:' + key, error);
      }
    });
  }

  function pickSpanishVoice() {
    try {
      if (!('speechSynthesis' in window)) return null;
      const voices = speechSynthesis.getVoices() || [];
      return voices.find((voice) => /^es[-_]ES$/i.test(voice.lang || '')) ||
        voices.find((voice) => /^es[-_]/i.test(voice.lang || '')) ||
        null;
    } catch (_) {
      return null;
    }
  }

  let fallbackMouthTimer = null;
  let fallbackMouthStep = 0;
  let fallbackUtterance = null;

  function stopFallbackMouth() {
    clearInterval(fallbackMouthTimer);
    fallbackMouthTimer = null;
    fallbackMouthStep = 0;
    const face = document.querySelector('#liteModal .human-avatar[data-teacher="olivia"]');
    if (face) face.style.setProperty('--mouth-open', '0');
  }

  function startFallbackMouth() {
    stopFallbackMouth();
    fallbackMouthTimer = setInterval(() => {
      const face = document.querySelector('#liteModal .human-avatar[data-teacher="olivia"]');
      if (!face) return;
      fallbackMouthStep = (fallbackMouthStep + 1) % 4;
      const values = [0.28, 0.72, 0.38, 0.82];
      face.style.setProperty('--mouth-open', String(values[fallbackMouthStep]));
    }, 145);
  }

  function scheduleHandsFreeAfterFallback() {
    try {
      if (!window.FNSNatural?.handsFree || !document.querySelector('#liteModal')) return;
      clearTimeout(window.FNSNatural.handsTimer);
      window.FNSNatural.handsTimer = setTimeout(() => {
        if (window.FNSNatural?.handsFree && !recognizing && document.querySelector('#liteModal')) startRecording();
      }, 650);
    } catch (_) {}
  }

  async function browserSpanishSpeak(text) {
    const clean = String(text || '').trim();
    if (!clean || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        stopFallbackMouth();
        const face = document.querySelector('#liteModal .human-avatar[data-teacher="olivia"]');
        if (face) face.classList.remove('avatar-speaking', 'avatar-talking');
        try {
          if (flowState !== FLOW_STATES.IDLE) setFlowState(FLOW_STATES.IDLE, { force: true, status: 'Lista' });
        } catch (_) {}
        fallbackUtterance = null;
        if (ok) scheduleHandsFreeAfterFallback();
        resolve(ok);
      };

      try {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(clean);
        fallbackUtterance = utterance;
        const voice = pickSpanishVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang || 'es-ES';
        utterance.rate = 0.96;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        runtime.browserVoiceFallbackCount += 1;
        runtime.lastBrowserVoice = voice ? `${voice.name} (${voice.lang})` : 'browser default (es-ES)';

        utterance.onstart = () => {
          try { setFlowState(FLOW_STATES.SPEAKING, { force: true, status: 'Olivia hablando' }); } catch (_) {}
          const face = document.querySelector('#liteModal .human-avatar[data-teacher="olivia"]');
          if (face) face.classList.add('avatar-speaking', 'avatar-talking');
          startFallbackMouth();
        };
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        speechSynthesis.speak(utterance);
      } catch (error) {
        rememberError('browserSpanishSpeak', error);
        finish(false);
      }
    });
  }

  function installCorePatches() {
    primeOliviaTeacher();

    try {
      const coreAvatarVisualMarkup = avatarVisualMarkup;
      avatarVisualMarkup = function (teacher) {
        if (isOliviaName(teacher?.name)) return oliviaAvatarMarkup();
        return coreAvatarVisualMarkup(teacher);
      };
    } catch (error) { rememberError('patch:avatarVisualMarkup', error); }

    try {
      const coreOpeningPrompt = openingPrompt;
      openingPrompt = function (level, topic) {
        if (isOliviaActive()) return spanishPrompt(level, topic);
        return coreOpeningPrompt(level, topic);
      };
    } catch (error) { rememberError('patch:openingPrompt', error); }

    try {
      const coreOpenLiteTeacher = openLiteTeacher;
      openLiteTeacher = function (i, level = 'A1', mode = 'conversation', topic = 'General conversation') {
        const target = teachers?.[i];
        if (!isOliviaName(target?.name)) return coreOpenLiteTeacher(i, level, mode, topic);

        primeOliviaTeacher();
        let hadVoice = false;
        try {
          hadVoice = !!voiceUnlocked;
          voiceUnlocked = false;
        } catch (_) {}

        const out = coreOpenLiteTeacher(i, level, mode, topic);
        localizeRoom();

        try { voiceUnlocked = hadVoice; } catch (_) {}
        try { lastSpoken = spanishIntro(); } catch (_) {}

        queueMicrotask(localizeRoom);
        requestAnimationFrame(localizeRoom);
        setTimeout(localizeRoom, 80);

        if (hadVoice) {
          setTimeout(() => {
            if (!isOliviaActive() || !document.querySelector('#liteModal')) return;
            try { void remoteSpeak(spanishIntro()); } catch (error) { rememberError('resumeSpanishVoice', error); }
          }, 140);
        }
        return out;
      };
    } catch (error) { rememberError('patch:openLiteTeacher', error); }

    try {
      const coreRefreshFlowControls = refreshFlowControls;
      refreshFlowControls = function (...args) {
        const result = coreRefreshFlowControls(...args);
        if (isOliviaActive()) queueMicrotask(localizeControls);
        return result;
      };
    } catch (error) { rememberError('patch:refreshFlowControls', error); }

    try {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async function (input, init = {}) {
        if (!isOliviaActive()) return nativeFetch(input, init);

        let url = '';
        try { url = new URL(typeof input === 'string' ? input : input.url, location.href).href; }
        catch (_) { return nativeFetch(input, init); }

        const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
        let patched = init;

        try {
          if (method === 'POST' && typeof init?.body === 'string' && (/\/chat(?:\?|$)/.test(url) || /\/tts(?:\?|$)/.test(url))) {
            const body = JSON.parse(init.body || '{}');
            body.teacher = 'Olivia';
            if (/\/chat(?:\?|$)/.test(url)) {
              body.input_language = 'es-ES';
              body.input_language_label = 'Español';
              body.strict_language = 'es-ES';
              body.strict_language_enabled = true;
              body.accent = 'Español';
            } else {
              body.language = 'es-ES';
              body.tts_language = 'es-ES';
            }
            patched = { ...init, body: JSON.stringify(body) };
          }

          if (method === 'POST' && /\/stt(?:\?|$)/.test(url)) {
            const headers = new Headers(init?.headers || {});
            headers.set('X-FNS-STT-Language', 'es-ES');
            patched = { ...init, headers };
          }
        } catch (error) {
          rememberError('fetchPatch', error);
        }

        const response = await nativeFetch(input, patched);
        if (method === 'POST' && /\/tts(?:\?|$)/.test(url) && response.ok) {
          const language = String(response.headers.get('X-FNS-Voice-Language') || '').toLowerCase();
          if (language && !language.startsWith('es')) {
            try { response.body?.cancel?.(); } catch (_) {}
            return new Response(JSON.stringify({
              ok: false,
              code: 'FNS_OLIVIA_WRONG_TTS_LANGUAGE',
              message: 'Remote TTS did not return a Spanish voice.'
            }), {
              status: 502,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
            });
          }
        }
        return response;
      };
    } catch (error) { rememberError('patch:fetch', error); }

    try {
      const coreRemoteSpeak = remoteSpeak;
      remoteSpeak = async function (text) {
        if (!isOliviaActive()) return await coreRemoteSpeak(text);
        const clean = String(text || '').trim();
        if (!clean) return false;
        let unlocked = false;
        try { unlocked = !!voiceUnlocked; } catch (_) {}

        let result = false;
        try { result = await coreRemoteSpeak(clean); }
        catch (error) { rememberError('remoteSpanishTts', error); }
        if (result || !unlocked) return result;

        try {
          if (isRecording || isSpeaking) return false;
        } catch (_) {}

        const fallback = await browserSpanishSpeak(clean);
        if (fallback) {
          const systemMessages = document.querySelectorAll('#liteModal #transcript .msg.system');
          const last = systemMessages[systemMessages.length - 1];
          if (last && /voz de la Emma|voz da Emma|voice.*Emma|temporariamente indisponível/i.test(last.textContent || '')) last.remove();
        }
        return fallback;
      };
    } catch (error) { rememberError('patch:remoteSpeak', error); }

    try {
      const coreStopRemoteVoice = stopRemoteVoice;
      stopRemoteVoice = function (...args) {
        if (isOliviaActive() && 'speechSynthesis' in window) {
          try { speechSynthesis.cancel(); } catch (_) {}
          fallbackUtterance = null;
          stopFallbackMouth();
        }
        return coreStopRemoteVoice(...args);
      };
    } catch (error) { rememberError('patch:stopRemoteVoice', error); }

    try {
      const coreUnlockVoice = unlockVoice;
      unlockVoice = async function (...args) {
        if (isOliviaActive()) {
          try { lastSpoken = spanishIntro(); } catch (_) {}
        }
        const result = await coreUnlockVoice(...args);
        if (isOliviaActive()) localizeControls();
        return result;
      };
    } catch (error) { rememberError('patch:unlockVoice', error); }
  }

  function directBoot() {
    if (!DIRECT_MODE) return;
    try {
      const index = oliviaIndex();
      document.querySelector('#liteModal')?.remove();
      if (typeof live === 'function') live();
      if (typeof openTeacher !== 'function') throw new Error('openTeacher unavailable');
      openTeacher(index);
      setTimeout(localizeRoom, 80);
      setTimeout(localizeRoom, 300);
    } catch (error) {
      rememberError('directBoot', error);
      try {
        if (typeof live === 'function') live();
        const appNode = document.querySelector('#app');
        appNode?.insertAdjacentHTML('afterbegin', '<div class="wrap"><div class="msg system">No se pudo abrir Olivia automáticamente. Usa Práctica ao vivo → Olivia.</div></div>');
      } catch (_) {}
    }
  }

  runtime.health = function () {
    const face = document.querySelector('#liteModal .human-avatar[data-teacher="olivia"]');
    const image = face?.querySelector('img');
    const select = document.querySelector('#liteModal #sttLangSel');
    const voice = pickSpanishVoice();
    return {
      version: VERSION,
      directMode: DIRECT_MODE,
      booted: runtime.booted,
      active: isOliviaActive(),
      modal: !!document.querySelector('#liteModal'),
      avatar: !!face,
      avatarReady: face?.dataset.avatarReady || '',
      avatarState: face?.dataset.pngtuberState || '',
      imageSrc: image?.src || '',
      imageLoaded: !!(image?.complete && image?.naturalWidth > 0 && image?.naturalHeight > 0),
      imageWidth: image?.naturalWidth || 0,
      imageHeight: image?.naturalHeight || 0,
      sttLanguage: select?.value || '',
      sttLocked: !!select?.disabled,
      strictLanguage: select?.dataset.fnsStrictLanguage || '',
      browserSpeechSynthesis: 'speechSynthesis' in window,
      spanishBrowserVoice: voice ? `${voice.name} (${voice.lang})` : '',
      assetStatus: { ...runtime.assetStatus },
      errors: runtime.errors.slice(-10)
    };
  };

  preloadAssets();
  installCorePatches();
  requestAnimationFrame(frameLoop);

  window.addEventListener('error', (event) => {
    if (!isOliviaActive() && !DIRECT_MODE) return;
    rememberError('window.error', event.error || event.message || 'window error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (!isOliviaActive() && !DIRECT_MODE) return;
    rememberError('unhandledrejection', event.reason || 'unhandled rejection');
  });

  if (document.readyState === 'complete') setTimeout(directBoot, 0);
  else window.addEventListener('load', () => setTimeout(directBoot, 0), { once: true });
})();
