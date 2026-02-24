/**
 * FinalQuizManager.js
 * 최종빌런 화면: 지문 스트리밍(TextRenderer 방식) → 문제 표시 → 4지선다 → score 화면
 *
 * [텍스트 스트리밍]
 *  - TextRenderer(TextRendererV2.js)와 동일한 방식:
 *    span.className = "tr-word", opacity:"0" 으로 생성 → opacity:"1" + classList.add("revealed") 로 reveal
 *  - 새로운 CSS animation 없이 기존 인프라 재사용
 *
 * [Score Fix]
 *  - Game.scoreManager 에서 실제 누적값(ink, rune, gem, wpm) 읽어서 Game.goToNewScore(scoreData) 전달
 */
export class FinalQuizManager {
    constructor() {
        this.phase = 'idle'; // 'idle' | 'reading' | 'choosing' | 'done'
        this._streamTimer = null;
        this._wordIndex = 0;
        this._words = [];
        this._spans = []; // DOM span 참조 배열
    }

    // ── 진입점 ──────────────────────────────────────────────────────────────
    init() {
        try {
            console.log('[FinalQuiz] ▶ init() START');

            this.phase = 'idle';
            this._clearTimer();
            this._wordIndex = 0;
            this._words = [];
            this._spans = [];

            // 1. WPM 취득 (HUD 실측값) — TextRenderer revealChunk interval 계산과 동일 방식
            const rawWPM = (window.Game?.scoreManager?.wpmDisplay) ?? 0;
            const wpm = (rawWPM > 30) ? Math.round(rawWPM) : 150;
            // TextRenderer.revealChunk의 default interval 150ms에 맞춤
            // WPM 150 → 400ms/word, WPM 300 → 200ms/word (읽기 속도에 비례)
            const msPerWord = Math.max(100, Math.round(60000 / wpm * 0.6));
            console.log(`[FinalQuiz] wpm=${wpm} (raw=${rawWPM}), msPerWord=${msPerWord}ms`);

            // 2. 화면 요소 보장 + 초기화
            this._ensureUI();
            this._resetUI();
            console.log('[FinalQuiz] UI ensured + reset');

            // 3. 스트리밍 시작 (TextRenderer 방식 — tr-word span + opacity reveal)
            this.phase = 'reading';
            this._streamTextTR(FINAL_QUIZ_DATA.passage, msPerWord, () => {
                setTimeout(() => {
                    try { this._showQuestion(); }
                    catch (e) { console.error('[FinalQuiz] _showQuestion error:', e); }
                }, 800);
            });
            console.log('[FinalQuiz] ▶ streaming started (TextRenderer style)');

        } catch (e) {
            console.error('[FinalQuiz] FATAL in init():', e);
        }
    }

