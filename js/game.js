import { storyParagraphs } from './data/StoryContent.js?v=20260224-FQ';
import { storyChapter1 } from './data/StoryContent_Dynamic.js?v=20260224-FQ';
import { vocabList, midBossQuizzes, finalBossQuiz } from './data/QuizData.js?v=20260224-FQ';
import { ScoreManager } from './managers/ScoreManager.js?v=20260224-FQ';
import { SceneManager } from './managers/SceneManager.js?v=20260224-FQ';
import { bus } from './core/EventBus.js?v=20260224-FQ';
import { TextRenderer } from './TextRendererV2.js?v=20260224-FQ';
import { WardenManager } from './managers/WardenManager.js?v=20260224-FQ';
import { IntroManager } from './managers/IntroManager.js?v=20260225-CS2';
import { VocabManager } from './managers/VocabManager.js?v=20260224-FQ';
import { UIManager } from './core/UIManager.js?v=20260224-FQ';
import { GameLogic } from './core/GameLogic.js?v=20260224-FQ';
import { DOMManager } from './core/DOMManager.js?v=20260224-FQ';
import { FinalQuizManager } from './managers/FinalQuizManager.js?v=20260224-FQ';
import { BookSelectManager } from './managers/BookSelectManager.js?v=20260226-BS3';

