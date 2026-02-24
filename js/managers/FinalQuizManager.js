/**
 * FinalQuizManager.js
 * 신규 최종빌런 화면: 지문 WPM 스트리밍 → 4지선다 정답 → gem 증감 → score 화면 전환
 *
 * [방어 설계]
 *  - DOM 요소가 없으면 직접 생성 (HTML 캐시 미스 대비)
 *  - 모든 단계 try/catch + 로그
 *  - WPM은 Game.scoreManager.wpmDisplay (HUD 실측값)
 */
export class FinalQuizManager {
    constructor() {
        this.phase = 'idle'; // 'idle' | 'reading' | 'choosing' | 'done'
        this._streamTimer = null;
        this._wordIndex = 0;
        this._words = [];
    }

    // ── 진입점 ──────────────────────────────────────────────────────────────
    init() {
        try {
            console.log('[FinalQuiz] ▶ init() START');

            this.phase = 'idle';
            this._clearTimer();
            this._wordIndex = 0;
            this._words = [];

            // 1. WPM 취득 (HUD 실측값)
            const rawWPM = (window.Game?.scoreManager?.wpmDisplay) || 0;
            const wpm = (rawWPM > 30) ? Math.round(rawWPM) : 150;
            const msPerWord = Math.round(60000 / wpm);
            console.log(`[FinalQuiz] wpm=${wpm} (raw=${rawWPM.toFixed(1)}), msPerWord=${msPerWord}ms`);

            // 2. 화면 요소 보장 + 초기화
            this._ensureUI();
            this._resetUI();
            console.log('[FinalQuiz] UI ensured + reset');

            // 3. 스트리밍 시작
            this.phase = 'reading';
            this._streamText(FINAL_QUIZ_DATA.passage, msPerWord, () => {
                setTimeout(() => {
                    try { this._showChoices(); }
                    catch (e) { console.error('[FinalQuiz] _showChoices error:', e); }
                }, 1000);
            });
            console.log('[FinalQuiz] ▶ streaming started');

        } catch (e) {
            console.error('[FinalQuiz] FATAL in init():', e);
        }
    }

    // ── DOM 보장 (HTML 캐시에 구 버전이 있을 때 스스로 생성) ────────────────
    _ensureUI() {
        const container = document.getElementById('screen-final-quiz');
        if (!container) {
            // screen-final-quiz 자체가 없는 경우 — game-ui에 직접 주입
            console.warn('[FinalQuiz] #screen-final-quiz NOT FOUND. Injecting dynamically.');
            this._injectScreen();
            return;
        }

        // 개별 요소 확인 + 없으면 삽입
        if (!document.getElementById('fq-passage-text')) {
            console.warn('[FinalQuiz] fq-passage-text missing, injecting into container');
            container.innerHTML = this._buildInnerHTML();
        }
    }

    _injectScreen() {
        const gameUI = document.getElementById('game-ui') || document.body;

        const section = document.createElement('section');
        section.id = 'screen-final-quiz';
        section.className = 'screen';
        Object.assign(section.style, {
            display: 'none',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at center, #1a0830 0%, #0a0515 100%)',
            padding: '30px 20px',
        });

        section.innerHTML = this._buildInnerHTML();
        gameUI.appendChild(section);
        console.log('[FinalQuiz] #screen-final-quiz dynamically injected');
    }

    _buildInnerHTML() {
        return `
        <img src="./finalredvillain.png" alt="Final Villain"
          style="width:100px;height:auto;object-fit:contain;margin-bottom:16px;
                 filter:drop-shadow(0 0 16px rgba(180,0,255,0.7));animation:fq-float 3s ease-in-out infinite;">
        <p style="font-family:'Cinzel',serif;color:#c060ff;font-size:1.0rem;letter-spacing:2px;margin:0 0 18px 0;text-shadow:0 0 12px rgba(180,0,255,0.8);">
          FINAL CHALLENGE
        </p>
        <div style="max-width:480px;width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(180,0,255,0.25);border-radius:16px;padding:24px;margin-bottom:24px;min-height:120px;">
          <p id="fq-passage-text"
            style="font-family:'Georgia',serif;font-size:1.05rem;line-height:1.9;color:#ddd;margin:0;white-space:pre-wrap;transition:opacity 0.5s ease;">
          </p>
        </div>
        <p id="fq-result" style="display:none;font-size:1.2rem;font-weight:bold;margin-bottom:16px;text-shadow:0 0 10px currentColor;"></p>
        <div id="fq-choices"
          style="display:none;opacity:0;flex-direction:column;gap:12px;width:100%;max-width:480px;transition:opacity 0.4s ease;">
        </div>
        `;
    }

