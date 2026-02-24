/**
 * FinalQuizManager.js
 * 최종빌런 화면: 지문 스트리밍(TextRenderer 방식) → 문제 표시 → 4지선다 → score 화면
 *
 * [타이머]
 *  - 1분(60초) 카운트다운 — 우측 상단 표시
 *  - 시간 종료 → 자동 score 화면 이동
 *  - 정답 선택 시 타이머 중단 → 1.5초 후 score 이동
 *
 * [오답 처리]
 *  - 오답 선택: -10 💎, 정답 초록 표시, 화면 유지 (타이머는 계속)
 *  - 타이머 종료 or 정답 선택 시만 score 화면으로 이동
 */
export class FinalQuizManager {
    constructor() {
        this.phase = 'idle'; // 'idle' | 'reading' | 'choosing' | 'done'
        this._streamTimer = null;
        this._wordIndex = 0;
        this._words = [];
        this._spans = [];
        // ── 카운트다운 타이머 ──
        this._countdownInterval = null;
        this._secondsLeft = 60;
    }

    // ── 진입점 ──────────────────────────────────────────────────────────────
    init() {
        try {
            console.log('[FinalQuiz] ▶ init() START');

            this.phase = 'idle';
            this._clearTimer();
            this._clearCountdown();
            this._secondsLeft = 60;
            this._wordIndex = 0;
            this._words = [];
            this._spans = [];

            // 1. WPM 취득 (HUD 실측값)
            const rawWPM = (window.Game?.scoreManager?.wpmDisplay) ?? 0;
            const wpm = (rawWPM > 30) ? Math.round(rawWPM) : 150;
            const msPerWord = Math.max(50, Math.round(60000 / wpm * 0.3));
            console.log(`[FinalQuiz] wpm=${wpm} (raw=${rawWPM}), msPerWord=${msPerWord}ms`);

            // 2. 화면 요소 보장 + 초기화
            this._ensureUI();
            this._resetUI();
            console.log('[FinalQuiz] UI ensured + reset');

            // 타이머 초기 표시 (1:00) — 아직 시작 안 함
            this._updateTimerDisplay();

            // 3. 스트리밍 시작 (타이머는 지문이 나오자마자 시작)
            this.phase = 'reading';
            this._startCountdown(60); // ← 지문 표시 시작과 동시에 카운트다운
            this._streamTextTR(FINAL_QUIZ_DATA.passage, msPerWord, () => {
                setTimeout(() => {
                    try { this._showQuestion(); }
                    catch (e) { console.error('[FinalQuiz] _showQuestion error:', e); }
                }, 800);
            });
            console.log('[FinalQuiz] ▶ streaming started + timer running');

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
            position: 'relative',
            background: 'radial-gradient(circle at center, #1a0830 0%, #0a0515 100%)',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: '0',
            overflowY: 'auto',
            overflowX: 'hidden',
        });
        section.innerHTML = this._buildInnerHTML();
        gameUI.appendChild(section);
        console.log('[FinalQuiz] #screen-final-quiz dynamically injected');
    }

    _buildInnerHTML() {
        return `
        <style>
          @keyframes fqTimerPulse {
            from { opacity:1; transform:scale(1); }
            to   { opacity:0.5; transform:scale(1.08); }
          }
          @keyframes fqShake {
            0%,100% { transform:translateX(0); }
            15%     { transform:translateX(-8px); }
            35%     { transform:translateX(8px); }
            55%     { transform:translateX(-6px); }
            75%     { transform:translateX(5px); }
          }
        </style>
        <!-- 타이머: 우측 상단 고정 -->
        <div id="fq-timer"
          style="position:absolute;top:10px;right:12px;z-index:10;
                 font-family:'Outfit',monospace;font-size:1.1rem;font-weight:700;
                 color:#00e5ff;text-shadow:0 0 8px rgba(0,229,255,0.7);
                 background:rgba(0,0,0,0.45);border:1px solid rgba(0,229,255,0.3);
                 border-radius:8px;padding:4px 10px;letter-spacing:2px;">
          1:00
        </div>

        <!-- 헤더: 빌런 이미지 + 타이틀 -->
        <div style="display:flex;flex-direction:column;align-items:center;
                    padding:16px 16px 8px 16px;width:100%;box-sizing:border-box;
                    background:linear-gradient(180deg,rgba(60,0,100,0.5) 0%,transparent 100%);
                    flex-shrink:0;">
          <img src="./finalredvillain.png" alt="Final Villain"
            style="width:72px;height:auto;object-fit:contain;margin-bottom:8px;
                   filter:drop-shadow(0 0 14px rgba(180,0,255,0.8));"
            onerror="this.style.display='none'">
          <p style="font-family:'Cinzel',serif;color:#c060ff;font-size:0.9rem;
                    letter-spacing:3px;margin:0;text-shadow:0 0 12px rgba(180,0,255,0.9);">
            FINAL CHALLENGE
          </p>
        </div>

        <!-- 콘텐츠: 지문 + 문제 + 선택지 -->
        <div style="display:flex;flex-direction:column;align-items:center;width:100%;
                    padding:8px 12px 24px 12px;box-sizing:border-box;gap:12px;">
          <div style="width:100%;max-width:680px;background:rgba(255,255,255,0.05);
                      border:1px solid rgba(180,0,255,0.3);border-radius:14px;
                      padding:18px 20px;box-sizing:border-box;min-height:80px;">
            <p id="fq-passage-text"
              style="font-family:'Crimson Text',serif;font-size:1.0rem;line-height:1.85;
                     color:#e0e0e0;margin:0;text-align:left;transition:opacity 0.5s ease;"></p>
          </div>
          <p id="fq-question"
            style="display:none;font-family:'Outfit','Segoe UI',sans-serif;font-size:1.0rem;
                   color:#f0e0ff;text-align:center;width:100%;max-width:680px;margin:0;
                   font-weight:700;line-height:1.6;padding:10px 4px;
                   border-top:1px solid rgba(180,0,255,0.2);"></p>
          <p id="fq-result"
            style="display:none;font-size:1.0rem;font-weight:bold;margin:0;
                   text-shadow:0 0 10px currentColor;"></p>
          <div id="fq-choices"
            style="display:none;opacity:0;flex-direction:column;gap:10px;
                   width:100%;max-width:680px;transition:opacity 0.4s ease;padding-bottom:12px;">
          </div>
        </div>
        `;
    }

    // ── UI 초기화 ────────────────────────────────────────────────────────────
    _resetUI() {
        const textEl = document.getElementById('fq-passage-text');
        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');
        const resultEl = document.getElementById('fq-result');
        const timerEl = document.getElementById('fq-timer');

        if (textEl) { textEl.innerHTML = ''; textEl.style.opacity = '1'; }
        if (questionEl) { questionEl.style.display = 'none'; questionEl.textContent = ''; }
        if (choicesEl) { choicesEl.style.display = 'none'; choicesEl.style.opacity = '0'; choicesEl.innerHTML = ''; }
        if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
        if (timerEl) { timerEl.style.color = '#00e5ff'; timerEl.style.animation = 'none'; timerEl.style.borderColor = 'rgba(0,229,255,0.3)'; }

        if (!textEl) console.error('[FinalQuiz] fq-passage-text still missing after ensureUI!');
        if (!choicesEl) console.error('[FinalQuiz] fq-choices still missing after ensureUI!');
    }

    // ── 카운트다운 타이머 ────────────────────────────────────────────────────
    _startCountdown(seconds) {
        this._secondsLeft = seconds;
        this._clearCountdown();
        this._updateTimerDisplay();

        this._countdownInterval = setInterval(() => {
            this._secondsLeft--;
            this._updateTimerDisplay();

            if (this._secondsLeft <= 0) {
                this._clearCountdown();
                console.log('[FinalQuiz] ⏰ Timer expired → goToNewScore()');
                if (this.phase !== 'done') {
                    this.phase = 'done';
                    this._goToScore();
                }
            }
        }, 1000);
    }

    _clearCountdown() {
        if (this._countdownInterval !== null) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }
    }

    _updateTimerDisplay() {
        const el = document.getElementById('fq-timer');
        if (!el) return;

        const m = Math.floor(this._secondsLeft / 60);
        const s = this._secondsLeft % 60;
        el.textContent = `${m}:${s.toString().padStart(2, '0')}`;

        if (this._secondsLeft <= 10) {
            el.style.color = '#ff4444';
            el.style.textShadow = '0 0 10px rgba(255,68,68,0.9)';
            el.style.borderColor = 'rgba(255,68,68,0.5)';
            el.style.animation = 'fqTimerPulse 0.5s ease-in-out infinite alternate';
        } else if (this._secondsLeft <= 30) {
            el.style.color = '#ff9944';
            el.style.textShadow = '0 0 8px rgba(255,153,68,0.8)';
            el.style.borderColor = 'rgba(255,153,68,0.4)';
            el.style.animation = 'none';
        } else {
            el.style.color = '#00e5ff';
            el.style.textShadow = '0 0 8px rgba(0,229,255,0.6)';
            el.style.borderColor = 'rgba(0,229,255,0.3)';
            el.style.animation = 'none';
        }
    }

    // ── Score 화면 이동 헬퍼 ────────────────────────────────────────────────
    _goToScore() {
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
    }

    // ── TextRenderer 방식 텍스트 스트리밍 ──────────────────────────────────
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

        // Step 1: 모든 단어를 tr-word span으로 생성 (opacity=0)
        words.forEach((word, i) => {
            const span = document.createElement('span');
            span.className = 'tr-word';
            span.style.opacity = '0';
            span.style.display = 'inline-block';
            span.style.marginRight = '0.3em';
            span.style.lineHeight = '1.85';
            span.style.fontSize = '1.0rem';
            span.style.verticalAlign = 'middle';
            span.style.color = '#e0e0e0';
            span.style.transition = 'opacity 0.15s ease';
            span.dataset.index = i;
            span.textContent = word;
            textEl.appendChild(span);
            this._spans.push(span);
        });

        console.log(`[FinalQuiz] streaming ${words.length} words @ ${msPerWord}ms/word`);

        // Step 2: 순차 reveal
        let idx = 0;
        const revealNext = () => {
            if (this.phase !== 'reading') return;

            if (idx >= this._spans.length) {
                this._clearTimer();
                console.log('[FinalQuiz] streaming complete');
                onComplete?.();
                return;
            }

            const span = this._spans[idx++];
            span.style.opacity = '1';
            span.classList.add('revealed');

            this._streamTimer = setTimeout(revealNext, msPerWord);
        };

        this._streamTimer = setTimeout(revealNext, 0);
    }

    // ── 문제 표시 ────────────────────────────────────────────────────────────
    _showQuestion() {
        if (this.phase !== 'reading') return;
        this.phase = 'choosing';

        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');

        // 문제 텍스트 fade-in
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
            console.error('[FinalQuiz] fq-choices not found');
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
                transition: 'background 0.2s ease',
            });
            btn.onmouseover = () => { if (btn.style.pointerEvents !== 'none') btn.style.background = 'rgba(130,30,220,0.35)'; };
            btn.onmouseout = () => { if (btn.style.pointerEvents !== 'none') btn.style.background = 'rgba(130,30,220,0.15)'; };
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

        console.log('[FinalQuiz] question + choices displayed (timer already running).');
    }

    // ── 정답 처리 ────────────────────────────────────────────────────────────
    _onAnswer(selectedIdx, correctIdx) {
        if (this.phase !== 'choosing') return;

        console.log(`[FinalQuiz] answer: selected=${selectedIdx}, correct=${correctIdx}`);

        const btns = document.querySelectorAll('.fq-option-btn');
        const resultEl = document.getElementById('fq-result');
        const isCorrect = (selectedIdx === correctIdx);

        if (isCorrect) {
            // ✅ Correct: lock, clear timer, go to score
            this.phase = 'done';
            this._clearCountdown();
            btns.forEach(b => { b.style.pointerEvents = 'none'; b.onmouseover = null; b.onmouseout = null; });

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
            console.log('[FinalQuiz] CORRECT +50 gems → score in 1.5s');
            setTimeout(() => this._goToScore(), 1500);

        } else {
            // ❌ Wrong: shake the clicked button, keep others clickable, English-only message

            // 1. 클릭한 버튼만 비활성화 + 흔들기 애니메이션
            const wrongBtn = btns[selectedIdx];
            if (wrongBtn) {
                wrongBtn.style.pointerEvents = 'none';
                wrongBtn.onmouseover = null;
                wrongBtn.onmouseout = null;
                wrongBtn.style.background = 'rgba(180,30,30,0.35)';
                wrongBtn.style.borderColor = 'rgba(255,80,80,0.55)';
                wrongBtn.style.color = '#ff9999';
                wrongBtn.style.animation = 'fqShake 0.42s ease';
                setTimeout(() => { wrongBtn.style.animation = 'none'; }, 450);
            }

            // 2. 조건부 젬 차감: 현재 보유 젬 >= 10일 때만
            const currentGems = window.Game?.scoreManager?.gems
                ?? window.Game?.state?.gems
                ?? 0;
            let resultMsg = '✗ Wrong!';
            if (currentGems >= 10 && window.Game?.addGems) {
                window.Game.addGems(-10);
                resultMsg = '✗ Wrong!  −10 💎';
            }

            // 3. 결과 메시지 (영문만, 1.5초 후 자동 숨김)
            if (resultEl) {
                resultEl.textContent = resultMsg;
                resultEl.style.color = '#ff7755';
                resultEl.style.display = 'block';
                setTimeout(() => { if (resultEl) resultEl.style.display = 'none'; }, 1800);
            }

            console.log(`[FinalQuiz] WRONG idx=${selectedIdx} — gems=${currentGems}, deducted=${currentGems >= 10}. Retry allowed.`);
        }
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
        this._clearCountdown();
        this.phase = 'idle';
        this._wordIndex = 0;
        this._words = [];
        this._spans = [];
        console.log('[FinalQuiz] destroyed');
    }
}

// ── 퀴즈 데이터 ─────────────────────────────────────────────────────────────
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
