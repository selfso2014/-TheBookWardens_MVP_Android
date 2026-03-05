/**
 * FinalQuizManager.js — v2 (Slide-Panel Layout)
 * 최종빌런: 지문 스트리밍 → 오른쪽 슬라이드 아웃 → Q&A 동일 위치 표시
 *
 * [Phase]
 *  idle → reading → (1s pause) → choosing (지문 오른쪽 이동, Q&A 노출)
 *                                    ↕ peek탭 tap / 오른쪽 스와이프
 *                               reviewing (지문 복귀, Q&A 숨김)
 *                               → done (정답 or 타이머 만료)
 *
 * [타이머] 지문 스트리밍 완료 후 120초 카운트다운
 * [잉크 번짐] 문제 표시 5초 후 → 5초/단어 blur+fade
 */
export class FinalQuizManager {
    constructor() {
        this.phase = 'idle';
        this._streamTimer = null;
        this._wordIndex = 0;
        this._words = [];
        this._spans = [];
        this._riftTimers = [];
        this._countdownInterval = null;
        this._secondsLeft = 120;
        this._touchHandlers = [];  // [v2] 터치 이벤트 정리용
    }

    // ── 진입점 ──────────────────────────────────────────────────────────────
    init() {
        try {
            console.log('[FinalQuiz] ▶ init() START');
            this.phase = 'idle';
            this._clearTimer();
            this._clearCountdown();
            this._clearRiftTimers();
            this._removeTouchHandlers();
            this._secondsLeft = 120;
            this._wordIndex = 0;
            this._words = [];
            this._spans = [];

            // 1. WPM 취득
            const rawWPM = (window.Game?.scoreManager?.wpmDisplay) ?? 0;
            const wpm = (rawWPM > 30) ? Math.round(rawWPM) : 150;
            const msPerWord = Math.max(50, Math.round(60000 / wpm * 0.3));
            console.log(`[FinalQuiz] wpm=${wpm}, msPerWord=${msPerWord}ms`);

            // 2. 화면 요소 보장 + 초기화
            this._ensureUI();
            this._resetUI();
            this._updateTimerDisplay();

            // 3. 퀴즈 데이터 로드
            const bookQuiz = window.Game?.state?.finalBossQuiz || FINAL_QUIZ_DATA;
            this._activeQuiz = {
                passage: bookQuiz.passage || FINAL_QUIZ_DATA.passage,
                question: bookQuiz.q || bookQuiz.question || FINAL_QUIZ_DATA.question,
                options: bookQuiz.o || bookQuiz.options || FINAL_QUIZ_DATA.options,
                answer: bookQuiz.a ?? bookQuiz.answer ?? FINAL_QUIZ_DATA.answer,
            };

            // 4. 터치 인터랙션 설정
            this._setupInteractions();

            // 5. 스트리밍 시작 (타이머는 스트리밍 완료 후 시작)
            this.phase = 'reading';
            this._streamTextTR(this._activeQuiz.passage, msPerWord, () => {
                // 스트리밍 완료 → 1초 대기 → 슬라이드 아웃
                setTimeout(() => {
                    if (this.phase !== 'reading') return;
                    this._slidePassageOut();

                    // 슬라이드 애니메이션(0.55s) 후 Q&A 표시 + 타이머 시작
                    setTimeout(() => {
                        this._showQuestion();
                        this._startCountdown(120);
                        const tRift = setTimeout(() => this._startRiftEffect(), 5000);
                        this._riftTimers.push(tRift);
                    }, 650);
                }, 1000);
            });
            console.log('[FinalQuiz] ▶ streaming started');

        } catch (e) {
            console.error('[FinalQuiz] FATAL in init():', e);
        }
    }

    // ── 지문 패널 슬라이드 제어 ──────────────────────────────────────────────
    _slidePassageOut() {
        const panel = document.getElementById('fq-passage-panel');
        if (panel) {
            // offsetWidth 기반으로 실제 패널 너비만큼 + 여유분 슬라이드
            const slideDistance = (panel.offsetWidth || window.innerWidth) + 20;
            panel.style.transform = `translateX(${slideDistance}px)`;
        }
        // Peek tab: body에 직접 붙어있음 (CSS transform 영향 없음)
        const peekTab = document.getElementById('fq-peek-tab');
        if (peekTab) { peekTab.style.opacity = '1'; peekTab.style.pointerEvents = 'auto'; }
        if (this.phase !== 'done') this.phase = 'choosing';
    }