// ── Firebase SDK Deferred Loader ──────────────────────────────────────────────
// [v33] Firebase SDK is NOT loaded at page start (removed from index.html).
// It is loaded here on demand — only when the user clicks "Claim Reward".
// Reason: Firebase SDK creates WebSocket connections immediately on load.
// On iPhone 15 Pro Chrome (iOS 18), failed connections create a retry loop
// adding ~5 EventListeners/sec → LSN explosion → pushes WebContent over jetsam limit.
let _firebaseLoading = null;
function loadFirebaseSDK() {
    if (typeof firebase !== 'undefined') return Promise.resolve();
    if (_firebaseLoading) return _firebaseLoading;

    const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load: ' + src));
        document.head.appendChild(s);
    });

    _firebaseLoading = loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js')
        .then(() => loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js'))
        .then(() => loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js'))
        .then(() => loadScript('./js/firebase-config.js'))
        .then(() => { console.log('[Firebase] SDK dynamically loaded (app + database + firestore).'); })
        .catch((e) => { _firebaseLoading = null; throw e; });

    return _firebaseLoading;
}
// ─────────────────────────────────────────────────────────────────────────────
const Game = {
    // Initialized in init()
    scoreManager: null,
    sceneManager: null,

    // [New] Global Resource Tracker
    activeIntervals: [],
    // [FIX-iOS] Track RAF handles so clearAllResources() can cancel them all.
    // Without this, RAF loops accumulate across screen transitions -> iOS kill.
    activeRAFs: [],

    trackInterval(id) {
        if (id) this.activeIntervals.push(id);
        return id;
    },

    trackRAF(id) {
        if (id) this.activeRAFs.push(id);
        return id;
    },

    clearAllResources() {
        const intervalCount = this.activeIntervals.length;
        const rafCount = this.activeRAFs.length;
        if (intervalCount > 0 || rafCount > 0) {
            console.log(`[Game] Clearing Resources: Intervals=${intervalCount}, RAFs=${rafCount}`);
            this.activeIntervals.forEach(id => clearInterval(id));
            this.activeIntervals = [];
            // [FIX-iOS] Cancel all tracked RAF loops on screen transition.
            this.activeRAFs.forEach(id => cancelAnimationFrame(id));
            this.activeRAFs = [];
        }
        // [FIX] Also cancel UIManager's in-flight score-counter RAF loops
        if (this.uiManager && typeof this.uiManager.cancelAnims === 'function') {
            this.uiManager.cancelAnims();
        }
        // [FIX #9] Remove transient body-level DOM nodes that may be orphaned
        // when RAF/timeout is cancelled mid-flight during screen transitions.
        // These classes are appended to document.body by:
        //   - spawnFloatingText() → .floating-text
        //   - _animateScoreToHud() → .flying-ink (also handled by TextRenderer._activeFlyingInkNodes)
        //   - battle animations → .replay-mini-score
        const TRANSIENT_SELECTORS = ['.floating-text', '.flying-ink', '.replay-mini-score'];
        TRANSIENT_SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                try { el.remove(); } catch (e) { /* silent */ }
            });
        });
    },

    // [Restored] Floating Text Effect (Required for Boss Battle)
    spawnFloatingText(targetEl, text, type = "normal") {
        if (!targetEl) return;
        const rect = targetEl.getBoundingClientRect();

        const floatEl = document.createElement("div");
        floatEl.innerText = text;
        floatEl.className = `floating-text ${type}`;
        floatEl.style.left = (rect.left + rect.width / 2) + "px";
        floatEl.style.top = (rect.top) + "px";

        document.body.appendChild(floatEl);

        // Animate
        requestAnimationFrame(() => {
            floatEl.style.transform = "translate(-50%, -50px)";
            floatEl.style.opacity = "0";
        });

        setTimeout(() => {
            floatEl.remove();
        }, 1000);
    },

    state: {
        // Renamed/Removed: gem/ink/rune to ScoreManager
        currentWordIndex: 0,
        vocabIndex: 0, // Track Word Forge progress
        readProgress: 0, // 0..100
        isTracking: false,
        rift: {
            currentWord: null,
            dwellTime: 0,
            requiredDwell: 1000,
            totalRifts: 0,
            fixedRifts: 0
        },
        // [BookSelect] 선택된 책 정보 & 주입된 게임 데이터
        selectedBook: null,
        storyParagraphs: null,   // BookSelectManager.selectBook()에서 주입
        storyChapter: null,   // BookSelectManager.selectBook()에서 주입 (Typewriter 토큰 데이터)
        midBossQuizzes: null,    // BookSelectManager.selectBook()에서 주입
        finalBossQuiz: null      // BookSelectManager.selectBook()에서 주입
    },

    // Bridge Methods (Proxies to ScoreManager)
    addInk(amount) { if (this.scoreManager) this.scoreManager.addInk(amount); },
    addRunes(amount) { if (this.scoreManager) this.scoreManager.addRunes(amount); },
    addGems(amount) { if (this.scoreManager) this.scoreManager.addGems(amount); },

    updateUI() {
        if (this.scoreManager) this.scoreManager.updateUI();
    },

    // --- Rift Intro Sequence (Delegated to IntroManager) ---



    init() {
        console.log("Game Init");

        // 1. Core Managers (Must be first)
        this.scoreManager = new ScoreManager();
        this.sceneManager = new SceneManager();
        this.uiManager = new UIManager(this);
        this.gameLogic = new GameLogic(this); // Critical Dependency

        // 2. Feature Managers (Dependent on Core)
        this.introManager = new IntroManager(this);
        this.vocabManager = new VocabManager(this);
        this.vocabManager.init(vocabList);
        this.bookSelectManager = new BookSelectManager(this);

        // 3. DOM & Events (Last)
        this.domManager = new DOMManager(this);
        this.domManager.init();

        // 4. Start Features
        this.introManager.init(); // Now safe to call

        // 4. Session ID for Firebase
        // [NEW] Generate a Firebase-like ID early so Amplitude can track the entire funnel
        const chars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
        let autoId = '';
        for (let i = 0; i < 20; i++) {
            autoId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.firebaseSessionId = autoId;

        // Short ID for display
        this.sessionId = Math.random().toString(36).substring(2, 6).toUpperCase();
        console.log("Global Firebase Session ID:", this.firebaseSessionId, "| Display ID:", this.sessionId);

        // --- NEW: Amplitude User ID Sync at Init ---
        if (window.amplitude) {
            window.amplitude.setUserId(this.firebaseSessionId);
            console.log("[Amplitude] setUserId called early with:", this.firebaseSessionId);
        }

        // Display Session ID permanently
        // Display Session ID permanently (REMOVED for Production)
        /*
        const sessionBadge = document.createElement("div");
        sessionBadge.innerText = `ID: ${this.sessionId}`;
        sessionBadge.style.cssText = "position:fixed; bottom:10px; left:10px; background:rgba(0,0,0,0.5); color:lime; padding:5px 10px; font-family:monospace; font-weight:bold; z-index:9999; border:1px solid lime; border-radius:4px; pointer-events:none;";
        document.body.appendChild(sessionBadge);
        */

        // DEBUG: Manual Export Button (Removed per user request)

    },

    bindEvents() {
        // [Intro Events delegated to IntroManager]

        // Debug Keys
        document.addEventListener("keydown", (e) => {
            if (e.key === "`") { // Tilde key for instant debug
                const chk = document.getElementById("chk-debug-mode");
                if (chk) {
                    chk.checked = !chk.checked;
                    // Trigger change event manually
                    chk.dispatchEvent(new Event('change'));
                }
            }
        });

        // [FIX] Splash Screen Logic -> Delegated via JS, not inline HTML
        const splash = document.getElementById('screen-splash');
        if (splash) {
            splash.onclick = () => {
                this.dismissSplash();
            };
        }
    },

    // --- NEW: SDK Loading Feedback (Delegated) ---
    updateSDKProgress(progress, status) {
        // Init state if missing
        if (!this.state.sdkLoading) this.state.sdkLoading = { progress: 0, status: 'Idle', isReady: false };

        this.state.sdkLoading.progress = progress;
        this.state.sdkLoading.status = status;
        this.state.sdkLoading.isReady = (progress >= 100);

        this.uiManager.updateLoadingProgress(progress, status);
    },

    onLoadingComplete() {
        if (this.pendingWPMAction) {
            this.pendingWPMAction();
            this.pendingWPMAction = null;
        }
    },

    showToast(msg, duration = 3000) {
        this.uiManager.showToast(msg, duration);
    },


    // --- Browser Detection Moved to IntroManager ---

    // ─────────────────────────────────────────────────────────────────────
    // SCREEN LIFECYCLE CONTRACT
    // Each screen declares exactly what it owns and how to unmount.
    // switchScreen() enforces this: UNMOUNT previous → transition → MOUNT next.
    //
    // Rule: if a screen allocates a resource, it MUST declare it here.
    // No heuristics, no timeouts, no error thresholds — just deterministic cleanup.
    // ─────────────────────────────────────────────────────────────────────
    SCREEN_CLEANUP: {

        // ── Reading Screen ───────────────────────────────────────────────
        'screen-read': () => {
            // 1. Stop all TextRenderer animations (timeouts + RAFs)
            const renderer = window.Game?.typewriter?.renderer;
            if (renderer && typeof renderer.cancelAllAnimations === 'function') {
                renderer.cancelAllAnimations();
                console.log('[Lifecycle] screen-read: TextRenderer cleared');
            }
            // 2. Remove all transient DOM overlays created during reading
            //    (Pang markers, mini scores, flying ink, impact flashes)
            const OVERLAYS = [
                '#pang-marker-layer',
                '#replay-canvas',
            ];
            OVERLAYS.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => el.remove());
            });
            document.querySelectorAll('.replay-mini-score, .flying-ink').forEach(el => el.remove());
            console.log('[Lifecycle] screen-read: DOM overlays cleared');
        },

        // ── Calibration Screen ───────────────────────────────────────────
        'screen-calibration': () => {
            // Cal RAF loop is managed by app.js overlay.calRunning / stopCalibrationLoop.
            // This is already called by CalibrationManager.finishSequence().
            // Nothing extra needed here — cal cleanup is handled at the app.js level.
            console.log('[Lifecycle] screen-calibration: (managed by app.js)');
        },

        // ── Final Quiz Screen (New Final Villain) ────────────────────────
        'screen-final-quiz': () => {
            if (window.FinalQuizRef && typeof window.FinalQuizRef.destroy === 'function') {
                window.FinalQuizRef.destroy();
                console.log('[Lifecycle] screen-final-quiz: FinalQuizManager destroyed');
            }
        },

        // ── Alice Battle Screen ──────────────────────────────────────────
        'screen-alice-battle': () => {
            if (window.AliceBattleRef && typeof window.AliceBattleRef.destroy === 'function') {
                window.AliceBattleRef.destroy();
                console.log('[Lifecycle] screen-alice-battle: AliceBattleRef destroyed');
            }
        },

        // ── Mid-Boss / Quiz Screens ──────────────────────────────────────
        'screen-battle': () => {
            // Remove any battle-specific animated elements
            document.querySelectorAll('.battle-fx, .battle-lightning').forEach(el => el.remove());
        },

        // ── Mid-Boss Screen ──────────────────────────────────────────────
        'screen-boss': () => {
            // [FIX #4] Reset pointerEvents lock from checkBossAnswer() answer-disable flow
            const vs = document.getElementById('screen-boss');
            if (vs) vs.style.pointerEvents = 'auto';
        },

        // ── Rift / Intro Screens ─────────────────────────────────────────
        'screen-rift-intro': () => {
            // The SceneManager.resetRiftIntro() handles DOM, nothing extra.
        },

        // ── Book Select Screen ───────────────────────────────────────────
        'screen-book-select': () => {
            // 동적 생성된 카드 DOM 초기화 (재진입 대비)
            const container = document.getElementById('book-card-list');
            if (container) container.innerHTML = '';
        },


        // ── Score / Share Screens ─────────────────────────────────────────
        'screen-new-score': () => {
            // Cancel any in-flight score-counter animations when leaving this screen
            if (window.Game?.uiManager?.cancelAnims) {
                window.Game.uiManager.cancelAnims();
            }
        },

        // ── Default: no specific cleanup needed ──────────────────────────
        _default: () => { },
    },

    // Central cleanup dispatcher — call before mounting new screen
    _unmountScreen(screenId) {
        const cleanup = this.SCREEN_CLEANUP[screenId] || this.SCREEN_CLEANUP._default;
        try {
            cleanup();
        } catch (e) {
            console.error(`[Lifecycle] unmount error for ${screenId}:`, e);
        }
    },

    switchScreen(screenId) {
        const prevScreen = document.querySelector('.screen.active')?.id || 'unknown';
        console.log(`[Scene] ${prevScreen} → ${screenId}`);

        // ── STEP 1: UNMOUNT previous screen (deterministic resource cleanup) ──
        // Always runs: Game-global resources (RAFs, Intervals)
        this.clearAllResources();
        // Screen-specific owned resources
        this._unmountScreen(prevScreen);

        // ── STEP 2: DOM Transition ────────────────────────────────────────
        document.querySelectorAll('.screen').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none';
        });

        const target = document.getElementById(screenId);
        if (target) {
            target.style.display = 'flex';
            requestAnimationFrame(() => target.classList.add('active'));
        }

        // --- NEW: Amplitude Tracking ---
        if (window.amplitude) {
            window.amplitude.track('Screen_Viewed', { screen: screenId });
        }

        // ── STEP 3: HUD Visibility ────────────────────────────────────────
        const topHud = document.querySelector('.hud-container');
        if (topHud) {
            const hideHud = ['screen-new-score', 'screen-home', 'screen-new-share'].includes(screenId);
            topHud.style.opacity = hideHud ? '0' : '1';
            topHud.style.pointerEvents = hideHud ? 'none' : 'auto';
        }

        // ── STEP 4: Release camera + SDK on terminal screens ──────────────
        // Game is over — shut down eye tracking immediately,
        // rather than waiting for beforeunload.
        // ── STEP 4: Release camera + SDK on terminal screens ──────────────
        // Fire shutdownEyeTracking() ONLY after Firebase upload is complete.
        // screen-new-score: claim button → uploadToCloud() is still running → DO NOT shutdown yet.
        // screen-new-share / screen-new-signup: upload is done at this point → safe to shutdown.
        // beforeunload (app.js) also covers tab close / refresh as a safety net.
        const SHUTDOWN_SCREENS = ['screen-new-share', 'screen-new-signup'];
        if (SHUTDOWN_SCREENS.includes(screenId)) {
            if (typeof window.shutdownEyeTracking === 'function') {
                window.shutdownEyeTracking();
                console.log('[Lifecycle] Eye tracking shut down on terminal screen:', screenId);
            }
        }
    },


    updateUI() {
        if (this.scoreManager) {
            this.scoreManager.updateUI();
        }
    },

    // Bridge for WPM updates
    updateWPM(targetWPM) {
        if (this.scoreManager) {
            this.scoreManager.updateWPM(targetWPM);
        }
    },

    // --- 1. Word Forge ---
    // --- 1. Word Forge ---
    // --- 1. Word Forge (Delegated to VocabManager) ---

    loadVocab(index) {
        this.vocabManager.loadVocab(index);
    },

    checkVocab(optionIndex, event) {
        this.vocabManager.checkVocab(optionIndex, event);
    },

    // --- [NEW] Flying Resource Effect (Passage 123 Style) ---
    spawnFlyingResource(startX, startY, amount, type = 'gem') {
        const targetId = type === 'ink' ? 'ink-count' : 'gem-count';
        let targetEl = document.getElementById(targetId);

        // Safety Fallback if HUD element missing
        if (!targetEl) {
            // Create dummy target at top-right
            targetEl = {
                getBoundingClientRect: () => ({ left: window.innerWidth - 60, top: 40, width: 0, height: 0 }),
                parentElement: null
            };
        }

        const targetRect = (targetEl.parentElement || targetEl).getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;

        // Create Element
        const p = document.createElement('div');
        p.className = 'flying-resource';
        // amount=0이면 숫자 텍스트 숨김 (점수는 이미 반영, 시각 효과만)
        p.innerText = amount > 0 ? `+${amount}` : '';
        p.style.position = 'fixed';
        p.style.left = startX + 'px';
        p.style.top = startY + 'px';
        p.style.color = type === 'ink' ? '#00ffff' : '#ffd700';
        p.style.fontWeight = 'bold';
        p.style.fontSize = '1.5rem';
        p.style.pointerEvents = 'none';
        p.style.zIndex = '1000001';
        p.style.textShadow = `0 0 10px ${p.style.color}`;
        p.style.transition = 'opacity 0.2s';

        // Icon
        const icon = document.createElement('span');
        icon.innerText = type === 'ink' ? ' ✒️' : ' 💎';
        p.appendChild(icon);

        document.body.appendChild(p);

        // Fail-safe removal (Force remove after 1.2s)
        setTimeout(() => {
            if (p && p.parentNode) p.remove();
        }, 1200);

        // Animation Loop
        let startTime = null;
        const duration = 1000;
        const cpX = startX + (Math.random() * 100 - 50);
        const cpY = Math.min(startY, targetY) - 150;

        const animate = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const progress = (timestamp - startTime) / duration;

            if (progress < 1) {
                const t = progress;
                const ease = 1 - Math.pow(1 - t, 3);

                const curX = Math.pow(1 - ease, 2) * startX + 2 * (1 - ease) * ease * cpX + Math.pow(ease, 2) * targetX;
                const curY = Math.pow(1 - ease, 2) * startY + 2 * (1 - ease) * ease * cpY + Math.pow(ease, 2) * targetY;

                p.style.left = curX + 'px';
                p.style.top = curY + 'px';
                p.style.opacity = 1 - Math.pow(ease, 4);

                // [FIX-iOS] Track RAF so clearAllResources() can cancel it if screen changes
                Game.trackRAF(window.requestAnimationFrame(animate));
            } else {
                if (p.parentNode) p.remove();
                if (type === 'gem') Game.addGems(amount);
                if (type === 'ink') Game.addInk(amount);
            }
        };
        Game.trackRAF(window.requestAnimationFrame(animate));
    },

    // --- 1.2 WPM Selection (Delegated) ---
    calculateWPMAttributes(wpm) {
        return this.gameLogic.calculateWPMAttributes(wpm);
    },

    selectWPM(wpm, btnElement) {
        this.gameLogic.selectWPM(wpm, btnElement);
    },

    // --- 1.5 Owl (Delegated) ---
    startOwlScene() {
        this.gameLogic.startOwlScene();
    },

    startReadingFromOwl() {
        this.gameLogic.startReadingFromOwl();
    },

    // --- 2. Reading Rift ---
    // startReadingSession_OLD removed.

    confrontVillain() {
        this.gameLogic.confrontVillain();
    },

    // Called by app.js (SeeSo overlay)
    onGaze(x, y) {
        // Owl Interaction
        if (this.state.isOwlTracker) {
            const pupils = document.querySelectorAll('.pupil');
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const maxMove = 20;

            let dx = (x - cx) / (window.innerWidth / 2) * maxMove;
            let dy = (y - cy) / (window.innerHeight / 2) * maxMove;
            dx = Math.max(-maxMove, Math.min(maxMove, dx));
            dy = Math.max(-maxMove, Math.min(maxMove, dy));

            pupils.forEach(p => {
                p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            });
            return;
        }

        // Typewriter Gaze Feedback
        if (this.typewriter) {
            // Gaze Stats (Hit Test + Line Progress)
            if (typeof this.typewriter.updateGazeStats === "function") {
                this.typewriter.updateGazeStats(x, y);
            }
            // [FIX-iOS] Removed checkGazeDistance() — it just called updateGazeStats() again,
            // causing hitTest to run TWICE per gaze frame (2x DOM rect access).

            // [RGT] Check Responsive Words
            if (this.typewriter.renderer && typeof this.typewriter.renderer.checkRuneTriggers === 'function') {
                this.typewriter.renderer.checkRuneTriggers(x, y);
            }
        }
    },

    onCalibrationFinish() {
        if (typeof window.calManager !== 'undefined' && window.calManager.state && window.calManager.state.isBossMode) {
            console.log("Boss Calibration finished. Triggering Final Boss Alert.");
            window.calManager.state.isBossMode = false; // Reset
            if (this.typewriter && typeof this.typewriter.showFinalBossAlert === 'function') {
                this.typewriter.showFinalBossAlert();
            } else {
                this.showFinalBossAlert(); // Fallback if typewriter is not available
            }
            return;
        }

        console.log("Calibration finished. Starting Owl Scene.");
        this.startOwlScene();
    },

    // --- 3. Boss Battle ---
    checkBossAnswer(optionIndex) {
        if (this.typewriter && typeof this.typewriter.checkBossAnswer === 'function') {
            this.typewriter.checkBossAnswer(optionIndex);
        } else {
            console.error("Typewriter checkBossAnswer method not found.");
        }
    },


    // --- 4. Splash Screen Logic (Proxy to IntroManager) ---
    dismissSplash() {
        // 1. Check In-App Browser (Critical for Eye Tracking)
        if (this.introManager && typeof this.introManager.isInAppBrowser === 'function') {
            if (this.introManager.isInAppBrowser()) {
                this.introManager.openSystemBrowser();
                return;
            }
        }

        // 2. Go to Lobby (Home) to initialize SDK properly via user interaction
        this.switchScreen("screen-home");
    },

    // --- NEW: Enriched Game Flow (Debug / Implementation) ---
    // --- NEW: Alice Battlefield Integration ---
    debugFinalVillain() {
        console.log("Starting Alice Battlefield...");

        // Switch to new screen
        this.switchScreen('screen-alice-battle');

        // Initialize if available
        if (this.AliceBattle) {
            this.AliceBattle.init();
        } else if (window.AliceBattleRef) {
            this.AliceBattle = window.AliceBattleRef;
            this.AliceBattle.init();
        } else {
            console.error("AliceBattle module NOT loaded! Check console.");
        }
    },
    goToNewScore(scoreData) {
        console.log("Showing Score Screen with Data:", scoreData);

        // 1. Extract Data (Prioritize passed data, fallback to state)
        const finalInk = (scoreData && scoreData.ink !== undefined) ? scoreData.ink : this.state.ink;
        const finalRune = (scoreData && scoreData.rune !== undefined) ? scoreData.rune : this.state.rune;
        const finalGem = (scoreData && scoreData.gem !== undefined) ? scoreData.gem : this.state.gems;
        let finalWPM = (scoreData && scoreData.wpm !== undefined) ? scoreData.wpm : (this.state.wpmDisplay || 180);

        // 정수화: scoreManager.wpmDisplay는 EMA 스무딩으로 소수점이 발생할 수 있음
        finalWPM = Math.round(finalWPM);

        // Sanity Check for WPM
        if (finalWPM < 50) finalWPM = 150 + Math.floor(Math.random() * 100);

        // Update Game State to match final results
        this.state.ink = finalInk;
        this.state.rune = finalRune;
        this.state.gems = finalGem;
        this.state.wpmDisplay = finalWPM;

        this.switchScreen("screen-new-score");

        // [FIX-v29] Firebase WebSocket Warm-up (Cold-start 방지)
        // 이전: paragraph replay 시 uploadToCloud() 자동 실행 → WebSocket 미리 연결됨
        // 현재: 자동 업로드 비활성화 → Claim 버튼 클릭 시 cold-start 21초 타임아웃 발생
        // 해결: score 화면 진입 시 데이터 전송 없이 WebSocket만 미리 연결 (goOnline)
        //       사용자가 이메일 입력하는 10~20초 동안 연결 수립 완료
        //       Claim 버튼 클릭 시 이미 연결된 WebSocket 재사용 → 즉시 성공
        setTimeout(() => {
            try {
                if (window.firebase && window.FIREBASE_CONFIG) {
                    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
                    firebase.database().goOnline();
                    console.log('[Firebase] WebSocket warm-up started for score screen.');
                }
            } catch (e) {
                console.warn('[Firebase] Warm-up failed (non-critical):', e.message);
            }
        }, 500); // 화면 전환 애니메이션 완료 후 실행

        // 2. Reset Animation States (Invisible initially)
        const rowStats = document.getElementById("report-stats-row");
        const rowResources = document.getElementById("report-resource-row");
        const secReward = document.getElementById("reward-section");

        [rowStats, rowResources, secReward].forEach(el => {
            if (el) {
                el.style.opacity = "0";
                el.style.transform = "translateY(30px)";
                el.style.transition = "none"; // Disable transition for reset
            }
        });

        // 3. Start Sequence
        // Force reflow
        if (rowStats) void rowStats.offsetHeight;

        // Restore transitions
        [rowStats, rowResources, secReward].forEach(el => {
            if (el) el.style.transition = "all 0.8s cubic-bezier(0.22, 1, 0.36, 1)";
        });

        // Step 1: Speed & Rank (Start immediately)
        setTimeout(() => {
            if (rowStats) {
                rowStats.style.opacity = "1";
                rowStats.style.transform = "translateY(0)";
            }
            this.animateValue("report-wpm", 0, finalWPM, 1500);
        }, 100);

        // Step 2: Resources (Ink, Rune, Gem) - Delay 800ms
        setTimeout(() => {
            if (rowResources) {
                rowResources.style.opacity = "1";
                rowResources.style.transform = "translateY(0)";
            }
            const elInk = document.getElementById('report-ink-score');
            const elRune = document.getElementById('report-rune-score');
            const elGem = document.getElementById('report-gem-score');

            if (elInk) elInk.innerText = "0";
            if (elRune) elRune.innerText = "0";
            if (elGem) elGem.innerText = "0";

            this.animateValue("report-ink-score", 0, finalInk, 1500, "");
            this.animateValue("report-rune-score", 0, finalRune, 1500, "");
            this.animateValue("report-gem-score", 0, finalGem, 1500, "");
        }, 900);

        // Step 3: Golden Key (Reward) - Delay 2000ms
        setTimeout(() => {
            if (secReward) {
                secReward.style.opacity = "1";
                secReward.style.transform = "translateY(0)";
            }
        }, 2200);


        // 4. Calculate Rank based on total score (Simple Mock Logic)
        const totalScore = finalInk + (finalRune * 10) + (finalGem * 5);
        let rank = "Novice";
        if (totalScore > 500) rank = "Apprentice";
        if (totalScore > 1000) rank = "Master";
        if (totalScore > 2000) rank = "Warden";

        const elRank = document.getElementById('report-rank-text');
        if (elRank) elRank.innerText = rank;

        // [FIX] Bind Claim Reward Button logic
        const btnClaim = document.getElementById("btn-claim-reward");
        const emailInput = document.getElementById("warden-email");
        if (btnClaim) {
            // Remove old listeners (clone node trick)
            const newBtn = btnClaim.cloneNode(true);
            if (btnClaim.parentNode) btnClaim.parentNode.replaceChild(newBtn, btnClaim);

            newBtn.onclick = async () => {
                const email = emailInput ? emailInput.value.trim() : "";

                if (!email || !email.includes("@")) {
                    alert("Please enter a valid email address.");
                    return;
                }

                // 1. Load Firebase SDK on demand (deferred from page load)
                if (typeof firebase === "undefined") {
                    newBtn.innerText = "⏳ CONNECTING...";
                    try {
                        await loadFirebaseSDK();
                    } catch (e) {
                        console.error("[Firebase] SDK dynamic load failed:", e);
                        alert("System Error: Firebase SDK failed to load.");
                        newBtn.disabled = false;
                        newBtn.innerText = "CLAIM REWARD";
                        return;
                    }
                }

                if (!firebase.apps.length) {
                    if (window.FIREBASE_CONFIG) {
                        try {
                            firebase.initializeApp(window.FIREBASE_CONFIG);
                        } catch (e) {
                            console.error("Firebase Init Error:", e);
                            alert("Database Connection Failed.");
                            return;
                        }
                    } else {
                        alert("System Error: Firebase Config missing.");
                        return;
                    }
                }

                // 2. Prepare Data
                const now = new Date();
                // KST (UTC+9) formatting
                const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
                const kstStr = kstDate.toISOString().replace('T', ' ').slice(0, 19);

                const reportData = {
                    email: email,
                    timestamp: kstStr,
                    wpm: finalWPM,
                    rank: rank,
                    ink: finalInk,
                    rune: finalRune,
                    gem: finalGem,
                    device: navigator.userAgent
                };

                // 3. Save to Realtime Database
                const originalText = "CLAIM REWARD";
                newBtn.disabled = true;
                newBtn.innerText = "⏳ SAVING...";
                newBtn.style.opacity = "0.7";

                // [FIX-v29] db를 외부 스코프로 이동 → .then/.catch에서 goOffline() 접근 가능
                const db = firebase.database();

                // [NEW] Use the globally generated firebaseSessionId instead of pushing a new key
                const newLeadRef = db.ref("warden_leads/" + (window.Game.firebaseSessionId || window.Game.sessionId));

                // Add Session ID reference to report data
                reportData.sessionId = window.Game.firebaseSessionId || window.Game.sessionId;

                // Amplitude 'Reward_Claimed' event and User Properties
                if (window.amplitude) {
                    if (window.amplitude.Identify) {
                        const identifyEvent = new window.amplitude.Identify().set('email', email);
                        window.amplitude.identify(identifyEvent);
                    }
                    window.amplitude.track('Reward_Claimed', { rank: rank });
                }

                // Promise Array for Parallel saving
                const promises = [];

                // 1. Save Lead Data (Summary)
                promises.push(newLeadRef.set(reportData));

                // 2. Save Full Gaze Data (Detail) - if available
                if (window.gazeDataManager) {
                    newBtn.innerText = "⏳ DATA SYNC...";
                    console.log("[Firebase] Starting Gaze Data Upload for Session:", newLeadRef.key);
                    promises.push(window.gazeDataManager.uploadToCloud(newLeadRef.key));
                }

                Promise.all(promises)
                    .then(() => {
                        // uploadToCloud() 내부 finally에서 goOffline() 처리 — 여기서 중복 호출 제거
                        this.showSuccessModal(() => {
                            this.goToNewShare();
                        });
                        newBtn.innerText = "✅ CLAIMED";
                        newBtn.style.background = "#4CAF50";
                        if (emailInput) emailInput.disabled = true;
                    })
                    .catch((error) => {
                        // uploadToCloud() 내부 finally에서 goOffline() 처리 — 여기서 중복 호출 제거
                        console.error("Firebase Save Error:", error);
                        console.error("Transmission Failed: " + error.message);
                        newBtn.disabled = false;
                        newBtn.innerText = originalText;
                        newBtn.style.opacity = "1";
                    });
            };
        }
    },

    // NEW: Custom Success Modal Logic
    showSuccessModal(onConfirm) {
        const modal = document.getElementById("success-modal");
        const btn = document.getElementById("btn-modal-confirm");
        if (!modal || !btn) {
            window.alert("Access Granted! (Modal Missing)");
            if (onConfirm) onConfirm();
            return;
        }

        // Show
        modal.style.display = "flex";
        // Force Reflow
        void modal.offsetHeight;

        modal.style.opacity = "1";
        const content = modal.firstElementChild;
        if (content) content.style.transform = "scale(1)";

        // Bind Action
        btn.onclick = () => {
            // Hide Animation
            modal.style.opacity = "0";
            if (content) content.style.transform = "scale(0.9)";

            setTimeout(() => {
                modal.style.display = "none";
                if (onConfirm) onConfirm();
            }, 300);
        };
    },

    goToNewSignup() {
        this.switchScreen("screen-new-signup");
    },

    goToNewShare() {
        // Simulate Signup submission if coming from Signup screen
        const emailInput = document.querySelector("#screen-new-signup input[type='email']");
        if (emailInput && emailInput.value) {
            console.log("Signup Email:", emailInput.value);
            // Optionally show toast
        }
        this.switchScreen("screen-new-share");
    },

    // ── Home 버튼: 브라우저 새로고침을 통해 모든 데이터를 완벽히 비우고 책 선택 화면으로 직행 ──
    goBackToBookSelect() {
        console.log('[Home] goBackToBookSelect(): Initiating Hard Reload to clear all SDK/DOM states.');

        // FinalQuizManager 등에서 사용하던 잔여 리소스 해제 시도
        if (window.FinalQuizRef && typeof window.FinalQuizRef.destroy === 'function') {
            window.FinalQuizRef.destroy();
        }

        // 가장 안전한 방식: 브라우저 완전히 다시 불러와 메모리 누수 방지
        // IntroManager에서 skip_intro param을 감지하고 바로 Book Select 앞단(Home)으로 감.
        window.location.href = window.location.pathname + "?skip_intro=1";
    },

    // Utilities
    animateValue(id, start, end, duration, prefix = "", suffix = "") {
        this.uiManager.animateValue(id, start, end, duration, prefix, suffix);
    }
};

