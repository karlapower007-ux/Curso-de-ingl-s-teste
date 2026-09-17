(() => {
  'use strict';

  // FNS OLIVIA V12 — isolated visual engine + JSON factory config.
  // This file deliberately does not import, execute or depend on Emma's app.js.
  const FACTORY_GUARD = 'FNS-AVATAR-FACTORY-V12';
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
    stream: null,
    chunks: [],
    audio: null,
    audioContext: null,
    analyser: null,
    lipRaf: 0,
    sessionId: '',
    history: [],
    lastTranscript: '',
    lastReply: '',
    turbine: '',
    imageRetry: 0
  };

  const el = (id) => document.getElementById(id);

  function emit(type, detail = {}) {
    window.dispatchEvent(new CustomEvent('fns:avatar:v12', {
      detail: { guard: FACTORY_GUARD, avatar: state.slug, type, ...detail }
    }));
  }

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
    const response = await fetch('/avatar-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Config HTTP ${response.status}`);
    const catalog = await response.json();
    state.catalogVersion = catalog.schemaVersion || 0;
    state.config = catalog?.avatars?.[state.slug] || null;
    if (!state.config) throw new Error(`Avatar "${state.slug || 'unknown'}" no configurado.`);
    return state.config;
  }

  function setStatus(text) {
    const node = el('status');
    if (node) node.textContent = String(text || '');
  }

  function setModeLabel(text) {
    const node = el('avatar-mode');
    if (node) node.textContent = String(text || '');
  }

  function frameUrl(path) {
    const raw = String(path || '');
    if (!raw) return '';
    return `${raw}${raw.includes('?') ? '&' : '?'}v=v12-20260917`;
  }

  function setFrame(name) {
    const cfg = state.config;
    const image = el('olivia-avatar-img');
    if (!cfg || !image) return;
    const map = cfg.images || {};
    const path = map[name] || map.closed;
    if (!path) return;
    const next = frameUrl(path);
    if (image.getAttribute('src') !== next) image.setAttribute('src', next);
    image.style.visibility = 'visible';
    image.style.opacity = '1';
    image.style.transform = 'none';
    state.frame = name;
  }

  function installImageGuard() {
    const image = el('olivia-avatar-img');
    if (!image) throw new Error('V12 skeleton missing #olivia-avatar-img');

    image.addEventListener('load', () => {
      state.imageRetry = 0;
      image.dataset.loaded = 'true';
      image.style.visibility = 'visible';
      image.style.opacity = '1';
      emit('image-loaded', { width: image.naturalWidth, height: image.naturalHeight, frame: state.frame });
    });

    image.addEventListener('error', () => {
      image.dataset.loaded = 'false';
      if (state.imageRetry < 1 && state.config?.images?.closed) {
        state.imageRetry += 1;
        image.src = `${state.config.images.closed}?v=v12-retry-${Date.now()}`;
        return;
      }
      setStatus('No se pudo cargar la imagen de Olivia.');
      emit('image-error', { src: image.currentSrc || image.src });
    });
  }

  function hydrateLayout() {
    const cfg = state.config;
    const ui = cfg.ui || {};
    const required = ['avatar-stage','olivia-avatar-img','interaction-panel','chat-history','controls-bar','micBtn','replayBtn','textInput','voiceTurbine','sendBtn'];
    for (const id of required) if (!el(id)) throw new Error(`V12 skeleton missing #${id}`);

    root.dataset.fnsAvatarRoot = 'isolated-v12';
    root.dataset.avatar = state.slug;
    root.dataset.guard = FACTORY_GUARD;

    if (el('avatar-name')) el('avatar-name').textContent = ui.title || cfg.name || 'Olivia';
    if (el('avatar-subtitle')) el('avatar-subtitle').textContent = ui.subtitle || cfg.languageLabel || 'Español';
    if (el('panel-title')) el('panel-title').textContent = ui.title || cfg.name || 'Olivia';
    if (el('panel-language')) el('panel-language').textContent = `${cfg.languageLabel || 'Español'} · ${cfg.level || 'A1'}`;
    if (el('textInput')) el('textInput').placeholder = ui.placeholder || 'Escribe en español…';
    if (el('micBtn')) el('micBtn').querySelector('span').textContent = ui.startListening || 'Hablar';

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

    // Paint the idle PNG immediately into the visible left-hand stage.
    setFrame('closed');
    installImageGuard();

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
    const labels = {
      idle: 'Lista', listening: 'Escuchando', thinking: 'Pensando', speaking: 'Hablando', booting: 'Iniciando'
    };
    setModeLabel(labels[mode] || mode);
    if (mode === 'idle' || mode === 'listening' || mode === 'thinking') setFrame('closed');
    emit(mode, detail);
  }

  function stopLipSync() {
    if (state.lipRaf) cancelAnimationFrame(state.lipRaf);
    state.lipRaf = 0;
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
      setStatus('No se pudo reproducir la voz.');
      URL.revokeObjectURL(url);
    }, { once: true });

    await audio.play();
  }

  async function speak(text) {
    const cfg = state.config;
    const response = await fetch('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        teacher: cfg.teacher || cfg.name,
        language: cfg.language,
        voice_turbine: state.turbine || cfg.voiceTurbine
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`TTS HTTP ${response.status}${detail ? `: ${detail.slice(0, 140)}` : ''}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/^audio\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
      throw new Error(`TTS devolvió ${contentType || 'contenido desconocido'}`);
    }
    await playAudioBlob(await response.blob());
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
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.reply) {
        throw new Error(payload?.message || payload?.error || `Chat HTTP ${response.status}`);
      }

      remember('user', text);
      remember('assistant', payload.reply);
      state.lastReply = String(payload.reply);
      appendMessage('assistant', state.lastReply);
      if (el('replayBtn')) el('replayBtn').disabled = false;
      setStatus('Preparando voz…');
      await speak(state.lastReply);
    } catch (error) {
      setMode('idle', { error: true });
      setStatus(`Error: ${String(error?.message || error)}`);
    } finally {
      setBusy(false);
    }
  }

  function mediaMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  async function startRecording() {
    if (state.busy || state.recording) return;
    try {
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
      setMode('listening');
      setStatus('Escuchando…');
      const btnText = el('micBtn')?.querySelector('span');
      if (btnText) btnText.textContent = state.config?.ui?.stopListening || 'Detener';
      emit('recording-start');
    } catch (error) {
      state.recording = false;
      setMode('idle', { error: true });
      setStatus(`Micrófono no disponible: ${String(error?.message || error)}`);
    }
  }

  async function stopRecording() {
    if (!state.recording || !state.recorder) return;
    state.recording = false;
    setStatus('Transcribiendo…');
    const btnText = el('micBtn')?.querySelector('span');
    if (btnText) btnText.textContent = state.config?.ui?.startListening || 'Hablar';
    try { state.recorder.stop(); } catch (_) { await finishRecording(); }
  }

  async function finishRecording() {
    const chunks = state.chunks.splice(0);
    const stream = state.stream;
    state.stream = null;
    state.recorder = null;
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
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !String(payload?.text || '').trim()) {
        throw new Error(payload?.error || `STT HTTP ${response.status}`);
      }
      emit('transcript', { text: payload.text });
      await sendMessage(payload.text);
    } catch (error) {
      setMode('idle', { error: true });
      setStatus(`Transcripción falló: ${String(error?.message || error)}`);
    }
  }

  function health() {
    const image = el('olivia-avatar-img');
    const rootStyle = getComputedStyle(root);
    const stageStyle = el('avatar-stage') ? getComputedStyle(el('avatar-stage')) : null;
    const panelStyle = el('interaction-panel') ? getComputedStyle(el('interaction-panel')) : null;
    return {
      guard: FACTORY_GUARD,
      avatar: state.slug,
      isolatedRoot: root.dataset.fnsAvatarRoot === 'isolated-v12',
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
      thresholds: state.config?.thresholds || null,
      image: image?.getAttribute('src') || '',
      imageLoaded: !!(image?.complete && image?.naturalWidth > 0),
      imageNaturalWidth: image?.naturalWidth || 0,
      imageNaturalHeight: image?.naturalHeight || 0,
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
      setStatus('Listo.');
      emit('ready', { language: state.config.language, turbine: state.turbine, layout: 'two-column-v12' });
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
      root.innerHTML = `<div style="padding:24px;color:white;background:#1a0c10;font-family:sans-serif"><strong>FNS Avatar V12</strong><br>${String(error?.message || error)}</div>`;
      emit('boot-error', { error: String(error?.message || error) });
    }
  }

  // HTML already contains /assets/olivia-fechada.png, so Olivia is visible even before boot finishes.
  void boot();
})();
