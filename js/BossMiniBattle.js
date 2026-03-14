/**
 * BossMiniBattle.js
 * 소형 빌런(ink_shadow_boss) 배틀 시퀀스 관리
 *
 * Pipeline:
 *   1. 읽기 중: HP 바 표시, 팡 발생마다 HP -3%
 *   2. 리플레이: 빌런 우하단 유지
 *   3. 리플레이 경로 완료 → 800ms 후 중앙 좌측으로 순간이동 + 좌우반전
 *   4. 배틀 시퀀스 자동 진행:
 *      Rift 공격 → 번개 → 레이저 반격 → rift 복원 → 결과
 *   5. 완료 후 onComplete 호출 (기존 Wire Discharge 연결)
 */
export class BossMiniBattle {
    constructor() {
        this.hp = 100;
        this.pangsInReading = 0;
        this.riftedWords = [];
        this.timeouts = [];
        this.animIds = [];
        this.hpFillEl = null;
        this._initHPBar();
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
        const r = boss.getBoundingClientRect();
        wrap.style.right = '4px';
        wrap.style.bottom = (window.innerHeight - r.top + 4) + 'px';
        wrap.style.width = r.width + 'px';
    }

    showHPBar() {
        const wrap = document.getElementById('boss-hp-wrap');
        if (wrap) { wrap.style.display = 'block'; this._syncHPBarPos(); }
    }

    hideHPBar() {
        const wrap = document.getElementById('boss-hp-wrap');
        if (wrap) wrap.style.display = 'none';
    }