// --- Typewriter Mode Logic (Refactored for TextRenderer) ---
Game.typewriter = {
    renderer: null,

    // Data (Content) — dynamically injected from Game.state in start()
    // Fallback: storyChapter1 (Alice) is used only if no book has been selected.
    paragraphs: null,
    quizzes: null,

    // --- FINAL BOSS DATA ---
    finalQuiz: null,

    // State
    currentParaIndex: 0,
    chunkIndex: 0,
    isPaused: false,
    timer: null,

    // Stats
    startTime: null,
    wordCount: 0,

    // Reading Tracking (Line-based)
    lineStats: new Map(), // lineIndex -> Set(wordIndices hit)

    init() {
        // Init renderer if not already
        if (!this.renderer) {
            // Ensure container exists
            const container = document.getElementById("book-content");
            if (container) {
                // Apply layout styles JS-side just in case CSS missed something
                container.style.position = "relative";
                container.style.overflow = "visible"; // Allow overflow for debugging visibility

                this.renderer = new TextRenderer("book-content", {
                    fontSize: window.innerWidth <= 768 ? "1.0rem" : "1.3rem",
                    lineHeight: "2.3",
                    wordSpacing: "0.4em",
                    padding: "20px"
                });
            } else {
                console.error("TextRenderer Container Not Found");
            }
        }
    },

    start() {
        console.log("[Typewriter] Starting Engine V2 (TextRenderer)...");
        this.init();

        if (!this.renderer) return;

        this.currentParaIndex = 0;
        this.isPaused = false;
        this.lineStats.clear();

        // Dynamically load content from the selected book (injected by BookSelectManager)
        // Fallback to Alice's original data if no book selected (direct screen-word entry)
        const chapter = (Game.state.storyChapter) || storyChapter1;
        this.paragraphs = chapter.paragraphs;
        this.quizzes = (Game.state.midBossQuizzes) || midBossQuizzes;
        this.finalQuiz = (Game.state.finalBossQuiz) || finalBossQuiz;
        console.log(`[Typewriter] Loaded book chapter: ${chapter.story_id}, ${this.paragraphs.length} paragraphs.`);

        // ── 챕터 타이틀 배지 업데이트 (책마다 다른 타이틀 표시) ──────────────
        const titleBadge = document.getElementById('chapter-title-badge');
        if (titleBadge) {
            const selectedBook = Game.state.selectedBook;
            let chapterTitle = 'Chapter 1: Down the Rabbit-Hole'; // Alice default
            if (selectedBook) {
                if (selectedBook.id === 'aesop') {
                    chapterTitle = 'Tales of Wisdom — Aesop\'s Fables';
                } else if (selectedBook.id === 'sherlock') {
                    chapterTitle = 'Chapter 1: A Scandal in Bohemia';
                } else if (selectedBook.id === 'alice') {
                    chapterTitle = 'Chapter 1: Down the Rabbit-Hole';
                }
            }
            titleBadge.textContent = chapterTitle;
        }

        Game.state.ink = 0;
        Game.updateUI();

        // Ensure first paragraph plays
        this.playNextParagraph();

        // WPM Monitor
        if (this.wpmMonitor) clearInterval(this.wpmMonitor);
        // [FIX] Removed WPM polling interval. 
        // WPM should only update on discrete "Pang" events driven by GazeDataManager.
        // this.wpmMonitor = setInterval(() => this.updateWPM(), 1000);

        // --- CHANGED: Periodic Cloud Upload REMOVED ---
        // As per user request, we now upload ONLY when Replay starts (per paragraph).
        if (this.uploadMonitor) {
            clearInterval(this.uploadMonitor);
            this.uploadMonitor = null;
        }
    },

    playNextParagraph() {
        // [iOS Gate] Open gaze processing gate — start accepting gaze data for this paragraph.
        // NOTE: SeeSo SDK itself stays running continuously (iOS cannot restart mid-session).
        // This simply sets window._gazeActive = true so the gaze callback resumes processing.
        if (typeof window.setSeesoTracking === 'function') {
            window.setSeesoTracking(true, `reading para ${this.currentParaIndex}`);
        }

        // [SAFETY FIX] Reset Scroll Position to (0,0) BEFORE rendering new content.
        // This prevents lingering scroll from previous paragraphs from affecting lockLayout coordinates.
        window.scrollTo(0, 0);
        const screenRead = document.getElementById('screen-read');
        if (screenRead) screenRead.scrollTop = 0;

        // [CRITICAL FIX] Reset Pang Event Logic / First Content Time for new paragraph
        console.log(`[Typewriter] Pre-Check: Resetting Triggers for Para ${this.currentParaIndex}...`);

        const gdm = window.gazeDataManager;
        if (gdm) {
            // Function Call (Preferred)
            if (typeof gdm.resetTriggers === 'function') {
                gdm.resetTriggers();
            } else {
                // FALLBACK: Manual Reset (If function missing in cached JS)
                console.warn("[Typewriter] resetTriggers function missing! Performing Manual Reset.");
                gdm.maxLineIndexReached = -1;
                gdm.firstContentTime = null;
                gdm.lastTriggerTime = 0;
                gdm.pendingReturnSweep = null;
                if (gdm.pangLog) gdm.pangLog = [];
            }
            console.log("[Typewriter] Triggers Reset Check Complete.");
        }

        if (this.currentParaIndex >= this.paragraphs.length) {
            // All paragraphs done. Trigger FINAL BOSS.
            this.triggerFinalBossBattle();
            return;
        }

        const paraData = this.paragraphs[this.currentParaIndex];
        console.log(`[Typewriter] Playing Para ${this.currentParaIndex}`);

        // 1. Prepare Content (Dynamic DSC Mode)
        // Wrap single paragraph in chapter structure for renderer
        const currentWPM = Game.wpm || 150;
        this.renderer.prepareDynamic({ paragraphs: [paraData] }, currentWPM);

        this.chunkIndex = 0;
        this._lineStartSet = null; // [FIX] Reset cached Set for new paragraph layout
        this.lineStats.clear(); // Reset reading stats for new page

        // [FIX] Register Cursor with SceneManager (Cursor is recreated directly in prepare())
        if (Game.sceneManager && this.renderer.cursor) {
            Game.sceneManager.setCursorReference(this.renderer.cursor);
        }

        // 2. Lock Layout (Next Frame to allow DOM render)
        requestAnimationFrame(() => {
            this.renderer.lockLayout();
            const debugEl = document.getElementById('line-detect-result');
            if (debugEl) debugEl.textContent = `Lines Cached: ${this.renderer.lines.length}`;

            // Resume Game Loop safely after layout is ready
            this.isPaused = false;

            // [CRITICAL FIX] Re-enable Tracking!
            // Tracking is disabled in 'confrontVillain' (Mid-Boss).
            // We must re-enable it here for the next paragraph.
            Game.state.isTracking = true;
            console.log("[Typewriter] Tracking Re-enabled for new paragraph.");

            // 3. Start Reading Flow
            // UX IMPROVEMENT: Hide cursor initially. 
            // The screen 'fadeIn' animation shifts the text container. 
            // If we show the cursor immediately, it looks like it's floating/misaligned.
            if (this.renderer.cursor) this.renderer.cursor.style.opacity = "0";

            // Wait for measurement and pagination
            setTimeout(() => {
                if (this.renderer) {
                    // Start from Page 0
                    this.renderer.showPage(0).then(() => {
                        this.renderer.resetToStart(); // Aligns correctly
                        if (this.renderer.cursor) this.renderer.cursor.style.opacity = "1";
                        console.log("[Typewriter] Page 0 Ready.");

                        // Start Text after full delay
                        setTimeout(() => {
                            this.startTime = Date.now();
                            this.tick();
                        }, 1000); // Reduced from 3000 to 1000 for snappier page loads
                    });
                }
            }, 600);
        });
    },

    tick() {
        if (this.isPaused) return;

        // Prevent double-tick: clear previous if exists (though usually it fires once)
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        // [SAFETY] If chunks are not ready (length 0), wait and retry.
        if (!this.renderer || !this.renderer.chunks || this.renderer.chunks.length === 0) {
            console.warn("[Typewriter] Chunks not ready. Retrying in 500ms...");
            this.timer = setTimeout(() => this.tick(), 500);
            return;
        }

        // Reveal next chunk
        if (this.chunkIndex < this.renderer.chunks.length) {

            // TEXT TRAIN EFFECT (Continuous Flow):
            // Instead of fading out an old chunk manually here, we SCHEDULE the death of the NEW chunk.
            // "I am born now, and I shall die in 4 seconds."
            // This ensures a smooth, independent pipeline regardless of whether the cursor pauses.
            this.renderer.scheduleFadeOut(this.chunkIndex, 3000); // 3 seconds lifetime

            // Wait for Animation to Finish (Promise-based) with Timeout Safety
            const chunkLen = this.renderer.chunks[this.chunkIndex].length;
            const wpm = Game.wpm || 200;
            const msPerWord = 60000 / wpm; // e.g. 200wpm -> 300ms

            // The renderer's revealChunk animation takes (length * interval) ms.
            // Game.wpmParams.interval is usually very fast (e.g. 50ms) for 'snappy' reveal.
            // We need to wait for the visual reveal, THEN wait for the remaining time to match WPM.

            const revealPromise = this.renderer.revealChunk(this.chunkIndex, Game.wpmParams.interval);

            // Total time this chunk *should* occupy
            // [TUNING] Dynamic Multiplier for "Reading/Pause" buffer.
            let buffer = 1.2; // Default (200 WPM)
            if (wpm <= 100) buffer = 1.15; // [100 WPM] Increased chunk size, so reduce buffer slightly.
            else if (wpm >= 300) buffer = 1.05; // [300 WPM] Needs to be faster. Reduce gap.

            const targetDuration = (msPerWord * chunkLen) * buffer;

            // Safety timeout
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, targetDuration + 1000));

            const startTime = Date.now();

            Promise.race([revealPromise, timeoutPromise]).then(() => {
                const elapsed = Date.now() - startTime;

                // Calculate remaining wait time
                // We want total time (reveal + pause) = targetDuration
                let remainingWait = targetDuration - elapsed;

                // If reveal was instant or fast, we wait longer.
                // If reveal took long (e.g. line break pause inside renderer?), we wait less.

                if (remainingWait < 0) remainingWait = 0;

                // [WPM COMPENSATION LOGIC]
                // 1. Check if the *current* chunk (this.chunkIndex) had a line break.
                // The renderer adds +450ms internally if a word starts a new line.
                // We must SUBTRACT this from our game loop delay to avoid double waiting.
                let hadLineBreak = false;
                if (this.renderer && this.renderer.chunks && this.renderer.lines) {
                    const currentChunkIndices = this.renderer.chunks[this.chunkIndex];
                    if (currentChunkIndices) {
                        // [FIX-iOS] Use Set for O(1) lookup instead of O(N×M) nested some().
                        // Old code: chunks.some(w => lines.some(l => l.startIndex === w))
                        // = chunkSize × lineCount comparisons per tick.
                        if (!this._lineStartSet) {
                            this._lineStartSet = new Set(this.renderer.lines.map(l => l.startIndex));
                        }
                        hadLineBreak = currentChunkIndices.some(wordIdx =>
                            wordIdx > 0 && this._lineStartSet.has(wordIdx)
                        );
                    }
                }

                this.chunkIndex++;

                // Calculate Delay (Pause AFTER valid reading)
                // We use the remainingWait calculated above to ensure WPM adherence.
                let baseDelay = remainingWait;

                // Apply Compensation
                let finalDelay = baseDelay;
                if (hadLineBreak) {
                    // Renderer paused 450ms, so we pause 450ms less.
                    finalDelay = Math.max(0, baseDelay - 450);
                    // console.log(`[WPM Sync] Line Break Detected in Chunk ${this.chunkIndex-1}. Compensating: ${baseDelay} -> ${finalDelay}ms`);
                }

                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.tick();
                }, finalDelay);
            });

        } else {
            console.log("Chunk Sequence Finished for current Page/Flow.");

            // Check if there are more pages in this paragraph!
            // [BUGFIX] If all chunks are shown, force finish regardless of 'pages'.
            // The renderer's page count might include trailing empty pages or logic issues.
            // Since chunkIndex >= chunks.length means *ALL* text is visible, we should proceed to end the paragraph.
            /*
            const renderer = this.renderer;
            if (renderer && renderer.currentPageIndex < renderer.pages.length - 1) {
                console.log("[Typewriter] Moving to Next Page...");
 
                // Fade out current page words? Or just switch?
                // Let's just switch cleanly.
                setTimeout(() => {
                    const nextPage = renderer.currentPageIndex + 1;
                    renderer.showPage(nextPage).then(() => {
                        // Reset chunk index to the first chunk of the new page?
                        // Actually, this.chunkIndex is global for the whole text. 
                        // It continues naturally. We just need to ensure the words are visible.
                        // Wait... The words ON the new page are currently opacity:0.
                        // tick() will reveal them.
 
                        renderer.resetToStart(); // Move cursor to top of new page
            }
            */

            console.log("Paragraph Fully Revealed (All Pages). Preparing for Replay...");

            // [FIX] Do NOT fade out text here.
            // We need the text to remain EXACTLY as it is for the Gaze Replay overlay.
            // If we fade out and then force-show in replay, it causes layout shifts (jumps).
            // The text will be hidden naturally when we switch to 'screen-boss' after replay.

            // let cleanupDelay = 0;
            // const startCleanupIdx = Math.max(0, this.chunkIndex - 3);
            // for (let i = startCleanupIdx; i < this.renderer.chunks.length; i++) {
            //    this.renderer.scheduleFadeOut(i, cleanupDelay + 600);
            //    cleanupDelay += 600;
            // }

            // [CHANGED] Always trigger Mid-Boss Battle after ANY paragraph (including the last one).
            // Logic: P1 -> Replay -> Mid -> P2 -> Replay -> Mid -> ...
            setTimeout(async () => {
                // Play Gaze Replay before Villain appears
                await this.triggerGazeReplay();
                this.triggerMidBossBattle();
            }, 1000); // 1s initial delay
        }
    },

    // --- NEW: Gaze Replay ---
    triggerGazeReplay() {
        return new Promise((resolve) => {
            console.log("[triggerGazeReplay] Preparing Gaze Replay...");

            // [iOS Gate] Close gaze processing gate — stop processing gaze data during replay.
            // NOTE: SeeSo SDK itself stays running (iOS cannot restart after stopTracking).
            // This simply sets window._gazeActive = false so onGaze/processGaze are skipped.
            // Gaze callbacks still fire from SDK but are ignored until next paragraph.
            if (typeof window.setSeesoTracking === 'function') {
                window.setSeesoTracking(false, 'gaze replay start');
            }

            // [FIX-iPhone15Pro] Also skip WASM processFrame_ during replay+boss.
            // Gate (above) blocks gaze callbacks but WASM still fires at 30fps.
            // Setting _sdkFrameSkip=true halts all WASM processing until next paragraph.
            window._sdkFrameSkip = true;
            console.log('[FIX] _sdkFrameSkip=true: WASM halted during replay+boss');

            // [DISABLED-iOS] Background Firebase upload during gaze replay REMOVED.
            // Firebase WebSocket 초기화(addEventListener × 4+)가 iPhone Air에서
            // LSN 폭발(29→79)을 유발 → iOS WebContent OOM Kill → 크래시.
            // 업로드는 score 화면의 CLAIM REWARD 버튼 클릭 시에만 수행.
            // if (window.gazeDataManager && Game.sessionId) {
            //     window.gazeDataManager.uploadToCloud(Game.sessionId);
            // }

            // Check dependencies
            if (!window.gazeDataManager || !this.startTime) {
                console.warn("No GazeDataManager or StartTime found. Skipping Replay.");
                resolve();
                return;
            }

            const gdm = window.gazeDataManager;
            // [FIX] Convert Absolute Time to Relative Time (GazeDataManager stores relative 't')
            if (!gdm.firstTimestamp) {
                console.warn("[Replay] GazeDataManager has no firstTimestamp. Skipping.");
                resolve();
                return;
            }

            const relativeStartTime = this.startTime - gdm.firstTimestamp;
            const relativeEndTime = Date.now() - gdm.firstTimestamp;

            console.log(`[Replay] Filtering Data: Range [${relativeStartTime.toFixed(0)} ~ ${relativeEndTime.toFixed(0)}] ms`);

            const rawData = gdm.data;
            const sessionData = rawData.filter(d => d.t >= relativeStartTime && d.t <= relativeEndTime);

            if (sessionData.length === 0) {
                console.warn(`[Replay] No gaze data found in range. Total Data: ${rawData.length}, Range: ${relativeStartTime.toFixed(0)}-${relativeEndTime.toFixed(0)}`);
                resolve();
                return;
            }

            console.log(`[Replay] Found ${sessionData.length} points.`);

            // [FIX] Cancel all pending fadeOut timers before replay starts.
            // During reading, tick() schedules scheduleFadeOut(chunkIndex, 3000) for every chunk.
            // Without this call, those timers fire mid-replay and erase visible text
            // (especially the last 3-4 lines which are revealed latest and time out soonest).
            if (this.renderer && typeof this.renderer.cancelAllAnimations === 'function') {
                this.renderer.cancelAllAnimations();
                console.log('[Replay] Cleared all pending fadeOut timers before replay.');
            }

            // Hide Cursor during replay for cleaner view
            if (this.renderer && this.renderer.cursor) this.renderer.cursor.style.opacity = "0";

            if (this.renderer && typeof this.renderer.playGazeReplay === 'function') {
                // [FEEDBACK] Reset Rune Words for Replay Cleanliness
                // We want to remove the 'active-rune' class so the user sees a raw replay.
                // Or maybe keep them? Feedback says: "Just Yellow Bold is enough" for active.
                // But during replay, if they are ALREADY yellow/bold, it might be distracting?
                // The feedback: "3. 지문 다 읽고 리플레이할때, 반응형 단어가 노란색에 밑줄까지 있는데, 보기가 안 좋음."
                // Since we removed underline from CSS, we just need to ensure they look clean.
                // Let's RESET them to normal so the replay shows the gaze "re-triggering" them?
                // No, TextRenderer.playGazeReplay just draws lines/dots. It doesn't re-simulate triggers.
                // So let's stripped the 'active-rune' class to make the text look "fresh" for the replay canvas overlay.

                this.renderer.words.forEach(w => {
                    if (w.element) w.element.classList.remove('active-rune'); // Clean slate
                });

                this.renderer.playGazeReplay(sessionData, () => {
                    console.log("[triggerGazeReplay] Replay Done.");
                    // Restore cursor opacity just in case (though screen switch follows)
                    if (this.renderer.cursor) this.renderer.cursor.style.opacity = "1";

                    const gdm = window.gazeDataManager;

                    // [NEW] Upload gaze data + pangLog BEFORE clearing memory.
                    // Timing: replay just ended = villain is about to appear (소형빌런 진입).
                    // MUST be called before clearGazeData() — after that, this.data is empty.
                    // [FIX] Use firebaseSessionId (20-char) — same key visible in session_list
                    const uploadId = Game.firebaseSessionId || Game.sessionId;
                    if (gdm && uploadId) {
                        const paraIdx = this.currentParaIndex;
                        console.log(`[Upload] Mid-boss entry: uploading para ${paraIdx} → session [${uploadId}]`);

                        const uploadPromises = [];
                        // ① pangLog upload (small, fast — per paragraph path)
                        if (typeof gdm.uploadPangLog === 'function') {
                            uploadPromises.push(
                                gdm.uploadPangLog(uploadId, paraIdx).catch(e => {
                                    console.warn('[Upload] pangLog failed:', e);
                                    return 'pangLog_failed';
                                })
                            );
                        }
                        // ② gaze chunk + meta upload (incremental, async)
                        uploadPromises.push(
                            gdm.uploadToCloud(uploadId).catch(e => {
                                console.warn('[Upload] uploadToCloud failed:', e);
                                return 'gaze_failed';
                            })
                        );

                        // ★ 업로드 완료 팝업 + clearGazeData
                        Promise.all(uploadPromises).then(results => {
                            const failed = results.filter(r => typeof r === 'string' && r.includes('failed'));
                            const msg = failed.length === 0
                                ? `✅ 데이터 업로드 완료!\n세션: ${uploadId}\n지문: ${paraIdx}`
                                : `⚠️ 일부 업로드 실패 (${failed.join(', ')})\n세션: ${uploadId}`;

                            // 화면 팝업 (3초 후 자동 사라짐)
                            const popup = document.createElement('div');
                            popup.textContent = msg;
                            Object.assign(popup.style, {
                                position: 'fixed', top: '20px', left: '50%',
                                transform: 'translateX(-50%)', zIndex: '999999',
                                padding: '14px 24px', borderRadius: '12px',
                                background: failed.length === 0
                                    ? 'linear-gradient(135deg, #1a6b3c, #2ea55a)'
                                    : 'linear-gradient(135deg, #8b4513, #cc6600)',
                                color: '#fff', fontSize: '14px', fontWeight: 'bold',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                                whiteSpace: 'pre-line', textAlign: 'center',
                                opacity: '0', transition: 'opacity 0.4s ease'
                            });
                            document.body.appendChild(popup);
                            requestAnimationFrame(() => popup.style.opacity = '1');
                            setTimeout(() => {
                                popup.style.opacity = '0';
                                setTimeout(() => popup.remove(), 500);
                            }, 3000);

                            console.log(`[Upload] ${msg.replace(/\n/g, ' | ')}`);

                            // ★ 업로드 완료 후에만 데이터 클리어 (레이스 컨디션 방지)
                            if (gdm && typeof gdm.clearGazeData === 'function') {
                                gdm.clearGazeData();
                            }
                        });
                    } else {
                        console.warn('[Upload] Skipped — no uploadId:', { firebaseSessionId: Game.firebaseSessionId, sessionId: Game.sessionId });
                        // 업로드 없어도 데이터 클리어 필요
                        if (gdm && typeof gdm.clearGazeData === 'function') {
                            gdm.clearGazeData();
                        }
                    }

                    // [FIX-iPhone15Pro] Restore WASM processing before next paragraph.
                    // _sdkFrameSkip was set true at replay start. Clear it here after replay+boss
                    // finishes so processFrame_ resumes for Para N reading.
                    window._sdkFrameSkip = false;
                    console.log('[FIX] _sdkFrameSkip=false: WASM resumed for next paragraph');

                    resolve();
                });

            } else {
                console.warn("Renderer does not support playGazeReplay.");
                resolve();
            }
        });
    },

    // --- NEW: Mid-Boss Battle (After each paragraph) ---
    triggerMidBossBattle() {
        console.log(`[Typewriter] Triggering Villain for Para ${this.currentParaIndex}`);
        if (this.uploadMonitor) clearInterval(this.uploadMonitor);

        // Use the same screen as final boss, but load specific quiz
        this.loadBossQuiz(this.currentParaIndex);
        Game.confrontVillain();
    },

    loadBossQuiz(index) {
        // [FIX] Ensure screen is interactive (reset previous lock)
        const villainScreen = document.getElementById("screen-boss");
        if (villainScreen) villainScreen.style.pointerEvents = "auto";

        if (!this.quizzes || !this.quizzes[index]) return;

        const quiz = this.quizzes[index];
        const questionEl = document.getElementById("boss-question");
        const optionsEl = document.getElementById("boss-options");

        if (questionEl) questionEl.textContent = `"${quiz.q}"`;
        if (optionsEl) {
            optionsEl.innerHTML = "";
            quiz.o.forEach((optText, i) => {
                const btn = document.createElement("button"); // FIXED: Re-added missing variable declaration
                btn.className = "quiz-btn";
                btn.textContent = optText;
                btn.onclick = () => Game.checkBossAnswer(i); // Direct call to global Game object
                optionsEl.appendChild(btn);
            });
        }
    },

    // --- Core Interaction: Gaze Input ---
    updateGazeStats(x, y) {
        if (!this.renderer || !this.renderer.isLayoutLocked) return;

        // 1. Hit Test (Visual Feedback Only)
        // Used only to highlight words, NOT to change the Line Index context.
        const hit = this.renderer.hitTest(x, y);

        // 2. Define Content Context (Ground Truth)
        // [CORRECTED PRINCIPLE] Line Index counts up automatically as text appears.
        // It is INDEPENDENT of gaze.
        const contentLineIndex = (typeof this.renderer.currentVisibleLineIndex === 'number')
            ? this.renderer.currentVisibleLineIndex
            : 0;

        let contentTargetY = null;

        // Find the Y coordinate of the *Current Text Line* (Context)
        if (this.renderer.lines && this.renderer.lines[contentLineIndex]) {
            contentTargetY = this.renderer.lines[contentLineIndex].visualY;
        }

        // 3. Return Sweep Logic is handled entirely by GazeDataManager's internal processGaze loop.
        // We only provide the context.

        // 4. Sync Context to Data Manager
        if (window.gazeDataManager) {
            const ctx = {
                lineIndex: contentLineIndex, // Strictly Typewriter-driven
                targetY: contentTargetY,
                paraIndex: this.currentParaIndex,
                wordIndex: null
            };
            window.gazeDataManager.setContext(ctx);
        }

        // 5. Visual Interactions (Hit Testing for Highlights Only)
        if (hit && hit.type === 'word') {
            const word = hit.word;
            // Only highlight if the word is actually revealed
            if (word.element && !word.element.classList.contains("read") && word.element.classList.contains("revealed")) {
                word.element.classList.add("read");
                word.element.style.color = "#fff";
                word.element.style.textShadow = "0 0 8px var(--primary-accent)";
            }
            if (hit.line) this.trackLineProgress(hit.line, word.index);
        }
    },

    trackLineProgress(line, wordIndex) {
        // Use the line's startIndex as a unique ID
        const lineId = line.startIndex;

        if (!this.lineStats.has(lineId)) {
            this.lineStats.set(lineId, new Set());
        }

        const hitWords = this.lineStats.get(lineId);
        hitWords.add(wordIndex);

        // Check Coverage
        const totalWordsInLine = line.wordIndices.length;
        const hitCount = hitWords.size;
        const ratio = hitCount / totalWordsInLine;

        // Report Coverage to Data Manager
        if (window.gazeDataManager) {
            window.gazeDataManager.setLineMetadata(line.index, {
                coverage: ratio * 100
            });
        }

        // Threshold: 60% of words in line read
        if (ratio > 0.6 && !line.completed) {
            line.completed = true; // Flag in renderer's line object (runtime only)
            // Deprecated: spawnInkReward(line); // Visual effect removed as per request
        }
    },

    // spawnInkReward(line) - DELETED (Deprecated feature)


    updateWPM() {
        // Check if currently reading (screen-read is active)
        const isReading = document.getElementById("screen-read")?.classList.contains("active");
        if (!isReading || this.isPaused) return;

        let targetWPM = 0;
        // Priority 1: GazeDataManager (Accurate)
        if (window.gazeDataManager && window.gazeDataManager.wpm > 0) {
            targetWPM = window.gazeDataManager.wpm;
        }
        // Priority 2: Simple estimation (Fallback) - REMOVED
        // We strictly use GazeDataManager's calculated WPM.
        // If 0, display 0. Do not use time-based estimation as it causes fluctuations.

        // Bridge to Manager
        Game.updateWPM(targetWPM);
    },

    startBossBattle() {
        console.log("Entering Boss Battle!");
        if (this.uploadMonitor) clearInterval(this.uploadMonitor); // Stop auto-upload
        // [DISABLED-iOS] Firebase upload at Boss entry removed.
        // Same reason as gaze replay: WebSocket LSN accumulation crashes iPhone Air.
        // if (window.gazeDataManager && Game.sessionId) {
        //     window.gazeDataManager.uploadToCloud(Game.sessionId);
        // }
        Game.confrontVillain();
    },

    // Stub
    checkGazeDistance(x, y) {
        this.updateGazeStats(x, y);
    },

    // [Feature] Floating Text Effect (Restored)
    spawnFloatingText(element, text, type = "normal") {
        if (!element) return;

        const floatEl = document.createElement("div");
        floatEl.textContent = text;
        floatEl.className = "floating-text " + type;

        // Style
        floatEl.style.position = "absolute";
        floatEl.style.left = "50%";
        floatEl.style.top = "50%";
        floatEl.style.transform = "translate(-50%, -50%)"; // Center
        floatEl.style.color = type === "error" ? "#ff5252" : (type === "success" ? "#69f0ae" : "#fff");
        floatEl.style.fontSize = "1.5rem";
        floatEl.style.fontWeight = "bold";
        floatEl.style.pointerEvents = "none";
        floatEl.style.whiteSpace = "nowrap";
        floatEl.style.textShadow = "0 2px 4px rgba(0,0,0,0.8)";
        floatEl.style.zIndex = "1000";
        floatEl.style.opacity = "1";
        floatEl.style.transition = "all 1s ease-out";

        element.appendChild(floatEl);

        // Animate
        requestAnimationFrame(() => {
            floatEl.style.top = "20%"; // Move Up
            floatEl.style.opacity = "0";
        });

        // Cleanup
        setTimeout(() => {
            if (floatEl.parentNode) floatEl.parentNode.removeChild(floatEl);
        }, 1000);
    },

    checkBossAnswer(optionIndex) {
        try {
            // [Safety] Find Quiz Data (Safely)
            const quiz = (this.currentChapter && this.currentChapter.boss_quiz)
                ? this.currentChapter.boss_quiz
                : (this.quizzes ? this.quizzes[this.currentParaIndex] : null);

            if (!quiz) {
                console.warn("[Game] No quiz data found for index " + this.currentParaIndex);
                this.forceAdvanceStage(); // Safety Fallback
                return;
            }

            // ── selector: #boss-options (실제 DOM); 과거 #boss-quiz-options는 없는 ID였음 ──
            const allBtns = document.querySelectorAll("#boss-options button");

            if (optionIndex === quiz.a) {
                // ── CORRECT ──────────────────────────────────────────────────────
                // Step 1: Lock ALL buttons
                allBtns.forEach(b => { b.disabled = true; b.style.cursor = 'default'; });

                // Step 2: Green glow on the chosen button
                const correctBtn = allBtns[optionIndex];
                if (correctBtn) correctBtn.classList.add("correct");

                // Step 3: 점수 즉시 반영 (동기 호출 — 화면 전환 전에 반드시 실행)
                // ⚠️ spawnFlyingResource 내부의 addGems 콜백은 RAF 완료 시 실행되므로
                //    화면 전환으로 RAF가 취소되면 점수가 누락된다. 여기서 먼저 호출한다.
                Game.addGems(100);
                console.log('[BossQuiz] CORRECT +100 gems applied immediately.');

                // Step 3b: 시각 효과 — 버튼에서 HUD gem-count 로 파티클 (순수 장식)
                // spawnFlyingResource 내부에도 addGems 호출이 있으나, 이미 위에서 처리했으므로
                // 중복 차감이 발생하지 않도록 amount=0 으로 전달한다.
                if (correctBtn && typeof Game.spawnFlyingResource === 'function') {
                    const rect = correctBtn.getBoundingClientRect();
                    Game.spawnFlyingResource(rect.left + rect.width / 2, rect.top + rect.height / 2, 0, 'gem');
                }

                // Step 4: Lock screen pointer events
                const villainScreen = document.getElementById("screen-boss");
                if (villainScreen) villainScreen.style.pointerEvents = "none";

                // Step 5: Advance
                if (this.currentParaIndex >= this.paragraphs.length - 1) {
                    console.log("[Game] All paragraphs done. Triggering Boss Calibration...");
                    setTimeout(() => {
                        Game.switchScreen('screen-boss-calibration');
                        const intro = document.getElementById('boss-cal-intro');
                        if (intro) intro.style.display = 'block';
                    }, 1000);
                } else {
                    const villainModal = document.getElementById("villain-modal");
                    if (villainModal) villainModal.style.display = "none";

                    this.currentParaIndex++;
                    console.log(`[Game] Advancing to Stage ${this.currentParaIndex + 1}...`);
                    this.chunkIndex = 0;
                    this.lineStats.clear();

                    // [FIX-iPhone15Pro] Stay on dark boss screen for 2500ms → iOS GC memory reclaim
                    setTimeout(() => {
                        Game.switchScreen("screen-read");
                        setTimeout(() => {
                            this.chunkIndex = 0;
                            this.playNextParagraph();
                        }, 800);
                    }, 2500);
                }

            } else {
                // ── WRONG ────────────────────────────────────────────────────────
                const wrongBtn = allBtns[optionIndex];

                // Step 1: Lock only the tapped button
                if (wrongBtn) {
                    wrongBtn.disabled = true;
                    wrongBtn.style.cursor = 'default';

                    // Step 2: Red shake via CSS class (bossShake keyframe in index.html)
                    wrongBtn.classList.add("wrong");
                    setTimeout(() => wrongBtn.classList.remove("wrong"), 450);
                }

                // Step 3: Deduct gems
                Game.addGems(-50);

                // Step 4: Fixed-position floating "-10 💎" rising from the button
                if (wrongBtn) {
                    const rect = wrongBtn.getBoundingClientRect();
                    const floatEl = document.createElement('div');
                    floatEl.textContent = '-50 💎';
                    Object.assign(floatEl.style, {
                        position: 'fixed',
                        left: (rect.left + rect.width / 2) + 'px',
                        top: rect.top + 'px',
                        transform: 'translateX(-50%)',
                        color: '#ff5252',
                        fontSize: '1.3rem',
                        fontWeight: 'bold',
                        fontFamily: "'Outfit', sans-serif",
                        textShadow: '0 0 10px rgba(255,82,82,0.8)',
                        pointerEvents: 'none',
                        zIndex: '999999',
                        transition: 'transform 0.9s ease-out, opacity 0.9s ease-out',
                        opacity: '1',
                    });
                    document.body.appendChild(floatEl);
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        floatEl.style.transform = 'translateX(-50%) translateY(-55px)';
                        floatEl.style.opacity = '0';
                    }));
                    setTimeout(() => { if (floatEl.parentNode) floatEl.remove(); }, 950);
                }

                // Step 5: Other buttons remain clickable — retry allowed
                console.log(`[Game] WRONG idx=${optionIndex}. Retry allowed.`);
            }

        } catch (e) {
            console.error("[Game] checkBossAnswer Critical Error:", e);
            this.forceAdvanceStage();
        }
    },

    // [New] Helper to force advance on error
    forceAdvanceStage() {
        this.currentParaIndex++;
        setTimeout(() => {
            Game.switchScreen("screen-read");
            setTimeout(() => { this.playNextParagraph(); }, 500);
        }, 1000);
    },

    // ── 최종빌런 진입 경고 팝업 ────────────────────────────────────────────
    // 소형빌런 3번째 정답 후, 또는 디버그 버튼에서 호출.
    // 플레이어가 "I AM READY" 를 눌러야만 triggerFinalBossBattleSequence() 실행.
    showFinalBossAlert() {
        // 중복 방지
        if (document.getElementById('final-boss-alert')) return;

        const overlay = document.createElement('div');
        overlay.id = 'final-boss-alert';
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;' +
            'align-items:center;justify-content:center;padding:32px;box-sizing:border-box;' +
            'background:radial-gradient(circle at 50% 40%,#1a0020 0%,#000 100%);' +
            'opacity:0;transition:opacity 0.5s ease;';

        overlay.innerHTML =
            '<p style="font-family:\'Cinzel\',serif;color:#ff4488;font-size:1.8rem;' +
            'letter-spacing:4px;text-shadow:0 0 16px rgba(255,0,100,0.9);' +
            'margin:0 0 22px 0;text-align:center;">FINAL CHALLENGE ALERT</p>' +

            '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(180,0,255,0.35);' +
            'border-radius:14px;padding:20px 24px;max-width:340px;margin-bottom:28px;text-align:center;">' +
            '<p style="font-family:\'Crimson Text\',serif;color:#e0ccff;font-size:1.0rem;' +
            'line-height:1.75;margin:0 0 14px 0;">' +
            'The Final Villain has unleashed a <strong style="color:#ff66aa;">Rift</strong> — ' +
            'a dark force that erases the memories of Wardens.<br><br>' +
            'Your reading is the only weapon left. <em>Steel your mind.</em>' +
            '</p>' +
            '<p style="font-family:\'Outfit\',sans-serif;color:#9966cc;font-size:0.8rem;' +
            'letter-spacing:1px;margin:0;">— Head Warden</p>' +
            '</div>' +

            '<button id="final-boss-alert-btn" style="' +
            'font-family:\'Cinzel\',serif;font-size:1.0rem;letter-spacing:3px;' +
            'color:#fff;background:linear-gradient(135deg,#6d28d9,#7c3aed);' +
            'border:1px solid rgba(167,139,250,0.4);border-radius:50px;' +
            'padding:14px 40px;cursor:pointer;' +
            'box-shadow:0 0 20px rgba(124,58,237,0.5);' +
            'transition:transform 0.15s ease,box-shadow 0.15s ease;">' +
            'I AM READY</button>';

        document.body.appendChild(overlay);
        // fade in
        requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '1'; }));

        // 버튼 hover 효과
        const btn = document.getElementById('final-boss-alert-btn');
        btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 0 32px rgba(124,58,237,0.8)'; };
        btn.onmouseout = () => { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 0 20px rgba(124,58,237,0.5)'; };

        btn.onclick = () => {
            btn.disabled = true; // 중복 클릭 방지

            // ① TextRenderer 해제 — overlay 커튼이 쳐진 상태에서 수행
            if (Game.typewriter && Game.typewriter.renderer) {
                if (typeof Game.typewriter.renderer.cancelAllAnimations === 'function') {
                    Game.typewriter.renderer.cancelAllAnimations();
                }
                Game.typewriter.renderer = null;
                console.log('[FinalBoss] TextRenderer released under overlay cover.');
            }

            // ② 화면 전환 — villain 화면이 절대 노출되지 않음 (overlay가 덮고 있음)
            Game.switchScreen('screen-final-quiz');

            // ③ FinalQuizManager 초기화 (150ms)
            setTimeout(() => {
                try {
                    if (!window.FinalQuizRef) {
                        window.FinalQuizRef = new FinalQuizManager();
                    }
                    window.FinalQuizRef.init();

                    const fqScreen = document.getElementById('screen-final-quiz');
                    if (fqScreen && !fqScreen.classList.contains('active')) {
                        console.warn('[FinalBoss] screen-final-quiz not active — forcing');
                        document.querySelectorAll('.screen').forEach(el => {
                            el.classList.remove('active');
                            el.style.display = 'none';
                        });
                        fqScreen.style.display = 'flex';
                        requestAnimationFrame(() => fqScreen.classList.add('active'));
                    }
                    console.log('[FinalBoss] FinalQuizManager.init() called ✓');
                } catch (e) {
                    console.error('[FinalBoss] FinalQuizManager init FAILED:', e);
                }

                // ④ 준비 완료 → 커튼 걷기. 노출되는 화면 = screen-final-quiz ✓
                setTimeout(() => {
                    overlay.style.transition = 'opacity 0.5s ease';
                    overlay.style.opacity = '0';
                    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 500);
                }, 150); // 총 300ms 후 fade 시작
            }, 150);
        };
    },

    // Extracted Helper: Trigger Final Boss
    triggerFinalBossBattleSequence() {
        console.log("[FinalBoss] Triggering NEW Final Quiz screen");

        // [FIX-MEM A] Release TextRenderer to free word-span DOM memory.
        if (Game.typewriter && Game.typewriter.renderer) {
            if (typeof Game.typewriter.renderer.cancelAllAnimations === 'function') {
                Game.typewriter.renderer.cancelAllAnimations();
            }
            Game.typewriter.renderer = null;
            console.log('[FinalBoss] TextRenderer released (word spans eligible for GC).');
        }

        // ── Route to screen-final-quiz ──
        Game.switchScreen('screen-final-quiz');

        setTimeout(() => {
            try {
                // FinalQuizManager 초기화 + 필요시 DOM 주입
                if (!window.FinalQuizRef) {
                    window.FinalQuizRef = new FinalQuizManager();
                }
                window.FinalQuizRef.init();

                // DOM 주입 후 switchScreen이 요소를 못찾았을 수 있으므로 재활성화
                const fqScreen = document.getElementById('screen-final-quiz');
                if (fqScreen && !fqScreen.classList.contains('active')) {
                    console.warn('[FinalBoss] screen-final-quiz was not active — forcing display');
                    document.querySelectorAll('.screen').forEach(el => {
                        el.classList.remove('active');
                        el.style.display = 'none';
                    });
                    fqScreen.style.display = 'flex';
                    requestAnimationFrame(() => fqScreen.classList.add('active'));
                }

                console.log('[FinalBoss] FinalQuizManager.init() called ✓');
            } catch (e) {
                console.error('[FinalBoss] FinalQuizManager init FAILED:', e);
            }
        }, 150);
    },


    // (Legacy) Old Final Boss via Alice Battle — preserved, not called from main flow
    triggerFinalBossBattleSequence_legacy() {
        console.log("[FinalBoss-Legacy] Routing to screen-alice-battle");
        if (Game.typewriter && Game.typewriter.renderer) {
            if (typeof Game.typewriter.renderer.cancelAllAnimations === 'function') {
                Game.typewriter.renderer.cancelAllAnimations();
            }
            Game.typewriter.renderer = null;
        }
        Game.switchScreen('screen-alice-battle');
        setTimeout(() => {
            if (window.AliceBattleRef) {
                const currentStats = {
                    ink: Game.state.ink,
                    rune: Game.state.rune,
                    gem: Game.state.gems
                };
                window.AliceBattleRef.init(currentStats);
                console.log("[FinalBoss-Legacy] AliceBattleRef.init() called with stats:", currentStats);
            } else {
                console.error("[FinalBoss-Legacy] FATAL: AliceBattleRef NOT FOUND!");
            }
        }, 150);
    },

    // [State] Simple Battle System (Delegated to GameLogic)

    triggerFinalBossBattle() {
        this.gameLogic.triggerFinalBossBattle();
    },

    updateBattleUI() {
        this.gameLogic.updateBattleUI();
    },

    handleBattleAction(type) {
        this.gameLogic.handleBattleAction(type);
    },

    winBattle() {
        this.gameLogic.winBattle();
    },

    /*
    checkFinalBossAnswer(index) {
        // ... (Legacy code preserved for reference if needed later) ...
    }
    */
    goToNewScore() {
        this.gameLogic.goToNewScore();
    },

    bindKeyAndUnlock_V2() {
        if (!this.wardenManager) {
            console.warn("[Game] WardenManager not ready on click. Force initializing...");
            // Ensure WardenManager is available in scope (it is imported at top)
            try {
                this.wardenManager = new WardenManager(this);
            } catch (e) {
                console.error("[Game] Failed to force-init WardenManager:", e);
                alert("Game Error: WardenManager Missing. Please refresh.");
                return;
            }
        }
        this.wardenManager.bindWarden();
    },

    goToNewSignup() {
        this.gameLogic.goToNewSignup();
    },

    goToNewShare() {
        this.gameLogic.goToNewShare();
    },
};

