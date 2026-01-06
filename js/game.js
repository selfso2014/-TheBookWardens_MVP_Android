/**
 * The Book Wardens: Game Logic
 */

const Game = {
    state: {
        gems: 0,
        currentWordIndex: 0,
        readProgress: 0, // 0..100
        isTracking: false,
    },

    init() {
        console.log("Game Init");
        this.bindEvents();
        this.updateUI();
    },

    bindEvents() {
        const startBtn = document.getElementById("btn-start-game");
        if (startBtn) {
            startBtn.onclick = async () => {
                startBtn.disabled = true;
                startBtn.textContent = "Initializing Eye Tracking...";

                try {
                    // 1. Request Camera & Init SDK
                    if (typeof window.startEyeTracking === "function") {
                        const ok = await window.startEyeTracking();
                        if (ok) {
                            // 2. Success -> Move to Game
                            this.switchScreen("screen-word");
                        } else {
                            alert("Eye tracking failed to initialize. Please reload and try again.");
                            startBtn.disabled = false;
                            startBtn.textContent = "Enter the Rift";
                        }
                    } else {
                        // Fallback/Debug
                        console.warn("window.startEyeTracking not found. Starting without eye tracking.");
                        this.switchScreen("screen-word");
                    }
                } catch (e) {
                    console.error(e);
                    alert("Initialization error: " + e.message);
                    startBtn.disabled = false;
                    startBtn.textContent = "Enter the Rift";
                }
            };
        }
    },

    switchScreen(screenId) {
        // Hide all
        document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
        // Show target
        const target = document.getElementById(screenId);
        if (target) target.classList.add("active");

        // Logic per screen
        if (screenId === "screen-read") {
            this.startReadingSession();
        }
    },

    updateUI() {
        const gemEl = document.getElementById("gem-count");
        if (gemEl) gemEl.textContent = this.state.gems;
    },

    // --- 1. Word Forge ---
    checkVocab(optionIndex) {
        // In a real app, check vs data. Luminous -> 1 (Shining)
        const isCorrect = (optionIndex === 1);
        if (isCorrect) {
            alert("Correct! +10 Gems");
            this.state.gems += 10;
            this.updateUI();
            // Move to next stage
            this.switchScreen("screen-read");
        } else {
            alert("Try again!");
        }
    },

    // --- 2. Reading Rift ---
    startReadingSession() {
        this.state.readProgress = 0;
        this.state.isTracking = true;
        console.log("Reading session started. Waiting for gaze...");
    },

    // Called by app.js (SeeSo overlay)
    onGaze(x, y) {
        // Only active in reading screen
        const readScreen = document.getElementById("screen-read");
        if (!readScreen.classList.contains("active")) return;

        // Hit test: is the user looking at the text?
        const el = document.elementFromPoint(x, y);
        if (el && (el.tagName === 'P' || el.closest('.book-container'))) {
            // Glow effect on text logic could go here
            // For now, simple progress accumulation
            this.state.readProgress += 0.2; // fill speed
            this.updateProgressBar();
        }
    },

    updateProgressBar() {
        const bar = document.getElementById("read-progress");
        if (bar) {
            // Cap at 100
            let p = Math.min(100, this.state.readProgress);
            bar.style.width = p + "%";

            // Win condition for reading
            if (p >= 100) {
                this.state.isTracking = false;
                // Delay slightly then move to boss
                setTimeout(() => this.switchScreen("screen-boss"), 1000);
            }
        }
    },

    // --- 3. Boss Battle ---
    checkBoss(optionIndex) {
        // Correct answer for "Why did Alice follow?" -> B. Bored / Curiosity (in simplified text)
        // Here we used "Bred" vs "Late". Text says "nothing to do".
        // Let's say Option 1 (Index 1) is correct.
        const isCorrect = (optionIndex === 1);

        if (isCorrect) {
            alert("Direct Hit! The Shadow fades...");
            this.state.gems += 50;
            this.updateUI();
            this.switchScreen("screen-win");
        } else {
            alert("The Shadow deflects your attack! Try reading carefully.");
        }
    }
};

// Expose to window for HTML onclicks
window.Game = Game;

// Boot game when DOM ready
document.addEventListener("DOMContentLoaded", () => {
    Game.init();
});
