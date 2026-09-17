(() => {
  'use strict';

  // FNS OLIVIA V14 — resilient isolated avatar engine.
  // Visual rendering is independent from Cloudflare AI availability.
  const FACTORY_GUARD = 'FNS-AVATAR-FACTORY-V14';
  const VERSION = 'v14-20260917';
  const root = document.getElementById('root');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const injected = window.__FNS_AVATAR_BOOTSTRAP__ || {};
  const slug = String(injected.slug || params.get('avatar') || 'olivia')
    .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);

  const state = {
    slug,
    config: injected.config || null,
    catalogVersion: injected.schemaVersion || 0,
    mode: 'booting',
    frame: 'closed',
    busy: false,
    recording: false,
    recorder: null,
    recognition: null,
    stream: null,
    chunks: [],
    audio: null,
    audioContext: null,
    analyser: null,
    lipRaf: 0,
    localSpeechTimer: 0,
    sessionId: '',
    history: [],
    lastTranscript: '',
    lastReply: '',
    turbine: '',
    imageRetry: 0,
    cloudVoiceUnavailable: false
  };

  const el = (id) => document.getElementById(id);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

  function emit(type, detail = {}) {
    window.dispatchEvent(new CustomEvent('fns:avatar:v14', {
      detail: { guard: FACTORY_GUARD, avatar: state.slug, type, ...detail }
    }));
  }

  function textOfError(error) {
    return String(error?.message || error || 'Error desconocido');
  }

  function isQuotaError(value) {
    return /\b4006\b|daily free allocation|10,000 neurons|workers paid plan|used up your daily/i.test(String(value || ''));
  }

  function setStatus(text) {
    const node = el('status');
    if (node) node.textContent = String(text || '');
  }

  function setModeLabel(text) {
    const node = el('avatar-mode');
    if (node) node.textContent = String(text || '');
  }

  function protectVisuals(message = '') {
    const image = el('olivia-avatar-img');
    if (image) {
      image.style.display = 'block';
      image.style.visibility = 'visible';
      image.style.opacity = '1';
      image.style.transform = 'none';
    }
    if (message) setStatus(message);
  }

  window.addEventListener('unhandledrejection', (event) => {
    const message = textOfError(event.reason);
    if (isQuotaError(message)) {
      event.preventDefault();
      state.cloudVoiceUnavailable = true;
      protectVisuals('La cuota de voz en la nube se agotó. Olivia sigue activa; usando alternativas del navegador.');
      setMode('idle', { degraded: true, reason: 'cloudflare-4006' });
      emit('quota-fallback', { message });
      return;
    }
    protectVisuals();
    emit('unhandled-rejection', { message });
  });

  window.addEventListener('error', (event) => {
    protectVisuals();
    emit('window-error', { message: String(event?.message || '') });
  });

  function sessionId() {
    const key = `fns-avatar-session-${state.slug || 'default'}`;
    let id = '';
    try { id = localStorage.getItem(key) || ''; } catch (_) {}
    if (id.length < 12) {
      const fresh = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
        .replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
      id = `fns_${fresh}`;
      try { localStorage.setItem(key, id); } catch (_) {}
    }
    return id;
  }

  async function loadConfig() {
    if (state.config) return state.config;
    const response = await fetch(`/avatar-config.json?v=${VERSION}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Config HTTP ${response.status}`);
    const catalog = await response.json();
    state.catalogVersion = catalog.schemaVersion || 0;
    state.config = catalog?.avatars?.[state.slug] || null;
    if (!state.config) throw new Error(`Avatar "${state.slug || 'unknown'}" no configurado.`);
    return state.config;
  }

  function frameUrl(path) {
    const raw = String(path || '');
    if (!raw) return '';
    const separator = raw.includes('?') ? '&' : '?';
    return `${raw}${separator}v=${VERSION}`;
  }

  function setFrame(name) {
    const cfg = state.config;
    const image = el('olivia-avatar-img');
    if (!cfg || !image) return;
    const map = cfg.images || {};
    const path = map[name] || map.closed;
    if (!path) return;
    const next = frameUrl(path);
    if (image.src !== next && image.getAttribute('src') !== next) image.src = next;
    image.style.display = 'block';
    image.style.visibility = 'visible';
    image.style.opacity = '1';
    image.style.transform = 'none';
    state.frame = name;
  }

  function installImageGuard() {
    const image = el('olivia-avatar-img');
    if (!image) return;

    image.addEventListener('load', () => {
      state.imageRetry = 0;
      image.dataset.loaded = 'true';
      protectVisuals();
      emit('image-loaded', {
        width: image.naturalWidth,
        height: image.naturalHeight,
        src: image.currentSrc || image.src,
        frame: state.frame
      });
    });

    image.addEventListener('error', () => {
      image.dataset.loaded = 'false';
      const absoluteClosed = state.config?.images?.closed || 'https://fns-stt.karlapower007.workers.dev/assets/olivia-fechada.png';
      if (state.imageRetry < 2) {
        state.imageRetry += 1;
        image.src = `${absoluteClosed}${absoluteClosed.includes('?') ? '&' : '?'}v=${VERSION}-retry-${state.imageRetry}-${Date.now()}`;
        protectVisuals('Recargando la imagen de Olivia…');
        return;
      }
      protectVisuals('La interfaz sigue activa, pero la imagen de Olivia no respondió desde el servidor.');
      emit('image-error', { src: image.currentSrc || image.src });
    });
  }

  function hydrateLayout() {
    const cfg = state.config;
    const ui = cfg.ui || {};
    const required = ['avatar-stage','olivia-avatar-img','interaction-panel','chat-history','controls-bar','micBtn','replayBtn','textInput','voiceTurbine','sendBtn'];
    for (const id of required) if (!el(id)) throw new Error(`V14 skeleton missing #${id}`);

    root.dataset.fnsAvatarRoot = 'isolated-v14';
    root.dataset.avatar = state.slug;
    root.dataset.guard = FACTORY_GUARD;

    if (el('avatar-name')) el('avatar-name').textContent = ui.title || cfg.name || 'Olivia';
    if (el('avatar-subtitle')) el('avatar-subtitle').textContent = ui.subtitle || cfg.languageLabel || 'Español';
    if (el('panel-title')) el('panel-title').textContent = ui.title || cfg.name || 'Olivia';
    if (el('panel-language')) el('panel-language').textContent = `${cfg.languageLabel || 'Español'} · ${cfg.level || 'A1'}`;
    if (el('textInput')) el('textInput').placeholder = ui.placeholder || 'Escribe en español…';
    if (el('micBtn')?.querySelector('span')) el('micBtn').querySelector('span').textContent = ui.startListening || 'Hablar';

    const turbines = Array.isArray(cfg.availableTurbines) ? cfg.availableTurbines : [];
    const select = el('voiceTurbine');
    select.replaceChildren(...turbines.map((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      return option;
    }));

    let savedTurbine = '';
    try { savedTurbine = localStorage.getItem(`fns-avatar-turbine-${state.slug}`) || ''; } catch (_) {}
    state.turbine = turbines.includes(savedTurbine) ? savedTurbine : (cfg.voiceTurbine || turbines[0] || '');
    select.value = state.turbine;

    installImageGuard();
    setFrame('closed');

    el('controls-bar').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = el('textInput');
      const text = String(input?.value || '').trim();
      if (!text) return;
      input.value = '';
      void sendMessage(text);
    });

    el('micBtn').addEventListener('click', () => {
      if (state.recording) void stopRecording();
      else void startRecording();
    });

    el('replayBtn').addEventListener('click', () => {
      if (state.lastReply && !state.busy) void speak(state.lastReply);
    });

    select.addEventListener('change', (event) => {
      state.turbine = String(event.target.value || cfg.voiceTurbine || '');
      try { localStorage.setItem(`fns-avatar-turbine-${state.slug}`, state.turbine); } catch (_) {}
      emit('turbine-change', { turbine: state.turbine });
    });
  }

  function appendMessage(role, text) {
    const history = el('chat-history');
    if (!history) return;
    el('chat-empty')?.remove();
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${role}`;
    const roleNode = document.createElement('span');
    roleNode.className = 'chat-role';
    roleNode.textContent = role === 'user' ? 'Tú' : (state.config?.name || 'Olivia');
    const textNode = document.createElement('span');
    textNode.textContent = String(text || '');
    bubble.append(roleNode, textNode);
    history.appendChild(bubble);
    history.scrollTop = history.scrollHeight;
  }

  function setBusy(value) {
    state.busy = !!value;
    if (el('sendBtn')) el('sendBtn').disabled = state.busy;
    if (el('replayBtn')) el('replayBtn').disabled = state.busy || !state.lastReply;
  }

  function setMode(mode, detail = {}) {
    state.mode = mode;
    const labels = { idle: 'Lista', listening: 'Escuchando', thinking: 'Pensando', speaking: 'Hablando', booting: 'Iniciando' };
    setModeLabel(labels[mode] || mode);
    if (mode === 'idle' || mode === 'listening' || mode === 'thinking') setFrame('closed');
    protectVisuals();
    emit(mode, detail);
  }

  function stopLipSync() {
    if (state.lipRaf) cancelAnimationFrame(state.lipRaf);
    state.lipRaf = 0;
    if (state.localSpeechTimer) clearInterval(state.localSpeechTimer);
    state.localSpeechTimer = 0;
    state.analyser = null;
    setFrame('closed');
  }

  function animateLipSync() {
    const analyser = state.analyser;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const talk = Number(state.config?.thresholds?.talking ?? 0.15);
    const open = Number(state.config?.thresholds?.open ?? 0.60);

    const tick = () => {
      if (!state.analyser || state.mode !== 'speaking') return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs((data[i] - 128) / 128);
        if (v > peak) peak = v;
      }
      if (peak >= open) setFrame('open');
      else if (peak >= talk) setFrame('talking');
      else setFrame('closed');
      state.lipRaf = requestAnimationFrame(tick);
    };
    state.lipRaf = requestAnimationFrame(tick);
  }

  async function ensureAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!state.audioContext) state.audioContext = new AudioCtx();
    if (state.audioContext.state === 'suspended') await state.audioContext.resume().catch(() => {});
    return state.audioContext;
  }

  async function playAudioBlob(blob) {
    stopLipSync();
    if (state.audio) {
      try { state.audio.pause(); } catch (_) {}
      state.audio = null;
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.audio = audio;
    const ctx = await ensureAudioContext();

    if (ctx) {
      try {
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.55;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        state.analyser = analyser;
      } catch (_) {
        state.analyser = null;
      }
    }

    audio.addEventListener('play', () => {
      setMode('speaking', { source: 'remote-tts', turbine: state.turbine });
      setFrame('talking');
      animateLipSync();
      setStatus(`${state.config.name} está hablando…`);
    });
    audio.addEventListener('ended', () => {
      stopLipSync();
      setMode('idle', { source: 'remote-tts' });
      setStatus('Listo.');
      URL.revokeObjectURL(url);
    }, { once: true });
    audio.addEventListener('error', () => {
      stopLipSync();
      setMode('idle', { source: 'audio-error' });
      URL.revokeObjectURL(url);
    }, { once: true });

    await audio.play();
  }

  function speakLocal(text) {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
        reject(new Error('SpeechSynthesis no disponible'));
        return;
      }

      try { speechSynthesis.cancel(); } catch (_) {}
      const utterance = new SpeechSynthesisUtterance(String(text || ''));
      utterance.lang = state.config?.language || 'es-ES';
      utterance.rate = 0.96;
      utterance.pitch = 1;
      const voices = speechSynthesis.getVoices?.() || [];
      const voice = voices.find((v) => /^es(-|_)/i.test(v.lang)) || voices.find((v) => /^es/i.test(v.lang));
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        setMode('speaking', { source: 'browser-speechSynthesis' });
        setStatus('Olivia está hablando con la voz del navegador…');
        let flip = false;
        state.localSpeechTimer = window.setInterval(() => {
          flip = !flip;
          setFrame(flip ? 'open' : 'talking');
        }, 150);
      };
      utterance.onend = () => {
        stopLipSync();
        setMode('idle', { source: 'browser-speechSynthesis' });
        setStatus(state.cloudVoiceUnavailable ? 'Voz local activa. La cuota de Cloudflare no afecta la interfaz.' : 'Listo.');
        resolve();
      };
      utterance.onerror = (event) => {
        stopLipSync();
        setMode('idle', { source: 'browser-speechSynthesis-error' });
        reject(new Error(event?.error || 'SpeechSynthesis falló'));
      };
      speechSynthesis.speak(utterance);
    });
  }

  async function remoteSpeak(text) {
    const cfg = state.config;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          teacher: cfg.teacher || cfg.name,
          language: cfg.language,
          voice_turbine: state.turbine || cfg.voiceTurbine
        })
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`TTS HTTP ${response.status}${detail ? `: ${detail.slice(0, 220)}` : ''}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!/^audio\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
        const detail = await response.text().catch(() => '');
        throw new Error(`TTS inválido: ${contentType || 'sin content-type'} ${detail.slice(0, 160)}`);
      }
      await playAudioBlob(await response.blob());
    } finally {
      clearTimeout(timer);
    }
  }

  async function speak(text) {
    try {
      if (!state.cloudVoiceUnavailable) {
        await remoteSpeak(text);
        return;
      }
    } catch (error) {
      const message = textOfError(error);
      if (isQuotaError(message)) state.cloudVoiceUnavailable = true;
      emit('tts-fallback', { message });
    }

    try {
      await speakLocal(text);
    } catch (error) {
      setMode('idle', { error: true });
      setStatus(`La respuesta está escrita arriba. Voz no disponible: ${textOfError(error)}`);
    }
  }

  function remember(role, content) {
    state.history.push({ role, content: String(content || '').slice(0, 1600), ts: Date.now() });
    state.history = state.history.slice(-20);
  }

  async function sendMessage(message) {
    const text = String(message || '').trim();
    if (!text || state.busy) return;
    setBusy(true);
    setMode('thinking');
    state.lastTranscript = text;
    appendMessage('user', text);
    setStatus('Pensando…');

    const cfg = state.config;
    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          teacher: cfg.teacher || cfg.name,
          level: cfg.level || 'A1',
          accent: cfg.accent || 'Español neutral',
          input_language: cfg.language || 'es-ES',
          input_language_label: cfg.languageLabel || 'Español',
          session_id: state.sessionId,
          history: state.history,
          system_prompt: cfg.systemPrompt || ''
        })
      });
      const raw = await response.text();
      let payload = {};
      try { payload = JSON.parse(raw); } catch (_) {}
      if (!response.ok || !payload?.reply) {
        throw new Error(payload?.message || payload?.error || raw || `Chat HTTP ${response.status}`);
      }

      remember('user', text);
      remember('assistant', payload.reply);
      state.lastReply = String(payload.reply);
      appendMessage('assistant', state.lastReply);
      if (el('replayBtn')) el('replayBtn').disabled = false;
      setStatus('Preparando voz…');
      await speak(state.lastReply);
    } catch (error) {
      const message = textOfError(error);
      setMode('idle', { error: true });
      if (isQuotaError(message)) {
        state.cloudVoiceUnavailable = true;
        setStatus('La cuota de Cloudflare se agotó hoy. Olivia y su imagen siguen activas; el chat en la nube volverá cuando la cuota se restablezca.');
      } else {
        setStatus(`Chat no disponible: ${message}`);
      }
    } finally {
      setBusy(false);
      protectVisuals();
    }
  }

  function startBrowserRecognition() {
    const recognition = new Recognition();
    state.recognition = recognition;
    state.recording = true;
    let finalText = '';

    recognition.lang = state.config?.sttLanguage || state.config?.language || 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setMode('listening', { source: 'browser-SpeechRecognition' });
      setStatus('Escuchando con el reconocimiento del navegador…');
      const span = el('micBtn')?.querySelector('span');
      if (span) span.textContent = state.config?.ui?.stopListening || 'Detener';
    };

    recognition.onresult = (event) => {
      finalText = Array.from(event.results || [])
        .map((result) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();
    };

    recognition.onerror = (event) => {
      const code = String(event?.error || 'speech-recognition-error');
      if (code !== 'aborted' && code !== 'no-speech') setStatus(`Reconocimiento del navegador: ${code}. También puedes escribir.`);
    };

    recognition.onend = () => {
      state.recording = false;
      state.recognition = null;
      const span = el('micBtn')?.querySelector('span');
      if (span) span.textContent = state.config?.ui?.startListening || 'Hablar';
      setMode('idle', { source: 'browser-SpeechRecognition' });
      if (finalText) {
        emit('transcript', { text: finalText, source: 'browser-SpeechRecognition' });
        void sendMessage(finalText);
      } else if (!state.busy) {
        setStatus('No se detectó una frase. Inténtalo otra vez o escribe el mensaje.');
      }
    };

    try {
      recognition.start();
    } catch (error) {
      state.recording = false;
      state.recognition = null;
      throw error;
    }
  }

  function mediaMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  async function startMediaRecording() {
    await ensureAudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = mediaMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.stream = stream;
    state.recorder = recorder;
    state.chunks = [];
    state.recording = true;
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) state.chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => void finishRecording(), { once: true });
    recorder.start();
    setMode('listening', { source: 'MediaRecorder-cloud-STT' });
    setStatus('Escuchando…');
    const span = el('micBtn')?.querySelector('span');
    if (span) span.textContent = state.config?.ui?.stopListening || 'Detener';
  }

  async function startRecording() {
    if (state.busy || state.recording) return;
    try {
      if (Recognition) {
        startBrowserRecognition();
        return;
      }
      await startMediaRecording();
    } catch (error) {
      state.recording = false;
      setMode('idle', { error: true });
      setStatus(`Micrófono no disponible: ${textOfError(error)}`);
    }
  }

  async function stopRecording() {
    if (!state.recording) return;
    const span = el('micBtn')?.querySelector('span');
    if (span) span.textContent = state.config?.ui?.startListening || 'Hablar';

    if (state.recognition) {
      try { state.recognition.stop(); } catch (_) {}
      return;
    }

    state.recording = false;
    setStatus('Transcribiendo…');
    try { state.recorder?.stop(); } catch (_) { await finishRecording(); }
  }

  async function finishRecording() {
    const chunks = state.chunks.splice(0);
    const stream = state.stream;
    state.stream = null;
    state.recorder = null;
    state.recording = false;
    if (stream) stream.getTracks().forEach((track) => track.stop());

    if (!chunks.length) {
      setMode('idle');
      setStatus('No se detectó audio.');
      return;
    }

    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    try {
      const response = await fetch('/stt', {
        method: 'POST',
        headers: { 'X-FNS-STT-Language': state.config.sttLanguage || state.config.language || 'es-ES' },
        body: await blob.arrayBuffer()
      });
      const raw = await response.text();
      let payload = {};
      try { payload = JSON.parse(raw); } catch (_) {}
      const transcript = String(payload?.text || '').trim();
      if (!response.ok || !transcript) throw new Error(payload?.error || raw || `STT HTTP ${response.status}`);
      emit('transcript', { text: transcript, source: 'cloud-STT' });
      await sendMessage(transcript);
    } catch (error) {
      const message = textOfError(error);
      setMode('idle', { error: true });
      if (isQuotaError(message)) {
        state.cloudVoiceUnavailable = true;
        setStatus('La cuota STT de Cloudflare se agotó. La interfaz y Olivia siguen activas; escribe el mensaje o usa reconocimiento del navegador cuando esté disponible.');
      } else {
        setStatus(`Transcripción no disponible: ${message}`);
      }
      protectVisuals();
    }
  }

  function health() {
    const image = el('olivia-avatar-img');
    const rootStyle = getComputedStyle(root);
    const stageStyle = el('avatar-stage') ? getComputedStyle(el('avatar-stage')) : null;
    const panelStyle = el('interaction-panel') ? getComputedStyle(el('interaction-panel')) : null;
    return {
      guard: FACTORY_GUARD,
      version: VERSION,
      avatar: state.slug,
      isolatedRoot: root.dataset.fnsAvatarRoot === 'isolated-v14',
      emmaAppLoaded: !!document.querySelector('script[src*="/app.js"]'),
      layout: rootStyle.display,
      stagePresent: !!el('avatar-stage'),
      panelPresent: !!el('interaction-panel'),
      stageWidth: stageStyle?.width || '',
      panelWidth: panelStyle?.width || '',
      mode: state.mode,
      frame: state.frame,
      language: state.config?.language || '',
      turbine: state.turbine,
      image: image?.getAttribute('src') || '',
      imageCurrentSrc: image?.currentSrc || '',
      imageLoaded: !!(image?.complete && image?.naturalWidth > 0),
      imageNaturalWidth: image?.naturalWidth || 0,
      imageNaturalHeight: image?.naturalHeight || 0,
      browserSpeechRecognition: !!Recognition,
      browserSpeechSynthesis: 'speechSynthesis' in window,
      cloudVoiceUnavailable: state.cloudVoiceUnavailable,
      recording: state.recording,
      busy: state.busy
    };
  }

  async function boot() {
    try {
      await loadConfig();
      state.sessionId = sessionId();
      hydrateLayout();
      setMode('idle');
      setStatus(Recognition ? 'Listo. Voz del navegador preparada como respaldo.' : 'Listo.');
      emit('ready', { language: state.config.language, turbine: state.turbine, layout: 'two-column-v14' });
      window.FNS_AVATAR_CORE = Object.freeze({
        guard: FACTORY_GUARD,
        health,
        send: sendMessage,
        speak,
        startRecording,
        stopRecording,
        setFrame
      });
    } catch (error) {
      // Never destroy the static V14 HTML or the avatar image on boot failure.
      state.mode = 'idle';
      protectVisuals(`Inicialización parcial: ${textOfError(error)}. La interfaz visual permanece activa.`);
      emit('boot-error', { error: textOfError(error) });
    }
  }

  // The HTML paints the absolute Olivia PNG before this script boots.
  void boot();
})();
