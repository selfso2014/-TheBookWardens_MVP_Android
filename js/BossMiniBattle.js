/**
 * BossMiniBattle.js — v2
 * 수정: HP 바 50% 너비·중앙정렬, 화면전환 시 자동 숨김(MutationObserver),
 *       3라운드 ~15초 배틀 구조
 */
export class BossMiniBattle {
    constructor() {
        this.hp = 100;
        this.pangsInReading = 0;
        this.riftedWords = [];
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

    /** boss 이미지 바로 위, 이미지 중앙 정렬 (width = 50% of boss width) */
    _syncHPBarPos() {
        const boss = document.getElementById('read-boss-overlay');
        const wrap = document.getElementById('boss-hp-wrap');
        if (!boss || !wrap) return;

        const bossW   = boss.offsetWidth  || 170;
        const bossH   = boss.offsetHeight || 200;
        const barW    = Math.round(bossW * 0.5);        // 50% of boss width
        const rightPx = 4 + Math.round((bossW - barW) / 2); // 중앙 정렬
        // bottom: boss visually starts at bottom:-20px CSS, so top of boss = vh - bossH + 20
        // HP bar bottom = boss CSS bottom(-20) + bossH + 4gap
        const bottomPx = bossH - 20 + 6;                // above boss top edge

        wrap.style.right  = rightPx + 'px';
        wrap.style.bottom = bottomPx + 'px';
        wrap.style.width  = barW + 'px';
    }

    /** #screen-read의 active 클래스 소멸 → HP 바 자동 숨김 */
    _watchScreenChange() {
        const screenRead = document.getElementById('screen-read');
        if (!screenRead) return;
        this._screenObserver = new MutationObserver(() => {
            if (!screenRead.classList.contains('active')) {
                this.hideHPBar();
            }
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
        this._flashDmgText('-3%');
    }

    _flashDmgText(txt) {
        const boss = document.getElementById('read-boss-overlay');
        const el = document.createElement('div');
        el.textContent = txt;
        el.className = 'boss-dmg-text';
        if (boss) {
            const r = boss.getBoundingClientRect();
            el.style.left = (r.left + 4) + 'px';
            el.style.top  = (r.top - 18) + 'px';
        }
        document.body.appendChild(el);
        let op = 1, ty = 0;
        const fade = () => {
            op -= 0.045; ty -= 0.8;
            el.style.opacity = op;
            el.style.transform = `translateY(${ty}px)`;
            if (op > 0) requestAnimationFrame(fade); else el.remove();
        };
        requestAnimationFrame(fade);
    }

    // ─────────────────────────────────────────────────────────────
    // ENTRY POINT
    // ─────────────────────────────────────────────────────────────
    triggerAfterReplay(onComplete) {
        const t = setTimeout(() => {
            this.hideHPBar();
            this._teleportBoss(() => this.startBattle(onComplete));
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

        const cr  = card.getBoundingClientRect();
        const bH  = boss.offsetHeight || 185;
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
            boss.style.filter     = 'brightness(4) drop-shadow(0 0 30px rgba(124,58,237,1))';
            boss.style.opacity    = '1';

            const t2 = setTimeout(() => {
                boss.style.transition = 'filter 0.4s';
                boss.style.filter     = 'drop-shadow(0 0 18px rgba(124,58,237,0.85))';
                if (onDone) onDone();
            }, 220);
            this.timeouts.push(t2);
        }, 180);
        this.timeouts.push(t);
    }

    // ─────────────────────────────────────────────────────────────
    // BATTLE — 3 rounds, ~15 seconds
    // ─────────────────────────────────────────────────────────────
    startBattle(onComplete) {
        const T = (ms, fn) => { const id = setTimeout(fn, ms); this.timeouts.push(id); };

        // ── Round 1: 빌런 우세 (0 ~ 5s) ──────────────────────────
        T(300,   () => this._bossRiftAttack(0.15));       // Rift 1차 (15%)
        T(1200,  () => this._purpleLightning(3, 25, '#dd88ff')); // 번개 R1
        T(2800,  () => this._bossLaser(1));               // 레이저 R1
        T(4000,  () => this._bossRiftAttack(0.15));       // Rift 2차 (누적 30%)

        // ── Round 2: 공방전 (5s ~ 10s) ──────────────────────────
        T(5500,  () => this._purpleLightning(4, 38, '#ee99ff')); // 번개 R2 강화
        T(7000,  () => this._bossLaser(3));               // 레이저 R2
        T(8200,  () => this._purpleLightning(3, 28, '#cc88ff')); // 번개 반격
        T(9500,  () => this._bossLaser(2));               // 레이저 R2b

        // ── Round 3: 자주색 원 클라이맥스 (10s ~ 15s) ───────────
        T(10500, () => this._purpleLightning(5, 50, '#ffffff')); // 메가 번개
        T(11200, () => this._bossFlinch());               // 빌런 비틀거림
        T(12000, () => this._restoreRift());              // Rift 복원 시작
        T(13800, () => this._showResult());               // 결과 판정

        T(14600, () => {
            this._cleanup();
            if (onComplete) onComplete();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // ATTACKS
    // ─────────────────────────────────────────────────────────────
    _bossRiftAttack(ratio = 0.15) {
        const card = document.getElementById('book-content');
        if (card) {
            card.classList.add('pang-shake');
            const t = setTimeout(() => card.classList.remove('pang-shake'), 430);
            this.timeouts.push(t);
        }
        this._spawnSplatter();

        const words = Array.from(document.querySelectorAll('.tr-word.revealed'))
            .filter(w => !w.classList.contains('rift-corrupted'));
        if (words.length < 4) return;
        const count = Math.min(Math.floor(words.length * ratio), 16);
        const chosen = [...words].sort(() => Math.random() - 0.5).slice(0, count);
        chosen.forEach(w => { w.classList.add('rift-corrupted'); this.riftedWords.push(w); });
    }

    _spawnSplatter() {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        const r = boss.getBoundingClientRect();
        const cx = r.left + r.width * 0.8;
        const cy = r.top + r.height * 0.3;
        for (let i = 0; i < 7; i++) {
            const dot = document.createElement('div');
            dot.className = 'ink-splat';
            dot.style.left = cx + 'px'; dot.style.top = cy + 'px';
            document.body.appendChild(dot);
            const angle = -Math.PI * 0.7 + Math.random() * Math.PI * 0.6;
            const spd = 55 + Math.random() * 90;
            let x = cx, y = cy, life = 1;
            const vx = Math.cos(angle) * spd * 0.06;
            const vy = Math.sin(angle) * spd * 0.06;
            const tick = () => {
                x += vx; y += vy; life -= 0.04;
                dot.style.left = x + 'px'; dot.style.top = y + 'px';
                dot.style.opacity = life;
                if (life > 0) requestAnimationFrame(tick); else dot.remove();
            };
            requestAnimationFrame(tick);
        }
    }

    /** 번개: strands 가닥 수, maxFrames 애니메이션 길이, color 색상 */
    _purpleLightning(strands, maxFrames, color) {
        const boss = document.getElementById('read-boss-overlay');
        const pangLayer = document.getElementById('pang-marker-layer');
        if (!boss) return;

        const br = boss.getBoundingClientRect();
        const tgtX = br.left + br.width * 0.5;
        const tgtY = br.top + br.height * 0.38;

        const markers = pangLayer ? Array.from(pangLayer.querySelectorAll('.pang-marker')) : [];
        const sources = markers.length
            ? markers.slice(0, strands).map(m => { const r = m.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })
            : Array.from({ length: strands }, (_, i) => ({
                x: window.innerWidth - 22,
                y: window.innerHeight * (0.25 + i * 0.15)
            }));

        const svgId = 'battle-lightning-svg-' + Date.now();
        const svg = this._createSVG(svgId, 460);
        let frame = 0;
        const render = () => {
            svg.innerHTML = '';
            sources.forEach(src => {
                const pts = this._zigzag(src.x, src.y, tgtX, tgtY, 9);
                const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
                poly.setAttribute('fill', 'none');
                poly.setAttribute('stroke', frame % 2 === 0 ? color : '#ffffff');
                poly.setAttribute('stroke-width', (2 + Math.random() * 2).toFixed(1));
                poly.setAttribute('opacity', (0.72 + Math.random() * 0.28).toFixed(2));
                svg.appendChild(poly);
            });
            frame++;
            if (frame < maxFrames) {
                this.animIds.push(requestAnimationFrame(render));
            } else {
                svg.style.transition = 'opacity 0.25s';
                svg.style.opacity = '0';
                setTimeout(() => svg.remove(), 280);
                // 보스 피격 플래시
                boss.style.transition = 'filter 0.1s';
                boss.style.filter = 'brightness(5) drop-shadow(0 0 25px #fff)';
                setTimeout(() => { boss.style.filter = 'drop-shadow(0 0 18px rgba(124,58,237,0.85))'; }, 200);
            }
        };
        this.animIds.push(requestAnimationFrame(render));
    }

    _bossLaser(beams) {
        const boss = document.getElementById('read-boss-overlay');
        const pangLayer = document.getElementById('pang-marker-layer');
        if (!boss) return;

        const br = boss.getBoundingClientRect();
        const srcX = br.left + br.width * 0.62;
        const srcY = br.top + br.height * 0.36;

        const markers = pangLayer ? Array.from(pangLayer.querySelectorAll('.pang-marker')).slice(0, beams) : [];
        const targets = markers.length
            ? markers.map(m => { const r = m.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })
            : Array.from({ length: beams }, (_, i) => ({ x: window.innerWidth - 22, y: window.innerHeight * (0.3 + i * 0.2) }));

        const svgId = 'battle-laser-svg-' + Date.now();
        const svg = this._createSVG(svgId, 460);
        let prog = 0;
        const render = () => {
            svg.innerHTML = '';
            targets.forEach((tgt, i) => {
                const ex = srcX + (tgt.x - srcX) * prog;
                const ey = srcY + (tgt.y - srcY) * prog + (i - (beams - 1) / 2) * 12;
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                g.setAttribute('x1', srcX); g.setAttribute('y1', srcY + (i - (beams-1)/2) * 6);
                g.setAttribute('x2', ex);   g.setAttribute('y2', ey);
                g.setAttribute('stroke', '#ff6600'); g.setAttribute('stroke-width', '7'); g.setAttribute('opacity', '0.28');
                svg.appendChild(g);
                const c = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                c.setAttribute('x1', srcX); c.setAttribute('y1', srcY + (i - (beams-1)/2) * 6);
                c.setAttribute('x2', ex);   c.setAttribute('y2', ey);
                c.setAttribute('stroke', '#ff2020'); c.setAttribute('stroke-width', '2.5');
                svg.appendChild(c);
            });
            prog = Math.min(1, prog + 0.055);
            if (prog < 1) {
                this.animIds.push(requestAnimationFrame(render));
            } else {
                const t = setTimeout(() => {
                    svg.style.transition = 'opacity 0.3s'; svg.style.opacity = '0';
                    setTimeout(() => svg.remove(), 350);
                }, 420);
                this.timeouts.push(t);
                markers.forEach(m => { m.style.transform = 'scale(1.45)'; setTimeout(() => { m.style.transform = ''; }, 200); });
            }
        };
        this.animIds.push(requestAnimationFrame(render));
    }

    /** 빌런 비틀거림 (Round 3에서 타격당할 때) */
    _bossFlinch() {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        boss.style.transition = 'transform 0.15s';
        boss.style.transform = 'scaleX(-1) translateX(10px) rotate(-5deg)';
        const t = setTimeout(() => {
            boss.style.transform = 'scaleX(-1) translateX(-6px) rotate(3deg)';
            const t2 = setTimeout(() => {
                boss.style.transform = 'scaleX(-1)';
            }, 150);
            this.timeouts.push(t2);
        }, 150);
        this.timeouts.push(t);
    }

    _restoreRift() {
        const unique = [...new Set(this.riftedWords)];
        unique.forEach((w, i) => {
            const t = setTimeout(() => {
                w.classList.remove('rift-corrupted');
                w.classList.add('rift-restored');
                setTimeout(() => w.classList.remove('rift-restored'), 600);
            }, i * 90);
            this.timeouts.push(t);
        });
        this.riftedWords = [];
    }

    _showResult() {
        const boss = document.getElementById('read-boss-overlay');
        if (!boss) return;
        if (this.hp <= 30) {
            boss.style.transition = 'transform 0.3s, opacity 0.5s, filter 0.3s';
            boss.style.filter = 'brightness(6) saturate(0)';
            boss.style.transform = 'scaleX(-1) scale(1.4)';
            const t = setTimeout(() => { boss.style.opacity = '0'; }, 300);
            this.timeouts.push(t);
        } else {
            boss.style.transition = 'opacity 0.4s';
            boss.style.opacity = '0';
        }
    }

    // ─────────────────────────────────────────────────────────────
    // CLEANUP & RESET
    // ─────────────────────────────────────────────────────────────
    _cleanup() {
        const boss = document.getElementById('read-boss-overlay');
        if (boss) {
            // 인라인 스타일 모두 제거 → CSS 기본값 복원
            boss.removeAttribute('style');
            // float 애니메이션 재시작 (짧은 delay 후 CSS animation 동작)
        }
        // 전투 SVG 잔재 제거
        document.querySelectorAll('[id^="battle-lightning-svg"]').forEach(el => el.remove());
        document.querySelectorAll('[id^="battle-laser-svg"]').forEach(el => el.remove());
        document.querySelectorAll('.rift-corrupted').forEach(el => el.classList.remove('rift-corrupted'));

        // HP & 카운터 리셋 (다음 문단 대비)
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
        // HP 바는 showHPBar()로 외부에서 명시적으로 표시
        this.hideHPBar();
    }

    // ─────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────
    _createSVG(id, zIndex = 450) {
        document.getElementById(id)?.remove();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = id;
        svg.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${zIndex};`;
        document.body.appendChild(svg);
        return svg;
    }

    _zigzag(x1, y1, x2, y2, segs) {
        const pts = [{ x: x1, y: y1 }];
        const dx = (x2 - x1) / segs;
        const dy = (y2 - y1) / segs;
        const jitter = Math.sqrt(dx * dx + dy * dy) * 0.38;
        for (let i = 1; i < segs; i++) {
            pts.push({
                x: x1 + dx * i + (Math.random() - 0.5) * jitter * 2,
                y: y1 + dy * i + (Math.random() - 0.5) * jitter * 2,
            });
        }
        pts.push({ x: x2, y: y2 });
        return pts;
    }
}
