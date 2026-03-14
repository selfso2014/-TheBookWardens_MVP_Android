/**
 * BossMiniBattle.js — v3
 * 변경:
 *   - onPang(): pang-shake·데미지 텍스트 제거 (읽기 방해 제거)
 *   - startBattle() → startRiftAttack(): 전투 없음, Rift 집중 공격만
 *   - restoreAllRift(): Wire Discharge 완료 시 호출, 오염 단어 순차 복원
 */
export class BossMiniBattle {
    constructor() {
        this.hp = 100;
        this.pangsInReading = 0;
        this.riftedWords = [];          // 오염된 단어 목록 (복원용)
        this.timeouts = [];
        this.animIds = [];
        this.hpFillEl = null;
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
        document.body.appendChild(wrap);
        this.hpFillEl = fill;
    }

    _syncHPBarPos() {
        const boss = document.getElementById('read-boss-overlay');
        const wrap = document.getElementById('boss-hp-wrap');
        if (!boss || !wrap) return;
        const bossW   = boss.offsetWidth  || 170;
        const bossH   = boss.offsetHeight || 200;
        const barW    = Math.round(bossW * 0.5);
        const rightPx = 4 + Math.round((bossW - barW) / 2);
        const botPx   = bossH - 20 + 6;          // boss CSS bottom=-20, gap=6
        wrap.style.right  = rightPx + 'px';
        wrap.style.bottom = botPx + 'px';
        wrap.style.width  = barW + 'px';
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

    /** 팡 이벤트: HP 감소만 (애니메이션 없음 — 읽기 방해 제거) */
    onPang() {
        this.pangsInReading++;
        this.hp = Math.max(0, this.hp - 3);
        if (this.hpFillEl) {
            this.hpFillEl.style.width = this.hp + '%';
            if (this.hp <= 30) {
                this.hpFillEl.style.background = 'linear-gradient(90deg,#ff2020,#ff5500)';
            } else if (this.hp <= 60) {
                this.hpFillEl.style.background = 'linear-gradient(90deg,#cc00ff,#ff3030)';
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // ENTRY POINT — called from TextRendererV2 replay path end
    // ─────────────────────────────────────────────────────────────
    triggerAfterReplay(onComplete) {
        const t = setTimeout(() => {
            this.hideHPBar();
            this._teleportBoss(() => this.startRiftAttack(onComplete));
        }, 800);
        this.timeouts.push(t);
    }

    // ─────────────────────────────────────────────────────────────
    // TELEPORT: bottom-right → center-left of text card
    // ─────────────────────────────────────────────────────────────
    _teleportBoss(onDone) {
        const boss = document.getElementById('read-boss-overlay');
        const card = document.getElementById('book-content');
        if (!boss || !card) { if (onDone) onDone(); return; }

        const cr     = card.getBoundingClientRect();
        const bH     = boss.offsetHeight || 185;
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
            boss.style.transform  = 'scaleX(-1)';  // 오른쪽(텍스트) 방향
            boss.style.zIndex     = '500';
            boss.style.filter     = 'brightness(3.5) drop-shadow(0 0 28px rgba(124,58,237,1))';
            boss.style.opacity    = '1';

            const t2 = setTimeout(() => {
                boss.style.transition = 'filter 0.5s';
                boss.style.filter     = 'drop-shadow(0 0 18px rgba(124,58,237,0.85))';
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

        // 에너지 차징 글로우
        T(200,  () => this._chargeGlow(true));

        // Wave 1 — 전체 단어의 25% 오염
        T(800,  () => {
            this._chargeGlow(false);
            this._applyRiftWave(0.25);
        });

        // Wave 2 — 추가 20% 오염 (누적 ~45%)
        T(2500, () => {
            this._chargeGlow(true);
            const t = setTimeout(() => {
                this._chargeGlow(false);
                this._applyRiftWave(0.20);
            }, 600);
            this.timeouts.push(t);
        });

        // Wave 3 — 추가 15% 오염 (누적 ~60%), 최강 파동
        T(4500, () => {
            this._chargeGlow(true);
            const t = setTimeout(() => {
                this._chargeGlow(false);
                this._applyRiftWave(0.15);
            }, 700);
            this.timeouts.push(t);
        });

        // 공격 완료 포즈 유지 (6~7초)
        T(6000, () => this._chargeGlow(false));

        // 빌런 퇴각
        T(7000, () => this._bossRetreat());

        // Wire Discharge 진행
        T(8500, () => {
            this._cleanupBattleVisuals();
            if (onComplete) onComplete();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // RIFT APPLICATION
    // ─────────────────────────────────────────────────────────────
    /**
     * ratio: 전체 revealed 단어 중 오염할 비율
     * 오염 타입: rift-corrupted(40%) / rift-blur(35%) / rift-dark(25%)
     */
    _applyRiftWave(ratio) {
        const boss = document.getElementById('read-boss-overlay');

        // 텍스트 카드 흔들기
        const card = document.getElementById('book-content');
        if (card) {
            card.classList.add('pang-shake');
            const t = setTimeout(() => card.classList.remove('pang-shake'), 430);
            this.timeouts.push(t);
        }

        // 잉크 스플래터
        this._spawnSplatter(10);

        // 에너지 임펄스 파동
        if (boss) {
            boss.style.transition = 'filter 0.08s';
            boss.style.filter = 'brightness(5) drop-shadow(0 0 35px rgba(200,0,255,1))';
            const t = setTimeout(() => {
                boss.style.transition = 'filter 0.4s';
                boss.style.filter = 'drop-shadow(0 0 18px rgba(124,58,237,0.85))';
            }, 120);
            this.timeouts.push(t);
        }

        // 미오염·표시된 단어 수집
        const words = Array.from(document.querySelectorAll('.tr-word.revealed'))
            .filter(w => !w.classList.contains('rift-corrupted')
                      && !w.classList.contains('rift-blur')
                      && !w.classList.contains('rift-dark'));

        if (words.length < 4) return;

        const count   = Math.min(Math.floor(words.length * ratio), 25);
        const chosen  = [...words].sort(() => Math.random() - 0.5).slice(0, count);

        chosen.forEach((w, i) => {
            const r = Math.random();
            let riftClass;
            if (r < 0.40)      riftClass = 'rift-corrupted';
            else if (r < 0.75) riftClass = 'rift-blur';
            else               riftClass = 'rift-dark';

            // 단어별로 살짝 딜레이 (파동 느낌)
            const t = setTimeout(() => {
                w.classList.add(riftClass);
                this.riftedWords.push({
                    el: w,
                    cls: riftClass,
                    top: w.getBoundingClientRect().top  // Y충 정렬용
                });
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
            : 'drop-shadow(0 0 18px rgba(124,58,237,0.85))';
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
    // RIFT PURIFICATION — called by Wire Discharge finish()
    // ─────────────────────────────────────────────────────────────
    /** TextRendererV2._riftPurificationPhase에 전달: Y충 오름차순 정렬 */
    getSortedRiftWords() {
        const items = [...this.riftedWords];
        this.riftedWords = [];
        return items
            .filter(({ el }) => el && el.isConnected)
            .sort((a, b) => (a.top || 0) - (b.top || 0));
    }

    /** Wire Discharge 완료 시 안전망 일괄 정리 (getSortedRiftWords 미호출 시) */
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
        document.querySelectorAll('.battle-lightning-svg, .battle-laser-svg').forEach(el => el.remove());
    }

    _cleanup() {
        const boss = document.getElementById('read-boss-overlay');
        if (boss) boss.removeAttribute('style');
        this._cleanupBattleVisuals();
        document.querySelectorAll('.rift-corrupted,.rift-blur,.rift-dark')
            .forEach(el => el.classList.remove('rift-corrupted','rift-blur','rift-dark'));

        this.hp = 100;
        this.pangsInReading = 0;
        this.riftedWords = [];
        if (this.hpFillEl) {
            this.hpFillEl.style.width = '100%';
            this.hpFillEl.style.background = '';
        }
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
