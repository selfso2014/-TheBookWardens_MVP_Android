
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
        let targetSpan = Math.max(1, Math.round(wpm / 100)); // [ADJUSTED] Smaller chunks: 100 divisor (was 75)

        // Safety constraint: Don't let chunks get too massive even at high speeds
        const MAX_CHUNK_SIZE = 15;

        // Loop through tokens
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            // Store original index for reference
            const tokenObj = { ...token, originalIndex: i };
            currentChunk.push(tokenObj);

            let shouldBreak = false;

            // 1. Critical Break (Limit 4: Strongest Stop) - Always break
            if (token.b === 4) {
                shouldBreak = true;
            }
            // 2. Check if we reached target size
            else if (currentChunk.length >= targetSpan) {
                // Adaptive Logic based on WPM band
                if (wpm < 150) {
                    // Low Speed: Break on any weak boundary (b >= 2)
                    if (token.b >= 2) {
                        shouldBreak = true;
                    }
                } else if (wpm < 300) {
                    // Mid Speed: Break on medium boundary (b >= 3)
                    if (token.b >= 3) {
                        shouldBreak = true;
                    }
                } else {
                    // High Speed: Ignore b=2,3. Just break on count (or b=4 caught above)
                    // We simply break because we filled the span.
                    shouldBreak = true;
                }
            }

            // 3. Safety: Force break if too long
            if (currentChunk.length >= MAX_CHUNK_SIZE) {
                shouldBreak = true;
            }

            // 4. End of Data
            if (i === tokens.length - 1) {
                shouldBreak = true;
            }

            if (shouldBreak) {
                chunks.push([...currentChunk]);
                currentChunk = [];
            }
        }

        return chunks;
    }
}
