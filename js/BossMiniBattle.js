/**
 * BossMiniBattle.js — v5
 * 변경:
 *   - opacity 1.0, dark halo 제거 → 빌런 선명
 *   - _triggerAttackHalo(): 4단계 flash + 쇼크웨이브 링 2개 + 화면 마이크로 플래시
 *   - 말풍선: 빌런 우상단 위치
 */
export class BossMiniBattle {
    constructor() {
        this.hp = 100;
        this.pangsInReading = 0;
        this.riftedWords = [];
        this.timeouts = [];
        this.animIds = [];
        this.hpFillEl = null;
        this.hpPctEl  = null;
        this._screenObserver = null;

        this._initHPBar();
        this._watchScreenChange();
    }

    // ─────────────────────────────────────────────────────────────
    // HP BAR (display:none !important in CSS — kept for API compat)
    // ─────────────────────────────────────────────────────────────
    _initHPBar() {
        document.getElementById('boss-hp-wrap')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'boss-hp-wrap';
        const bar = document.createElement('div');
        bar.id = 'boss-hp-bar';
        const fill = document.createElement('div');
        fill.id = 'boss-hp-fill';
        bar.appendChild(fill);
        wrap.appendChild(bar);
        const pct = document.createElement('span');
        pct.id = 'boss-hp-pct';
        pct.textContent = '100%';
        wrap.appendChild(pct);
        document.body.appendChild(wrap);
        this.hpFillEl = fill;
        this.hpPctEl  = pct;
    }

    _watchScreenChange() {
        const screenRead = document.getElementById('screen-read');
        if (!screenRead) return;
        this._screenObserver = new MutationObserver(() => {
            if (!screenRead.classList.contains('active')) this.hideHPBar();
        });
        this._screenObserver.observe(screenRead, { attributes: true, attributeFilter: ['class'] });
    }

    showHPBar() { /* HP 바 숨김 유지 (CSS display:none !important) */ }
    hideHPBar() { const w = document.getElementById('boss-hp-wrap'); if (w) w.style.display = 'none'; }

    _updateHPVisual() {
        if (!this.hpFillEl) return;
        this.hpFillEl.style.width = this.hp + '%';
        if (this.hpPctEl) this.hpPctEl.textContent = this.hp + '%';
    }

    onPang() {
        this.pangsInReading++;
        this.hp = Math.max(0, this.hp - 3);
        this._updateHPVisual();
    }

    // ─────────────────────────────────────────────────────────────
    // ENTRY POINT
    // ─────────────────────────────────────────────────────────────
    triggerAfterReplay(onComplete) {
        const t = setTimeout(() => {
            this._teleportBoss(() => this.startRiftAttack(onComplete));
        }, 800);
        this.timeouts.push(t);
    }

    // ─────────────────────────────────────────────────────────────
    // TELEPORT  (dark halo 생성 없음 — 빌런 선명 유지)
    // ─────────────────────────────────────────────────────────────
    _teleportBoss(onDone) {
        const boss = document.getElementById('read-boss-overlay');
        const card = document.getElementById('book-content');
        if (!boss || !card) { if (onDone) onDone(); return; }

        const cr      = card.getBoundingClientRect();
        const bH      = boss.offsetHeight || 185;
        const tgtLeft = cr.left + 6;
        const tgtTop  = cr.top + cr.height * 0.5 - bH * 0.45;

        boss.style.transition = 'opacity 0.15s ease';
        boss.style.opacity = '0';

        const t = setTimeout(() => {
            boss.style.animation  = 'none';
            boss.style.position   = 'fixed';
            boss.style.right      = 'auto';
            boss.style.bottom     = 'auto';
            boss.style.left       = tgtLeft + 'px';
            boss.style.top        = tgtTop  + 'px';
            boss.style.width      = '185px';
            boss.style.transform  = 'scaleX(-1)';
            boss.style.zIndex     = '500';
            boss.style.opacity    = '1';
            // 등장 flash (짧음)
            boss.style.filter     = 'brightness(3.5) drop-shadow(0 0 28px rgba(124,58,237,1))';

            const t2 = setTimeout(() => {
                boss.style.transition = 'filter 0.5s';
                boss.style.filter     = 'drop-shadow(0 0 22px rgba(124,58,237,0.9))';
                if (onDone) onDone();
            }, 250);
            this.timeouts.push(t2);
        }, 180);
        this.timeouts.push(t);
    }