    // ── UI 초기화 ────────────────────────────────────────────────────────────
    _resetUI() {
        const textEl = document.getElementById('fq-passage-text');
        const choicesEl = document.getElementById('fq-choices');
        const resultEl = document.getElementById('fq-result');

        if (textEl) { textEl.textContent = ''; textEl.style.opacity = '1'; }
        if (choicesEl) { choicesEl.style.display = 'none'; choicesEl.style.opacity = '0'; choicesEl.innerHTML = ''; }
        if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }

        if (!textEl) console.error('[FinalQuiz] fq-passage-text still missing after ensureUI!');
        if (!choicesEl) console.error('[FinalQuiz] fq-choices still missing after ensureUI!');
    }

    // ── 텍스트 스트리밍 ──────────────────────────────────────────────────────
    _streamText(passage, msPerWord, onComplete) {
        const textEl = document.getElementById('fq-passage-text');
        if (!textEl) {
            console.error('[FinalQuiz] _streamText: fq-passage-text not found, skipping to choices');
            onComplete?.();
            return;
        }

        this._words = passage.split(/\s+/).filter(w => w.length > 0);
        this._wordIndex = 0;
        textEl.textContent = '';
        console.log(`[FinalQuiz] streaming ${this._words.length} words @ ${msPerWord}ms/word`);

        const step = () => {
            if (this.phase !== 'reading') return; // 화면 이탈 시 중지

            if (this._wordIndex >= this._words.length) {
                this._clearTimer();
                console.log('[FinalQuiz] streaming complete');
                onComplete?.();
                return;
            }

            const word = this._words[this._wordIndex++];
            textEl.textContent += (this._wordIndex > 1 ? ' ' : '') + word;
            this._streamTimer = setTimeout(step, msPerWord);
        };

        this._streamTimer = setTimeout(step, 0);
    }

    // ── 선택지 표시 ──────────────────────────────────────────────────────────
    _showChoices() {
        if (this.phase !== 'reading') return;
        this.phase = 'choosing';

        const textEl = document.getElementById('fq-passage-text');
        const choicesEl = document.getElementById('fq-choices');

        if (textEl) {
            textEl.style.transition = 'opacity 0.5s ease';
            textEl.style.opacity = '0';
        }

        setTimeout(() => {
            if (!choicesEl) {
                console.error('[FinalQuiz] fq-choices not found — cannot show buttons');
                return;
            }

            choicesEl.innerHTML = '';
            FINAL_QUIZ_DATA.options.forEach((optText, i) => {
                const btn = document.createElement('button');
                btn.className = 'fq-option-btn';
                btn.textContent = optText;
                // inline style fallback (CSS가 캐시 미스인 경우 대비)
                Object.assign(btn.style, {
                    display: 'block',
                    width: '100%',
                    background: 'rgba(130,30,220,0.15)',
                    border: '1px solid rgba(180,0,255,0.4)',
                    color: '#e0ccff',
                    padding: '14px 18px',
                    borderRadius: '12px',
                    fontSize: '1rem',
                    fontFamily: "'Outfit','Segoe UI',sans-serif",
                    textAlign: 'left',
                    cursor: 'pointer',
                    marginBottom: '0',
                    animationDelay: `${i * 0.12}s`,
                });
                btn.onmouseover = () => { btn.style.background = 'rgba(130,30,220,0.35)'; };
                btn.onmouseout = () => { btn.style.background = 'rgba(130,30,220,0.15)'; };
                btn.onclick = () => this._onAnswer(i, FINAL_QUIZ_DATA.answer);
                choicesEl.appendChild(btn);
            });

            choicesEl.style.display = 'flex';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    choicesEl.style.transition = 'opacity 0.4s ease';
                    choicesEl.style.opacity = '1';
                });
            });

            console.log('[FinalQuiz] choices displayed');
        }, 500);
    }

    // ── 정답 처리 ────────────────────────────────────────────────────────────
    _onAnswer(selectedIdx, correctIdx) {
        if (this.phase !== 'choosing') return;
        this.phase = 'done';

        console.log(`[FinalQuiz] answer: selected=${selectedIdx}, correct=${correctIdx}`);

        const btns = document.querySelectorAll('.fq-option-btn');
        const resultEl = document.getElementById('fq-result');

        // 모든 버튼 비활성화
        btns.forEach(b => { b.style.pointerEvents = 'none'; });

        const isCorrect = (selectedIdx === correctIdx);

        if (isCorrect) {
            btns[selectedIdx].style.background = 'linear-gradient(135deg,#1a7a2e,#2db84a)';
            btns[selectedIdx].style.borderColor = '#2db84a';
            btns[selectedIdx].style.boxShadow = '0 0 20px rgba(45,184,74,0.6)';

            if (resultEl) {
                resultEl.textContent = '✓ Correct!  +50 💎';
                resultEl.style.color = '#2db84a';
                resultEl.style.display = 'block';
            }

            // Flying gem 애니메이션 + gem 추가
            const btn = btns[selectedIdx];
            if (btn && window.Game?.spawnFlyingResource) {
                const r = btn.getBoundingClientRect();
                window.Game.spawnFlyingResource(r.left + r.width / 2, r.top + r.height / 2, 50, 'gem');
            } else if (window.Game?.addGems) {
                window.Game.addGems(50);
            }
            console.log('[FinalQuiz] CORRECT +50 gems');

        } else {
            btns[selectedIdx].style.background = 'linear-gradient(135deg,#7a1a1a,#b82d2d)';
            btns[selectedIdx].style.borderColor = '#b82d2d';
            btns[selectedIdx].style.boxShadow = '0 0 20px rgba(184,45,45,0.6)';

            if (correctIdx < btns.length) {
                btns[correctIdx].style.background = 'linear-gradient(135deg,#1a7a2e,#2db84a)';
                btns[correctIdx].style.borderColor = '#2db84a';
            }

            if (resultEl) {
                resultEl.textContent = '✗ Wrong!  -30 💎';
                resultEl.style.color = '#e05555';
                resultEl.style.display = 'block';
            }

            if (window.Game?.addGems) {
                window.Game.addGems(-30);
            }
            console.log('[FinalQuiz] WRONG -30 gems');
        }

        // 1.5초 후 score 화면으로
        setTimeout(() => {
            console.log('[FinalQuiz] → goToNewScore()');
            if (window.Game?.goToNewScore) {
                window.Game.goToNewScore({
                    ink: window.Game.state?.ink ?? 0,
                    rune: window.Game.state?.rune ?? 0,
                    gem: window.Game.state?.gems ?? 0,
                    wpm: window.Game.scoreManager?.wpmDisplay ?? 150,
                });
            }
        }, 1500);
    }

    // ── 정리 ────────────────────────────────────────────────────────────────
    _clearTimer() {
        if (this._streamTimer !== null) {
            clearTimeout(this._streamTimer);
            this._streamTimer = null;
        }
    }

    destroy() {
        this._clearTimer();
        this.phase = 'idle';
        this._wordIndex = 0;
        this._words = [];
        console.log('[FinalQuiz] destroyed');
    }
}

// ── 퀴즈 데이터 (이상한 나라의 앨리스 지문 1·2·3 종합) ──────────────────────
export const FINAL_QUIZ_DATA = {
    passage:
        "Alice had always found the world perfectly ordinary— " +
        "until a White Rabbit rushed past her, muttering anxiously. " +
        "She tumbled into a hole where size and logic meant nothing. " +
        "Strange labels dared her to drink; tiny cakes made her grow tall. " +
        "In Wonderland, the rules she had always known no longer applied.",

    question: "What best describes what Alice discovered about Wonderland?",

    options: [
        "A. Rabbits in Wonderland can speak human language.",
        "B. Its rules of size and logic are completely unlike the real world.",
        "C. It is a dangerous place that Alice wants to escape from immediately.",
        "D. Following rules carefully is the only way to survive there."
    ],

    answer: 1  // B
};