    _slidePassageIn() {
        const panel = document.getElementById('fq-passage-panel');
        if (panel) panel.style.transform = 'translateX(0)';
        const peekTab = document.getElementById('fq-peek-tab');
        if (peekTab) { peekTab.style.opacity = '0'; peekTab.style.pointerEvents = 'none'; }
        if (this.phase !== 'done') this.phase = 'reviewing';
    }

    // ── Peek Tab: document.body에 직접 관리 (screen transform 영향 차단) ────
    _ensurePeekTab() {
        let tab = document.getElementById('fq-peek-tab');
        if (tab) return tab;
        tab = document.createElement('div');
        tab.id = 'fq-peek-tab';
        tab.innerHTML = '<span style="font-size:1.5rem;line-height:1;">‹</span>' +
            '<span style="writing-mode:vertical-rl;font-size:0.63rem;letter-spacing:2px;' +
            'opacity:0.85;font-family:\'Outfit\',sans-serif;">지문</span>';
        Object.assign(tab.style, {
            position: 'fixed', right: '0', top: '50%',
            transform: 'translateY(-50%)',
            width: '44px', height: '90px',
            background: 'linear-gradient(180deg,rgba(100,20,200,0.88),rgba(180,0,255,0.88))',
            borderRadius: '12px 0 0 12px',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            opacity: '0', pointerEvents: 'none', cursor: 'pointer',
            zIndex: '99999',
            boxShadow: '-4px 0 20px rgba(130,30,220,0.55)',
            gap: '4px', color: 'white', userSelect: 'none',
            transition: 'opacity 0.3s ease',
        });
        document.body.appendChild(tab);
        console.log('[FinalQuiz] Peek tab appended to body');
        return tab;
    }

    // ── 터치 인터랙션 ────────────────────────────────────────────────────────
    _setupInteractions() {
        this._removeTouchHandlers();

        // Peek Tab: body에 생성 후 이벤트 바인딩
        const peekTab = this._ensurePeekTab();
        if (peekTab) {
            const onClick = () => { if (this.phase === 'choosing') this._slidePassageIn(); };
            peekTab.addEventListener('click', onClick);
            this._touchHandlers.push({ el: peekTab, type: 'click', fn: onClick });

            let sx = 0;
            const onTS = (e) => { sx = e.touches[0].clientX; };
            const onTE = (e) => {
                if ((e.changedTouches[0].clientX - sx) < -40 && this.phase === 'choosing')
                    this._slidePassageIn();
            };
            peekTab.addEventListener('touchstart', onTS, { passive: true });
            peekTab.addEventListener('touchend', onTE, { passive: true });
            this._touchHandlers.push({ el: peekTab, type: 'touchstart', fn: onTS });
            this._touchHandlers.push({ el: peekTab, type: 'touchend', fn: onTE });
        }

        // Passage Panel: 오른쪽 스와이프 → 슬라이드 아웃 (문제로 복귀)
        const passPanel = document.getElementById('fq-passage-panel');
        if (passPanel) {
            let sx = 0;
            const onTS = (e) => { sx = e.touches[0].clientX; };
            const onTE = (e) => {
                if ((e.changedTouches[0].clientX - sx) > 60 && this.phase === 'reviewing')
                    this._slidePassageOut();
            };
            passPanel.addEventListener('touchstart', onTS, { passive: true });
            passPanel.addEventListener('touchend', onTE, { passive: true });
            this._touchHandlers.push({ el: passPanel, type: 'touchstart', fn: onTS });
            this._touchHandlers.push({ el: passPanel, type: 'touchend', fn: onTE });
        }

        // "← 문제로" 버튼
        const backBtn = document.getElementById('fq-back-btn');
        if (backBtn) {
            const onClick = () => { if (this.phase === 'reviewing') this._slidePassageOut(); };
            backBtn.addEventListener('click', onClick);
            this._touchHandlers.push({ el: backBtn, type: 'click', fn: onClick });
        }
    }

