/**
 * FinalQuizManager.js
 * 신규 최종빌런 화면: 지문 WPM 스트리밍 → 4지선다 정답 → gem 증감 → score 화면 전환
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
        this.phase = 'idle';
        this._clearTimer();
        this._wordIndex = 0;
        this._words = [];

        // 1. WPM 취득 (HUD 실측값)
        const rawWPM = (window.Game?.scoreManager?.wpmDisplay) || 0;
        const wpm = (rawWPM > 30) ? Math.round(rawWPM) : 150;
        const msPerWord = Math.round(60000 / wpm);

        console.log(`[FinalQuiz] init: wpm=${wpm} (raw=${rawWPM}), msPerWord=${msPerWord}ms`);

        // 2. 화면 요소 초기화
        this._resetUI();

        // 3. 스트리밍 시작
        this.phase = 'reading';
        this._streamText(FINAL_QUIZ_DATA.passage, msPerWord, () => {
            // 1초 대기 후 선택지 표시
            setTimeout(() => this._showChoices(), 1000);
        });
    }

    // ── UI 초기화 ────────────────────────────────────────────────────────────
    _resetUI() {
        const textEl = document.getElementById('fq-passage-text');
        const choicesEl = document.getElementById('fq-choices');
        const resultEl = document.getElementById('fq-result');

        if (textEl) { textEl.textContent = ''; textEl.style.opacity = '1'; }
        if (choicesEl) { choicesEl.style.display = 'none'; choicesEl.style.opacity = '0'; }
        if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
    }

    // ── 텍스트 스트리밍 ──────────────────────────────────────────────────────
    _streamText(passage, msPerWord, onComplete) {
        const textEl = document.getElementById('fq-passage-text');
        if (!textEl) { onComplete?.(); return; }

        // 5줄 passage를 단어 배열로 변환
        this._words = passage.split(/\s+/).filter(w => w.length > 0);
        this._wordIndex = 0;
        textEl.textContent = '';

        const step = () => {
            if (this.phase !== 'reading') return; // 화면 이탈 시 중지

            if (this._wordIndex >= this._words.length) {
                this._clearTimer();
                onComplete?.();
                return;
            }

            const word = this._words[this._wordIndex++];
            textEl.textContent += (this._wordIndex > 1 ? ' ' : '') + word;

            this._streamTimer = setTimeout(step, msPerWord);
        };

        // 첫 단어는 즉시 시작
        this._streamTimer = setTimeout(step, 0);
    }

    // ── 선택지 표시 ──────────────────────────────────────────────────────────
    _showChoices() {
        if (this.phase !== 'reading') return;
        this.phase = 'choosing';

        // 지문 텍스트 fade-out
        const textEl = document.getElementById('fq-passage-text');
        const choicesEl = document.getElementById('fq-choices');

        if (textEl) {
            textEl.style.transition = 'opacity 0.5s ease';
            textEl.style.opacity = '0';
        }

        setTimeout(() => {
            // 선택지 렌더링
            if (choicesEl) {
                choicesEl.innerHTML = '';

                FINAL_QUIZ_DATA.options.forEach((optText, i) => {
                    const btn = document.createElement('button');
                    btn.className = 'fq-option-btn';
                    btn.textContent = optText;
                    btn.style.animationDelay = `${i * 0.12}s`;

                    btn.onclick = () => this._onAnswer(i, FINAL_QUIZ_DATA.answer);
                    choicesEl.appendChild(btn);
                });

                choicesEl.style.display = 'flex';
                // 다음 프레임에 fade-in
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        choicesEl.style.transition = 'opacity 0.4s ease';
                        choicesEl.style.opacity = '1';
                    });
                });
            }
        }, 500);
    }

    // ── 정답 처리 ────────────────────────────────────────────────────────────
    _onAnswer(selectedIdx, correctIdx) {
        if (this.phase !== 'choosing') return;
        this.phase = 'done';

        // 모든 버튼 비활성화
        const btns = document.querySelectorAll('.fq-option-btn');
        btns.forEach(b => { b.style.pointerEvents = 'none'; });

        const isCorrect = (selectedIdx === correctIdx);
        const resultEl = document.getElementById('fq-result');

        if (isCorrect) {
            // 정답
            btns[selectedIdx].style.background = 'linear-gradient(135deg, #1a7a2e, #2db84a)';
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
                window.Game.spawnFlyingResource(
                    r.left + r.width / 2,
                    r.top + r.height / 2,
                    50, 'gem'
                );
            } else if (window.Game?.addGems) {
                window.Game.addGems(50);
            }

        } else {
            // 오답
            btns[selectedIdx].style.background = 'linear-gradient(135deg, #7a1a1a, #b82d2d)';
            btns[selectedIdx].style.borderColor = '#b82d2d';
            btns[selectedIdx].style.boxShadow = '0 0 20px rgba(184,45,45,0.6)';

            // 정답 버튼 표시
            if (correctIdx < btns.length) {
                btns[correctIdx].style.background = 'linear-gradient(135deg, #1a7a2e, #2db84a)';
                btns[correctIdx].style.borderColor = '#2db84a';
            }

            if (resultEl) {
                resultEl.textContent = '✗ Wrong!  -30 💎';
                resultEl.style.color = '#e05555';
                resultEl.style.display = 'block';
            }

            // gem 차감 (ScoreManager가 max(0,...) 보장)
            if (window.Game?.addGems) {
                window.Game.addGems(-30);
            }
        }

        // 1.5초 후 score 화면으로
        setTimeout(() => {
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