    // ── DOM 보장 ────────────────────────────────────────────────────────────
    _ensureUI() {
        const container = document.getElementById('screen-final-quiz');
        if (!container) {
            console.warn('[FinalQuiz] #screen-final-quiz NOT FOUND. Injecting dynamically.');
            this._injectScreen();
            return;
        }
        if (!document.getElementById('fq-passage-text')) {
            console.warn('[FinalQuiz] fq-passage-text missing, rebuilding innerHTML');
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
            background: 'radial-gradient(circle at center, #1a0830 0%, #0a0515 100%)',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
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
                 filter:drop-shadow(0 0 16px rgba(180,0,255,0.7));"
          onerror="this.style.display='none'">
        <p style="font-family:'Cinzel',serif;color:#c060ff;font-size:1.0rem;letter-spacing:2px;margin:0 0 18px 0;text-shadow:0 0 12px rgba(180,0,255,0.8);">
          FINAL CHALLENGE
        </p>
        <div style="max-width:480px;width:90%;background:rgba(255,255,255,0.04);border:1px solid rgba(180,0,255,0.25);border-radius:16px;padding:24px;margin-bottom:24px;min-height:120px;">
          <p id="fq-passage-text"
            style="font-family:'Crimson Text',serif;font-size:1.15rem;line-height:1.9;color:#ddd;margin:0;transition:opacity 0.5s ease;"></p>
        </div>
        <p id="fq-question"
          style="display:none;font-family:'Outfit','Segoe UI',sans-serif;font-size:1.05rem;color:#e0d0ff;text-align:center;max-width:480px;width:90%;margin-bottom:16px;font-weight:600;line-height:1.5;"></p>
        <p id="fq-result"
          style="display:none;font-size:1.2rem;font-weight:bold;margin-bottom:16px;text-shadow:0 0 10px currentColor;"></p>
        <div id="fq-choices"
          style="display:none;opacity:0;flex-direction:column;gap:12px;width:90%;max-width:480px;transition:opacity 0.4s ease;">
        </div>
        `;
    }

    // ── UI 초기화 ────────────────────────────────────────────────────────────
    _resetUI() {
        const textEl = document.getElementById('fq-passage-text');
        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');
        const resultEl = document.getElementById('fq-result');

        if (textEl) { textEl.innerHTML = ''; textEl.style.opacity = '1'; }
        if (questionEl) { questionEl.style.display = 'none'; questionEl.textContent = ''; }
        if (choicesEl) { choicesEl.style.display = 'none'; choicesEl.style.opacity = '0'; choicesEl.innerHTML = ''; }
        if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }

        if (!textEl) console.error('[FinalQuiz] fq-passage-text still missing after ensureUI!');
        if (!choicesEl) console.error('[FinalQuiz] fq-choices still missing after ensureUI!');
    }

    // ── TextRenderer 방식 텍스트 스트리밍 ──────────────────────────────────
    // TextRendererV2.js prepareDynamic() / revealChunk() 와 동일한 패턴:
    //   span.className = "tr-word", opacity = "0" → 시간 경과 후 opacity = "1" + classList.add("revealed")
    _streamTextTR(passage, msPerWord, onComplete) {
        const textEl = document.getElementById('fq-passage-text');
        if (!textEl) {
            console.error('[FinalQuiz] _streamTextTR: fq-passage-text not found');
            onComplete?.();
            return;
        }

        const words = passage.split(/\s+/).filter(w => w.length > 0);
        this._words = words;
        this._spans = [];
        textEl.innerHTML = '';

        // Step 1: 모든 단어를 tr-word span으로 생성 (opacity=0) — TextRenderer.prepareDynamic와 동일
        words.forEach((word, i) => {
            const span = document.createElement('span');
            span.className = 'tr-word';                    // TextRenderer와 동일한 class
            span.style.opacity = '0';                      // TextRenderer: span.style.opacity = "0"
            span.style.display = 'inline-block';           // TextRenderer와 동일
            span.style.marginRight = '0.3em';              // TextRenderer: this.options.wordSpacing
            span.style.lineHeight = '1.8';
            span.style.fontSize = '0.92rem';               // ← 기존 1.15rem의 80%
            span.style.verticalAlign = 'middle';
            span.style.color = '#ddd';
            span.style.transition = 'opacity 0.15s ease'; // 부드러운 reveal
            span.dataset.index = i;
            span.textContent = word;
            textEl.appendChild(span);
            this._spans.push(span);
        });

        console.log(`[FinalQuiz] streaming ${words.length} words @ ${msPerWord}ms/word (TextRenderer style)`);

        // Step 2: 순차 reveal — TextRenderer.revealChunk의 opacity="1" + classList.add("revealed")
        let idx = 0;
        const revealNext = () => {
            if (this.phase !== 'reading') return; // 화면 이탈 시 중단

            if (idx >= this._spans.length) {
                this._clearTimer();
                console.log('[FinalQuiz] streaming complete');
                onComplete?.();
                return;
            }

            const span = this._spans[idx++];
            span.style.opacity = '1';                    // TextRenderer: w.element.style.opacity = "1"
            span.classList.add('revealed');              // TextRenderer: w.element.classList.add("revealed")

            this._streamTimer = setTimeout(revealNext, msPerWord);
        };

        this._streamTimer = setTimeout(revealNext, 0);
    }

    // ── 문제 표시 (지문 유지 + 문제·선택지 fade-in) ──────────────────────────
    _showQuestion() {
        if (this.phase !== 'reading') return;
        this.phase = 'choosing';

        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');

        // ⬇ 지문은 사라지지 않음 — 바로 문제 텍스트 표시
        if (questionEl) {
            questionEl.textContent = FINAL_QUIZ_DATA.question;
            questionEl.style.opacity = '0';
            questionEl.style.display = 'block';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    questionEl.style.transition = 'opacity 0.5s ease';
                    questionEl.style.opacity = '1';
                });
            });
        }

        if (!choicesEl) {
            console.error('[FinalQuiz] fq-choices not found — cannot show buttons');
            return;
        }

        // 선택지 버튼 생성
        choicesEl.innerHTML = '';
        FINAL_QUIZ_DATA.options.forEach((optText, i) => {
            const btn = document.createElement('button');
            btn.className = 'fq-option-btn';
            btn.textContent = optText;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                background: 'rgba(130,30,220,0.15)',
                border: '1px solid rgba(180,0,255,0.4)',
                color: '#e0ccff',
                padding: '12px 16px',
                borderRadius: '12px',
                fontSize: '0.9rem',
                fontFamily: "'Outfit','Segoe UI',sans-serif",
                textAlign: 'left',
                cursor: 'pointer',
                marginBottom: '0',
            });
            btn.onmouseover = () => { btn.style.background = 'rgba(130,30,220,0.35)'; };
            btn.onmouseout = () => { btn.style.background = 'rgba(130,30,220,0.15)'; };
            btn.onclick = () => this._onAnswer(i, FINAL_QUIZ_DATA.answer);
            choicesEl.appendChild(btn);
        });

        // 선택지 fade-in
        choicesEl.style.opacity = '0';
        choicesEl.style.display = 'flex';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                choicesEl.style.transition = 'opacity 0.5s ease';
                choicesEl.style.opacity = '1';
            });
        });

        console.log('[FinalQuiz] question + choices displayed (passage kept visible)');
    }

    // ── 정답 처리 ────────────────────────────────────────────────────────────
    _onAnswer(selectedIdx, correctIdx) {
        if (this.phase !== 'choosing') return;
        this.phase = 'done';

        console.log(`[FinalQuiz] answer: selected=${selectedIdx}, correct=${correctIdx}`);

        const btns = document.querySelectorAll('.fq-option-btn');
        const resultEl = document.getElementById('fq-result');

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
            if (window.Game?.addGems) window.Game.addGems(-30);
            console.log('[FinalQuiz] WRONG -30 gems');
        }

        // 1.5초 후 score 화면으로 이동
        // [Score Fix] Game.state 는 playNextParagraph()에서 ink=0 리셋되므로
        // scoreManager(ScoreManager 인스턴스)의 실제 누적값을 읽어서 전달
        setTimeout(() => {
            console.log('[FinalQuiz] → goToNewScore()');
            if (window.Game?.goToNewScore) {
                const sm = window.Game.scoreManager;
                const scoreData = {
                    ink: sm?.ink ?? window.Game.state?.ink ?? 0,
                    rune: sm?.rune ?? sm?.runes ?? window.Game.state?.rune ?? 0,
                    gem: sm?.gems ?? window.Game.state?.gems ?? 0,
                    wpm: sm?.wpmDisplay ?? sm?.wpm ?? window.Game.state?.wpmDisplay ?? 150,
                };
                console.log('[FinalQuiz] scoreData =', JSON.stringify(scoreData));
                window.Game.goToNewScore(scoreData);
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
        this._spans = [];
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
