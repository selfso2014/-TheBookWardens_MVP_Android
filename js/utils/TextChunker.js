
export class TextChunker {
    /**
     * Splits tokens into semantic chunks based on WPM.
     * @param {Array} tokens - Array of {t, b} objects
     * @param {number} wpm - Words Per Minute
     * @param {Array} highlights - Array of {target_token_index, type, word_id}
     * @returns {Array} Array of Arrays of Token Objects
     */
    static process(tokens, wpm, highlights = []) {
        const chunks = [];
        let currentChunk = [];

        // Define WPM Bands
        let band = 'mid'; // Default
        if (wpm < 150) band = 'low';       // Novice
        else if (wpm < 250) band = 'mid';  // Apprentice (Target: 200)
        else band = 'high';                // Master (300+)

        // Loop through tokens
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const tokenObj = { ...token, originalIndex: i };
            currentChunk.push(tokenObj);

            let shouldBreak = false;
            const len = currentChunk.length;

            // --- 0. Absolute Hard Breaks (Always Break) ---
            if (token.b === 4) shouldBreak = true; // Paragraph/Sentence End

            // --- 1. Band-Specific Logic ---
            else if (band === 'low') {
                // Novice (100 WPM):
                // [FEEDBACK] "100wpm 속도시에는 너무 청크가 1개가 많이 나옴." -> Increase chunk size.
                // New Strategy: Minimum 2 words, Target 3.
                // - Only break if len >= 2 AND pause strength >= 1.
                // - Force break at 4 words (Hard Limit).
                if (len >= 4) shouldBreak = true;
                else if (len >= 2 && token.b >= 1) shouldBreak = true;
            }
            else if (band === 'mid') {
                // Apprentice (200 WPM): Sense Groups (3-4 words).
                // Current logic is GOOD (198 WPM measured). Keep it.
                // Target: 200 WPM -> ~3 words/chunk
                if (len >= 5) shouldBreak = true; // Hard Limit
                else if (len >= 3 && token.b >= 2) shouldBreak = true; // Normal flow
                else if (len >= 2 && token.b >= 3) shouldBreak = true; // Short phrase end
            }
            else { // 'high'
                // Master (300 WPM):
                // [FEEDBACK] "300wpm 속도시에는 청크를 조금 더 많이 나오게(잘게)" -> Decrease chunk size.
                // Prev: 6-10 words -> New: 4-7 words.
                // - Break on MEDIUM pauses (b>=2, commas) if len >= 4.
                // - Force break at 7 words (Hard Limit).
                if (len >= 7) shouldBreak = true; // Hard Limit (Reduced from 10)
                else if (len >= 4 && token.b >= 2) shouldBreak = true; // More aggressive breaking
                else if (len >= 3 && token.b >= 3) shouldBreak = true; // Strong pause
            }

            // --- 2. End of Data ---
            if (i === tokens.length - 1) shouldBreak = true;

            if (shouldBreak) {
                // Prevent empty chunks (sanity check)
                if (currentChunk.length > 0) {
                    chunks.push([...currentChunk]);
                    currentChunk = [];
                }
            }
        }

        return chunks;
    }
}