    /** 팡 이벤트 발생 시 호출 */
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
        this._syncHPBarPos();
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
            el.style.top = (r.top - 18) + 'px';
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
    // ENTRY POINT: called from TextRendererV2 after replay path ends
    // ─────────────────────────────────────────────────────────────
    triggerAfterReplay(onComplete) {
        // 800ms 후 순간이동 + 배틀
        const t = setTimeout(() => {
            this.hideHPBar();
            this._teleportBoss(() => {
                this.startBattle(onComplete);
            });
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

        const cr = card.getBoundingClientRect();
        const bH = boss.offsetHeight || 170;
        const tgtLeft = cr.left + 6;
        const tgtTop  = cr.top + cr.height * 0.5 - bH * 0.45;

        // 1. fade out
        boss.style.transition = 'opacity 0.15s ease';
        boss.style.opacity = '0';

        const t = setTimeout(() => {
            // 2. reposition
            boss.style.animation = 'none';
            boss.style.position = 'fixed';
            boss.style.right = 'auto';
            boss.style.bottom = 'auto';
            boss.style.left  = tgtLeft + 'px';
            boss.style.top   = tgtTop  + 'px';
            boss.style.width = '185px';
            boss.style.transform = 'scaleX(-1)'; // 이제 오른쪽(자주색 원)을 향함
            boss.style.zIndex = '500';

            // 3. flash 등장
            boss.style.filter = 'brightness(4) drop-shadow(0 0 30px rgba(124,58,237,1))';
            boss.style.opacity = '1';

            const t2 = setTimeout(() => {
                boss.style.transition = 'filter 0.4s';
                boss.style.filter = 'drop-shadow(0 0 18px rgba(124,58,237,0.85))';
                if (onDone) onDone();
            }, 220);
            this.timeouts.push(t2);
        }, 180);
        this.timeouts.push(t);
    }

    // ─────────────────────────────────────────────────────────────
    // BATTLE SEQUENCE
    // ─────────────────────────────────────────────────────────────
    startBattle(onComplete) {
        const T = (ms, fn) => { const id = setTimeout(fn, ms); this.timeouts.push(id); };

        T(200,  () => this._bossRiftAttack());
        T(900,  () => this._purpleLightningAttack());
        T(2000, () => this._bossLaserAttack());
        T(3100, () => this._restoreRift());
        T(4400, () => {
            this._showResult();
            T(750, () => {
                this._cleanup();
                if (onComplete) onComplete();
            });
        });
    }

    // ── A. BOSS → TEXT RIFT ──────────────────────────────────────
    _bossRiftAttack() {
        // Shake card
        const card = document.getElementById('book-content');
        if (card) {
            card.classList.add('pang-shake');
            const t = setTimeout(() => card.classList.remove('pang-shake'), 430);
            this.timeouts.push(t);
        }
        // Ink splatter
        this._spawnSplatter();
        // Corrupt random words
        const words = Array.from(document.querySelectorAll('.tr-word.revealed'));
        if (words.length < 5) return;
        const count = Math.min(Math.floor(words.length * 0.2), 14);
        this.riftedWords = [...words].sort(() => Math.random() - 0.5).slice(0, count);
        this.riftedWords.forEach(w => w.classList.add('rift-corrupted'));
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
            dot.style.left = cx + 'px';
            dot.style.top  = cy + 'px';
            document.body.appendChild(dot);
            const angle = -Math.PI * 0.7 + Math.random() * Math.PI * 0.6;
            const spd = 55 + Math.random() * 90;
            let x = cx, y = cy, life = 1;
            const vx = Math.cos(angle) * spd * 0.06;
            const vy = Math.sin(angle) * spd * 0.06;
            const tick = () => {
                x += vx; y += vy; life -= 0.04;
                dot.style.left = x + 'px';
                dot.style.top  = y + 'px';
                dot.style.opacity = life;
                if (life > 0) requestAnimationFrame(tick); else dot.remove();
            };
            requestAnimationFrame(tick);
        }
    }

    // ── B. PURPLE ORB → BOSS LIGHTNING ──────────────────────────
    _purpleLightningAttack() {
        const boss = document.getElementById('read-boss-overlay');
        const pangLayer = document.getElementById('pang-marker-layer');
        if (!boss) return;

        const br = boss.getBoundingClientRect();
        const tgtX = br.left + br.width * 0.5;
        const tgtY = br.top + br.height * 0.38;

        const markers = pangLayer ? Array.from(pangLayer.querySelectorAll('.pang-marker')) : [];
        const sources = markers.length
            ? markers.map(m => { const r = m.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })
            : [{ x: window.innerWidth - 22, y: window.innerHeight * 0.35 },
               { x: window.innerWidth - 22, y: window.innerHeight * 0.50 },
               { x: window.innerWidth - 22, y: window.innerHeight * 0.65 }];

        const svg = this._createSVG('battle-lightning-svg', 460);
        let frame = 0;
        const MAX = 28;
        const render = () => {
            svg.innerHTML = '';
            sources.forEach(src => {
                const pts = this._zigzag(src.x, src.y, tgtX, tgtY, 9);
                const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
                poly.setAttribute('fill', 'none');
                poly.setAttribute('stroke', frame % 2 === 0 ? '#dd88ff' : '#ffffff');
                poly.setAttribute('stroke-width', (2 + Math.random() * 2).toFixed(1));
                poly.setAttribute('opacity', (0.75 + Math.random() * 0.25).toFixed(2));
                svg.appendChild(poly);
            });
            frame++;
            if (frame < MAX) {
                this.animIds.push(requestAnimationFrame(render));
            } else {
                svg.style.transition = 'opacity 0.25s';
                svg.style.opacity = '0';
                setTimeout(() => svg.remove(), 280);
                // Boss hit flash
                boss.style.transition = 'filter 0.12s';
                boss.style.filter = 'brightness(5) drop-shadow(0 0 25px #fff)';
                setTimeout(() => {
                    boss.style.filter = 'drop-shadow(0 0 18px rgba(124,58,237,0.85))';
                }, 220);
            }
        };
        this.animIds.push(requestAnimationFrame(render));
    }

    // ── C. BOSS → PURPLE ORB LASER ──────────────────────────────
    _bossLaserAttack() {
        const boss = document.getElementById('read-boss-overlay');
        const pangLayer = document.getElementById('pang-marker-layer');
        if (!boss) return;

        const br = boss.getBoundingClientRect();
        const srcX = br.left + br.width * 0.62;
        const srcY = br.top + br.height * 0.36;

        const beamCount = this.hp > 50 ? 3 : 1;
        const markers = pangLayer ? Array.from(pangLayer.querySelectorAll('.pang-marker')).slice(0, beamCount) : [];
        const targets = markers.length
            ? markers.map(m => { const r = m.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })
            : Array.from({ length: beamCount }, (_, i) => ({ x: window.innerWidth - 22, y: window.innerHeight * (0.3 + i * 0.2) }));

        const svg = this._createSVG('battle-laser-svg', 460);
        let prog = 0;
        const render = () => {
            svg.innerHTML = '';
            targets.forEach((tgt, i) => {
                const ex = srcX + (tgt.x - srcX) * prog;
                const ey = srcY + (tgt.y - srcY) * prog + (i - (beamCount - 1) / 2) * 12;
                // outer glow
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                g.setAttribute('x1', srcX); g.setAttribute('y1', srcY + (i - (beamCount-1)/2) * 6);
                g.setAttribute('x2', ex);   g.setAttribute('y2', ey);
                g.setAttribute('stroke', '#ff6600'); g.setAttribute('stroke-width', '7'); g.setAttribute('opacity', '0.28');
                svg.appendChild(g);
                // core
                const c = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                c.setAttribute('x1', srcX); c.setAttribute('y1', srcY + (i - (beamCount-1)/2) * 6);
                c.setAttribute('x2', ex);   c.setAttribute('y2', ey);
                c.setAttribute('stroke', '#ff2020'); c.setAttribute('stroke-width', '2.5');
                svg.appendChild(c);
            });
            prog = Math.min(1, prog + 0.055);
            if (prog < 1) {
                this.animIds.push(requestAnimationFrame(render));
            } else {
                const t = setTimeout(() => {
                    svg.style.transition = 'opacity 0.3s';
                    svg.style.opacity = '0';
                    setTimeout(() => svg.remove(), 350);
                }, 420);
                this.timeouts.push(t);
                // Orb hit reaction
                markers.forEach(m => {
                    m.style.transform = 'scale(1.45)';
                    setTimeout(() => { m.style.transform = ''; }, 200);
                });
            }
        };
        this.animIds.push(requestAnimationFrame(render));
    }

    // ── D. RESTORE RIFT ──────────────────────────────────────────
    _restoreRift() {
        this.riftedWords.forEach((w, i) => {
            const t = setTimeout(() => {
                w.classList.remove('rift-corrupted');
                w.classList.add('rift-restored');
                setTimeout(() => w.classList.remove('rift-restored'), 600);
            }, i * 75);
            this.timeouts.push(t);
        });
        this.riftedWords = [];
    }

    // ── E. RESULT ────────────────────────────────────────────────
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

    // ── CLEANUP ──────────────────────────────────────────────────
    _cleanup() {
        const boss = document.getElementById('read-boss-overlay');
        if (boss) {
            boss.style.cssText = '';          // 모든 인라인 스타일 제거
            boss.style.animation = 'none';    // float 잠시 중단
            const t = setTimeout(() => {
                boss.style.animation = '';    // CSS 애니메이션 복원
            }, 50);
            this.timeouts.push(t);
        }
        document.getElementById('battle-lightning-svg')?.remove();
        document.getElementById('battle-laser-svg')?.remove();
        document.querySelectorAll('.rift-corrupted').forEach(el => el.classList.remove('rift-corrupted'));

        // HP 리셋 (다음 문단 대비)
        this.hp = 100;
        this.pangsInReading = 0;
        if (this.hpFillEl) {
            this.hpFillEl.style.width = '100%';
            this.hpFillEl.style.background = '';
        }
        this.showHPBar();
    }

    reset() {
        this.timeouts.forEach(clearTimeout);
        this.timeouts = [];
        this.animIds.forEach(cancelAnimationFrame);
        this.animIds = [];
        this._cleanup();
    }

    // ── UTILITIES ────────────────────────────────────────────────
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