    _removeTouchHandlers() {
        this._touchHandlers.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
        this._touchHandlers = [];
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
            display: 'none', position: 'relative',
            background: 'radial-gradient(circle at center, #1a0830 0%, #0a0515 100%)',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
            padding: '0', overflowY: 'auto', overflowX: 'hidden',
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
            to   { opacity:.5; transform:scale(1.08); }
          }
          @keyframes fqShake {
            0%,100%{transform:translateX(0)} 15%{transform:translateX(-8px)}
            35%{transform:translateX(8px)}  55%{transform:translateX(-6px)}
            75%{transform:translateX(5px)}
          }
          #fq-passage-panel {
            transition: transform 0.5s cubic-bezier(0.4,0,0.2,1);
            will-change: transform;
          }
          #fq-peek-tab { transition: opacity 0.3s ease; }
          #fq-qa-panel  { transition: opacity 0.4s ease; }
          #fq-back-btn-inner:hover {
            background: rgba(130,30,220,0.5) !important;
          }
        </style>

        <!-- 타이머: 우측 상단 -->
        <div id="fq-timer"
          style="position:absolute;top:10px;right:12px;z-index:10;
                 font-family:'Outfit',monospace;font-size:1.1rem;font-weight:700;
                 color:#00e5ff;text-shadow:0 0 8px rgba(0,229,255,0.7);
                 background:rgba(0,0,0,0.45);border:1px solid rgba(0,229,255,0.3);
                 border-radius:8px;padding:4px 10px;letter-spacing:2px;">2:00</div>

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

        <!-- ── Arena: 지문 패널 + Q&A 패널이 동일 공간 점유 ── -->
        <div id="fq-arena"
          style="position:relative;width:100%;max-width:680px;
                 padding:8px 12px 28px 12px;box-sizing:border-box;
                 overflow:hidden;">

          <!-- Layer B: Q&A 패널 (하단·절대위치, 지문이 빠진 자리에 드러남) -->
          <div id="fq-qa-panel"
            style="position:absolute;top:8px;left:12px;right:12px;bottom:28px;
                   opacity:0;pointer-events:none;
                   background:rgba(255,255,255,0.05);
                   border:1px solid rgba(180,0,255,0.3);border-radius:14px;
                   padding:18px 20px;box-sizing:border-box;
                   display:flex;flex-direction:column;gap:12px;overflow-y:auto;z-index:1;">
            <p id="fq-question"
              style="display:none;font-family:'Outfit','Segoe UI',sans-serif;font-size:1.0rem;
                     color:#f0e0ff;font-weight:700;line-height:1.6;margin:0;"></p>
            <p id="fq-result"
              style="display:none;font-size:1.0rem;font-weight:bold;margin:0;
                     text-shadow:0 0 10px currentColor;"></p>
            <div id="fq-choices"
              style="display:flex;flex-direction:column;gap:10px;"></div>
          </div>

          <!-- Layer A: 지문 패널 (상단·슬라이딩, z-index:2 로 Q&A 위에 올라탐) -->
          <div id="fq-passage-panel"
            style="position:relative;z-index:2;transform:translateX(0);
                   background:rgba(255,255,255,0.05);
                   border:1px solid rgba(180,0,255,0.3);border-radius:14px;
                   padding:18px 20px;box-sizing:border-box;min-height:80px;">
            <p id="fq-passage-text"
              style="font-family:'Crimson Text',serif;font-size:1.0rem;line-height:1.85;
                     color:#e0e0e0;margin:0;text-align:left;"></p>

            <!-- 지문 열람 중 "←" 복귀 버튼 (슬라이드인 후 표시) -->
            <div id="fq-back-btn" style="display:none;margin-top:14px;text-align:center;">
              <button id="fq-back-btn-inner"
                style="background:rgba(130,30,220,0.25);border:1px solid rgba(180,0,255,0.45);
                       color:#c080ff;font-family:'Outfit',sans-serif;font-size:0.8rem;
                       padding:7px 22px;border-radius:20px;cursor:pointer;letter-spacing:1px;
                       transition:background 0.2s;">
                ← 문제로 돌아가기
              </button>
            </div>
          </div>
        </div>

        <!-- Peek Tab은 JS에서 document.body에 직접 append (CSS transform 영향 방지) -->
        `;
    }

    // ── UI 초기화 ────────────────────────────────────────────────────────────
    _resetUI() {
        const passPanel = document.getElementById('fq-passage-panel');
        const qaPanel = document.getElementById('fq-qa-panel');
        const textEl = document.getElementById('fq-passage-text');
        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');
        const resultEl = document.getElementById('fq-result');
        const timerEl = document.getElementById('fq-timer');
        const peekTab = document.getElementById('fq-peek-tab'); // body에 있을 수 있음
        const backBtn = document.getElementById('fq-back-btn');
        const arena = document.getElementById('fq-arena');

        // 지문 패널 원위치 (transition 없이)
        if (passPanel) {
            passPanel.style.transition = 'none';
            passPanel.style.transform = 'translateX(0)';
            requestAnimationFrame(() => {
                if (passPanel) passPanel.style.transition = '';
            });
        }
        // Q&A 패널 숨김
        if (qaPanel) { qaPanel.style.transition = 'none'; qaPanel.style.opacity = '0'; qaPanel.style.pointerEvents = 'none'; qaPanel.style.height = ''; }
        // Peek tab 숨김 (body에 있어도 getElementById로 찾힘)
        if (peekTab) { peekTab.style.opacity = '0'; peekTab.style.pointerEvents = 'none'; }
        // "← 문제로" 숨김
        if (backBtn) backBtn.style.display = 'none';
        // 지문 텍스트
        if (textEl) textEl.innerHTML = '';
        // Q&A 컨텐츠
        if (questionEl) { questionEl.style.display = 'none'; questionEl.textContent = ''; }
        if (choicesEl) choicesEl.innerHTML = '';
        if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
        // 타이머
        if (timerEl) {
            timerEl.textContent = '2:00';
            timerEl.style.color = '#00e5ff';
            timerEl.style.animation = 'none';
            timerEl.style.borderColor = 'rgba(0,229,255,0.3)';
            timerEl.style.textShadow = '0 0 8px rgba(0,229,255,0.7)';
        }
        // Arena 높이 초기화
        if (arena) arena.style.height = '';
        document.getElementById('fq-rift-msg')?.remove();

        // transition 복원
        setTimeout(() => { if (qaPanel) qaPanel.style.transition = 'opacity 0.4s ease'; }, 50);

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
                if (this.phase !== 'done') { this.phase = 'done'; this._goToScore(); }
            }
        }, 1000);
    }

    _clearCountdown() {
        if (this._countdownInterval !== null) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }
    }

    // ── 잉크 리프트 타이머 정리 ─────────────────────────────────────────────
    _clearRiftTimers() {
        this._riftTimers.forEach(t => clearTimeout(t));
        this._riftTimers = [];
        document.getElementById('fq-rift-msg')?.remove();
    }

    // ── 잉크 번짐 리프트 효과 ───────────────────────────────────────────────
    _startRiftEffect() {
        if (this.phase === 'done') return;
        const spans = [...this._spans];
        if (spans.length === 0) return;
        for (let i = spans.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [spans[i], spans[j]] = [spans[j], spans[i]];
        }
        spans.forEach((span, idx) => {
            const t = setTimeout(() => {
                if (this.phase === 'done') return;
                span.style.transition = 'filter 0.9s ease, opacity 0.9s ease';
                span.style.filter = 'blur(8px)';
                span.style.opacity = '0';
            }, idx * 5000);
            this._riftTimers.push(t);
        });
        console.log(`[FinalQuiz] ⚡ Ink Bleed Rift — ${spans.length} words @ 5s/word`);
    }

    _updateTimerDisplay() {
        const el = document.getElementById('fq-timer');
        if (!el) return;
        const m = Math.floor(this._secondsLeft / 60);
        const s = this._secondsLeft % 60;
        el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        if (this._secondsLeft <= 10) {
            el.style.color = '#ff4444'; el.style.textShadow = '0 0 10px rgba(255,68,68,0.9)';
            el.style.borderColor = 'rgba(255,68,68,0.5)';
            el.style.animation = 'fqTimerPulse 0.5s ease-in-out infinite alternate';
        } else if (this._secondsLeft <= 30) {
            el.style.color = '#ff9944'; el.style.textShadow = '0 0 8px rgba(255,153,68,0.8)';
            el.style.borderColor = 'rgba(255,153,68,0.4)'; el.style.animation = 'none';
        } else {
            el.style.color = '#00e5ff'; el.style.textShadow = '0 0 8px rgba(0,229,255,0.6)';
            el.style.borderColor = 'rgba(0,229,255,0.3)'; el.style.animation = 'none';
        }
    }

    // ── Score 화면 이동 ──────────────────────────────────────────────────────
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

    // ── TextRenderer 방식 텍스트 스트리밍 ───────────────────────────────────
    _streamTextTR(passage, msPerWord, onComplete) {
        const textEl = document.getElementById('fq-passage-text');
        if (!textEl) { console.error('[FinalQuiz] fq-passage-text not found'); onComplete?.(); return; }

        const words = passage.split(/\s+/).filter(w => w.length > 0);
        this._words = words;
        this._spans = [];
        textEl.innerHTML = '';

        words.forEach((word, i) => {
            const span = document.createElement('span');
            span.className = 'tr-word';
            span.style.cssText = 'opacity:0;display:inline-block;margin-right:0.3em;' +
                'line-height:1.85;font-size:1.0rem;vertical-align:middle;' +
                'color:#e0e0e0;transition:opacity 0.15s ease;';
            span.dataset.index = i;
            span.textContent = word;
            textEl.appendChild(span);
            this._spans.push(span);
        });

        console.log(`[FinalQuiz] streaming ${words.length} words @ ${msPerWord}ms/word`);

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

    // ── 문제 표시 (Q&A 패널을 지문 자리에서 fade-in) ────────────────────────
    _showQuestion() {
        if (this.phase !== 'choosing') return;

        const arena = document.getElementById('fq-arena');
        const passPanel = document.getElementById('fq-passage-panel');
        const qaPanel = document.getElementById('fq-qa-panel');
        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');
        const backBtn = document.getElementById('fq-back-btn');

        // ── arena 높이를 지문 패널 높이로 고정 (Q&A가 같은 공간을 점유하도록) ──
        // passage panel은 translateX로 밀려났지만 overflow:hidden으로 클리핑.
        // position:relative이므로 레이아웃 높이는 유지됨. 이를 arena에 명시적으로 고정.
        if (arena && passPanel) {
            const h = passPanel.offsetHeight;
            if (h > 0) {
                arena.style.height = h + 'px';
                // Q&A panel은 absolute로 같은 공간을 채움
                if (qaPanel) qaPanel.style.height = h + 'px';
            }
        }

        const quiz = this._activeQuiz || FINAL_QUIZ_DATA;

        // 문제 텍스트
        if (questionEl) {
            questionEl.textContent = quiz.question;
            questionEl.style.display = 'block';
        }

        // 선택지 버튼
        if (choicesEl) {
            choicesEl.innerHTML = '';
            quiz.options.forEach((optText, i) => {
                const btn = document.createElement('button');
                btn.className = 'fq-option-btn';
                btn.textContent = optText;
                Object.assign(btn.style, {
                    display: 'block', width: '100%',
                    background: 'rgba(130,30,220,0.15)',
                    border: '1px solid rgba(180,0,255,0.4)',
                    color: '#e0ccff', padding: '12px 16px',
                    borderRadius: '12px', fontSize: '0.9rem',
                    fontFamily: "'Outfit','Segoe UI',sans-serif",
                    textAlign: 'left', cursor: 'pointer',
                    transition: 'background 0.2s ease',
                });
                btn.onmouseover = () => { if (btn.style.pointerEvents !== 'none') btn.style.background = 'rgba(130,30,220,0.35)'; };
                btn.onmouseout = () => { if (btn.style.pointerEvents !== 'none') btn.style.background = 'rgba(130,30,220,0.15)'; };
                btn.onclick = () => this._onAnswer(i, quiz.answer);
                choicesEl.appendChild(btn);
            });
        }

        // "← 문제로" 버튼 활성화
        if (backBtn) backBtn.style.display = 'block';

        // Q&A 패널 fade-in
        if (qaPanel) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                qaPanel.style.opacity = '1';
                qaPanel.style.pointerEvents = 'auto';
            }));
        }

        console.log('[FinalQuiz] Q&A panel shown in passage slot. arenaH=', arena?.style.height);
    }

    // ── 정답 처리 ────────────────────────────────────────────────────────────
    _onAnswer(selectedIdx, correctIdx) {
        if (this.phase !== 'choosing' && this.phase !== 'reviewing') return;

        const btns = document.querySelectorAll('.fq-option-btn');
        const resultEl = document.getElementById('fq-result');
        const isCorrect = (selectedIdx === correctIdx);

        if (isCorrect) {
            this.phase = 'done';
            this._clearCountdown();
            this._clearRiftTimers();
            btns.forEach(b => { b.style.pointerEvents = 'none'; b.onmouseover = null; b.onmouseout = null; });

            btns[selectedIdx].style.background = 'linear-gradient(135deg,#1a7a2e,#2db84a)';
            btns[selectedIdx].style.borderColor = '#2db84a';
            btns[selectedIdx].style.boxShadow = '0 0 20px rgba(45,184,74,0.6)';

            if (resultEl) {
                resultEl.textContent = '✓ Correct!  +300 💎';
                resultEl.style.color = '#2db84a';
                resultEl.style.display = 'block';
            }
            const btn = btns[selectedIdx];
            if (btn && window.Game?.spawnFlyingResource) {
                const r = btn.getBoundingClientRect();
                window.Game.spawnFlyingResource(r.left + r.width / 2, r.top + r.height / 2, 300, 'gem');
            } else if (window.Game?.addGems) {
                window.Game.addGems(300);
            }
            console.log('[FinalQuiz] CORRECT +300 gems → score in 1.5s');
            setTimeout(() => this._goToScore(), 1500);

        } else {
            const wrongBtn = btns[selectedIdx];
            if (wrongBtn) {
                wrongBtn.style.pointerEvents = 'none';
                wrongBtn.onmouseover = null; wrongBtn.onmouseout = null;
                wrongBtn.style.background = 'rgba(180,30,30,0.35)';
                wrongBtn.style.borderColor = 'rgba(255,80,80,0.55)';
                wrongBtn.style.color = '#ff9999';
                wrongBtn.style.animation = 'fqShake 0.42s ease';
                setTimeout(() => { wrongBtn.style.animation = 'none'; }, 450);
            }
            const currentGems = window.Game?.scoreManager?.gems ?? window.Game?.state?.gems ?? 0;
            let resultMsg = '✗ Wrong!';
            if (currentGems >= 100 && window.Game?.addGems) {
                window.Game.addGems(-100);
                resultMsg = '✗ Wrong!  −100 💎';
            }
            if (resultEl) {
                resultEl.textContent = resultMsg;
                resultEl.style.color = '#ff7755';
                resultEl.style.display = 'block';
                setTimeout(() => { if (resultEl) resultEl.style.display = 'none'; }, 1800);
            }
            console.log(`[FinalQuiz] WRONG idx=${selectedIdx} — retry allowed.`);
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
        this._clearRiftTimers();
        this._removeTouchHandlers();
        this.phase = 'idle';
        this._wordIndex = 0;
        this._words = [];
        this._spans = [];
        this._riftTimers = [];
        // Peek tab: body에서 완전 제거 (다른 화면으로 이탈 시 잔류 방지)
        const peekTab = document.getElementById('fq-peek-tab');
        if (peekTab && peekTab.parentNode === document.body) {
            document.body.removeChild(peekTab);
        } else if (peekTab) {
            peekTab.style.opacity = '0';
            peekTab.style.pointerEvents = 'none';
        }
        console.log('[FinalQuiz] destroyed');
    }
}

// ── 퀴즈 데이터 (책 선택 시 Game.state.finalBossQuiz로 교체됨) ────────────────
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