    // ─────────────────────────────────────────────────────────────
    // RIFT ATTACK
    // ─────────────────────────────────────────────────────────────
    startRiftAttack(onComplete) {
        const T = (ms, fn) => { const id = setTimeout(fn, ms); this.timeouts.push(id); };

        this._showSpeechBubble();

        T(200,  () => this._chargeGlow(true));
        T(800,  () => { this._chargeGlow(false); this._applyRiftWave(0.25); });
        T(2500, () => {
            this._chargeGlow(true);
            const t = setTimeout(() => { this._chargeGlow(false); this._applyRiftWave(0.20); }, 600);
            this.timeouts.push(t);
        });
        T(4500, () => {
            this._chargeGlow(true);
            const t = setTimeout(() => { this._chargeGlow(false); this._applyRiftWave(0.15); }, 700);
            this.timeouts.push(t);
        });
        T(6000, () => this._chargeGlow(false));
        T(7000, () => { this._bossRetreat(); this._hideSpeechBubble(); });
        T(8500, () => { this._cleanupBattleVisuals(); if (onComplete) onComplete(); });
    }

    _applyRiftWave(ratio) {
        const card = document.getElementById('book-content');
        if (card) {
            card.classList.add('pang-shake');
            const t = setTimeout(() => card.classList.remove('pang-shake'), 430);
            this.timeouts.push(t);
        }

        // 강화된 공격 헤일로
        this._triggerAttackHalo();
        this._spawnSplatter(10);

        const words = Array.from(document.querySelectorAll('.tr-word.revealed'))
            .filter(w => !w.classList.contains('rift-corrupted')
                      && !w.classList.contains('rift-blur')
                      && !w.classList.contains('rift-dark'));
        if (words.length < 4) return;
        const count  = Math.min(Math.floor(words.length * ratio), 25);
        const chosen = [...words].sort(() => Math.random() - 0.5).slice(0, count);
        chosen.forEach((w, i) => {
            const r = Math.random();
            const cls = r < 0.40 ? 'rift-corrupted' : r < 0.75 ? 'rift-blur' : 'rift-dark';
            const t = setTimeout(() => {
                w.classList.add(cls);
                this.riftedWords.push({ el: w, cls, top: w.getBoundingClientRect().top });
            }, i * 30);
            this.timeouts.push(t);
        });
    }

