/* FNS OLIVIA V9 — absolute singleton visual injector. Emma/core untouched. */

// 1. TRAVA GLOBAL DE EXECUÇÃO (Mata o loop do React/app re-render)
if (window.oliviaIsBooted) {
    console.log("Olivia já injetada. Ignorando re-renderização do React.");
} else {
    // Trava ativada imediatamente no primeiro milissegundo
    window.oliviaIsBooted = true;

    const params = new URLSearchParams(location.search);
    const directV9 = params.get('olivia') === 'v9';
    const VERSION = 'v9-20260917';

    // 2. PRELOAD IMEDIATO DAS IMAGENS (Mata o flicker ao trocar de estado)
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
        lastEvent: 'boot',
        lastSource: 'boot',
        directV9
    };

    // 3. INJEÇÃO DIRETA NO BODY (Imune ao root do App)
    let container = document.getElementById('olivia-standalone-node');
    if (!container) {
        container = document.createElement('div');
        container.id = 'olivia-standalone-node';
        container.dataset.owner = 'fns-olivia-v9-absolute-singleton';
        container.dataset.instanceId = 'olivia-v9-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        container.dataset.state = 'idle';
        container.dataset.visible = directV9 ? 'true' : 'false';

        // CSS forçado via JS para sobrepor o painel esquerdo
        container.style.position = 'fixed';
        container.style.top = '10%';
        container.style.left = '5%';
        container.style.width = '450px';
        container.style.height = '706px';
        container.style.zIndex = '999999';
        container.style.pointerEvents = 'none';
        container.style.display = 'block';
        container.style.opacity = '1';
        container.style.visibility = directV9 ? 'visible' : 'hidden';
        container.style.overflow = 'hidden';
        container.style.background = '#0a1020';
        container.style.borderRadius = '18px';

        const avatarImg = document.createElement('img');
        avatarImg.id = 'olivia-avatar-img';
        avatarImg.src = urlIdle;
        avatarImg.alt = 'Olivia, profesora virtual';
        avatarImg.loading = 'eager';
        avatarImg.decoding = 'sync';
        avatarImg.fetchPriority = 'high';
        avatarImg.dataset.frame = 'idle';
        avatarImg.style.width = '100%';
        avatarImg.style.height = '100%';
        avatarImg.style.objectFit = 'contain';
        avatarImg.style.objectPosition = 'center center';
        avatarImg.style.display = 'block';
        avatarImg.style.opacity = '1';
        avatarImg.style.visibility = 'visible';
        avatarImg.style.transform = 'none';

        const badge = document.createElement('div');
        badge.textContent = '● LIVE';
        badge.style.cssText = 'position:absolute;top:14px;left:14px;z-index:4;font-size:11px;font-weight:800;letter-spacing:.08em;padding:7px 9px;border-radius:999px;background:#090d18d9;border:1px solid #ffffff24;color:white;';

        const label = document.createElement('div');
        label.innerHTML = '<b>Olivia</b><br><span>Español • Português de apoio • V9 • 15 turbinas A–O</span>';
        label.style.cssText = 'position:absolute;left:16px;right:16px;bottom:14px;z-index:5;padding:10px 12px;border-radius:14px;background:#07101fdd;border:1px solid #ffffff18;color:white;line-height:1.35;text-shadow:0 1px 2px #000;';

        container.appendChild(avatarImg);
        container.appendChild(badge);
        container.appendChild(label);
        document.body.appendChild(container);
        stats.createCount = 1;
    }

    // 4. BIND DE EVENTOS (Vanilla JS) - Executado apenas UMA vez
    function showAvatar() {
        const node = document.getElementById('olivia-standalone-node');
        if (!node) return;
        node.dataset.visible = 'true';
        node.style.display = 'block';
        node.style.visibility = 'visible';
        node.style.opacity = '1';
        node.setAttribute('aria-hidden', 'false');
    }

    function hideAvatar() {
        const node = document.getElementById('olivia-standalone-node');
        if (!node) return;
        node.dataset.visible = 'false';
        node.style.visibility = 'hidden';
        node.setAttribute('aria-hidden', 'true');
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
        if (stats.state !== safe) {
            stats.state = safe;
            stats.stateChanges++;
        }
        if (!img.src.includes(nextSrc.split('?')[0])) img.src = nextSrc;
    }

    // Eventos reais emitidos pelo motor STT/TTS da Olivia V8. V9 é apenas a camada visual autoritativa.
    const onEngineVisual = (event) => {
        const type = String(event?.detail?.type || '');
        const source = String(event?.detail?.source || 'v8-engine');
        if (type === 'listening-start') { showAvatar(); setAvatarState('listening', source); return; }
        if (type === 'listening-stop') { setAvatarState('idle', source); return; }
        if (type === 'speaking-start') { showAvatar(); setAvatarState('talking', source); return; }
        if (type === 'speaking-stop' || type === 'idle') { setAvatarState('idle', source); }
    };
    window.addEventListener('fns:olivia:v8:visual', onEngineVisual);
    stats.eventBinds++;

    // Eventos Vanilla explícitos para STT, mantendo compatibilidade com integrações futuras.
    document.addEventListener('olivia-stt-start', () => { showAvatar(); setAvatarState('listening', 'olivia-stt-start'); });
    document.addEventListener('olivia-stt-stop', () => setAvatarState('idle', 'olivia-stt-stop'));
    stats.eventBinds += 2;

    function bootV9Room() {
        if (!directV9) return;
        try {
            if (!Array.isArray(window.teachers) || typeof window.openLiteTeacher !== 'function') {
                setTimeout(bootV9Room, 25);
                return;
            }
            const i = window.teachers.findIndex(t => String(t?.name || '').trim().toLowerCase() === 'olivia');
            if (i < 0) return;
            if (typeof window.live === 'function') window.live();
            window.openLiteTeacher(i, 'A1', 'conversation', 'General conversation');
            showAvatar();
            setAvatarState('idle', 'v9-direct-boot');
            queueMicrotask(() => {
                const modal = document.querySelector('#liteModal');
                if (modal) modal.dataset.oliviaV9 = 'true';
                const h2 = modal?.querySelector('h2');
                if (h2) h2.textContent = 'Olivia • Español • V9';
            });
        } catch (error) {
            console.error('[FNS OLIVIA V9] direct boot', error);
            setTimeout(bootV9Room, 50);
        }
    }

    // Executa após o script V8 seguinte terminar de registrar os hooks reais de STT/TTS.
    setTimeout(bootV9Room, 0);

    window.FNS_OLIVIA_V9 = {
        version: VERSION,
        setAvatarState,
        showAvatar,
        hideAvatar,
        get node() { return document.getElementById('olivia-standalone-node'); },
        get image() { return document.getElementById('olivia-avatar-img'); },
        get engine() { return window.FNS_OLIVIA_V8 || null; },
        health() {
            const node = document.getElementById('olivia-standalone-node');
            const img = document.getElementById('olivia-avatar-img');
            const modal = document.querySelector('#liteModal');
            const r = node?.getBoundingClientRect();
            return {
                version: VERSION,
                globalLock: window.oliviaIsBooted === true,
                singleton: !!node,
                singletonBodyChild: node?.parentElement === document.body,
                singletonOutsideApp: !!node && !document.getElementById('app')?.contains(node),
                singletonOutsideModal: !!node && !modal?.contains(node),
                visible: node?.dataset.visible === 'true' && getComputedStyle(node).visibility === 'visible',
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
