/* FNS OLIVIA V10 — absolute singleton + max z-index lock + global audio capture. Emma/core untouched. */

if (window.oliviaIsBooted) {
    console.log('Olivia já injetada. Ignorando re-renderização do app.');
} else {
    window.oliviaIsBooted = true;

    const params = new URLSearchParams(location.search);
    const directV10 = params.get('olivia') === 'v10';
    const VERSION = 'v10-20260917';

    const urlIdle = '/assets/olivia-fechada.png?v=' + VERSION;
    const urlListening = '/assets/olivia-falando.png?v=' + VERSION;
    const urlTalking = '/assets/olivia-aberta.png?v=' + VERSION;

    const imgIdle = new Image(); imgIdle.fetchPriority = 'high'; imgIdle.decoding = 'sync'; imgIdle.src = urlIdle;
    const imgListening = new Image(); imgListening.decoding = 'sync'; imgListening.src = urlListening;
    const imgTalking = new Image(); imgTalking.decoding = 'sync'; imgTalking.src = urlTalking;

    const stats = {
        version: VERSION,
        createdAt: performance.now(),
        createCount: 0,
        state: 'idle',
        stateChanges: 0,
        eventBinds: 0,
        audioCapturePlays: 0,
        audioCaptureStops: 0,
        bootAttempts: 0,
        engineBridgeBinds: 0,
        lastEvent: 'boot',
        lastSource: 'boot',
        directV10
    };

    function installVisualCssGuard() {
        let style = document.getElementById('fns-olivia-v10-visual-lock');
        if (style) return style;
        style = document.createElement('style');
        style.id = 'fns-olivia-v10-visual-lock';
        style.textContent = `
html body[data-olivia-v10-active="true"] #olivia-standalone-node,
html body[data-olivia-v10-active="true"] #olivia-standalone-node[data-visible="false"],
html body[data-olivia-v10-active="true"] #olivia-standalone-node[data-visible="true"] {
  position: fixed !important;
  top: 10% !important;
  left: 5% !important;
  width: 450px !important;
  height: 706px !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  transform: none !important;
  filter: none !important;
  clip-path: none !important;
  mask: none !important;
  -webkit-mask: none !important;
  transition: none !important;
  animation: none !important;
  overflow: hidden !important;
}
html body:not([data-olivia-v10-active="true"]) #olivia-standalone-node {
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
html body #olivia-standalone-node #olivia-avatar-img {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100% !important;
  object-fit: contain !important;
  object-position: center center !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  transform: none !important;
  filter: none !important;
  transition: none !important;
  animation: none !important;
  z-index: 2 !important;
}`;
        document.head.appendChild(style);
        return style;
    }
    installVisualCssGuard();

    let container = document.getElementById('olivia-standalone-node');
    if (!container) {
        container = document.createElement('div');
        container.id = 'olivia-standalone-node';
        container.dataset.owner = 'fns-olivia-v10-absolute-singleton';
        container.dataset.instanceId = 'olivia-v10-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        container.dataset.state = 'idle';
        container.dataset.visible = directV10 ? 'true' : 'false';

        container.style.cssText = 'position: fixed !important; top: 10% !important; left: 5% !important; width: 450px !important; height: 706px !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important; visibility: visible !important; opacity: 1 !important; overflow: hidden !important; background: #0a1020 !important; border-radius: 18px !important; transform: none !important; filter: none !important; transition: none !important; animation: none !important;';

        const avatarImg = document.createElement('img');
        avatarImg.id = 'olivia-avatar-img';
        avatarImg.src = urlIdle;
        avatarImg.alt = 'Olivia, profesora virtual';
        avatarImg.loading = 'eager';
        avatarImg.decoding = 'sync';
        avatarImg.fetchPriority = 'high';
        avatarImg.dataset.frame = 'idle';
        avatarImg.style.cssText = 'position:absolute !important; inset:0 !important; width:100% !important; height:100% !important; object-fit:contain !important; object-position:center center !important; display:block !important; visibility:visible !important; opacity:1 !important; transform:none !important; filter:none !important; transition:none !important; animation:none !important;';

        const badge = document.createElement('div');
        badge.textContent = '● LIVE';
        badge.style.cssText = 'position:absolute !important;top:14px !important;left:14px !important;z-index:4 !important;font-size:11px !important;font-weight:800 !important;letter-spacing:.08em !important;padding:7px 9px !important;border-radius:999px !important;background:#090d18d9 !important;border:1px solid #ffffff24 !important;color:white !important;';

        const label = document.createElement('div');
        label.innerHTML = '<b>Olivia</b><br><span>Español • Português de apoio • V10 • 15 turbinas A–O</span>';
        label.style.cssText = 'position:absolute !important;left:16px !important;right:16px !important;bottom:14px !important;z-index:5 !important;padding:10px 12px !important;border-radius:14px !important;background:#07101fdd !important;border:1px solid #ffffff18 !important;color:white !important;line-height:1.35 !important;text-shadow:0 1px 2px #000 !important;';

        container.appendChild(avatarImg);
        container.appendChild(badge);
        container.appendChild(label);
        document.body.appendChild(container);
        stats.createCount = 1;
    }

    function forceContainerCss() {
        const node = document.getElementById('olivia-standalone-node');
        if (!node) return;
        node.style.setProperty('position', 'fixed', 'important');
        node.style.setProperty('top', '10%', 'important');
        node.style.setProperty('left', '5%', 'important');
        node.style.setProperty('width', '450px', 'important');
        node.style.setProperty('height', '706px', 'important');
        node.style.setProperty('z-index', '2147483647', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
        node.style.setProperty('display', 'block', 'important');
        node.style.setProperty('visibility', 'visible', 'important');
        node.style.setProperty('opacity', '1', 'important');
    }

    function activateOlivia(source = 'activate') {
        document.body.dataset.oliviaV10Active = 'true';
        const node = document.getElementById('olivia-standalone-node');
        if (!node) return;
        node.dataset.visible = 'true';
        node.setAttribute('aria-hidden', 'false');
        forceContainerCss();
        stats.lastSource = source;
    }

    function deactivateOlivia(source = 'deactivate') {
        document.body.dataset.oliviaV10Active = 'false';
        const node = document.getElementById('olivia-standalone-node');
        if (!node) return;
        node.dataset.visible = 'false';
        node.setAttribute('aria-hidden', 'true');
        node.style.setProperty('visibility', 'hidden', 'important');
        node.style.setProperty('opacity', '0', 'important');
        stats.lastSource = source;
    }

    function oliviaContextActive() {
        if (document.body.dataset.oliviaV10Active === 'true') return true;
        try { return String(activeTeacher?.name || '').trim().toLowerCase() === 'olivia'; } catch (_) { return false; }
    }

    function setAvatarState(state, source = 'internal') {
        const img = document.getElementById('olivia-avatar-img');
        const node = document.getElementById('olivia-standalone-node');
        if (!img || !node) return;
        const safe = state === 'listening' || state === 'talking' ? state : 'idle';
        let nextSrc = urlIdle;
        if (safe === 'listening') nextSrc = urlListening;
        else if (safe === 'talking') nextSrc = urlTalking;
        node.dataset.state = safe;
        img.dataset.frame = safe;
        stats.lastSource = source;
        stats.lastEvent = safe;
        if (stats.state !== safe) { stats.state = safe; stats.stateChanges++; }
        if (!img.src.includes(nextSrc.split('?')[0])) img.src = nextSrc;
        if (oliviaContextActive()) activateOlivia(source);
    }

    const onAudioPlayCapture = (e) => {
        if (!oliviaContextActive()) return;
        if (e.target && e.target.tagName === 'AUDIO') {
            stats.audioCapturePlays++;
            activateOlivia('document-capture:play');
            setAvatarState('talking', 'document-capture:play');
        }
    };
    const onAudioPauseCapture = (e) => {
        if (!oliviaContextActive()) return;
        if (e.target && e.target.tagName === 'AUDIO') {
            stats.audioCaptureStops++;
            setAvatarState('idle', 'document-capture:pause');
        }
    };
    const onAudioEndedCapture = (e) => {
        if (!oliviaContextActive()) return;
        if (e.target && e.target.tagName === 'AUDIO') {
            stats.audioCaptureStops++;
            setAvatarState('idle', 'document-capture:ended');
        }
    };

    document.addEventListener('play', onAudioPlayCapture, true);
    document.addEventListener('pause', onAudioPauseCapture, true);
    document.addEventListener('ended', onAudioEndedCapture, true);
    stats.eventBinds += 3;

    // Keep the already validated global engine events as a second path because the current remote TTS uses new Audio()
    // instances that may not be attached to the DOM and therefore cannot always be seen by document capture.
    const onEngineVisual = (event) => {
        const type = String(event?.detail?.type || '');
        const source = String(event?.detail?.source || 'v8-engine');
        if (source === 'ui:close') { setAvatarState('idle', source); deactivateOlivia(source); return; }
        if (type === 'listening-start') { activateOlivia(source); setAvatarState('listening', source); return; }
        if (type === 'listening-stop') { setAvatarState('idle', source); return; }
        if (type === 'speaking-start') { activateOlivia(source); setAvatarState('talking', source); return; }
        if (type === 'speaking-stop' || type === 'idle') { setAvatarState('idle', source); }
    };
    window.addEventListener('fns:olivia:v8:visual', onEngineVisual);
    stats.eventBinds++;

    document.addEventListener('olivia-stt-start', () => { activateOlivia('olivia-stt-start'); setAvatarState('listening', 'olivia-stt-start'); });
    document.addEventListener('olivia-stt-stop', () => setAvatarState('idle', 'olivia-stt-stop'));
    stats.eventBinds += 2;

    let engineBridgeInstalled = false;
    function installEngineBridge() {
        if (engineBridgeInstalled || !window.FNS_OLIVIA_V8) return !!window.FNS_OLIVIA_V8;
        try {
            const currentOpen = openLiteTeacher;
            if (typeof currentOpen === 'function' && !currentOpen.__fnsOliviaV10Wrapped) {
                const wrappedOpen = function(...args) {
                    let isOlivia = false;
                    try {
                        const list = typeof teachers !== 'undefined' ? teachers : [];
                        isOlivia = String(list?.[args[0]]?.name || '').trim().toLowerCase() === 'olivia';
                    } catch (_) {}
                    if (isOlivia) activateOlivia('openLiteTeacher:v10');
                    else deactivateOlivia('openLiteTeacher:other');
                    const out = currentOpen.apply(this, args);
                    if (isOlivia) queueMicrotask(() => {
                        const modal = document.querySelector('#liteModal');
                        if (modal) modal.dataset.oliviaV10 = 'true';
                        const h2 = modal?.querySelector('h2');
                        if (h2) h2.textContent = 'Olivia • Español • V10';
                        activateOlivia('openLiteTeacher:v10:post');
                        setAvatarState('idle', 'openLiteTeacher:v10:post');
                    });
                    return out;
                };
                wrappedOpen.__fnsOliviaV10Wrapped = true;
                openLiteTeacher = wrappedOpen;
            }
            const engine = window.FNS_OLIVIA_V8;
            if (engine && typeof engine.closeRoom === 'function' && !engine.closeRoom.__fnsOliviaV10Wrapped) {
                const currentClose = engine.closeRoom;
                const wrappedClose = function(...args) {
                    setAvatarState('idle', 'closeRoom:v10');
                    deactivateOlivia('closeRoom:v10');
                    return currentClose.apply(this, args);
                };
                wrappedClose.__fnsOliviaV10Wrapped = true;
                engine.closeRoom = wrappedClose;
            }
            engineBridgeInstalled = true;
            stats.engineBridgeBinds++;
            return true;
        } catch (error) {
            console.error('[FNS OLIVIA V10] engine bridge', error);
            return false;
        }
    }

    function bootV10Room() {
        if (!directV10) return;
        stats.bootAttempts++;
        try {
            if (!installEngineBridge()) { setTimeout(bootV10Room, 25); return; }
            const teacherList = typeof teachers !== 'undefined' ? teachers : null;
            const opener = typeof openLiteTeacher === 'function' ? openLiteTeacher : null;
            if (!Array.isArray(teacherList) || !opener) { setTimeout(bootV10Room, 25); return; }
            const i = teacherList.findIndex(t => String(t?.name || '').trim().toLowerCase() === 'olivia');
            if (i < 0) { setTimeout(bootV10Room, 50); return; }
            if (typeof live === 'function') live();
            activateOlivia('v10-direct-boot');
            opener(i, 'A1', 'conversation', 'General conversation');
            setAvatarState('idle', 'v10-direct-boot');
        } catch (error) {
            console.error('[FNS OLIVIA V10] direct boot', error);
            setTimeout(bootV10Room, 50);
        }
    }

    if (directV10) activateOlivia('initial-v10');
    else deactivateOlivia('initial-not-v10');

    const bridgeTimer = setInterval(() => {
        if (installEngineBridge()) clearInterval(bridgeTimer);
    }, 25);
    setTimeout(bootV10Room, 0);

    window.FNS_OLIVIA_V10 = {
        version: VERSION,
        setAvatarState,
        showAvatar: activateOlivia,
        hideAvatar: deactivateOlivia,
        forceContainerCss,
        get node() { return document.getElementById('olivia-standalone-node'); },
        get image() { return document.getElementById('olivia-avatar-img'); },
        get engine() { return window.FNS_OLIVIA_V8 || null; },
        health() {
            const node = document.getElementById('olivia-standalone-node');
            const img = document.getElementById('olivia-avatar-img');
            const modal = document.querySelector('#liteModal');
            const cs = node ? getComputedStyle(node) : null;
            const r = node?.getBoundingClientRect();
            return {
                version: VERSION,
                globalLock: window.oliviaIsBooted === true,
                singleton: !!node,
                singletonBodyChild: node?.parentElement === document.body,
                singletonOutsideApp: !!node && !document.getElementById('app')?.contains(node),
                singletonOutsideModal: !!node && !modal?.contains(node),
                visible: !!node && cs?.display !== 'none' && cs?.visibility === 'visible' && Number(cs?.opacity || 0) === 1,
                zIndex: cs?.zIndex || '',
                position: cs?.position || '',
                state: node?.dataset.state || '',
                frame: img?.dataset.frame || '',
                imageLoaded: !!(img?.complete && img?.naturalWidth > 0),
                src: img?.src || '',
                instanceId: node?.dataset.instanceId || '',
                rect: r ? {left:r.left, top:r.top, width:r.width, height:r.height} : null,
                stats: {...stats},
                engineV8: !!window.FNS_OLIVIA_V8,
                turbines: window.FNS_OLIVIA_V8?.health?.().turbineCount || 0
            };
        }
    };
}
