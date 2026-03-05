/**
 * FinalQuizManager.js — v3 (Carousel Slider Pattern)
 * 최종빌런: 지문 스트리밍 → 캐러셀 슬라이드 → Q&A 동일 위치 표시
 *
 * [구조]  fq-slider-wrapper (overflow:hidden)
 *           └── fq-slider-track (width:200%, flex row, transition:transform)
 *                 ├── fq-qa-panel      (50% of track = 100% of wrapper)  ← 왼쪽
 *                 └── fq-passage-panel (50% of track = 100% of wrapper)  ← 오른쪽
 *
 * [슬라이드]
 *  - 지문 표시: track translateX(-50%)           → 오른쪽 패널(지문) 보임
 *  - Q&A 표시:  track translateX(calc(-44px))    → 지문 44px 남기고 Q&A로 전환
 *                                                   (지문이 오른쪽으로 밀려남)
 *  - 지문 복귀: track translateX(-50%)
 *
 * [타이머] 지문 스트리밍 완료 후 120초 카운트다운
 * [잉크 번짐] Q&A 표시 후 5초 → 5초/단어 blur+fade
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
        this._touchHandlers = [];
    }

    // ── 진입점 ──────────────────────────────────────────────────────────────
    init() {
        try {
            console.log('[FinalQuiz] ▶ init() v3 START');
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
            console.log('[FinalQuiz] quiz loaded:', this._activeQuiz.question);

            // 4. 터치/스와이프 인터랙션 설정
            this._setupInteractions();

            // 5. 스트리밍 시작 (타이머는 스트리밍 완료 후 시작)
            this.phase = 'reading';
            this._streamTextTR(this._activeQuiz.passage, msPerWord, () => {
                // 스트리밍 완료 → 1초 대기 → 슬라이드
                setTimeout(() => {
                    if (this.phase !== 'reading') return;
                    this._slideToQA();  // 캐러셀 슬라이드

                    // 슬라이드 애니메이션(0.55s) 후 Q&A 활성화 + 타이머
                    setTimeout(() => {
                        this._activateQA();
                        this._startCountdown(120);
                        const tRift = setTimeout(() => this._startRiftEffect(), 5000);
                        this._riftTimers.push(tRift);
                    }, 600);
                }, 1000);
            });
            console.log('[FinalQuiz] ▶ streaming started');

        } catch (e) {
            console.error('[FinalQuiz] FATAL in init():', e);
        }
    }

    // ── 슬라이드 제어 (track 기준) ─────────────────────────────────────────
    _slideToQA() {
        // ── 과학적 peek 계산 ──────────────────────────────────────────────
        // 1. Peek tab 실측: CSS transform과 무관한 레이아웃 크기
        const peekTab = this._ensurePeekTab();
        const TAB_INNER_MARGIN = 8; // px — 지문이 탭 안쪽에 살짝 숨도록 하는 시각 여백
        const tabWidth = peekTab ? peekTab.offsetWidth : 40; // 실측, 기본값 40px
        const peek = Math.max(0, tabWidth - TAB_INNER_MARGIN);
        //   peek = 지문 패널이 오른쪽에서 보이는 픽셀 수
        //        = 탭 너비 - 여백  →  지문 왼쪽 끝이 탭 왼쪽 끝보다 여백만큼 오른쪽에 위치
        // 2. track 이동: -peek px → Q&A는 왼쪽(0)에서, 지문은 오른쪽(peek)에서 보임
        const track = document.getElementById('fq-slider-track');
        if (track) track.style.transform = `translateX(-${peek}px)`;
        // 3. Q&A 오른쪽 패딩 보정: track이 peek만큼 왼쪽으로 이동했으므로
        //    Q&A 패널 오른쪽 peek px가 viewport 밖으로 나감 → paddingRight로 보호
        //    SAFETY = 4px (border 두께 + 부동소수 보정)
        const SAFETY = 4;
        const qaPanel = document.getElementById('fq-qa-panel');
        if (qaPanel) qaPanel.style.paddingRight = `${peek + SAFETY}px`;
        console.log(`[FinalQuiz] slideToQA — tabWidth:${tabWidth}px, peek:${peek}px, paddingRight:${peek + SAFETY}px`);
        // Peek tab 표시 (body에 있어서 CSS transform 영향 없음)
        if (peekTab) { peekTab.style.opacity = '1'; peekTab.style.pointerEvents = 'auto'; }
        if (this.phase !== 'done') this.phase = 'choosing';
    }

    _slideToPassage() {
        // 지문 패널 복귀: -50% → 오른쪽 패널(지문)이 보이는 위치
        const track = document.getElementById('fq-slider-track');
        if (track) track.style.transform = 'translateX(-50%)';
        // Q&A 패딩 원복 (지문 열람 중엔 Q&A가 숨겨 있으므로 초기값으로 복구)
        const qaPanel = document.getElementById('fq-qa-panel');
        if (qaPanel) qaPanel.style.paddingRight = '20px';
        const peekTab = document.getElementById('fq-peek-tab');
        if (peekTab) { peekTab.style.opacity = '0'; peekTab.style.pointerEvents = 'none'; }
        if (this.phase !== 'done') this.phase = 'reviewing';
    }

    // ── Peek Tab: document.body에 직접 관리 ─────────────────────────────
    _ensurePeekTab() {
        let tab = document.getElementById('fq-peek-tab');
        if (tab) return tab;
        tab = document.createElement('div');
        tab.id = 'fq-peek-tab';
        tab.innerHTML =
            '<span style="font-size:1.4rem;line-height:1;">‹</span>' +
            '<span style="writing-mode:vertical-rl;font-size:0.6rem;letter-spacing:2px;' +
            'opacity:0.9;font-family:\'Outfit\',sans-serif;font-weight:700;">PASSAGE</span>';
        Object.assign(tab.style, {
            position: 'fixed', right: '0', top: '50%',
            transform: 'translateY(-50%)',
            width: '40px', height: '90px',
            background: 'linear-gradient(180deg,rgba(100,20,200,0.9),rgba(180,0,255,0.9))',
            borderRadius: '10px 0 0 10px',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            opacity: '0', pointerEvents: 'none', cursor: 'pointer',
            zIndex: '99999',
            boxShadow: '-4px 0 20px rgba(130,30,220,0.6)',
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

        // Peek Tab: body에 생성 + 이벤트 바인딩
        const peekTab = this._ensurePeekTab();
        if (peekTab) {
            const onClick = () => { if (this.phase === 'choosing') this._slideToPassage(); };
            peekTab.addEventListener('click', onClick);
            this._touchHandlers.push({ el: peekTab, type: 'click', fn: onClick });

            let sx = 0;
            const onTS = (e) => { sx = e.touches[0].clientX; };
            const onTE = (e) => {
                if ((e.changedTouches[0].clientX - sx) < -40 && this.phase === 'choosing')
                    this._slideToPassage();
            };
            peekTab.addEventListener('touchstart', onTS, { passive: true });
            peekTab.addEventListener('touchend', onTE, { passive: true });
            this._touchHandlers.push({ el: peekTab, type: 'touchstart', fn: onTS });
            this._touchHandlers.push({ el: peekTab, type: 'touchend', fn: onTE });
        }

        // 지문 패널: 오른쪽 스와이프 → Q&A로 복귀
        const passPanel = document.getElementById('fq-passage-panel');
        if (passPanel) {
            let sx = 0;
            const onTS = (e) => { sx = e.touches[0].clientX; };
            const onTE = (e) => {
                if ((e.changedTouches[0].clientX - sx) > 60 && this.phase === 'reviewing')
                    this._slideToQA();
            };
            passPanel.addEventListener('touchstart', onTS, { passive: true });
            passPanel.addEventListener('touchend', onTE, { passive: true });
            this._touchHandlers.push({ el: passPanel, type: 'touchstart', fn: onTS });
            this._touchHandlers.push({ el: passPanel, type: 'touchend', fn: onTE });
        }

        // "← To Quiz" 버튼
        const backBtn = document.getElementById('fq-back-btn');
        if (backBtn) {
            const onClick = () => { if (this.phase === 'reviewing') this._slideToQA(); };
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
            console.warn('[FinalQuiz] #screen-final-quiz NOT FOUND. Injecting.');
            this._injectScreen();
            return;
        }
        // V3 구조(fq-slider-track) 없으면 무조건 재빌드 (구버전 HTML 방지)
        if (!document.getElementById('fq-slider-track')) {
            console.warn('[FinalQuiz] V3 slider structure missing — rebuilding HTML');
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
        console.log('[FinalQuiz] #screen-final-quiz injected');
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
            35%{transform:translateX(8px)}   55%{transform:translateX(-6px)}
            75%{transform:translateX(5px)}
          }
          #fq-slider-track {
            transition: transform 0.5s cubic-bezier(0.4,0,0.2,1);
            will-change: transform;
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

        <!-- ── 캐러셀 슬라이더 ── -->
        <div id="fq-slider-wrapper"
          style="width:100%;max-width:680px;
                 padding:8px 12px 28px 12px;box-sizing:border-box;
                 overflow:hidden;flex-shrink:0;">

          <!-- track: 초기 translateX(-50%) → 오른쪽 패널(지문)이 보임
               Q&A로 전환: translateX(-44px) → 지문이 오른쪽으로 밀리고 Q&A 등장 -->
          <div id="fq-slider-track"
            style="display:flex;width:200%;transform:translateX(-50%);">

            <!-- 왼쪽 패널: Q&A (50% of track = 100% of wrapper) -->
            <div id="fq-qa-panel"
              style="flex:0 0 50%;box-sizing:border-box;
                     background:rgba(255,255,255,0.05);
                     border:1px solid rgba(180,0,255,0.3);border-radius:14px;
                     padding:18px 20px;
                     display:flex;flex-direction:column;gap:12px;overflow-y:auto;">
              <p id="fq-question"
                style="display:none;font-family:'Outfit','Segoe UI',sans-serif;font-size:1.0rem;
                       color:#f0e0ff;font-weight:700;line-height:1.6;margin:0;"></p>
              <p id="fq-result"
                style="display:none;font-size:1.0rem;font-weight:bold;margin:0;
                       text-shadow:0 0 10px currentColor;"></p>
              <div id="fq-choices"
                style="display:flex;flex-direction:column;gap:10px;"></div>
            </div>

            <!-- 오른쪽 패널: 지문 (50% of track = 100% of wrapper) -->
            <div id="fq-passage-panel"
              style="flex:0 0 50%;box-sizing:border-box;
                     background:rgba(255,255,255,0.05);
                     border:1px solid rgba(180,0,255,0.3);border-radius:14px;
                     padding:18px 20px;min-height:120px;">
              <p id="fq-passage-text"
                style="font-family:'Crimson Text',serif;font-size:1.0rem;line-height:1.85;
                       color:#e0e0e0;margin:0;text-align:left;"></p>

              <!-- "← To Quiz" 복귀 버튼 (지문 열람 중 표시) -->
              <div id="fq-back-btn" style="display:none;margin-top:14px;text-align:center;">
                <button
                  style="background:rgba(130,30,220,0.25);border:1px solid rgba(180,0,255,0.45);
                         color:#c080ff;font-family:'Outfit',sans-serif;font-size:0.8rem;
                         padding:7px 22px;border-radius:20px;cursor:pointer;letter-spacing:1px;
                         transition:background 0.2s;">
                  ← To Quiz
                </button>
              </div>
            </div>

          </div><!-- /fq-slider-track -->
        </div><!-- /fq-slider-wrapper -->

        <!-- Peek Tab은 JS에서 document.body에 직접 append -->
        `;
    }

    // ── UI 초기화 ────────────────────────────────────────────────────────────
    _resetUI() {
        const track = document.getElementById('fq-slider-track');
        const textEl = document.getElementById('fq-passage-text');
        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');
        const resultEl = document.getElementById('fq-result');
        const timerEl = document.getElementById('fq-timer');
        const peekTab = document.getElementById('fq-peek-tab'); // body에 있어도 검색됨
        const backBtn = document.getElementById('fq-back-btn');

        // 슬라이더 트랙 지문 위치로 초기화 (애니메이션 없이)
        // 지문이 오른쪽 패널이므로 -50% translateX로 지문을 보이게 함
        if (track) {
            track.style.transition = 'none';
            track.style.transform = 'translateX(-50%)';
            setTimeout(() => { if (track) track.style.transition = ''; }, 50);
        }
        // Peek tab 숨김
        if (peekTab) { peekTab.style.opacity = '0'; peekTab.style.pointerEvents = 'none'; }
        // "← To Quiz" 숨김
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
        document.getElementById('fq-rift-msg')?.remove();

        if (!textEl) console.error('[FinalQuiz] fq-passage-text missing!');
        if (!choicesEl) console.error('[FinalQuiz] fq-choices missing!');
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

    // ── 잉크 번짐 효과 (지문 패널 단어 blur) ───────────────────────────────
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
            window.Game.goToNewScore(scoreData);
        }
    }

    // ── 텍스트 스트리밍 ─────────────────────────────────────────────────────
    _streamTextTR(passage, msPerWord, onComplete) {
        const textEl = document.getElementById('fq-passage-text');
        if (!textEl) { console.error('[FinalQuiz] fq-passage-text not found'); onComplete?.(); return; }

        const words = passage.split(/\s+/).filter(w => w.length > 0);
        this._words = words;
        this._spans = [];
        textEl.innerHTML = '';

        words.forEach((word, i) => {
            const span = document.createElement('span');
            // tr-word CSS가 transform:translateY(10px)을 추가하므로 클래스 사용 안 함
            span.style.cssText =
                'opacity:0;display:inline-block;margin-right:0.3em;' +
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
            this._spans[idx++].style.opacity = '1';
            this._streamTimer = setTimeout(revealNext, msPerWord);
        };
        this._streamTimer = setTimeout(revealNext, 0);
    }

    // ── Q&A 패널 활성화 (슬라이드 후 호출) ──────────────────────────────────
    _activateQA() {
        if (this.phase !== 'choosing') return;

        const questionEl = document.getElementById('fq-question');
        const choicesEl = document.getElementById('fq-choices');
        const backBtn = document.getElementById('fq-back-btn');
        const quiz = this._activeQuiz || FINAL_QUIZ_DATA;

        // 문제 텍스트
        if (questionEl) { questionEl.textContent = quiz.question; questionEl.style.display = 'block'; }

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

        // "← To Quiz" 버튼: reviewing 상태에서 표시
        if (backBtn) backBtn.style.display = 'block';

        console.log('[FinalQuiz] Q&A activated in right panel.');
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
        // Peek tab: body에서 완전 제거 (화면 이탈 시 잔류 방지)
        const peekTab = document.getElementById('fq-peek-tab');
        if (peekTab) {
            if (peekTab.parentNode === document.body) document.body.removeChild(peekTab);
            else { peekTab.style.opacity = '0'; peekTab.style.pointerEvents = 'none'; }
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
