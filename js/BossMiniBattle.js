/**
 * BossMiniBattle.js — v4
 * 변경:
 *   - 빌런 filter: 검은 외곽선 제거, halo 투명도 낮춤 (형체 선명하게)
 *   - 경고 배너 → 말풍선 "Rift Attack!" 으로 대체
 *   - 배틀 중 HP 바: 읽기 시 HP 그대로, 빌런 위로 재배치
 *   - HP 바 스타일: 140px 가로, 10px 높이, 붉은 그라데이션, HP% 텍스트
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
    // HP BAR
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

        // HP% 텍스트
        const pct = document.createElement('span');
        pct.id = 'boss-hp-pct';
        pct.textContent = '100%';
        wrap.appendChild(pct);

        document.body.appendChild(wrap);
        this.hpFillEl = fill;
        this.hpPctEl  = pct;
    }

    /** 읽기 중 우하단 빌런 위에 HP 바 배치 */
    _syncHPBarPos() {
        const boss = document.getElementById('read-boss-overlay');
        const wrap = document.getElementById('boss-hp-wrap');
        if (!boss || !wrap) return;
        const bossW   = boss.offsetWidth  || 170;
        const bossH   = boss.offsetHeight || 200;
        const barW    = 140;
        const rightPx = 4 + Math.max(0, Math.round((bossW - barW) / 2));
        const botPx   = bossH - 20 + 6;
        wrap.style.left   = 'auto';
        wrap.style.top    = 'auto';
        wrap.style.right  = rightPx + 'px';
        wrap.style.bottom = botPx + 'px';
        wrap.style.width  = barW + 'px';
    }

    /** 배틀 중 이동한 빌런 위에 HP 바 재배치 */
    _repositionHPBarForBattle(bossLeft, bossTop) {
        const wrap = document.getElementById('boss-hp-wrap');
        if (!wrap) return;
        const barW = 140;
        wrap.style.right  = 'auto';
        wrap.style.bottom = 'auto';
        wrap.style.left   = bossLeft + 'px';
        wrap.style.top    = (bossTop - 28) + 'px';
        wrap.style.width  = barW + 'px';
        wrap.style.display = 'block';
    }

    _watchScreenChange() {
        const screenRead = document.getElementById('screen-read');
        if (!screenRead) return;
        this._screenObserver = new MutationObserver(() => {
            if (!screenRead.classList.contains('active')) this.hideHPBar();
        });
        this._screenObserver.observe(screenRead, { attributes: true, attributeFilter: ['class'] });
    }

    showHPBar() {
        const wrap = document.getElementById('boss-hp-wrap');
        if (!wrap) return;
        this._syncHPBarPos();
        wrap.style.display = 'block';
    }

    hideHPBar() {
        const wrap = document.getElementById('boss-hp-wrap');
        if (wrap) wrap.style.display = 'none';
    }

    _updateHPVisual() {
        if (!this.hpFillEl) return;
        this.hpFillEl.style.width = this.hp + '%';
        // 컬러: HP에 따라 변화
        if (this.hp <= 30) {
            this.hpFillEl.style.background = 'linear-gradient(90deg,#770000,#cc0000)';
        } else if (this.hp <= 60) {
            this.hpFillEl.style.background = 'linear-gradient(90deg,#993300,#cc5500)';
        } else {
            this.hpFillEl.style.background = 'linear-gradient(90deg,#cc0000,#ff4444)';
        }
        if (this.hpPctEl) this.hpPctEl.textContent = this.hp + '%';
    }

    /** 팡 이벤트: HP 감소만 (조용히) */
    onPang() {
        this.pangsInReading++;
        this.hp = Math.max(0, this.hp - 3);
        this._updateHPVisual();
    }

    // ─────────────────────────────────────────────────────────────
    // ENTRY POINT
    // ─────────────────────────────────────────────────────────────
    triggerAfterReplay(onComplete) {
        // HP 바 숨기지 않음 — 배틀 위치로 재배치
        const t = setTimeout(() => {
            this._teleportBoss(() => this.startRiftAttack(onComplete));
        }, 800);
        this.timeouts.push(t);
    }

    // ─────────────────────────────────────────────────────────────
    // TELEPORT
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
            // 검은 외곽선 제거 — 보라 글로우만 (형체 선명하게)
            boss.style.filter     = 'brightness(3.5) drop-shadow(0 0 28px rgba(124,58,237,1))';
            boss.style.opacity    = '1';

            // 어두운 후광 (halo) 투명도 낮춤 — 형체 선명도 유지
            document.getElementById('boss-dark-halo')?.remove();
            const halo = document.createElement('div');
            halo.id = 'boss-dark-halo';
            halo.style.cssText = [
                'position:fixed',
                `left:${tgtLeft - 20}px`,
                `top:${tgtTop  - 20}px`,
                'width:225px',
                'height:225px',
                'background:radial-gradient(ellipse, rgba(4,0,18,0.55) 25%, transparent 68%)',
                'pointer-events:none',
                'z-index:499',
                'border-radius:50%',
            ].join(';');
            document.body.appendChild(halo);

            // HP 바: 배틀 위치로 재배치 (읽기 때 HP 수치 그대로)
            this._repositionHPBarForBattle(tgtLeft, tgtTop);

            const t2 = setTimeout(() => {
                boss.style.transition = 'filter 0.5s';
                // 검은 외곽선 없이 보라 글로우만 유지
                boss.style.filter     = 'drop-shadow(0 0 20px rgba(124,58,237,0.9))';
                if (onDone) onDone();
            }, 250);
            this.timeouts.push(t2);
        }, 180);
        this.timeouts.push(t);
    }

    // ─────────────────────────────────────────────────────────────
    // RIFT ATTACK — 3 waves, ~8.5 seconds
    // ─────────────────────────────────────────────────────────────
    startRiftAttack(onComplete) {
        const T = (ms, fn) => { const id = setTimeout(fn, ms); this.timeouts.push(id); };

        // 말풍선 표시
        this._showSpeechBubble();

        // 에너지 차징
        T(200,  () => this._chargeGlow(true));

        // Wave 1 — 25%
        T(800,  () => { this._chargeGlow(false); this._applyRiftWave(0.25); });

        // Wave 2 — +20%
        T(2500, () => {
            this._chargeGlow(true);
            const t = setTimeout(() => { this._chargeGlow(false); this._applyRiftWave(0.20); }, 600);
            this.timeouts.push(t);
        });

        // Wave 3 — +15%
        T(4500, () => {
            this._chargeGlow(true);
            const t = setTimeout(() => { this._chargeGlow(false); this._applyRiftWave(0.15); }, 700);
            this.timeouts.push(t);
        });

        T(6000, () => this._chargeGlow(false));

        // 빌런 퇴각 + 말풍선 숨김
        T(7000, () => {
            this._bossRetreat();
            this._hideSpeechBubble();
        });

        // Wire Discharge 진행
        T(8500, () => {
            this._cleanupBattleVisuals();
            if (onComplete) onComplete();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // RIFT APPLICATION
    // ─────────────────────────────────────────────────────────────
    _applyRiftWave(ratio) {
        const boss = document.getElementById('read-boss-overlay');

        const card = document.getElementById('book-content');
        if (card) {
            card.classList.add('pang-shake');
            const t = setTimeout(() => card.classList.remove('pang-shake'), 430);
            this.timeouts.push(t);
        }

        this._spawnSplatter(10);

        if (boss) {
            boss.style.transition = 'filter 0.08s';
            boss.style.filter = 'brightness(5) drop-shadow(0 0 35px rgba(200,0,255,1))';
            const t = setTimeout(() => {
                boss.style.transition = 'filter 0.4s';
                boss.style.filter = 'drop-shadow(0 0 20px rgba(124,58,237,0.9))';
            }, 120);
            this.timeouts.push(t);
        }

        const words = Array.from(document.querySelectorAll('.tr-word.revealed'))
            .filter(w => !w.classList.contains('rift-corrupted')
                      && !w.classList.contains('rift-blur')
                      && !w.classList.contains('rift-dark'));

        if (words.length < 4) return;

        const count  = Math.min(Math.floor(words.length * ratio), 25);
        const chosen = [...words].sort(() => Math.random() - 0.5).slice(0, count);

        chosen.forEach((w, i) => {
            const r = Math.random();
            const riftClass = r < 0.40 ? 'rift-corrupted' : r < 0.75 ? 'rift-blur' : 'rift-dark';
            const t = setTimeout(() => {
                w.classList.add(riftClass);
                this.riftedWords.push({ el: w, cls: riftClass, top: w.getBoundingClientRect().top });
            }, i * 30);
            this.timeouts.push(t);
        });
    }

    _chargeGlow(on) {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        boss.style.transition = 'filter 0.5s ease';
        boss.style.filter = on
            ? 'drop-shadow(0 0 30px rgba(200,80,255,1)) brightness(2)'
            : 'drop-shadow(0 0 20px rgba(124,58,237,0.9))';
    }

    _bossRetreat() {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        // 후광도 함께 페이드
        const halo = document.getElementById('boss-dark-halo');
        if (halo) {
            halo.style.transition = 'opacity 0.6s';
            halo.style.opacity = '0';
        }
        boss.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        boss.style.opacity   = '0';
        boss.style.transform = 'scaleX(-1) translateX(-30px)';
        // HP 바도 함께 숨김
        this.hideHPBar();
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
            const tick = () => {
                x += vx; y += vy; life -= 0.035;
                dot.style.left = x + 'px'; dot.style.top = y + 'px';
                dot.style.opacity = life;
                if (life > 0) requestAnimationFrame(tick); else dot.remove();
            };
            requestAnimationFrame(tick);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 말풍선 — "Rift Attack!"
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
            // 빌런 오른쪽, 상단 1/3 지점 옆
            bubble.style.left = (r.right + 10) + 'px';
            bubble.style.top  = (r.top + r.height * 0.2) + 'px';
        }
        // fade in
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
}
