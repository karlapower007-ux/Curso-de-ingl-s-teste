/* Professores IA — local-first PWA client.
   Local pedagogical state stays in localStorage. Raw microphone audio is never persisted. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#main');
  const toastEl = $('#toast');
  const connectionBadge = $('#connectionBadge');
  const installBtn = $('#installBtn');

  const TEACHERS = {
    original: {
      name: 'Lily', label: 'A Ríspida', language: 'Inglês americano + português', accent: 'Americano',
      avatar: '/static/avatars/lily-main.jpg', slug: 'lily',
      personality: 'Direta, exigente, sincera e mais ríspida. Tem humor seco, provoca, corrige bastante e não infantiliza você.',
      correction: 'Intensa, objetiva e franca; pode brincar ou demonstrar impaciência leve sem humilhar.'
    },
    british: {
      name: 'Oliver', label: 'O Britânico', language: 'Inglês britânico + português', accent: 'Britânico',
      avatar: '/static/avatars/oliver-main.jpg', slug: 'oliver',
      personality: 'Simpático, elegante, inteligente, paciente e com humor britânico leve.',
      correction: 'Preciso e educado; mostra diferenças UK/US quando fizer sentido.'
    },
    american: {
      name: 'Sara', label: 'A Americana', language: 'Inglês americano + português', accent: 'Americano',
      avatar: '/static/avatars/sara-main.jpg', slug: 'sara',
      personality: 'Americana simpática, alegre, calorosa, paciente e encorajadora. Conversa como uma amiga real.',
      correction: 'Gentil, prática, contemporânea e ótima para gírias e situações reais.'
    },
    latina: {
      name: 'Sofía', label: 'A Espanhola', language: 'Espanhol + português', accent: 'Espanhol',
      avatar: '/static/avatars/sofia-main.jpg', slug: 'sofia',
      personality: 'Espanhola simpática, expressiva, energética e comunicativa. Ensina espanhol e também fala português como apoio.',
      correction: 'Leve e clara; explica diferenças regionais e de registro com naturalidade.'
    },
  };

  const DEFAULT_STATE = {
    teacher: 'american', level: 'A1', correction: 'balanced', subtitles: true, sounds: true,
    map: {}, vocab: {}, phrases: {}, situations: {}, favourites: {},
    histories: { original: [], british: [], american: [], latina: [] },
    sessionCount: 0, lastUsedAt: null,
  };

  let state = loadState();
  let config = null;
  let mapData = [];
  let situationsData = [];
  let wordsData = { items: [] };
  let phrasesData = { items: [] };
  let currentRoute = location.hash.replace('#/', '') || 'home';
  let deferredInstall = null;
  let voice = null;
  let avatarController = null;

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem('professoresIA.state') || '{}');
      return { ...structuredClone(DEFAULT_STATE), ...raw, histories: { ...DEFAULT_STATE.histories, ...(raw.histories || {}) } };
    } catch (_) { return structuredClone(DEFAULT_STATE); }
  }
  function saveState() {
    state.lastUsedAt = new Date().toISOString();
    localStorage.setItem('professoresIA.state', JSON.stringify(state));
  }
  function esc(v = '') { return String(v).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
  function toast(msg, ms = 2600) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms); }
  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
  function statusLabel(s) { return ({ practice: 'Quero praticar', progress: 'Em progresso', done: 'Confortável' })[s] || 'Não marcado'; }
  function langLabel(l) { return l === 'spanish' ? 'Espanhol' : 'Inglês'; }

  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    let data = null;
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(data?.detail || data?.message || `Erro ${r.status}`);
    return data;
  }

  async function bootstrap() {
    try {
      [config, mapData, situationsData, wordsData, phrasesData] = await Promise.all([
        fetchJSON('/api/config'), fetchJSON('/static/data/map.json'), fetchJSON('/static/data/situations.json'),
        fetchJSON('/static/data/words.json'), fetchJSON('/static/data/phrases.json')
      ]);
      updateConnectionBadge();
    } catch (e) {
      console.error(e); connectionBadge.textContent = 'local'; connectionBadge.className = 'status-pill demo';
      toast('Parte dos dados não pôde ser carregada.');
    }
    bindGlobal();
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/static/sw.js').catch(() => {});
  }

  function bindGlobal() {
    document.addEventListener('click', e => {
      const route = e.target.closest('[data-route]')?.dataset.route;
      if (route) { e.preventDefault(); go(route); }
    });
    window.addEventListener('hashchange', () => { currentRoute = location.hash.replace('#/', '') || 'home'; render(); });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; installBtn.hidden = false; });
    installBtn.addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; installBtn.hidden = true; });
  }

  function go(route) {
    if (voice && route !== 'conversation') stopVoice();
    if (avatarController && route !== 'conversation') { avatarController.destroy(); avatarController = null; }
    location.hash = '#/' + route;
  }
  function updateNav() { $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.route === currentRoute)); }
  function updateConnectionBadge() {
    if (!config) return;
    connectionBadge.textContent = config.provider_ready ? 'IA ao vivo' : 'modo local';
    connectionBadge.className = 'status-pill ' + (config.provider_ready ? 'online' : 'demo');
  }

  function render() {
    updateNav();
    const routes = { home: renderHome, conversation: renderConversation, map: renderMap, situations: renderSituations, words: renderWords, phrases: renderPhrases, progress: renderProgress, costs: renderCosts, settings: renderSettings, plan: renderPlan };
    (routes[currentRoute] || renderHome)();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function heroProgress() {
    const nodes = mapData.flatMap(x => x.nodes || []);
    return pct(nodes.filter(n => state.map[n.id] === 'done').length, nodes.length);
  }

  function renderHome() {
    const progress = heroProgress();
    main.innerHTML = `
      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow">IMERSÃO CONVERSACIONAL</span>
          <h1>Aprenda falando com <em>pessoas</em>, não fazendo prova.</h1>
          <p>Escolha seu professor, converse por texto ou voz, mude para português quando travar e volte naturalmente ao idioma-alvo.</p>
          <div class="hero-actions">
            <button class="btn primary" id="continueBtn">Conversar agora</button>
            <button class="btn ghost" data-route="map">Explorar Mapa da Fluência</button>
          </div>
          <div class="hero-meta"><span>A1 → C2 sem trava</span><span>Dados pedagógicos locais</span><span>Inglês + espanhol</span></div>
        </div>
        <div class="hero-progress"><div class="progress-ring" style="--p:${progress}"><strong>${progress}%</strong></div><small>conclusão do mapa<br><b>não é “% de fluência”</b></small></div>
      </section>
      <section class="section-head"><div><span class="eyebrow">ESCOLHA QUEM VAI CONVERSAR COM VOCÊ</span><h2>Quatro personalidades de verdade</h2></div></section>
      <div class="teacher-grid">${Object.entries(TEACHERS).map(([id,t]) => teacherCard(id,t)).join('')}</div>
      <section class="section-head compact"><div><span class="eyebrow">ATALHOS</span><h2>O que você quer praticar?</h2></div></section>
      <div class="quick-grid">
        <button class="quick-card" data-route="situations"><b>◈ Situações reais</b><span>${situationsData.reduce((n,c)=>n+(c.items?.length||0),0)} cenários locais para iniciar conversas.</span></button>
        <button class="quick-card" data-route="words"><b>Aa 1.000 itens lexicais</b><span>Palavras e padrões úteis, pesquisáveis offline.</span></button>
        <button class="quick-card" data-route="phrases"><b>❝ 1.000 frases</b><span>Padrões conversacionais prontos para praticar.</span></button>
      </div>`;
    $('#continueBtn').onclick = () => go('conversation');
    $$('.teacher-card').forEach(card => card.onclick = () => { state.teacher = card.dataset.teacher; saveState(); go('conversation'); });
  }

  function teacherCard(id, t) {
    return `<button class="teacher-card ${state.teacher===id?'selected':''}" data-teacher="${id}">
      <span class="teacher-badge">${esc(t.accent)}</span><img src="${t.avatar}" alt="Avatar de ${esc(t.name)}" loading="lazy">
      <div class="teacher-info"><h3>${esc(t.name)}</h3><small>${esc(t.language)}</small><p>${esc(t.personality)}</p></div>
    </button>`;
  }

  function renderConversation() {
    const t = TEACHERS[state.teacher];
    const hist = state.histories[state.teacher] || [];
    main.innerHTML = `<div class="conversation-layout">
      <section class="avatar-stage" id="avatarStage">
        <span class="avatar-state" id="avatarState">PRONTO PARA CONVERSAR</span>
        <div class="avatar-rig" id="avatarRig" data-teacher="${state.teacher}">
          <div class="avatar-aura"></div>
          <div class="performance-stack">
            <img id="avatarPortrait" class="avatar-portrait" src="${t.avatar}" alt="${esc(t.name)}">
            <div class="face-patch-system" aria-hidden="true">
              <span class="face-patch eye-patch" data-face-patch="eye-left"><img src="${t.avatar}" alt=""></span>
              <span class="face-patch eye-patch" data-face-patch="eye-right"><img src="${t.avatar}" alt=""></span>
              <span class="face-patch brow-patch" data-face-patch="brow-left"><img src="${t.avatar}" alt=""></span>
              <span class="face-patch brow-patch" data-face-patch="brow-right"><img src="${t.avatar}" alt=""></span>
            </div>
            <img id="avatarViseme" class="viseme-layer" src="/static/avatars/visemes/${t.slug}/REST.webp" alt="" aria-hidden="true">
          </div>
          <div class="breath-pulse" aria-hidden="true"></div>
          <div class="emotion-live"><span class="emotion-dot"></span><span id="emotionLabel">Neutra</span></div>
        </div>
        <h2>${esc(t.name)}</h2><p>${esc(t.personality)}</p>
        <div class="motor-signature">Performance Engine v1.7 de <b>${esc(t.name)}</b> · rig contínuo, coarticulação, olhar, piscadas, respiração, microexpressões e personalidade corporal em paralelo</div>
        <div class="voice-controls">
          <button class="btn ghost" id="switchTeacher">Trocar professor</button>
          <button class="mic-btn" id="micBtn" title="Iniciar conversa por voz">🎙</button>
          <button class="btn ghost" id="muteBtn" disabled>🔇 Parar</button>
        </div>
        <details class="emotion-tester"><summary>Testar motor emocional</summary>
          <div class="emotion-buttons">
            <button type="button" data-emotion="smile">🙂 Sorriso</button>
            <button type="button" data-emotion="joy">✨ Alegria</button>
            <button type="button" data-emotion="laugh">😂 Riso</button>
            <button type="button" data-emotion="sad">😢 Tristeza</button>
            <button type="button" data-emotion="angry">😠 Raiva</button>
            <button type="button" data-emotion="surprise">😮 Surpresa</button>
            <button type="button" data-emotion="thinking">🤔 Pensando</button>
            <button type="button" data-emotion="sigh">💨 Suspiro</button>
          </div>
          <div class="viseme-tester" aria-label="Teste de sincronização labial">
            <span>Visemas:</span>
            ${['A','E','I','O','U','MBP','FV','L','TH','SZ','SHCH'].map(v=>`<button type="button" data-viseme-test="${v}">${v}</button>`).join('')}
          </div>
          <div class="face-tester" aria-label="Teste dos olhos e sobrancelhas">
            <span>Olhos:</span>
            <button type="button" data-face-test="left">← olhar</button>
            <button type="button" data-face-test="center">centro</button>
            <button type="button" data-face-test="right">olhar →</button>
            <button type="button" data-face-test="up">↑ pensar</button>
            <button type="button" data-face-test="blink">piscar</button>
            <button type="button" data-face-test="wink">piscar 1 olho</button>
            <button type="button" data-face-test="brow">sobrancelha</button>
          </div>
          <div class="performance-lab" aria-label="Demonstrações de aceitação v1.7">
            <strong>Performance Lab v1.7 — camadas simultâneas</strong>
            <div class="lab-buttons">
              <button type="button" data-demo="idle">IDLE 30 s</button>
              <button type="button" data-demo="listening">LISTENING 20 s</button>
              <button type="button" data-demo="speaking">SPEAKING 12 s</button>
              <button type="button" data-demo="transition">Transição emocional</button>
              <button type="button" data-demo="repeated-error">Erro ×4</button>
              <button type="button" data-demo="long">Conversa 3 min</button>
            </div>
            <div id="performanceLabStatus" class="performance-lab-status">Escolha um teste. Boca, emoção, olhos, cabeça e respiração continuam ativos ao mesmo tempo.</div>
          </div>
        </details>
        <small class="microcopy">O áudio do microfone é transmitido para a IA somente durante uma sessão de voz e não é salvo localmente pelo app.</small>
      </section>
      <section class="chat-panel">
        <div class="chat-top"><div class="chat-top-left"><b>Conversa com ${esc(t.name)}</b><span class="chip teal">${esc(t.language)}</span></div>
          <div><label class="sr-only" for="levelSelect">Nível</label><select id="levelSelect">${['A1','A2','B1','B2','C1','C2'].map(l=>`<option ${state.level===l?'selected':''}>${l}</option>`).join('')}</select></div>
        </div>
        <div id="messages" class="messages">${hist.length ? hist.map(messageHTML).join('') : `<div class="msg system">Fale sobre o que quiser. Se travar, use português. ${config?.provider_ready ? 'A voz em tempo real está disponível.' : 'Sem credenciais da Alibaba, texto funciona em demonstração local; a voz ao vivo fica desativada.'}</div>`}</div>
        <form id="composer" class="composer"><textarea id="chatInput" placeholder="Digite aqui — ou use o microfone…" rows="1"></textarea><button class="send-btn" title="Enviar">➤</button></form>
      </section>
    </div>`;
    $('#levelSelect').onchange = e => { state.level = e.target.value; saveState(); };
    $('#switchTeacher').onclick = showTeacherPicker;
    $('#composer').onsubmit = e => { e.preventDefault(); sendText(); };
    $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } });
    $('#micBtn').onclick = () => voice?.active ? stopVoice() : startVoice();
    $('#muteBtn').onclick = stopVoice;
    if (avatarController) avatarController.destroy();
    const Avatar = window.ProfessoresAvatar;
    avatarController = new Avatar.AvatarController({
      teacherId: state.teacher,
      rig: $('#avatarRig'), img: $('#avatarPortrait'), visemeImg: $('#avatarViseme'), label: $('#emotionLabel'), status: $('#avatarState'),
      storage: window.localStorage
    }).mount();
    $$('[data-emotion]').forEach(btn => btn.onclick = () => {
      const map = {smile:'happy', joy:'excited', laugh:'amused', sad:'sad', angry:'annoyed', surprise:'surprised', thinking:'thinking', sigh:'disappointed'};
      const e = map[btn.dataset.emotion] || 'neutral';
      avatarController?.setEmotion(e, e==='annoyed' ? .68 : e==='excited' ? .76 : .58, 'manual-test');
      if (btn.dataset.emotion === 'laugh') avatarController?.laugh(.68);
      if (btn.dataset.emotion === 'sigh') avatarController?.sigh(.50);
    });
    $$('[data-viseme-test]').forEach(btn => btn.onclick = () => {
      avatarController?.startSpeaking();
      avatarController?.feedTimedViseme(btn.dataset.visemeTest, .82);
      setTimeout(() => avatarController?.feedTimedViseme('REST', 0), 520);
      setTimeout(() => avatarController?.stopSpeaking(), 700);
    });
    $$('[data-face-test]').forEach(btn => btn.onclick = () => {
      const a = btn.dataset.faceTest;
      if (a === 'left') avatarController?.lookAt(-.85, .02);
      if (a === 'center') avatarController?.lookAt(0, 0);
      if (a === 'right') avatarController?.lookAt(.85, .02);
      if (a === 'up') avatarController?.lookAt(.22, -.82);
      if (a === 'blink') avatarController?.blink();
      if (a === 'wink') avatarController?.blinkLeft();
      if (a === 'brow') { avatarController?.setEmotion('curious', .78, 'manual-face-test'); setTimeout(()=>avatarController?.setEmotion('neutral', .32, 'manual-face-reset'), 900); }
      if (['left','right','up'].includes(a)) setTimeout(()=>avatarController?.lookAt(0,0), 900);
    });
    $$('[data-demo]').forEach(btn => btn.onclick = () => {
      $$('[data-demo]').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
      const kind=btn.dataset.demo; const status=$('#performanceLabStatus');
      const labels={idle:'IDLE real por 30 segundos',listening:'LISTENING por 20 segundos',speaking:'SPEAKING com camadas simultâneas por 12 segundos',transition:'neutral → happy → surprised → annoyed → neutral', 'repeated-error':'reação ao quarto erro conforme a personalidade', long:'sequência longa de 3 minutos para observar repetição'};
      if(status) status.textContent=`Executando: ${labels[kind]||kind}. Observe olhos, boca, cabeça, respiração e emoção ao mesmo tempo.`;
      const ms=avatarController?.runDemo(kind,(metrics)=>{btn.classList.remove('active');if(status)status.textContent=`Concluído. Frames: ${metrics?.frames||0} · piscadas: ${metrics?.blinks||0} · olhares: ${(metrics?.gazeStates||[]).join(', ')||'—'} · microexpressões: ${(metrics?.micro||[]).join(', ')||'—'}.`;})||0;
      if(!ms){btn.classList.remove('active');if(status)status.textContent='Este teste não pôde ser iniciado.';}
    });
    scrollMessages();
  }

  function messageHTML(m) { return `<div class="msg ${m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system'}">${esc(m.content)}</div>`; }
  function appendMessage(role, content, persist = true) {
    const box = $('#messages'); if (!box) return;
    const div = document.createElement('div'); div.className = `msg ${role}`; div.textContent = content; box.appendChild(div); scrollMessages();
    if (persist && (role === 'user' || role === 'assistant')) {
      const h = state.histories[state.teacher] ||= []; h.push({ role, content: String(content).slice(0,3000), at: new Date().toISOString() });
      state.histories[state.teacher] = h.slice(-30); saveState();
    }
  }
  function scrollMessages() { const box = $('#messages'); if (box) box.scrollTop = box.scrollHeight; }

  async function sendText() {
    const input = $('#chatInput'); const message = input?.value.trim(); if (!message) return;
    input.value = ''; appendMessage('user', message);
    avatarController?.reactToUser(message);
    avatarController?.mode('thinking');
    const typing = document.createElement('div'); typing.className='msg assistant typing'; typing.textContent='pensando…'; $('#messages').appendChild(typing); scrollMessages();
    try {
      const history = (state.histories[state.teacher] || []).slice(-12,-1).map(x=>({role:x.role,content:x.content}));
      const data = await fetchJSON('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ teacher_id:state.teacher, level:state.level, correction:state.correction, message, history }) });
      typing.remove(); appendMessage('assistant', data.text || '…');
      if (data.avatar_plan) avatarController?.applyExternalPlan(data.avatar_plan);
      else avatarController?.reactToAssistant(data.text || '');
      state.sessionCount += 1; saveState();
      if (!data.demo) refreshConfigQuiet();
    } catch (e) { typing.remove(); avatarController?.setEmotion('disappointed', .55, 'error'); appendMessage('system', 'Não consegui responder: ' + e.message, false); }
  }

  function setAvatarState(kind, text) {
    const stage = $('#avatarStage'), label = $('#avatarState'); if (!stage || !label) return;
    stage.classList.remove('listening','thinking','speaking'); if (kind) stage.classList.add(kind); label.textContent = text;
    avatarController?.mode(kind === 'neutral' ? 'idle' : (kind || 'idle'));
  }

  // ----- Realtime audio -----
  async function startVoice() {
    if (!config?.provider_ready) { toast('Para voz ao vivo, execute “Configurar Alibaba Cloud” instalado com o aplicativo.', 4200); return; }
    if (!navigator.mediaDevices?.getUserMedia) { toast('Este navegador não liberou acesso ao microfone.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
      const AC = window.AudioContext || window.webkitAudioContext;
      const inputCtx = new AC();
      const outputCtx = new AC({ sampleRate: 24000 });
      await inputCtx.resume(); await outputCtx.resume();
      const source = inputCtx.createMediaStreamSource(stream);
      // ScriptProcessor is intentionally used for a dependency-free PWA prototype. It can be replaced by AudioWorklet later.
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      const silent = inputCtx.createGain(); silent.gain.value = 0;
      source.connect(processor); processor.connect(silent); silent.connect(inputCtx.destination);
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/ws/realtime/${state.teacher}?level=${encodeURIComponent(state.level)}&correction=${encodeURIComponent(state.correction)}`);
      ws.binaryType = 'arraybuffer';
      voice = { active:true, stream, inputCtx, outputCtx, source, processor, silent, ws, queueTime:0, sources:[], assistantTranscript:'', userTranscript:'', speaking:false, currentResponseId:'', cancelledResponseId:'' };
      $('#micBtn').classList.add('live'); $('#micBtn').textContent='●'; $('#muteBtn').disabled=false; setAvatarState('listening','OUVINDO');
      ws.onopen = () => { processor.onaudioprocess = ev => { if (!voice?.active || ws.readyState!==1) return; const samples=ev.inputBuffer.getChannelData(0); const pcm=resampleToPCM16(samples,inputCtx.sampleRate,16000); if(pcm.byteLength) ws.send(pcm); }; };
      ws.onmessage = ev => { try { handleRealtimeEvent(JSON.parse(ev.data)); } catch (_) {} };
      ws.onclose = () => { if (voice?.active) { toast('Sessão de voz encerrada.'); stopVoice(false); } };
      ws.onerror = () => toast('Falha na conexão de voz em tempo real.');
    } catch (e) { console.error(e); toast('Não foi possível iniciar o microfone: ' + e.message, 4000); stopVoice(false); }
  }

  function resampleToPCM16(input, inputRate, targetRate) {
    const ratio = inputRate / targetRate; const outLen = Math.max(1, Math.round(input.length / ratio)); const out = new Int16Array(outLen);
    for (let i=0;i<outLen;i++) { const start=Math.floor(i*ratio), end=Math.min(input.length,Math.floor((i+1)*ratio)); let sum=0,n=0; for(let j=start;j<end;j++){sum+=input[j];n++;} const s=Math.max(-1,Math.min(1,n?sum/n:input[start]||0)); out[i]=s<0?s*0x8000:s*0x7fff; }
    return out.buffer;
  }
  function b64ToInt16(b64) { const bin=atob(b64), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return new Int16Array(u8.buffer); }
  function playPCMChunk(b64) {
    if (!voice?.active || !b64) return; const samples=b64ToInt16(b64); avatarController?.feedPCM16(samples); const ctx=voice.outputCtx; const buf=ctx.createBuffer(1,samples.length,24000); const ch=buf.getChannelData(0); for(let i=0;i<samples.length;i++) ch[i]=samples[i]/32768;
    const src=ctx.createBufferSource(); src.buffer=buf; src.connect(ctx.destination); const now=ctx.currentTime; const at=Math.max(now+0.02,voice.queueTime||now); src.start(at); voice.queueTime=at+buf.duration; voice.sources.push(src); src.onended=()=>{ if(voice) voice.sources=voice.sources.filter(x=>x!==src); };
  }
  function clearPlayback() { if(!voice)return; for(const s of voice.sources||[]){try{s.stop();}catch(_){}} voice.sources=[]; voice.queueTime=voice.outputCtx?.currentTime||0; }

  function handleRealtimeEvent(ev) {
    const type = ev.type || '';
    if (type === 'app.error' || type === 'error') { toast(ev.message || ev.error?.message || 'Erro na sessão de voz', 4500); return; }
    if (type === 'input_audio_buffer.speech_started') {
      if (voice?.speaking) {
        voice.interrupted = true; voice.speaking = false; voice.assistantTranscript=''; voice.lastAssistantText='';
        voice.cancelledResponseId = voice.currentResponseId || voice.cancelledResponseId || '__active__';
        clearPlayback(); avatarController?.stopSpeaking();
        if(voice.ws.readyState===1) voice.ws.send(JSON.stringify({type:'app.cancel'}));
      }
      setAvatarState('listening','OUVINDO');
    } else if (type === 'input_audio_buffer.speech_stopped') setAvatarState('thinking','PENSANDO');
    else if (type === 'conversation.item.input_audio_transcription.delta') {
      const txt = `${ev.text||''}${ev.stash||''}`.trim();
      let part = document.querySelector('.msg.user.partial-live');
      if (txt) {
        if (!part) { part=document.createElement('div'); part.className='msg user partial-live'; part.setAttribute('aria-live','polite'); $('#messages')?.appendChild(part); }
        part.textContent=txt+' …'; scrollMessages();
      }
    } else if (type === 'conversation.item.input_audio_transcription.completed') {
      document.querySelector('.msg.user.partial-live')?.remove();
      const txt = ev.transcript || ev.item?.content?.[0]?.transcript; if(txt) appendMessage('user', txt);
    } else if (type === 'conversation.item.input_audio_transcription.failed') {
      document.querySelector('.msg.user.partial-live')?.remove();
    } else if (type === 'response.created') {
      if (voice) voice.currentResponseId = ev.response?.id || ev.response_id || '';
    } else if (type === 'response.audio.delta') {
      const rid = ev.response_id || voice?.currentResponseId || '';
      if (voice?.cancelledResponseId && (voice.cancelledResponseId === '__active__' || rid === voice.cancelledResponseId)) return;
      if(voice){voice.speaking=true;voice.interrupted=false;} setAvatarState('speaking','FALANDO'); avatarController?.startSpeaking(); playPCMChunk(ev.delta);
    }
    else if (type === 'response.audio_transcript.delta') {
      const rid = ev.response_id || voice?.currentResponseId || '';
      if (voice?.cancelledResponseId && (voice.cancelledResponseId === '__active__' || rid === voice.cancelledResponseId)) return;
      if(voice) voice.assistantTranscript += ev.delta || '';
    }
    else if (type === 'response.audio.viseme' || type === 'response.viseme') { avatarController?.feedTimedViseme(ev.viseme || ev.value || 'REST', ev.strength ?? .75); }
    else if (type === 'response.audio.phonemes' || type === 'response.phonemes') { avatarController?.feedPhonemeTimeline(ev.phonemes || ev.items || [], performance.now()); }
    else if (type === 'response.audio_transcript.done') {
      const rid = ev.response_id || voice?.currentResponseId || '';
      if (voice?.cancelledResponseId && (voice.cancelledResponseId === '__active__' || rid === voice.cancelledResponseId)) return;
      const txt = ev.transcript || voice?.assistantTranscript;
      if(txt) { appendMessage('assistant', txt); if (voice) voice.lastAssistantText = txt; }
      if(voice) voice.assistantTranscript='';
    } else if (type === 'response.audio.done' || type === 'response.done') {
      const rid = ev.response?.id || ev.response_id || voice?.currentResponseId || '';
      const wasCancelled = !!voice?.cancelledResponseId && (voice.cancelledResponseId === '__active__' || rid === voice.cancelledResponseId);
      const interrupted = wasCancelled || !!voice?.interrupted;
      const last = interrupted ? '' : (voice?.lastAssistantText || '');
      if(voice) {
        voice.speaking=false; voice.lastAssistantText=''; voice.interrupted=false;
        if (wasCancelled) voice.cancelledResponseId='';
        if (type === 'response.done' && (!rid || rid === voice.currentResponseId)) voice.currentResponseId='';
      }
      avatarController?.stopSpeaking();
      if (last) avatarController?.reactToAssistant(last, {after:'listening'});
      else setAvatarState('listening','OUVINDO');
      if(type==='response.done') refreshConfigQuiet();
    }
  }
  function stopVoice(closeSocket = true) {
    if (!voice) return;
    const v=voice; voice=null; try{v.processor.onaudioprocess=null;v.processor.disconnect();}catch(_){} try{v.source.disconnect();}catch(_){} try{v.silent.disconnect();}catch(_){}
    for(const tr of v.stream?.getTracks?.()||[]) tr.stop(); for(const s of v.sources||[]){try{s.stop();}catch(_){}}
    try{v.inputCtx?.close();}catch(_){} try{v.outputCtx?.close();}catch(_){} if(closeSocket&&v.ws?.readyState===1) try{v.ws.close(1000,'user stop');}catch(_){}
    const mic=$('#micBtn'), mute=$('#muteBtn'); if(mic){mic.classList.remove('live');mic.textContent='🎙';} if(mute)mute.disabled=true; setAvatarState('', 'PRONTO PARA CONVERSAR'); avatarController?.mode('idle');
  }

  function showTeacherPicker() {
    const modal=document.createElement('div'); modal.className='modal'; modal.innerHTML=`<div class="modal-card"><button class="modal-close">×</button><h2>Trocar de professor</h2><p class="page-sub">Trocar deve parecer trocar de pessoa — cada um preserva sua própria personalidade.</p><div class="teacher-grid mini">${Object.entries(TEACHERS).map(([id,t])=>teacherCard(id,t)).join('')}</div></div>`; document.body.appendChild(modal);
    $('.modal-close',modal).onclick=()=>modal.remove(); $$('.teacher-card',modal).forEach(c=>c.onclick=()=>{stopVoice();state.teacher=c.dataset.teacher;saveState();modal.remove();renderConversation();}); modal.onclick=e=>{if(e.target===modal)modal.remove();};
  }

  // ----- Fluency map -----
  function renderMap() {
    const total=mapData.reduce((n,l)=>n+l.nodes.length,0), done=Object.values(state.map).filter(x=>x==='done').length;
    main.innerHTML=`<h1 class="page-title">Mapa da Fluência A1–C2</h1><p class="page-sub">Uma bússola visual: você pode tocar em qualquer competência e praticar agora. <b>${pct(done,total)}%</b> significa conclusão deste mapa — não uma medição científica absoluta de fluência.</p>
      <div class="map-legend"><span class="chip">○ Quero praticar</span><span class="chip gold">◐ Em progresso</span><span class="chip teal">● Confortável</span></div>
      <div class="map-path">${mapData.map((l,i)=>`<section class="level-zone" style="--level-color:${l.color}"><div class="level-header"><div><span class="eyebrow">ETAPA ${i+1}</span><h3>${esc(l.level)} · ${esc(l.title)}</h3></div><span>${levelPct(l)}%</span></div><p>${esc(l.description)}</p><div class="node-grid">${l.nodes.map(n=>`<button class="map-node ${state.map[n.id]||''}" data-node="${n.id}" data-level="${l.level}"><b>${esc(n.title)}</b><small>${statusLabel(state.map[n.id])}</small></button>`).join('')}</div></section>`).join('')}</div>`;
    $$('.map-node').forEach(b=>b.onclick=()=>openMapNode(b.dataset.node,b.dataset.level));
  }
  function levelPct(level){return pct(level.nodes.filter(n=>state.map[n.id]==='done').length,level.nodes.length);}
  function findNode(id){for(const l of mapData){const n=l.nodes.find(x=>x.id===id);if(n)return{node:n,level:l};}return null;}
  function openMapNode(id, level) {
    const hit=findNode(id); if(!hit)return; const {node}=hit; const modal=document.createElement('div');modal.className='modal';modal.innerHTML=`<div class="modal-card"><button class="modal-close">×</button><span class="eyebrow">${esc(level)}</span><h2>${esc(node.title)}</h2><p>${esc(node.description||'Pratique esta competência dentro de uma conversa real.')}</p><div class="toolbar"><button class="btn ${state.map[id]==='practice'?'primary':'ghost'}" data-status="practice">Quero praticar</button><button class="btn ${state.map[id]==='progress'?'primary':'ghost'}" data-status="progress">Em progresso</button><button class="btn ${state.map[id]==='done'?'primary':'ghost'}" data-status="done">Me sinto confortável</button></div><button class="btn primary wide" id="practiceNode">Praticar com meu professor</button></div>`;document.body.appendChild(modal);
    $('.modal-close',modal).onclick=()=>modal.remove(); $$('[data-status]',modal).forEach(b=>b.onclick=()=>{state.map[id]=b.dataset.status;saveState();modal.remove();renderMap();}); $('#practiceNode',modal).onclick=()=>{state.map[id]='progress';saveState();queuePractice(`Quero praticar ${node.title} no nível ${level}. Crie uma conversa real e espontânea focada nisso.`);modal.remove();};
  }
  function queuePractice(text){ sessionStorage.setItem('professoresIA.practicePrompt',text); go('conversation'); setTimeout(()=>{const input=$('#chatInput');if(input){input.value=text;input.focus();}},50); }

  // ----- Situations -----
  function renderSituations() {
    main.innerHTML=`<h1 class="page-title">Situações da vida real</h1><p class="page-sub">Escolha uma situação e entre nela com seu professor. O catálogo é local e expansível, sem custo por abrir ou navegar.</p><div class="toolbar"><input id="sitSearch" type="search" placeholder="Buscar: aeroporto, farmácia, namoro…"><select id="sitCat"><option value="">Todas as categorias</option>${situationsData.map(c=>`<option>${esc(c.category)}</option>`).join('')}</select></div><div id="sitList"></div>`;
    const draw=()=>{const q=$('#sitSearch').value.toLowerCase(),cat=$('#sitCat').value; const cats=situationsData.filter(c=>!cat||c.category===cat).map(c=>({...c,items:c.items.filter(x=>(x.title+' '+(x.description||'')).toLowerCase().includes(q))})).filter(c=>c.items.length); $('#sitList').innerHTML=cats.map(c=>`<section class="panel"><h3>${c.icon||'◈'} ${esc(c.category)}</h3><div class="list-grid">${c.items.map(item=>`<article class="list-card"><h3>${esc(item.title)}</h3><p>${esc(item.description||'Conversa guiada por contexto real.')}</p><div class="actions"><button class="btn small primary" data-situation="${item.id}" data-title="${esc(item.title)}">Praticar agora</button>${state.situations[item.id]?'<span class="chip teal">praticado</span>':''}</div></article>`).join('')}</div></section>`).join('')||'<div class="empty">Nenhuma situação encontrada.</div>'; $$('[data-situation]').forEach(b=>b.onclick=()=>{state.situations[b.dataset.situation]=(state.situations[b.dataset.situation]||0)+1;saveState();queuePractice(`Vamos simular uma situação real: ${b.dataset.title}. Fale comigo no idioma-alvo como se estivéssemos realmente nessa situação.`);});}; $('#sitSearch').oninput=draw;$('#sitCat').onchange=draw;draw();
  }

  // ----- Words / phrases -----
  function renderWords() {
    main.innerHTML=`<h1 class="page-title">1.000 itens lexicais</h1><p class="page-sub">Lista local de alta utilidade: palavra + padrão lexical em inglês e espanhol. É uma referência prática, não um ranking universal “cientificamente comprovado”.</p><div class="toolbar"><input id="wordSearch" type="search" placeholder="Buscar palavra ou tradução"><select id="wordLang"><option value="">Inglês + espanhol</option><option value="english">Inglês</option><option value="spanish">Espanhol</option></select><select id="wordStatus"><option value="">Todos os estados</option><option value="known">Já conheço</option><option value="practice">Quero praticar</option><option value="hard">Difícil</option></select></div><div id="wordList" class="list-grid"></div><div class="pager"><button class="btn ghost" id="wordMore">Mostrar mais</button></div>`;
    let limit=60; const draw=()=>{const q=$('#wordSearch').value.toLowerCase(),lang=$('#wordLang').value,st=$('#wordStatus').value; const all=wordsData.items.filter(x=>(!lang||x.language===lang)&&(!st||state.vocab[x.id]===st)&&(!q||(x.term+' '+x.translation).toLowerCase().includes(q))); $('#wordList').innerHTML=all.slice(0,limit).map(wordCard).join('')||'<div class="empty">Nada encontrado.</div>'; $('#wordMore').hidden=all.length<=limit; bindWordActions();}; $('#wordSearch').oninput=()=>{limit=60;draw();};$('#wordLang').onchange=()=>{limit=60;draw();};$('#wordStatus').onchange=()=>{limit=60;draw();};$('#wordMore').onclick=()=>{limit+=60;draw();};draw();
  }
  function wordCard(x){const st=state.vocab[x.id];return `<article class="list-card"><span class="chip">${langLabel(x.language)} · ${esc(x.level)}</span><div class="vocab-word">${esc(x.term)}</div><div class="vocab-translation">${esc(x.translation)}</div><div class="vocab-example">${esc(x.example)}</div><div class="actions"><button class="btn tiny ${st==='known'?'primary':'ghost'}" data-vocab="${x.id}" data-vstate="known">✓ sei</button><button class="btn tiny ${st==='practice'?'primary':'ghost'}" data-vocab="${x.id}" data-vstate="practice">↻ praticar</button><button class="btn tiny ${st==='hard'?'primary':'ghost'}" data-vocab="${x.id}" data-vstate="hard">! difícil</button><button class="btn tiny ghost" data-practice-word="${x.id}">Conversar</button></div></article>`;}
  function bindWordActions(){ $$('[data-vocab]').forEach(b=>b.onclick=()=>{state.vocab[b.dataset.vocab]=b.dataset.vstate;saveState();renderWords();}); $$('[data-practice-word]').forEach(b=>b.onclick=()=>{const x=wordsData.items.find(i=>i.id===b.dataset.practiceWord); if(x)queuePractice(`Quero aprender e usar naturalmente “${x.term}” (${x.translation}). Converse comigo e faça eu usar isso em contexto real.`);}); }

  function renderPhrases(){
    main.innerHTML=`<h1 class="page-title">1.000 frases essenciais</h1><p class="page-sub">Padrões funcionais para situações reais, com tradução contextual e variações de registro.</p><div class="toolbar"><input id="phraseSearch" type="search" placeholder="Buscar frase ou contexto"><select id="phraseLang"><option value="">Inglês + espanhol</option><option value="english">Inglês</option><option value="spanish">Espanhol</option></select></div><div id="phraseList" class="list-grid"></div><div class="pager"><button class="btn ghost" id="phraseMore">Mostrar mais</button></div>`;
    let limit=60; const draw=()=>{const q=$('#phraseSearch').value.toLowerCase(),lang=$('#phraseLang').value;const all=phrasesData.items.filter(x=>(!lang||x.language===lang)&&(!q||(x.target+' '+x.translation+' '+x.when).toLowerCase().includes(q)));$('#phraseList').innerHTML=all.slice(0,limit).map(x=>`<article class="list-card"><div class="badge-row"><span class="chip">${langLabel(x.language)}</span><span class="chip gold">${esc(x.register)}</span></div><h3>${esc(x.target)}</h3><p class="vocab-translation">${esc(x.translation)}</p><p>${esc(x.when)}</p><div class="actions"><button class="btn tiny ${state.phrases[x.id]==='known'?'primary':'ghost'}" data-phrase="${x.id}" data-pstate="known">✓ sei</button><button class="btn tiny ${state.phrases[x.id]==='practice'?'primary':'ghost'}" data-phrase="${x.id}" data-pstate="practice">↻ praticar</button><button class="btn tiny ghost" data-practice-phrase="${x.id}">Conversar</button></div></article>`).join('')||'<div class="empty">Nada encontrado.</div>';$('#phraseMore').hidden=all.length<=limit;$$('[data-phrase]').forEach(b=>b.onclick=()=>{state.phrases[b.dataset.phrase]=b.dataset.pstate;saveState();draw();});$$('[data-practice-phrase]').forEach(b=>b.onclick=()=>{const x=phrasesData.items.find(i=>i.id===b.dataset.practicePhrase);if(x)queuePractice(`Quero praticar a frase “${x.target}”. Faça uma conversa real em que eu precise usá-la naturalmente.`);});};$('#phraseSearch').oninput=()=>{limit=60;draw();};$('#phraseLang').onchange=()=>{limit=60;draw();};$('#phraseMore').onclick=()=>{limit+=60;draw();};draw();
  }

  // ----- Progress -----
  function renderProgress(){
    const nodes=mapData.flatMap(l=>l.nodes), overall=heroProgress(); const known=Object.values(state.vocab).filter(x=>x==='known').length, pknown=Object.values(state.phrases).filter(x=>x==='known').length, situations=Object.keys(state.situations).length;
    main.innerHTML=`<h1 class="page-title">Seu progresso</h1><p class="page-sub">Tudo abaixo descreve progresso dentro deste aplicativo. Não é certificação nem medição científica absoluta de fluência.</p><div class="stat-grid"><div class="stat"><strong>${overall}%</strong><small>Mapa concluído</small></div><div class="stat"><strong>${known}</strong><small>Itens lexicais conhecidos</small></div><div class="stat"><strong>${pknown}</strong><small>Frases marcadas</small></div><div class="stat"><strong>${situations}</strong><small>Situações praticadas</small></div></div><section class="panel"><h3>Por nível</h3>${mapData.map(l=>`<div class="progress-row"><span><b>${l.level}</b> ${esc(l.title)}</span><span>${levelPct(l)}%</span></div><div class="bar"><span style="width:${levelPct(l)}%"></span></div>`).join('')}</section><section class="panel"><h3>Memória pedagógica local</h3><p>Professor preferido: <b>${esc(TEACHERS[state.teacher].name)}</b> · nível atual: <b>${state.level}</b> · interações registradas: <b>${Object.values(state.histories).reduce((n,h)=>n+h.length,0)}</b>.</p><button class="btn ghost" data-route="settings">Privacidade e dados</button></section>`;
  }

  // ----- Costs -----
  async function refreshConfigQuiet(){try{config=await fetchJSON('/api/config');updateConnectionBadge();}catch(_){}}
  function renderCosts(){
    const b=config?.budget||{limit_usd:5,spent_usd:0,percent:0,usage:{}}; const cls=b.percent>=95?'danger':''; main.innerHTML=`<h1 class="page-title">Custos e limite</h1><p class="page-sub">A camada local do aplicativo não gera cobrança. O único serviço pago previsto é a Alibaba Cloud quando você ativa a conversa inteligente/voz.</p><section class="panel"><div class="budget-gauge"><div class="progress-ring" style="--p:${Math.min(100,b.percent)}"><strong>${Number(b.percent).toFixed(1)}%</strong></div><div><h3>US$ ${Number(b.spent_usd).toFixed(4)} de US$ ${Number(b.limit_usd).toFixed(2)}</h3><p>Estimativa interna deste app baseada no uso reportado pela API.</p></div></div>${b.percent>=80?`<div class="warning ${cls}">${b.percent>=100?'Chamadas pagas bloqueadas pelo limite interno.':b.percent>=95?'Atenção: você passou de 95% do limite.':'Você passou de 80% do limite.'}</div>`:''}</section><section class="panel"><h3>Ajustar proteção mensal</h3><form id="budgetForm" class="toolbar"><input id="budgetInput" type="number" min="0.1" max="500" step="0.1" value="${Number(b.limit_usd)}"><button class="btn primary">Salvar limite</button></form><p class="microcopy">Essa proteção operacional não substitui alertas/limites configurados no console externo do provedor.</p></section><section class="panel"><h3>Unidades registradas</h3><div class="stat-grid"><div class="stat"><strong>${b.usage?.input_audio_tokens||0}</strong><small>áudio entrada</small></div><div class="stat"><strong>${b.usage?.output_audio_tokens||0}</strong><small>áudio saída</small></div><div class="stat"><strong>${b.usage?.input_text_tokens||0}</strong><small>texto entrada</small></div><div class="stat"><strong>${b.usage?.output_text_tokens||0}</strong><small>texto saída</small></div></div></section>`;
    $('#budgetForm').onsubmit=async e=>{e.preventDefault();try{await fetchJSON('/api/budget',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit_usd:Number($('#budgetInput').value)})});await refreshConfigQuiet();toast('Limite atualizado.');renderCosts();}catch(err){toast(err.message);}};
  }

  // ----- Settings/privacy -----
  function renderSettings(){
    main.innerHTML=`<h1 class="page-title">Configurações e privacidade</h1><p class="page-sub">O padrão é memória pedagógica local e coleta mínima.</p><section class="panel"><h3>Experiência</h3><div class="form-grid"><label>Nível atual<select id="setLevel">${['A1','A2','B1','B2','C1','C2'].map(x=>`<option ${state.level===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Correção<select id="setCorrection"><option value="light" ${state.correction==='light'?'selected':''}>Leve</option><option value="balanced" ${state.correction==='balanced'?'selected':''}>Equilibrada</option><option value="intense" ${state.correction==='intense'?'selected':''}>Intensa</option></select></label></div><label class="toggle"><input type="checkbox" id="setSubtitles" ${state.subtitles?'checked':''}> Legendas/transcrição durante conversa</label><label class="toggle"><input type="checkbox" id="setSounds" ${state.sounds?'checked':''}> Efeitos sonoros locais</label></section><section class="panel"><h3>Privacidade</h3><div class="privacy-list"><div class="privacy-item"><span>◉</span><div><b>Memória pedagógica local</b><small>Nível, mapa, palavras/frases, situações e resumos curtos ficam neste navegador.</small></div></div><div class="privacy-item"><span>🎙</span><div><b>Microfone sob seu controle</b><small>O app só captura áudio após você tocar no microfone; parar encerra as trilhas.</small></div></div><div class="privacy-item"><span>🔑</span><div><b>Chave fora do navegador</b><small>A chave permanente da Alibaba pertence ao servidor/.env, nunca ao JavaScript nem ao localStorage.</small></div></div></div><div class="actions big"><button id="exportBtn" class="btn ghost">Exportar progresso</button><button id="clearHistoryBtn" class="btn ghost">Apagar conversas locais</button><button id="clearAllBtn" class="btn danger-btn">Apagar todos os dados locais</button></div></section><section class="panel"><h3>Estado da IA</h3><p>${config?.provider_ready?`Conectada ao backend protegido · região <b>${esc(config.region)}</b> · modelo configurado <code>${esc(config.model)}</code>.`:'Modo local/demonstração. Para habilitar voz e IA completa, configure o servidor — sem colocar segredos no navegador.'}</p></section>`;
    $('#setLevel').onchange=e=>{state.level=e.target.value;saveState();};$('#setCorrection').onchange=e=>{state.correction=e.target.value;saveState();};$('#setSubtitles').onchange=e=>{state.subtitles=e.target.checked;saveState();};$('#setSounds').onchange=e=>{state.sounds=e.target.checked;saveState();};
    $('#exportBtn').onclick=exportState;$('#clearHistoryBtn').onclick=()=>{if(confirm('Apagar apenas os históricos locais de conversa?')){state.histories=structuredClone(DEFAULT_STATE.histories);saveState();toast('Conversas locais apagadas.');}};$('#clearAllBtn').onclick=()=>{if(confirm('Apagar TODO o progresso, histórico e preferências deste navegador?')){localStorage.removeItem('professoresIA.state');state=structuredClone(DEFAULT_STATE);toast('Dados locais apagados.');renderSettings();}};
  }
  function exportState(){const safe={...state,histories:Object.fromEntries(Object.entries(state.histories).map(([k,v])=>[k,v.map(x=>({...x,content:x.content.slice(0,1000)}))]))};const blob=new Blob([JSON.stringify(safe,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='professores-ia-progresso.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}

  // ----- Plan -----
  function renderPlan(){
    main.innerHTML=`<section class="plan-hero"><span class="eyebrow">PLANO DE USO</span><h1>Local é grátis. IA ao vivo usa apenas Alibaba.</h1><p>O mapa, situações, 1.000 itens lexicais, 1.000 frases, progresso, avatares e efeitos funcionam localmente. O plano com IA libera conversa completa e voz em tempo real quando sua conta Alibaba Cloud estiver configurada.</p><div class="plan-grid"><article class="plan-card"><span class="chip teal">LOCAL</span><h2>Imersão Local</h2><div class="price">R$ 0<small>/mês no app</small></div><ul><li>Mapa A1–C2</li><li>Situações, palavras e frases offline</li><li>Progresso e memória local</li><li>Avatares e animações locais</li><li>Chat em modo demonstração</li></ul><button class="btn ghost wide" data-route="home">Continuar local</button></article><article class="plan-card featured"><span class="chip gold">IA AO VIVO</span><h2>Conversa Completa</h2><div class="price">uso<small>cobrado pela Alibaba</small></div><ul><li>Voz bidirecional em streaming</li><li>Interrupção natural durante a fala</li><li>Quatro personas persistentes</li><li>Português de apoio + retorno ao idioma</li><li>Proteção mensal configurável (inicial US$ 5)</li></ul><button class="btn primary wide" id="paidPlanBtn">${config?.provider_ready?'Usar IA ao vivo':'Configurar plano com IA'}</button></article></div><div class="warning">O aplicativo não cria uma assinatura própria nem adiciona outro provedor pago. A cobrança, quando houver, é da sua conta Alibaba Cloud conforme o consumo real do serviço.</div></section>`;
    $('#paidPlanBtn').onclick=()=>{if(config?.provider_ready){go('conversation');}else{go('settings');toast('Execute “Configurar Alibaba Cloud” instalado com o aplicativo.');}};
  }

  bootstrap();
})();
