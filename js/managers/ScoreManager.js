/**
 * ScoreManager.js
 * Manages game state, scores, and resource updates.
 */
export class ScoreManager {
    constructor() {
        this.gems = 0;
        this.runes = 0;
        this.ink = 0;
        this.wpmDisplay = 0;

        // Additional Stats
        this.vocabIndex = 0; // Word Forge Progress
        this.readProgress = 0; // Percentage
        this.wpmScores = []; // History of WPM

        // New Detailed Stats for Recap
        this.stats = {
            ink: { totalLines: 0, pangs: 0 },
            rune: { total: 0, correct: 0 }, // Will rely on quiz counts
            gem: { total: 0, correct: 0 }
        };
    }

    reset() {
        this.gems = 0;
        this.runes = 0;
        this.ink = 0;
        this.wpmDisplay = 0;
        this.vocabIndex = 0;
        this.readProgress = 0;
        this.wpmScores = [];
        this.stats = {
            ink: { totalLines: 0, pangs: 0 },
            rune: { total: 0, correct: 0 },
            gem: { total: 0, correct: 0 }
        };
        this.updateUI();
    }

    addInk(amount) {
        this.ink = Math.max(0, this.ink + amount);
        this.updateUI();
    }

    addRunes(amount) {
        this.runes = Math.max(0, this.runes + amount);
        this.updateUI();
    }

    addGems(amount) {
        this.gems = Math.max(0, this.gems + amount);
        this.updateUI();
    }

    // WPM Smoothing Logic
    updateWPM(targetWPM) {
        const alpha = 0.1; // Smoothing factor
        // If difference is huge (e.g. init), jump directly
        if (Math.abs(targetWPM - this.wpmDisplay) > 50 && this.wpmDisplay === 0) {
            this.wpmDisplay = targetWPM;
        } else {
            this.wpmDisplay = this.wpmDisplay + alpha * (targetWPM - this.wpmDisplay);
        }

        // Update specific WPM UI
        const wpmEl = document.getElementById("wpm-display");
        if (wpmEl) wpmEl.textContent = Math.round(this.wpmDisplay);
    }

    // Centralized UI Update
    updateUI() {
        // 1. Gem
        const gemEl = document.getElementById("gem-count");
        if (gemEl) gemEl.textContent = this.gems;

        // 2. Ink
        const inkEl = document.getElementById("ink-count");
        if (inkEl) inkEl.textContent = this.ink;

        // 3. Rune
        const runeEl = document.getElementById("rune-count");
        if (runeEl) runeEl.textContent = this.runes;
    }

    // --- Scoring Logic for Final Report ---
    getReport() {
        // Calculate Percentages
        // 1. Ink (Pang Ratio) - Assume 10 lines per paragraph approx? Or rely on exact counts?
        // For now, simpler calculation: Ink Score / Theoretical Max
        // Let's use the raw values

        // 2. Rune 
        const runeTotal = this.stats.rune.total || 1;
        const runePct = Math.round((this.stats.rune.correct / runeTotal) * 100);

        // 3. Gem (Bosses)
        const gemTotal = this.stats.gem.total || 1;
        const gemPct = Math.round((this.stats.gem.correct / gemTotal) * 100);

        // 4. Ink (Valid Lines vs Pangs)
        // If we don't have total lines, use Ink/100 as placeholder or track strictly
        const inkTotal = this.stats.ink.totalLines || 1;
        const inkPct = Math.round((this.stats.ink.pangs / inkTotal) * 100);

        return {
            ink: { val: this.ink, pct: inkPct, label: 'Reading Flow' },
            rune: { val: this.runes, pct: runePct, label: 'Vocabulary' },
            gem: { val: this.gems, pct: gemPct, label: 'Comprehension' },
            wpm: Math.round(this.wpmDisplay),
            rank: this.calculateRank(inkPct, runePct, gemPct)
        };
    }

    calculateRank(ink, rune, gem) {
        // Weighted Average? Or simple average?
        const avg = (ink + rune + gem) / 3;
        if (avg >= 90) return 'S';
        if (avg >= 80) return 'A';
        if (avg >= 60) return 'B';
        return 'C';
    }
}
