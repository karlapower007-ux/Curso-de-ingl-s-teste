(() => {
  'use strict';

  const FACTORY_GUARD = 'FNS-AVATAR-FACTORY-V11';
  const root = document.getElementById('root');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const injected = window.__FNS_AVATAR_BOOTSTRAP__ || {};
  const slug = String(injected.slug || params.get('avatar') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);

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
    turbine: ''
  };

  const $ = (selector) => root.querySelector(selector);

  function emit(type, detail = {}) {
    window.dispatchEvent(new CustomEvent('fns:avatar:v11', {
      detail: { guard: FACTORY_GUARD, avatar: state.slug, type, ...detail }
    }));
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[ch]);
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

  function render() {
    const cfg = state.config;
    const turbines = Array.isArray(cfg.availableTurbines) ? cfg.availableTurbines : [];
    const options = turbines.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
    const ui = cfg.ui || {};

    root.innerHTML = `
      <main class="fns-avatar-shell" data-avatar="${esc(state.slug)}" data-guard="${FACTORY_GUARD}">
        <section class="fns-avatar-stage" aria-label="${esc(cfg.name)}">
          <div class="fns-avatar-badge"><strong>${esc(ui.title || cfg.name)}</strong><span>${esc(ui.subtitle || cfg.languageLabel || '')}</span></div>
          <img id="avatarImage" class="fns-avatar-image" src="${esc(cfg.images.closed)}" alt="${esc(cfg.name)}" draggable="false">
        </section>
        <section class="fns-avatar-panel">
          <div id="status" class="fns-avatar-status">Listo.</div>
          <div id="transcript" class="fns-avatar-transcript"></div>
          <div id="reply" class="fns-avatar-reply"></div>
          <form id="textForm" class="fns-avatar-controls" autocomplete="off">
            <button id="micBtn" type="button">${esc(ui.startListening || 'Hablar')}</button>
            <input id="textInput" type="text" inputmode="text" placeholder="${esc(ui.placeholder || 'Escribe…')}" aria-label="Mensaje">
            <select id="voiceTurbine" aria-label="Turbina de voz">${options}</select>
            <button id="sendBtn" type="submit">Enviar</button>
          </form>
        </section>
      </main>`;

    const savedTurbine = (() => {
      try { return localStorage.getItem(`fns-avatar-turbine-${state.slug}`) || ''; } catch (_) { return ''; }
    })();
    state.turbine = turbines.includes(savedTurbine) ? savedTurbine : (cfg.voiceTurbine || turbines[0] || '');
    if ($('#voiceTurbine')) $('#voiceTurbine').value = state.turbine;

    $('#textForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('#textInput');
      const text = String(input?.value || '').trim();
      if (!text) return;
      input.value = '';
      void sendMessage(text);
    });

    $('#micBtn')?.addEventListener('click', () => {
      if (state.recording) void stopRecording();
      else void startRecording();
    });

    $('#voiceTurbine')?.addEventListener('change', (event) => {
      state.turbine = String(event.target.value || cfg.voiceTurbine || '');
      try { localStorage.setItem(`fns-avatar-turbine-${state.slug}`, state.turbine); } catch (_) {}
      emit('turbine-change', { turbine: state.turbine });
    });
  }

  function setStatus(text) {
    const node = $('#status');
    if (node) node.textContent = String(text || '');
  }

  function setText(selector, text) {
    const node = $(selector);
    if (node) node.textContent = String(text || '');
  }

  function setBusy(value) {
    state.busy = !!value;
    const send = $('#sendBtn');
    if (send) send.disabled = state.busy;
  }

  function setFrame(name) {
    const cfg = state.config;
    const image = $('#avatarImage');
    if (!cfg || !image) return;
    const map = cfg.images || {};
    const next = map[name] || map.closed;
    if (!next) return;
    if (image.getAttribute('src') !== next) image.setAttribute('src', next);
    state.frame = name;
  }

  function setMode(mode, detail = {}) {
    state.mode = mode;
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
    setText('#transcript', `Tú: ${text}`);
    setText('#reply', '');
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
      setText('#reply', `${cfg.name}: ${state.lastReply}`);
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
      const btn = $('#micBtn');
      if (btn) btn.textContent = state.config?.ui?.stopListening || 'Detener';
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
    const btn = $('#micBtn');
    if (btn) btn.textContent = state.config?.ui?.startListening || 'Hablar';
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
    return {
      guard: FACTORY_GUARD,
      avatar: state.slug,
      isolatedRoot: root.dataset.fnsAvatarRoot === 'isolated-v11',
      emmaAppLoaded: !!document.querySelector('script[src*="/app.js"]'),
      mode: state.mode,
      frame: state.frame,
      language: state.config?.language || '',
      turbine: state.turbine,
      thresholds: state.config?.thresholds || null,
      image: $('#avatarImage')?.getAttribute('src') || '',
      recording: state.recording,
      busy: state.busy
    };
  }

  async function boot() {
    try {
      await loadConfig();
      state.sessionId = sessionId();
      render();
      setMode('idle');
      emit('ready', { language: state.config.language, turbine: state.turbine });
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
      root.innerHTML = `<div class="fns-avatar-error"><strong>FNS Avatar Factory</strong><br>${esc(error?.message || error)}</div>`;
      emit('boot-error', { error: String(error?.message || error) });
    }
  }

  void boot();
})();