    // ─────────────────────────────────────────────────────────────
    // ATTACK HALO — 4단계 플래시 + 쇼크웨이브 링 2개 + 화면 플래시
    // ─────────────────────────────────────────────────────────────
    _triggerAttackHalo() {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;

        const br = boss.getBoundingClientRect();
        const cx = br.left + br.width  * 0.5;
        const cy = br.top  + br.height * 0.5;

        // ── 4단계 Boss 플래시 ───────────────────────────────────
        // Stage 1: 극강 흰 폭발
        boss.style.transition = 'filter 0.04s, transform 0.1s';
        boss.style.filter     = 'brightness(9) drop-shadow(0 0 55px rgba(255,255,220,1))';
        boss.style.transform  = 'scaleX(-1) scale(1.22)';

        const s2 = setTimeout(() => {
            // Stage 2: 보라 2차 링
            boss.style.transition = 'filter 0.1s, transform 0.12s';
            boss.style.filter     = 'brightness(5) drop-shadow(0 0 70px rgba(200,80,255,1))';
            boss.style.transform  = 'scaleX(-1) scale(1.1)';
        }, 80);

        const s3 = setTimeout(() => {
            // Stage 3: 침착
            boss.style.transition = 'filter 0.15s, transform 0.15s';
            boss.style.filter     = 'brightness(2.5) drop-shadow(0 0 40px rgba(124,58,237,0.9))';
            boss.style.transform  = 'scaleX(-1) scale(1.0)';
        }, 200);

        const s4 = setTimeout(() => {
            // Stage 4: 정상
            boss.style.transition = 'filter 0.2s';
            boss.style.filter     = 'drop-shadow(0 0 22px rgba(124,58,237,0.9))';
        }, 400);

        [s2, s3, s4].forEach(id => this.timeouts.push(id));

        // ── 쇼크웨이브 링 1 — 흰-노랑, 즉시 ──────────────────────
        this._spawnShockwaveRing(cx, cy, 'rgba(255,240,180,0.9)', 4, 500);

        // ── 쇼크웨이브 링 2 — 보라, 100ms 딜레이 ─────────────────
        const sr2 = setTimeout(() => {
            this._spawnShockwaveRing(cx, cy, 'rgba(180,80,255,0.85)', 3, 400);
        }, 100);
        this.timeouts.push(sr2);

        // ── 화면 마이크로 플래시 ──────────────────────────────────
        const overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'inset:0',
            'background:rgba(255,255,255,0.15)',
            'pointer-events:none', 'z-index:498',
            'transition:opacity 0.18s ease-out',
        ].join(';');
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.style.opacity = '0';
                setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 200);
            });
        });
    }

    /** 원형 쇼크웨이브 링 생성 */
    _spawnShockwaveRing(cx, cy, color, thickness, duration) {
        const size = 120;   // 시작 크기 (px)
        const ring = document.createElement('div');
        ring.style.cssText = [
            'position:fixed',
            `left:${cx - size/2}px`,
            `top:${cy - size/2}px`,
            `width:${size}px`,
            `height:${size}px`,
            `border:${thickness}px solid ${color}`,
            'border-radius:50%',
            'pointer-events:none',
            `z-index:497`,
            `transition:transform ${duration}ms ease-out, opacity ${duration}ms ease-out`,
        ].join(';');
        document.body.appendChild(ring);
        // 트리거 확장 애니메이션
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                ring.style.transform = 'scale(2.8)';
                ring.style.opacity   = '0';
                setTimeout(() => { try { ring.remove(); } catch (_) {} }, duration + 50);
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // CHARGE GLOW
    // ─────────────────────────────────────────────────────────────
    _chargeGlow(on) {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        boss.style.transition = 'filter 0.5s ease';
        boss.style.filter = on
            ? 'drop-shadow(0 0 30px rgba(200,80,255,1)) brightness(2)'
            : 'drop-shadow(0 0 22px rgba(124,58,237,0.9))';
    }

    _bossRetreat() {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        boss.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        boss.style.opacity   = '0';
        boss.style.transform = 'scaleX(-1) translateX(-30px)';
    }

    _spawnSplatter(count = 7) {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        const r  = boss.getBoundingClientRect();
        const cx = r.left + r.width  * 0.8;
        const cy = r.top  + r.height * 0.3;
        for (let i = 0; i < count; i++) {
            const dot = document.createElement('div');
            dot.className = 'ink-splat';
            dot.style.left = cx + 'px'; dot.style.top = cy + 'px';
            document.body.appendChild(dot);
            const angle = -Math.PI * 0.75 + Math.random() * Math.PI * 0.7;
            const spd = 60 + Math.random() * 100;
            let x = cx, y = cy, life = 1;
            const vx = Math.cos(angle) * spd * 0.06;
            const vy = Math.sin(angle) * spd * 0.06;
            const tk = () => { x+=vx; y+=vy; life-=0.035; dot.style.left=x+'px'; dot.style.top=y+'px'; dot.style.opacity=life; if(life>0)requestAnimationFrame(tk);else dot.remove(); };
            requestAnimationFrame(tk);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // SPEECH BUBBLE — 빌런 우상단 위치
    // ─────────────────────────────────────────────────────────────
    _showSpeechBubble() {
        document.getElementById('boss-speech-bubble')?.remove();
        const boss = document.getElementById('read-boss-overlay');
        const bubble = document.createElement('div');
        bubble.id = 'boss-speech-bubble';
        bubble.className = 'boss-speech-bubble';
        bubble.textContent = 'Rift Attack!';
        document.body.appendChild(bubble);

        if (boss) {
            const r = boss.getBoundingClientRect();
            // 빌런 머리 위쪽 + 약간 오른쪽
            const rawTop = r.top - 70;          // 위쪽
            bubble.style.left = (r.left + 30) + 'px';   // 빌런 왼쪽에서 30px 오른쪽
            bubble.style.top  = Math.max(rawTop, 60) + 'px';  // HUD 아래 최소 60px
        }
        requestAnimationFrame(() => { requestAnimationFrame(() => { bubble.style.opacity = '1'; }); });
    }

    _hideSpeechBubble() {
        const b = document.getElementById('boss-speech-bubble');
        if (!b) return;
        b.style.opacity = '0';
        setTimeout(() => { try { b.remove(); } catch (_) {} }, 400);
    }

    // ─────────────────────────────────────────────────────────────
    // PURIFICATION
    // ─────────────────────────────────────────────────────────────
    getSortedRiftWords() {
        const items = [...this.riftedWords];
        this.riftedWords = [];
        return items
            .filter(({ el }) => el && el.isConnected)
            .sort((a, b) => (a.top || 0) - (b.top || 0));
    }

    restoreAllRift() {
        const items = [...this.riftedWords];
        this.riftedWords = [];
        items.forEach(({ el, cls }, i) => {
            const t = setTimeout(() => {
                if (!el) return;
                el.classList.remove(cls);
                el.classList.add('rift-restored');
                const t2 = setTimeout(() => el.classList.remove('rift-restored'), 650);
                this.timeouts.push(t2);
            }, i * 80);
            this.timeouts.push(t);
        });
    }

    // ─────────────────────────────────────────────────────────────
    // CLEANUP & RESET
    // ─────────────────────────────────────────────────────────────
    _cleanupBattleVisuals() {
        document.getElementById('boss-dark-halo')?.remove();
        document.getElementById('boss-speech-bubble')?.remove();
        document.getElementById('rift-warning-banner')?.remove();
    }

    _cleanup() {
        const boss = document.getElementById('read-boss-overlay');
        if (boss) boss.removeAttribute('style');
        this._cleanupBattleVisuals();
        document.querySelectorAll('.rift-corrupted,.rift-blur,.rift-dark')
            .forEach(el => el.classList.remove('rift-corrupted', 'rift-blur', 'rift-dark'));
        this.hp = 100;
        this.pangsInReading = 0;
        this.riftedWords = [];
        this._updateHPVisual();
    }

    reset() {
        this.timeouts.forEach(clearTimeout);
        this.timeouts = [];
        this.animIds.forEach(cancelAnimationFrame);
        this.animIds = [];
        this._cleanup();
        this.hideHPBar();
    }

    // ─────────────────────────────────────────────────────────────
    // VILLAIN ENTRANCE — dramatic appearance before reading starts
    // ─────────────────────────────────────────────────────────────
    triggerEntrance(onDone) {
        const T = (ms, fn) => { const id = setTimeout(fn, ms); this.timeouts.push(id); return id; };
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) { if (onDone) onDone(); return; }

        const W    = window.innerWidth;
        const H    = window.innerHeight;
        const SIZE = Math.min(W * 0.55, 260);
        const cx   = W / 2 - SIZE / 2;
        const cy   = H * 0.28;

        const TAUNTS = [
            "I'll corrupt these words!",
            "You can't read fast enough!",
            "The Rift spreads through every line!",
            "This passage belongs to the Shadow!",
        ];
        const taunt = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];

        // Override inline styles: large, centered, invisible initially
        boss.setAttribute('style', [
            'display:block',
            `left:${cx}px`,
            `top:${cy}px`,
            'right:auto',
            'bottom:auto',
            `width:${SIZE}px`,
            'transform:scale(0.1)',
            'opacity:0',
            'z-index:9999',
            'filter:brightness(8) drop-shadow(0 0 80px rgba(200,60,255,1))',
            'animation:none',
            'pointer-events:none',
            'position:fixed',
            'transition:opacity 0.2s, transform 0.45s cubic-bezier(0.22,1,0.36,1), filter 0.35s',
        ].join(';'));

        // Radial flash on entry
        this._entranceFlash();

        // Boss bursts in (scale up)
        T(80, () => {
            boss.style.opacity   = '1';
            boss.style.transform = 'scale(1.25)';
        });

        // Settle to normal scale
        T(520, () => {
            boss.style.transition = 'transform 0.3s ease, filter 0.4s ease';
            boss.style.transform  = 'scale(1.0)';
            boss.style.filter     = 'drop-shadow(0 0 28px rgba(124,58,237,0.9))';
        });

        // Show provocative speech bubble
        T(750, () => this._showEntranceBubble(taunt));

        // Retreat after taunt
        T(3100, () => {
            this._hideEntranceBubble();
            T(200, () => this._retreatToCorner(onDone));
        });
    }

    _entranceFlash() {
        const fl = document.createElement('div');
        fl.setAttribute('style', [
            'position:fixed', 'inset:0', 'pointer-events:none', 'z-index:9998',
            'opacity:1', 'transition:opacity 0.55s',
            'background:radial-gradient(circle,rgba(130,20,255,0.45) 0%,rgba(50,0,100,0.2) 60%,transparent 100%)',
        ].join(';'));
        document.body.appendChild(fl);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            fl.style.opacity = '0';
            setTimeout(() => fl.remove(), 700);
        }));
    }

    _showEntranceBubble(msg) {
        document.getElementById('boss-entrance-bubble')?.remove();
        const boss   = document.getElementById('read-boss-overlay');
        const bubble = document.createElement('div');
        bubble.id        = 'boss-entrance-bubble';
        bubble.className = 'boss-speech-bubble';
        bubble.textContent = msg;
        document.body.appendChild(bubble);

        if (boss) {
            const r = boss.getBoundingClientRect();
            bubble.style.left = Math.max(8,  r.left + r.width * 0.1) + 'px';
            bubble.style.top  = Math.max(10, r.top  - 75)            + 'px';
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
            bubble.style.opacity = '1';
        }));
    }

    _hideEntranceBubble() {
        const b = document.getElementById('boss-entrance-bubble');
        if (!b) return;
        b.style.opacity = '0';
        setTimeout(() => { try { b.remove(); } catch (_) {} }, 400);
    }

    _retreatToCorner(onDone) {
        const T    = (ms, fn) => { const id = setTimeout(fn, ms); this.timeouts.push(id); return id; };
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) { if (onDone) onDone(); return; }

        const W  = window.innerWidth;
        const H  = window.innerHeight;
        const NW = 170;  // matches CSS width

        // CSS natural pos: right:4 → left = W-NW-4; bottom:-20 → top = H-NW+20
        const tLeft = W - NW - 4;
        const tTop  = H - NW + 20;

        boss.style.transition = [
            'left   0.70s cubic-bezier(0.4,0,0.2,1)',
            'top    0.70s cubic-bezier(0.4,0,0.2,1)',
            'width  0.55s cubic-bezier(0.4,0,0.2,1)',
            'filter 0.55s',
            'transform 0.55s',
        ].join(',');
        boss.style.left      = tLeft + 'px';
        boss.style.top       = tTop  + 'px';
        boss.style.width     = NW    + 'px';
        boss.style.transform = 'scale(1.0)';
        boss.style.filter    = 'drop-shadow(0 0 18px rgba(124,58,237,0.85))';

        // Animation done: hand back to CSS
        T(900, () => {
            boss.removeAttribute('style');
            if (onDone) onDone();
        });
    }
}

