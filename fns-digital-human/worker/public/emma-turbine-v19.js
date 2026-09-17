// FNS TURBINE V19 - TERRA ARRASADA (OVERRIDE TOTAL DA BOCA)
// NÃO MEXER EM APP.JS, STT, TTS, NEM NAS TURBINAS A-P.

(function() {
    console.warn('[FNS TURBINE v19] BOOT STRATEGY: TERRA ARRASADA INICIADA');

    // 1. Injetar CSS de força bruta no HEAD para ANIQUILAR a boca velha e blindar a nova
    const style = document.createElement('style');
    style.id = 'fns-override-v19';
    style.innerHTML = `
        /* 1.1 MATA A BOCA NATIVA (O core pode atualizar o que quiser nela, não será vista) */
        .human-avatar .avatar-mouth-motion {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            transform: scale(0) !important;
        }

        /* 1.2 ESTILIZA A NOSSA BOCA INJETADA */
        #fns-nova-boca-v19 {
            position: absolute !important;
            left: 50% !important;
            top: 58.1% !important;
            width: 13.6% !important;
            height: 9px !important;
            z-index: 2147483647 !important; /* Força bruta por cima de todos os layers */
            transform-origin: 50% 50% !important;
            pointer-events: none !important;
            
            /* Fundo gradiente com dentes e boca */
            background: linear-gradient(180deg, #fffdfa 0 16%, #f4f1ed 16% 28%, #2b080d 29% 67%, #b23f59 68% 100%) !important;
            
            /* GEOMETRIA DEFINITIVA: Centro rebaixado, cantos subindo (formato de U aberto) */
            clip-path: polygon(0% 30%, 15% 45%, 35% 55%, 50% 60%, 65% 55%, 85% 45%, 100% 30%, 100% 70%, 80% 85%, 50% 95%, 20% 85%, 0% 70%) !important;
            border-radius: 10% 10% 60% 60% !important;
        }

        /* 1.3 LINHA DO LÁBIO SUPERIOR (Força a curvatura) */
        #fns-nova-boca-v19::after {
            content: "" !important;
            position: absolute !important;
            left: 5% !important; top: -1px !important;
            width: 90% !important; height: 50% !important;
            border-top: 2px solid rgba(150,42,63,.88) !important;
            border-radius: 50% 50% 0 0 / 100% 100% 0 0 !important;
        }
    `;
    document.head.appendChild(style);

    // 2. Loop de renderização (Sobrevive a qualquer re-render do React/Core)
    function forceFakeMouth() {
        const avatar = document.querySelector('.human-avatar');
        if (!avatar) return; 

        let fakeMouth = document.getElementById('fns-nova-boca-v19');

        // Se o core limpou o DOM e apagou nossa boca, reinjetamos imediatamente
        if (!fakeMouth) {
            fakeMouth = document.createElement('div');
            fakeMouth.id = 'fns-nova-boca-v19';
            avatar.appendChild(fakeMouth);
            console.warn('[FNS TURBINE v19] BOCA V19 INJETADA NO DOM');
        }

        // Lê os sinais vitais diretamente do container pai (o core injeta as variáveis lá)
        const styles = getComputedStyle(avatar);
        const mouthOpen = parseFloat(styles.getPropertyValue('--mouth-open')) || 0;
        const mouthWide = parseFloat(styles.getPropertyValue('--mouth-wide')) || 0;

        // Aplica a matemática dinâmica na NOSSA boca, ignorando a nativa
        fakeMouth.style.transform = `
            translate(-50%, -50%)
            translate3d(0, calc(${mouthOpen} * .30px), 0)
            scaleX(calc(1.00 + ${mouthWide} * .16))
            scaleY(calc(.28 + ${mouthOpen} * 1.02))
        `;
        
        // Garante que a boca suma se não houver fala
        fakeMouth.style.opacity = Math.min(Math.max(mouthOpen * 1.2, 0), 0.97);
    }

    // Executa a 60 frames por segundo, monitorando e esmagando qualquer alteração do core
    function loop() {
        forceFakeMouth();
        requestAnimationFrame(loop);
    }
    
    // Inicia a turbina
    requestAnimationFrame(loop);

})();