window.Game = Game;

// [SAFETY FIX] Module timing protection
const initGame = () => {
    if (Game.isInitialized) return;
    Game.isInitialized = true;
    console.log("[Game] Initializing (Module Loaded)...");
    Game.init();
};

if (document.readyState === "loading") {
    // Document still parsing
    document.addEventListener("DOMContentLoaded", initGame);
} else {
    // Document already interactive/complete
    initGame();
}



// ── [DEV] 디버그용 Final Quiz 바로가기 ─────────────────────────────────────
// home screen의 ⚡ [DEV] Final Quiz 버튼에서 호출
// FinalQuizManager가 이미 이 모듈 스코프에 import되어 있으므로 확실히 동작
window._devFinalQuiz = function () {
    console.log('[DEV] _devFinalQuiz() called — routing via showFinalBossAlert');
    try {
        if (Game.typewriter && typeof Game.typewriter.showFinalBossAlert === 'function') {
            Game.typewriter.showFinalBossAlert();
        } else {
            console.warn('[DEV] showFinalBossAlert not found, falling back to triggerFinalBossBattleSequence');
            Game.typewriter.triggerFinalBossBattleSequence();
        }
    } catch (e) {
        console.error('[DEV] _devFinalQuiz error:', e);
    }
};

// ── [SHARE] Social Share Global Handler ──────────────────────────────────────
window.shareGameLink = function (platform) {
    // Generate URL with referral ID parameter out of the dynamic base url
    const refId = window.Game && window.Game.firebaseSessionId ? window.Game.firebaseSessionId : '';
    const rootUrl = 'https://bookwardens.com/';
    const baseUrl = rootUrl + (refId ? '?ref=' + refId : '');
    const title = 'I just saved the Story World! Can you? Play The Book Wardens';

    console.log(`[Share] Triggering share for ${platform} with URL: ${baseUrl}`);

    // Track share in Amplitude
    if (window.amplitude) {
        window.amplitude.track('Share_Clicked', { platform: platform, shareUrl: baseUrl, refId: refId });
    }

    // Open native sharing dialogs
    if (platform === 'facebook') {
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(baseUrl)}`, '_blank');
    } else if (platform === 'twitter') {
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title + ': ' + baseUrl)}`, '_blank');
    } else if (platform === 'whatsapp') {
        window.open(`https://wa.me/?text=${encodeURIComponent(title + ': ' + baseUrl)}`, '_blank');
    } else if (platform === 'kakao' || platform === 'copy') {
        navigator.clipboard.writeText(baseUrl)
            .then(() => alert(`Link Copied to Clipboard!\n\n${baseUrl}`))
            .catch(() => alert('Failed to copy link. Please manually copy the URL.'));
    }
};
