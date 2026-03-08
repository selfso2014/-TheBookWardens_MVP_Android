/**
 * TextRenderer.js
 * 
 * "The Stable Typesetter"
 * 
 * Provides a specialized rendering engine for reading games that prioritizes:
 * 1. Layout Stability: Pre-renders text to lock in geometric coordinates (Reflow Prevention).
 * 2. Coordinate Caching: Caches word positions once, eliminating DOM reads during gameplay.
 * 3. Hit-Testing: Provides O(n) or optimized lookups for gaze-to-word mapping without browser recalculations.
 */
import { bus } from "./core/EventBus.js";
import { TextChunker } from "./utils/TextChunker.js";

export class TextRenderer {
    constructor(containerId, options = {}) {
        // v2026-02-05-1215: Retroactive Animation
        this.containerId = containerId;
        this.container = document.getElementById(containerId);

        this.options = Object.assign({
            fontFamily: "'Crimson Text', serif",
            fontSize: "1.5rem",
            lineHeight: "2.5",
            wordSpacing: "0.3em",
            padding: "20px"
        }, options);

        // State
        this.words = [];       // Array of Word Objects: { id, text, chunkId, element, rect }
        this.chunks = [];      // Array of Chunk Arrays (grouping word indices)
        this.lines = [];       // Array of Line Objects: { y, top, bottom, wordIndices[] }
        this.isLayoutLocked = false;

        // [New] Animation Safety
        this.activeAnimations = []; // Store timeout IDs to cancel them on reset/page turn
        // [FIX-iOS] Track RAF IDs to cancel them all on cleanup (prevents orphaned loops)
        this.activeRAFs = [];
        this._replayRAFId = null; // dedicated slot for the replay animate loop
        // [FIX #9] Track flying-ink particle elements so cancelAllAnimations() can remove orphan DOM nodes
        this._activeFlyingInkNodes = new Set();

        // Visual Elements
        this.cursor = null;
        this.impactElement = null;

        this.initStyles();
    }

    // [New] Safety Method: Kill all pending text reveals AND RAF loops
    cancelAllAnimations() {
        if (this.activeAnimations.length > 0) {
            console.log(`[Life] TextRenderer: Cancelling ${this.activeAnimations.length} pending animations.`);
            this.activeAnimations.forEach(id => clearTimeout(id));
            this.activeAnimations = [];
        } else {
            console.log(`[Life] TextRenderer: No pending animations to cancel.`);
        }
        // [FIX-iOS] Also cancel any tracked RAF loops
        if (this.activeRAFs && this.activeRAFs.length > 0) {
            console.log(`[Life] TextRenderer: Cancelling ${this.activeRAFs.length} RAFs.`);
            this.activeRAFs.forEach(id => cancelAnimationFrame(id));
            this.activeRAFs = [];
        }
        // Cancel dedicated replay RAF
        if (this._replayRAFId) {
            cancelAnimationFrame(this._replayRAFId);
            this._replayRAFId = null;
        }
        // [FIX #9] Remove orphaned flying-ink particle nodes from body.
        // When RAF is force-cancelled, p.remove() inside animate() never fires.
        // _activeFlyingInkNodes tracks every live particle so we can clean them up here.
        if (this._activeFlyingInkNodes && this._activeFlyingInkNodes.size > 0) {
            console.log(`[Life] TextRenderer: Removing ${this._activeFlyingInkNodes.size} orphaned flying-ink nodes.`);
            this._activeFlyingInkNodes.forEach(node => {
                try { if (node.parentNode) node.remove(); } catch (e) { /* silent */ }
            });
            this._activeFlyingInkNodes.clear();
        }
        // IMPORTANT: Do NOT touch this.cursor or this.impactElement here.
        // cancelAllAnimations() is called on every showPage() / prepareDynamic() / prepare() during reading.
        // Setting cursor=null kills triggerReturnEffect() (its first guard is: if (!this.cursor) return false).
        // cursor lifecycle: created in lockLayout(), replaced in lockLayout() on next render, removed naturally.
        // impactElement lifecycle: lazy-created in triggerReturnEffect() with document.contains() guard.
        // Pang-marker-layer cleanup belongs exclusively in SCREEN_CLEANUP['screen-read'] (game.js).
    }


    // [FIX-iOS] Track a RAF id so cancelAllAnimations() can clean it up
    trackRAF(id) {
        if (id) this.activeRAFs.push(id);
        return id;
    }

    initStyles() {
        if (!this.container) return;
        this.container.style.position = "relative";
        this.container.style.fontFamily = this.options.fontFamily;
        this.container.style.fontSize = this.options.fontSize;
        this.container.style.lineHeight = this.options.lineHeight;
        this.container.style.padding = this.options.padding;
        this.container.style.textAlign = "left";
    }

    prepareDynamic(chapterData, wpm = 150) {
        if (!this.container) return;
        this.cancelAllAnimations();

        // Clear state
        this.container.innerHTML = "";
        this.words = [];
        this.chunks = [];
        this.lines = [];
        this.isLayoutLocked = false;
        this.wpm = wpm; // [FIX] Store for _rechunkByLineBreaks() WPM guard

        if (!chapterData || !chapterData.paragraphs) return;

        // Flatten paragraphs into single token stream
        let allTokens = [];
        let allHighlights = [];
        let tokenOffset = 0;

        chapterData.paragraphs.forEach(p => {
            // Add paragraph break if needed? Usually text flows.
            // But we might want a visual break.
            // For now, simple concatenation.

            p.tokens.forEach(t => {
                allTokens.push(t);
            });

            if (p.vocab_highlights) {
                p.vocab_highlights.forEach(h => {
                    allHighlights.push({
                        ...h,
                        target_token_index: h.target_token_index + tokenOffset,
                        originalParagraphId: p.id
                    });
                });
            }
            tokenOffset += p.tokens.length;
        });

        // Use DSC Algorithm to chunk text
        console.log(`[TextRenderer] Preparing Dynamic Text for WPM: ${wpm}`);
        const groupedChunks = TextChunker.process(allTokens, wpm, allHighlights);

        // Render Chunks to DOM
        let globalWordIndex = 0;

        // Create Highlight Map for O(1) Lookup
        const highlightMap = new Map();
        allHighlights.forEach(h => highlightMap.set(h.target_token_index, h));

        groupedChunks.forEach((chunkTokens, chunkIdx) => {
            const currentChunkIndices = [];

            chunkTokens.forEach((tokenObj) => {
                // Determine if this is a Rune Word
                // tokenObj has 'originalIndex' relative to 'allTokens' if passed correctly?
                // Wait, TextChunker loop uses 'i' from 0..tokens.length.
                // So tokenObj.originalIndex IS the global index if we passed allTokens.
                const isRuneWord = highlightMap.has(tokenObj.originalIndex);
                const highlightData = highlightMap.get(tokenObj.originalIndex);

                // Create Span
                const span = document.createElement("span");
                span.className = "tr-word";
                if (isRuneWord) {
                    span.classList.add("rune-word");
                    span.dataset.wordId = highlightData.word_id;
                    // Initial Style for Rune Word?
                    // Bold? Glow? Handled by CSS or Logic later.
                    // span.style.fontWeight = "bold"; // Example default
                }

                span.style.color = "#ffffff"; // Default
                span.style.opacity = "0";
                span.style.marginRight = this.options.wordSpacing;
                span.style.display = "inline-block";
                span.style.lineHeight = "1.2";
                span.style.verticalAlign = "middle";
                span.dataset.index = globalWordIndex;
                span.textContent = tokenObj.t;

                this.container.appendChild(span);

                // Add to system
                this.words.push({
                    element: span,
                    text: tokenObj.t,
                    index: globalWordIndex,
                    rect: null,
                    isRuneWord: isRuneWord,
                    runeId: isRuneWord ? highlightData.word_id : null
                });

                currentChunkIndices.push(globalWordIndex);
                globalWordIndex++;
            });

            this.chunks.push(currentChunkIndices);
        });

        console.log(`[TextRenderer] Dynamic Layout: ${this.chunks.length} chunks from ${allTokens.length} tokens.`);

        // Common Setup
        this.addVisualAugments();
        this.paginate();
    }

    addVisualAugments() {
        // Reset Pagination State
        this.pages = [];
        this.currentPageIndex = 0;
        this.validatedLines = new Set();

        // Remove old layers
        const oldLayer = document.getElementById("pang-marker-layer");
        if (oldLayer) oldLayer.remove();

        const oldCursor = document.querySelector('.tr-cursor');
        if (oldCursor) oldCursor.remove();

        // Create Cursor
        this.cursor = document.createElement("span");
        this.cursor.className = "tr-cursor";
        this.cursor.style.position = "fixed";
        this.cursor.style.top = "-1000px";
        this.cursor.style.left = "-1000px";
        this.cursor.style.zIndex = "9999";
        this.cursor.style.pointerEvents = "none";
        this.cursor.style.opacity = "0";
        this.cursor.style.backgroundColor = "transparent";
        document.body.appendChild(this.cursor);

        // Create Impact
        if (!this.impactElement) {
            this.impactElement = document.createElement('div');
            this.impactElement.id = "tr-impact-effect";
            this.impactElement.style.position = "fixed";
            this.impactElement.style.borderRadius = "50%";
            this.impactElement.style.backgroundColor = "magenta";
            this.impactElement.style.boxShadow = "0 0 15px magenta";
            this.impactElement.style.zIndex = "999999";
            this.impactElement.style.pointerEvents = "none";
            this.impactElement.style.opacity = "0";
            this.impactElement.style.width = "10px";
            this.impactElement.style.height = "10px";
            document.body.appendChild(this.impactElement);
        }

        if (this.words.length > 0) {
            setTimeout(() => {
                this.updateCursor(this.words[0], 'start');
                this.cursor.style.opacity = '0';
            }, 50);
        }

        this.lastReturnTime = Date.now() + 2000;
    }

    prepare(rawText) {
        if (!this.container) return;
        this.cancelAllAnimations();

        // Clear previous state
        if (this.container) this.container.innerHTML = "";
        this.words = [];
        this.chunks = [];
        this.lines = []; // [FIX] Reset lines
        this.isLayoutLocked = false; // [FIX] Unlock layout

        if (!rawText) return;

        // ... Legacy Logic ...

        // --- DYNAMIC CHUNKING LOGIC (Legacy Mode) ---
        // 1. Get Target Chunk Size (Default to 4 if not set)
        const targetSize = (typeof Game !== 'undefined' && Game.targetChunkSize) ? Game.targetChunkSize : 4;
        console.log(`[TextRenderer] Preparing text with Chunk Size: ${targetSize}`);

        // 2. Normalize Text: Remove existing '/' delimiters which were static
        const cleanText = rawText.replace(/\//g, " ");

        // 3. Split into Words
        const rawWords = cleanText.trim().split(/\s+/);

        let currentChunkIndices = [];
        let wordCountInChunk = 0;

        rawWords.forEach((w, index) => {
            // ... legacy rendering ...
            const span = document.createElement("span");
            span.className = "tr-word";
            span.style.color = "#ffffff";
            span.style.opacity = "0";
            span.style.marginRight = this.options.wordSpacing;
            span.style.display = "inline-block";
            span.style.lineHeight = "1.2";
            span.style.verticalAlign = "middle";
            span.dataset.index = index;
            span.textContent = w;

            this.container.appendChild(span);
            this.words.push({ element: span, text: w, index: index, rect: null });

            currentChunkIndices.push(index);
            wordCountInChunk++;

            const isPunctuation = w.includes('.') || w.includes('?') || w.includes('!') || w.includes(',') || w.includes(';') || w.includes(':');

            if (isPunctuation || wordCountInChunk >= targetSize) {
                this.chunks.push(currentChunkIndices);
                currentChunkIndices = [];
                wordCountInChunk = 0;
            }
        });

        if (currentChunkIndices.length > 0) this.chunks.push(currentChunkIndices);

        this.addVisualAugments();
        this.paginate();
    }

    /* paginate() { ... } */

    paginate() {
        if (!this.container || this.words.length === 0) return;

        const containerHeight = this.container.clientHeight;
        const paddingBottom = 40; // Safety margin
        const maxHeight = containerHeight - paddingBottom;

        let currentPage = [];
        this.pages = [currentPage];

        // Temporarily ensure all words are visible to measure properly
        this.words.forEach(w => w.element.style.display = "inline-block");

        // Simple Greedy Pagination by Top coordinate
        // WE MUST MEASURE. Forcing a reflow here is necessary.
        let currentY = -9999;
        let pageStartY = this.words[0].element.offsetTop;

        // Strategy: Iterate words. If a word's bottom exceeds (pageStart + maxHeight), start new page.
        this.words.forEach((w, i) => {
            const el = w.element;
            const top = el.offsetTop;
            const bottom = top + el.offsetHeight;

            // Check if this word fits in current page
            // Relative Top from current page start
            const relTop = top - pageStartY;
            const relBottom = bottom - pageStartY;

            if (relBottom > maxHeight && currentPage.length > 0) {
                // Overflow! Start new page.
                currentPage = [];
                this.pages.push(currentPage);
                pageStartY = top; // New page starts here roughly
            }

            currentPage.push(w);
            w.pageIndex = this.pages.length - 1;
        });

        console.log(`[TextRenderer] Paginated into ${this.pages.length} pages.`);
    }

    showPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= this.pages.length) return false;

        // [SAFETY] Stop any ongoing typing effects from previous page!
        this.cancelAllAnimations();

        this.currentPageIndex = pageIndex;

        // Hide ALL words first
        this.words.forEach(w => {
            w.element.style.display = "none";
            w.element.style.opacity = "0"; // Reset opacity for animation
            w.element.classList.remove("revealed");
        });

        // Show words in current page
        const pageWords = this.pages[pageIndex];
        pageWords.forEach(w => {
            w.element.style.display = "inline-block";
        });

        // Important: Re-lock Layout for this page's content
        // This ensures hit-testing words on THIS page works correctly.
        // We delay slightly to allow display:block to reflow.
        return new Promise(resolve => {
            // [FIX-iOS] Track this RAF so cancelAllAnimations() can clean it up
            this.trackRAF(requestAnimationFrame(() => {
                this.lockLayout(); // Recalculate lines for current page
                resolve();
            }));
        });
    }

    lockLayout() {
        if (this.words.length === 0) return;

        // [CRITICAL FIX] Reset lines array before recalculating.
        // Otherwise, lines accumulate across page turns, causing index jumps (e.g., 0 -> 9).
        this.lines = [];

        const containerRect = this.container.getBoundingClientRect();
        let currentLineY = -9999;
        let lineBuffer = [];

        this.words.forEach(word => {
            const r = word.element.getBoundingClientRect();

            // [CRITICAL FIX] Skip invisible words (e.g., words from other pages).
            // They have rect {0,0,0,0} and should not form lines.
            if (r.width === 0 && r.height === 0) return;

            // Typographic Center Correction (Top Quartile)
            const visualCenterY = r.top + (r.height * 0.25);

            word.rect = {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                centerX: r.left + r.width / 2,
                centerY: r.top + r.height / 2,
                visualCenterY: visualCenterY
            };

            // Use larger threshold for line detection
            if (Math.abs(word.rect.top - currentLineY) > (word.rect.height * 1.5)) {
                if (lineBuffer.length > 0) {
                    this.lines.push(this._finalizeLine(lineBuffer));
                }
                lineBuffer = [word];
                currentLineY = word.rect.top;
            } else {
                lineBuffer.push(word);
            }
        });

        if (lineBuffer.length > 0) {
            this.lines.push(this._finalizeLine(lineBuffer));
        }

        this.isLayoutLocked = true;

        // [CRITICAL] Reset Line Index for NEW Page / Layout Lock
        this.currentVisibleLineIndex = 0;

        // [OPTIMIZATION] Cache line start indices for O(1) lookup in revealChunk
        this._lineStartSet = new Set(this.lines.map(l => l.startIndex));

        console.log(`[TextRenderer] Layout Locked: ${this.words.length} words (checked), ${this.lines.length} lines created.`);
        if (this.lines.length > 0) {
            console.log(`[TextRenderer] Line 0 Y: ${this.lines[0].rect.top.toFixed(1)}, Line ${this.lines.length - 1} Y: ${this.lines[this.lines.length - 1].rect.top.toFixed(1)}`);
        } else {
            console.warn("[TextRenderer] WARNING: No lines created! Check word visibility or threshold.");
        }

        // [BUG FIX: Pang line mismatch at 300 WPM]
        // Only apply at high WPM (>=250). At 100/200 WPM the original chunk timing
        // was already calibrated correctly; splitting pushes setContext() too late,
        // causing pang to fire 1 line behind the user's actual gaze position.
        if ((this.wpm || 0) >= 250) {
            this._rechunkByLineBreaks();
        }
    }

    /**
     * [POST-LAYOUT] Split chunks that cross visual line boundaries.
     *
     * Must be called AFTER lockLayout() has assigned w.lineIndex to every word.
     *
     * Invariant enforced:
     *   All word indices inside one chunk share the same lineIndex.
     *
     * This guarantees that revealChunk() never calls setContext() with a new
     * lineIndex while the previous chunk is still being displayed, eliminating
     * the 1-line offset in pang event positioning at high WPM.
     */
    _rechunkByLineBreaks() {
        if (!this.chunks || this.chunks.length === 0) return;
        if (!this.words || this.words.length === 0) return;

        const before = this.chunks.length;
        const newChunks = [];

        this.chunks.forEach(chunk => {
            // Group consecutive word indices by lineIndex.
            // We preserve order: sub-chunks appear in the same order as original.
            let subChunk = [];
            let lastLineIdx = null;

            chunk.forEach(wordIdx => {
                const w = this.words[wordIdx];
                const li = (w && typeof w.lineIndex === 'number') ? w.lineIndex : lastLineIdx;

                if (lastLineIdx === null) {
                    // First word in this chunk
                    lastLineIdx = li;
                }

                if (li !== lastLineIdx) {
                    // Line boundary crossed → flush current sub-chunk
                    if (subChunk.length > 0) newChunks.push(subChunk);
                    subChunk = [];
                    lastLineIdx = li;
                }

                subChunk.push(wordIdx);
            });

            // Flush remaining
            if (subChunk.length > 0) newChunks.push(subChunk);
        });

        this.chunks = newChunks;

        const after = this.chunks.length;
        if (after !== before) {
            console.log(`[TextRenderer] _rechunkByLineBreaks: ${before} → ${after} chunks (${after - before} splits from line breaks)`);
        }
    }


    _finalizeLine(words) {
        const first = words[0].rect;
        const last = words[words.length - 1].rect;
        const lineIndex = this.lines.length;
        const minTop = Math.min(...words.map(w => w.rect.top));
        const maxBottom = Math.max(...words.map(w => w.rect.bottom));

        let sumVisualY = 0;
        words.forEach(w => {
            w.lineIndex = lineIndex;
            sumVisualY += w.rect.visualCenterY;
        });

        return {
            index: lineIndex,
            startIndex: words[0].index,
            endIndex: words[words.length - 1].index,
            wordIndices: words.map(w => w.index),
            visualY: sumVisualY / words.length,
            rect: {
                left: first.left,
                right: last.right,
                top: minTop,
                bottom: maxBottom,
                width: last.right - first.left,
                height: maxBottom - minTop
            }
        };
    }

    resetToStart() {
        if (this.words.length > 0) {
            this.updateCursor(this.words[0], 'start');
        }
        this.currentVisibleLineIndex = 0;
    }

    revealChunk(chunkIndex, interval = 150) {
        if (!this.isLayoutLocked) this.lockLayout();
        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return Promise.resolve();

        const indices = this.chunks[chunkIndex];
        const startTime = Date.now();

        return new Promise((resolve) => {
            const wordsToReveal = indices.map((wordIdx, i) => {
                const w = this.words[wordIdx];
                const isLineStart = this._lineStartSet && this._lineStartSet.has(w.index);
                return { word: w, isLineStart, indexInChunk: i };
            });

            let revealedCount = 0;
            let cumulativeDelay = 0;
            const revealData = wordsToReveal.map(item => {
                if (item.isLineStart && item.word.index > 0) {
                    cumulativeDelay += 450; // Line break pause
                }
                const revealTime = cumulativeDelay;
                cumulativeDelay += interval;
                return { ...item, revealTime };
            });

            const animateReveal = () => {
                const now = Date.now();
                const elapsed = now - startTime;
                let allDone = true;

                revealData.forEach(item => {
                    if (item.done) return;
                    allDone = false;

                    // 1. Move Cursor Early (200ms before reveal if it's a line start)
                    if (item.isLineStart && !item.cursorMoved && elapsed >= Math.max(0, item.revealTime - 200)) {
                        this.updateCursor(item.word, 'start');
                        if (typeof item.word.lineIndex === 'number') {
                            this.currentVisibleLineIndex = item.word.lineIndex;
                            const gm = (window.Game && window.Game.gazeManager) || window.gazeDataManager;
                            if (gm?.setContext && this.lines[item.word.lineIndex]) {
                                gm.setContext({
                                    lineIndex: item.word.lineIndex,
                                    lineY: this.lines[item.word.lineIndex].visualY
                                });
                            }
                        }
                        item.cursorMoved = true;
                    }

                    // 2. Reveal Word
                    if (elapsed >= item.revealTime) {
                        const w = item.word;
                        w.element.style.opacity = "1";
                        w.element.style.visibility = "visible";
                        w.element.classList.add("revealed");

                        if (typeof w.lineIndex === 'number' && w.lineIndex !== this.currentVisibleLineIndex) {
                            this.currentVisibleLineIndex = w.lineIndex;
                            const gm = (window.Game && window.Game.gazeManager) || window.gazeDataManager;
                            if (gm?.setContext && this.lines[w.lineIndex]) {
                                gm.setContext({
                                    lineIndex: w.lineIndex,
                                    lineY: this.lines[w.lineIndex].visualY
                                });
                            }
                        }
                        this.updateCursor(w, 'end');
                        item.done = true;
                        revealedCount++;
                    }
                });

                if (revealedCount < revealData.length) {
                    // [FIX-iOS] Self-cleaning RAF slot.
                    // Old: push() every frame, never remove → activeRAFs grew O(frames) during reading.
                    // New: single rolling slot — remove previous id before registering next.
                    if (currentRevealRAFId !== null) {
                        const idx = this.activeRAFs.indexOf(currentRevealRAFId);
                        if (idx !== -1) this.activeRAFs.splice(idx, 1);
                    }
                    currentRevealRAFId = requestAnimationFrame(animateReveal);
                    this.activeRAFs.push(currentRevealRAFId);
                } else {
                    // Done — remove slot from tracking
                    if (currentRevealRAFId !== null) {
                        const idx = this.activeRAFs.indexOf(currentRevealRAFId);
                        if (idx !== -1) this.activeRAFs.splice(idx, 1);
                        currentRevealRAFId = null;
                    }
                    // Resolve after a small buffer
                    const finalTid = setTimeout(resolve, 100);
                    this.activeAnimations.push(finalTid);
                }
            };

            // [FIX-iOS] Single rolling slot for this chunk's reveal RAF
            let currentRevealRAFId = requestAnimationFrame(animateReveal);
            this.activeRAFs.push(currentRevealRAFId);
        });
    }

    updateCursor(wordObj, align = 'end') {
        const readScreen = document.getElementById('screen-read');
        // Safely check if active. If NOT active, force hide and return.
        if (readScreen && !readScreen.classList.contains('active')) {
            if (this.cursor) this.cursor.style.display = 'none';
            return;
        }

        if (!this.cursor || !wordObj || !wordObj.element) return;
        try {
            const currentRect = wordObj.element.getBoundingClientRect();
            let visualY = currentRect.top + (currentRect.height * 0.52);
            if (!wordObj.element.classList.contains("revealed")) visualY -= 10;

            let visualX;
            if (align === 'start' || align === 'left') visualX = currentRect.left - 4;
            else visualX = currentRect.right + 2;

            this.cursor.style.position = "fixed";
            this.cursor.style.left = visualX + "px";
            this.cursor.style.top = visualY + "px";
            this.cursor.style.opacity = "0"; // Force Hidden (Guide Runner)
            this.cursor.style.backgroundColor = "transparent";

            // STORE TRUTH: Save exact Y for Pang Event
            this.latestCursorY = visualY;
        } catch (e) {
            console.error("[TextRenderer] Cursor Update Error:", e);
        }
    }

    fadeOutChunk(chunkIndex) {
        if (chunkIndex < 0 || chunkIndex >= this.chunks.length) return;
        const indices = this.chunks[chunkIndex];
        indices.forEach((wordIdx, i) => {
            const w = this.words[wordIdx];
            if (w && w.element) {
                setTimeout(() => {
                    w.element.classList.remove("revealed");
                    w.element.classList.add("chunk-fade-out");
                }, i * 50);
            }
        });
    }

    scheduleFadeOut(chunkIndex, delayMs) {
        // [FIX] Track in activeAnimations so cancelAllAnimations() can cancel pending fadeOuts.
        // Previously untracked: fadeOut timers fired during replay, wiping visible text.
        const tid = setTimeout(() => this.fadeOutChunk(chunkIndex), delayMs);
        this.activeAnimations.push(tid);
    }

    // --- RGT (Relative Gaze Trigger) Logic ---
    checkRuneTriggers(gazeX, gazeY) {
        if (!this.lines || this.lines.length === 0) return;

        const gdm = window.gazeDataManager;
        if (!gdm) return;

        // 1. Get 'a' and 'b' (User's Gaze Range)
        const a = gdm.currentLineMinX;
        const b = gdm.globalMaxX;

        // Validation: If we don't have enough data yet, use conservative absolute hit test?
        // Or just wait. 'a' defaults to 99999, 'b' to 0. 
        if (a > 90000 || b <= a) {
            // Not calibrated enough on this line/session.
            // Fallback: Use viewport width as approximation?
            // Let's just return to avoid false positives. 
            // Standard hitTest (absolute) will handle click-like events if needed, 
            // but for "responsive" effect, we want RGT.
            return;
        }

        // 2. Normalized Gaze X (0.0 to 1.0)
        let Gx_norm = (gazeX - a) / (b - a);
        Gx_norm = Math.max(0, Math.min(1, Gx_norm)); // Clamp

        // 3. Find Line near Gaze Y
        // We expand the vertical tolerance because gaze Y is often inaccurate.
        const LINE_TOLERANCE_Y = 60; // +/- 60px
        const activeLine = this.lines.find(line => {
            const midY = (line.rect.top + line.rect.bottom) / 2;
            return Math.abs(gazeY - midY) < LINE_TOLERANCE_Y;
        });

        if (!activeLine) return;

        // 4. Check Words in this Line
        if (!this.containerRect) this.containerRect = this.container.getBoundingClientRect();
        const containerWidth = this.containerRect.width;
        const containerLeft = this.containerRect.left;

        activeLine.wordIndices.forEach(idx => {
            const word = this.words[idx];
            if (!word.isRuneWord || word.activated) return; // Skip if normal or already done

            // Calculate Word's Normalized Position in Container
            // Center of word relative to container
            const wordCenter = (word.rect.left + word.rect.right) / 2;
            const Wx_norm = (wordCenter - containerLeft) / containerWidth;

            // 5. Compare & Trigger
            // Tolerance: How close/predictive? 
            // 0.15 = 15% of screen width.
            const diff = Math.abs(Gx_norm - Wx_norm);

            // Heuristic: If gaze is 'ahead' or 'on', trigger.
            // Overshoot handling is naturally done by 'a' and 'b' clamping.

            if (diff < 0.15) {
                this.activateRuneWord(word);
            }
        });
    }

    activateRuneWord(word) {
        word.activated = true;
        word.element.classList.add('active-rune'); // CSS Animation

        console.log(`[RGT] Rune Word Triggered: "${word.text}" (ID: ${word.runeId})`);

        // Emit Event for Game Logic (Score, FX)
        // We use a small timeout to prevent blocking render loop
        setTimeout(() => {
            bus.emit('rune_touched', word.runeId);
        }, 0);
    }

    // --- End RGT Logic ---

    hitTest(gx, gy) {
        // Must have lines
        if (!this.isLayoutLocked || this.lines.length === 0) return null;

        // 1. Strict Hit Test (Vertical)
        // Check if falls exactly within [top, bottom] with padding
        const LINE_PADDING = 30;
        let line = this.lines.find(l => gy >= (l.rect.top - LINE_PADDING) && gy <= (l.rect.bottom + LINE_PADDING));

        // 2. Fallback: Snap to NEAREST Line (Infinite Force Snap)
        // If the gaze is outside ALL strict line boundaries, we force it to the nearest line.
        // This solves the issue where "RawX is reading" but "LineIndex is null or stuck".
        if (!line) {
            let minDist = Infinity;
            let closest = null;
            this.lines.forEach(l => {
                const dist = Math.abs(l.visualY - gy);
                if (dist < minDist) {
                    minDist = dist;
                    closest = l;
                }
            });

            // Just take the closest, no matter how far.
            // Assumption: User is looking at the screen.
            if (closest) {
                line = closest;
            }
        }

        // If for some reason we still have no line (e.g. no lines created), return null
        if (!line) return null;

        // 3. Horizontal Hit Test (Word) within that line
        const WORD_PADDING = 15;
        const wordIndex = line.wordIndices.find(idx => {
            const w = this.words[idx];
            return gx >= (w.rect.left - WORD_PADDING) && gx <= (w.rect.right + WORD_PADDING);
        });

        if (wordIndex !== undefined) return { type: 'word', word: this.words[wordIndex], line: line };

        // If valid line but no word hit (space or margin), still return the line info!
        return { type: 'line', line: line };
    }

    triggerReturnEffect(lineIndex = null) {
        if (!this.cursor) return false;

        // Cooldown: prevent visual glitching if called extremely fast (<50ms)
        const now = Date.now();
        if (this.lastRenderTime && (now - this.lastRenderTime < 50)) return false;
        this.lastRenderTime = now;

        let targetY;

        // 1. Calculate Target Y
        // Revert: User reported (+1) logic makes it appear one line TOO LOW.
        // This implies internal state (lineIndex/cursor) is already up-to-date or 'latestCursorY' represents the correct line.
        // We will strictly use the provided lineIndex or latestCursorY.

        let targetIndex = -1;

        if (typeof lineIndex === 'number' && lineIndex >= 0) {
            targetIndex = lineIndex;
        } else if (this.currentVisibleLineIndex !== undefined) {
            targetIndex = this.currentVisibleLineIndex;
        }

        // Attempt to get exact Visual Y from Line Objects
        if (this.lines && this.lines[targetIndex]) {
            targetY = this.lines[targetIndex].visualY;
        } else {
            // Fallback: Just use latestCursorY (Single Source of Truth)
            if (this.latestCursorY !== undefined && this.latestCursorY !== null) {
                targetY = this.latestCursorY;
            } else {
                // Last Resort: Current DOM Cursor
                const rect = this.cursor.getBoundingClientRect();
                targetY = rect.top + (rect.height * 0.52);
            }
        }

        // SAFETY: Lazy-create if missing
        if (!this.impactElement || !document.contains(this.impactElement)) {
            console.warn("[TextRenderer] Impact element missing, recreating.");
            this.impactElement = document.createElement('div');
            this.impactElement.style.position = "fixed";
            this.impactElement.style.borderRadius = "50%";
            this.impactElement.style.backgroundColor = "magenta";
            this.impactElement.style.boxShadow = "0 0 15px magenta";
            this.impactElement.style.zIndex = "999999";
            this.impactElement.style.pointerEvents = "none";
            this.impactElement.style.opacity = "0";
            document.body.appendChild(this.impactElement);
        }

        const impact = this.impactElement;

        // Reset Style instantly (no reflow needed — CSS transition handles it)
        impact.style.transition = "none";
        impact.style.width = "10px";
        impact.style.height = "10px";
        impact.style.opacity = "1";
        impact.style.left = (window.innerWidth - 20) + "px";
        impact.style.top = targetY + "px";
        impact.style.transform = "translate(-50%, -50%) scale(1.0)";

        // Animate: schedule via RAF (one-shot, tracked for cleanup)
        // Note: we skip void offsetWidth to avoid forced layout recalculation on every pang.
        // The next-frame transition start is handled by the browser's rendering pipeline.
        this.trackRAF(requestAnimationFrame(() => {
            impact.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-in";
            impact.style.transform = "translate(-50%, -50%) scale(2.0)";
            impact.style.opacity = "0";
        }));

        if (this.validatedLines && typeof lineIndex === 'number' && lineIndex >= 0) {
            this.validatedLines.add(lineIndex);
        }

        return true;
    }

    // [NEW] Sync View from Data (Global Layer Version)
    syncPangMarkers() {
        // 1. Ensure Global Layer Exists on Body (Fixed Overlay)
        let layer = document.getElementById("pang-marker-layer");
        if (!layer) {
            layer = document.createElement("div");
            layer.id = "pang-marker-layer";
            layer.style.position = "fixed"; // Global Fixed Overlay
            layer.style.top = "0";
            layer.style.left = "0";
            layer.style.width = "100%";
            layer.style.height = "100%";
            layer.style.pointerEvents = "none";
            layer.style.zIndex = "999000";
            document.body.appendChild(layer);
        }

        // 2. Clear & Repopulate
        layer.innerHTML = "";

        if (!this.validatedLines) return;

        this.validatedLines.forEach(lineIdx => {
            const line = this.lines[lineIdx];
            if (!line) return;

            // Coordinates are Fixed Viewport Relative
            // Use same logic as triggerReturnEffect (Right Edge)
            const targetX = window.innerWidth - 20;
            const targetY = line.visualY;

            const marker = document.createElement("div");
            marker.className = "pang-marker";
            marker.style.position = "absolute";
            marker.style.left = targetX + "px";
            marker.style.top = targetY + "px";
            marker.style.width = "10px";
            marker.style.height = "10px";
            marker.style.backgroundColor = "magenta";
            marker.style.borderRadius = "50%";
            marker.style.boxShadow = "0 0 5px magenta";
            marker.style.transform = "translate(-50%, -50%) scale(2.0)"; // Slightly prominent

            layer.appendChild(marker);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5-PHASE RIFT SEALING REPLAY
    // Phase 1: Gray text  →  Phase 2: Dot + line light-up  →
    // Phase 3: Energy beams + progress bar  →  Phase 4: Popup  →  Phase 5: Mid-Boss
    // ═══════════════════════════════════════════════════════════════════════════
    playGazeReplay(gazeData, onComplete) {
        this.syncPangMarkers();

        if (!gazeData || gazeData.length < 2) {
            console.warn('[TextRenderer] No gaze data for replay.');
            if (onComplete) onComplete();
            return;
        }

        // ── forceVisibility helper ──
        const forceVisibility = () => {
            if (this.container) {
                this.container.style.transition = 'none';
                this.container.style.opacity = '1';
                this.container.style.visibility = 'visible';
            }
            if (this.words && this.words.length > 0) {
                this.words.forEach(w => {
                    if (!w.element) return;
                    w.element.style.transition = 'none';
                    w.element.style.opacity = '1';
                    w.element.style.visibility = 'visible';
                    w.element.style.transform = 'translateY(0)';
                    w.element.classList.add('revealed');
                    w.element.classList.remove('faded-out', 'chunk-fade-out', 'hidden');
                });
            }
        };

        forceVisibility();
        const safetyTimer = setTimeout(forceVisibility, 250);
        this.activeAnimations.push(safetyTimer);

        setTimeout(() => {
            clearTimeout(safetyTimer);

            const visualLines = this.lines || [];
            if (visualLines.length === 0) {
                console.warn('[TextRenderer] No visual lines. Forcing lock.');
                this.lockLayout();
            }

            // ── Build processedPath from Pang logs ──
            const gm = (window.Game && window.Game.gazeManager) || window.gazeDataManager;
            const rawPangLogs = (gm && typeof gm.getPangLogs === 'function') ? gm.getPangLogs() : [];

            if (rawPangLogs.length === 0) {
                console.log('[TextRenderer] No Pang Events. Skipping Replay.');
                if (onComplete) onComplete();
                return;
            }

            rawPangLogs.sort((a, b) => a.t - b.t);

            const sortedGaze = gazeData;
            const getGx = (d) => (typeof d.gx === 'number') ? d.gx : d.x;

            let avgReadTime = 3000;
            if (rawPangLogs.length >= 2) {
                let sum = 0, cnt = 0;
                for (let i = 1; i < rawPangLogs.length; i++) {
                    const g = rawPangLogs[i].t - rawPangLogs[i - 1].t;
                    if (g > 0 && g < 10000) { sum += g; cnt++; }
                }
                if (cnt > 0) avgReadTime = sum / cnt;
            }

            const processedPath = [];
            const replaySegments = [];
            let lastPangTime = 0;

            rawPangLogs.forEach((log, idx) => {
                const targetLineIndex = log.line;
                const pangTime = log.t;
                if (!visualLines[targetLineIndex]) { lastPangTime = pangTime; return; }

                const targetLineObj = visualLines[targetLineIndex];
                const fixedY = targetLineObj.visualY;

                const candidateData = [];
                for (let i = 0; i < sortedGaze.length; i++) {
                    const d = sortedGaze[i];
                    if (d.t <= lastPangTime) continue;
                    if (d.t > pangTime) break;
                    if (typeof d.line === 'number' &&
                        (d.line === targetLineIndex || d.line === targetLineIndex + 1)) {
                        candidateData.push(d);
                    }
                }
                if (candidateData.length < 5) { lastPangTime = pangTime; return; }

                let peakIdx = candidateData.length - 1;
                let peakGx = getGx(candidateData[peakIdx]);
                const searchStart = Math.max(0, Math.floor(candidateData.length * 0.5));
                for (let i = candidateData.length - 1; i >= searchStart; i--) {
                    const gx = getGx(candidateData[i]);
                    if (gx > peakGx) { peakGx = gx; peakIdx = i; }
                }
                const segEndTime = candidateData[peakIdx].t;

                const searchFromTime = (idx > 0) ? lastPangTime : Math.max(0, segEndTime - avgReadTime);
                let valleyIdx = 0, valleyGx = Infinity;
                for (let i = 0; i < candidateData.length; i++) {
                    if (candidateData[i].t < searchFromTime) continue;
                    if (candidateData[i].t > segEndTime) break;
                    const gx = getGx(candidateData[i]);
                    if (gx < valleyGx) { valleyGx = gx; valleyIdx = i; }
                }

                const segmentData = [];
                for (let i = valleyIdx; i <= peakIdx; i++) segmentData.push(candidateData[i]);
                if (segmentData.length < 3) { lastPangTime = pangTime; return; }

                if (processedPath.length > 0) processedPath.push({ isJump: true });

                replaySegments.push({
                    idx, targetLine: targetLineIndex,
                    segStart: candidateData[valleyIdx].t, segEnd: segEndTime, pangTime,
                    sourceMinX: Math.round(valleyGx), sourceMaxX: Math.round(peakGx),
                    targetLeft: Math.round(targetLineObj.rect.left),
                    targetWidth: Math.round(targetLineObj.rect.width),
                    samples: segmentData.length,
                });

                const sourceWidth = peakGx - valleyGx;
                const targetLeft = targetLineObj.rect.left;
                const targetWidth = targetLineObj.rect.width;

                for (let i = 0; i < segmentData.length; i++) {
                    const d = segmentData[i];
                    const gx = getGx(d);
                    let scaledX = gx;
                    if (sourceWidth > 10 && targetWidth > 0) {
                        let r = (gx - valleyGx) / sourceWidth;
                        r = Math.max(0, Math.min(1, r));
                        scaledX = targetLeft + r * targetWidth;
                    } else {
                        scaledX = targetLeft + (gx - valleyGx);
                    }
                    processedPath.push({ x: scaledX, y: fixedY, t: d.t, isJump: false });
                }
                lastPangTime = pangTime;
            });

            // Expose for dashboard/GazeDataManager
            try {
                window.dashboardReplayData = processedPath;
                if (window.gazeDataManager) {
                    if (typeof window.gazeDataManager.setReplayData === 'function')
                        window.gazeDataManager.setReplayData(processedPath);
                    window.gazeDataManager.replaySegments = replaySegments;
                }
            } catch (e) { console.warn('Could not expose replay data', e); }

            if (processedPath.length < 2) {
                console.warn('[TextRenderer] No processed path.');
                if (onComplete) onComplete();
                return;
            }

            // ─────────────────────────────────────────────
            // PHASE 1: Gray out all text
            // ─────────────────────────────────────────────
            this._grayOutAllText();

            // ─────────────────────────────────────────────
            // PHASE 2: Canvas + Progress Bar setup
            // ─────────────────────────────────────────────
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:999999;';
            document.body.appendChild(canvas);
            const ctx = canvas.getContext('2d');

            const progressContainer = this._createProgressBar();

            const path = processedPath;
            const duration = Math.max(1500, replaySegments.length * 500);
            let startTime = null;
            const litLines = new Set();

            const animate = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const elapsed = timestamp - startTime;
                const progress = elapsed / duration;

                if (progress >= 1) {
                    canvas.style.transition = 'opacity 0.5s';
                    canvas.style.opacity = '0';
                    this._replayRAFId = null;
                    setTimeout(() => {
                        canvas.remove();
                        // ─────────────────────────────────────────
                        // PHASE 3: Energy beams → Progress Bar
                        // ─────────────────────────────────────────
                        this._runEnergyTransfer(litLines, visualLines, progressContainer, () => {
                            if (progressContainer.parentNode) progressContainer.remove();
                            // PHASE 5: onComplete → Mid-Boss
                            if (onComplete) onComplete();
                        });
                    }, 500);
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const maxIdx = Math.floor(path.length * progress);
                if (maxIdx >= 0 && maxIdx < path.length) {
                    const head = path[maxIdx];
                    if (head && !head.isJump) {
                        // Light up line as dot passes through
                        const lineIdx = this._findLineForY(head.y, visualLines);
                        if (lineIdx !== null && !litLines.has(lineIdx)) {
                            litLines.add(lineIdx);
                            this._lightUpLine(lineIdx);
                        }
                        // Draw green gaze dot
                        ctx.beginPath();
                        ctx.fillStyle = '#00ff00';
                        ctx.shadowColor = '#00ff00';
                        ctx.shadowBlur = 12;
                        ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.shadowBlur = 0;
                    }
                }

                this._replayRAFId = requestAnimationFrame(animate);
            };

            this._replayRAFId = requestAnimationFrame(animate);

        }, 500);
    }

    // ─── Phase 1: Gray all text ───────────────────────────────────────────────
    _grayOutAllText() {
        if (!this.words) return;
        this.words.forEach(w => {
            if (!w.element) return;
            w.element.style.transition = 'color 0.4s ease, text-shadow 0.4s ease';
            w.element.style.color = 'rgba(255,255,255,0.18)';
            w.element.style.textShadow = 'none';
        });
    }

    // ─── Phase 2: Find closest line index by Y ────────────────────────────────
    _findLineForY(y, visualLines) {
        let closest = null, minDist = Infinity;
        visualLines.forEach((line, idx) => {
            const d = Math.abs(line.visualY - y);
            if (d < minDist) { minDist = d; closest = idx; }
        });
        return (minDist < 60) ? closest : null;
    }

    // ─── Phase 2: Light up a line's words ────────────────────────────────────
    _lightUpLine(lineIndex) {
        if (!this.lines || !this.lines[lineIndex]) return;
        const line = this.lines[lineIndex];
        if (!line.wordIndices) return;
        // Step A: 즉시 강한 보라 glow 플래시
        line.wordIndices.forEach(wIdx => {
            const word = this.words[wIdx];
            if (word && word.element) {
                word.element.style.transition = 'none';
                word.element.style.color = '#ffffff';
                word.element.style.textShadow =
                    '0 0 22px #fff, 0 0 14px rgba(155,89,182,1), 0 0 6px rgba(215,189,226,0.9)';
                word.element.style.filter = 'brightness(2.0)';
            }
        });
        // Step B: 100ms 후 glow 안정화
        setTimeout(() => {
            line.wordIndices.forEach(wIdx => {
                const word = this.words[wIdx];
                if (word && word.element) {
                    word.element.style.transition =
                        'text-shadow 0.4s ease-out, filter 0.4s ease-out';
                    word.element.style.textShadow =
                        '0 0 6px rgba(155,89,182,0.5), 0 0 2px rgba(255,255,255,0.4)';
                    word.element.style.filter = 'brightness(1.0)';
                }
            });
        }, 100);
    }

    // ─── Phase 3: Create progress bar DOM ────────────────────────────────────
    _createProgressBar() {
        const container = document.createElement('div');
        container.id = 'replay-progress-container';
        container.style.cssText = [
            'position:fixed', 'bottom:28px', 'left:50%', 'transform:translateX(-50%)',
            'width:78%', 'height:14px',
            'background:rgba(20,5,35,0.75)',
            'border-radius:7px',
            'border:1px solid rgba(155,89,182,0.55)',
            'box-shadow:0 0 14px rgba(155,89,182,0.3)',
            'z-index:999998', 'overflow:hidden',
        ].join(';');

        const fill = document.createElement('div');
        fill.id = 'replay-progress-fill';
        fill.style.cssText = [
            'width:0%', 'height:100%',
            'background:linear-gradient(90deg,#4a1a6b,#8e44ad,#c39bd3)',
            'border-radius:7px',
            'box-shadow:0 0 18px rgba(155,89,182,0.85)',
            'transition:width 0.35s ease-out',
        ].join(';');

        const label = document.createElement('div');
        label.id = 'replay-progress-label';
        label.style.cssText = [
            'position:absolute', 'top:-22px', 'right:0',
            'color:#d7bde2', 'font-size:11px',
            'font-family:monospace', 'letter-spacing:1px',
        ].join(';');
        label.textContent = '0%';

        const titleEl = document.createElement('div');
        titleEl.id = 'replay-rift-title';
        titleEl.style.cssText = [
            'position:absolute', 'top:-24px', 'left:0',
            'color:rgba(155,89,182,0.75)', 'font-size:12px',
            'font-family:monospace', 'letter-spacing:2px', 'text-transform:uppercase',
            'transition:opacity 0.4s ease',
        ].join(';');
        titleEl.textContent = 'Rift Sealing';

        // result message label (hidden initially)
        const resultEl = document.createElement('div');
        resultEl.id = 'replay-rift-result';
        resultEl.style.cssText = [
            'position:absolute', 'top:-44px', 'left:50%',
            'transform:translateX(-50%)',
            'font-size:13px', 'font-family:monospace',
            'letter-spacing:3px', 'text-transform:uppercase',
            'font-weight:700', 'white-space:nowrap',
            'opacity:0', 'transition:opacity 0.4s ease',
        ].join(';');

        container.appendChild(fill);
        container.appendChild(label);
        container.appendChild(titleEl);
        container.appendChild(resultEl);
        document.body.appendChild(container);
        return container;
    }

    // ─── Phase 3: Multi-strand Zigzag Lightning → progress bar ──────────────
    _runEnergyTransfer(litLines, visualLines, progressContainer, onDone) {
        const totalLines = visualLines.length;
        const finalPct = totalLines > 0 ? (litLines.size / totalLines) * 100 : 0;
        const isSealed = finalPct >= 60;

        if (litLines.size === 0) {
            this._showInlineResult(isSealed, progressContainer, onDone);
            return;
        }

        const fill = document.getElementById('replay-progress-fill');
        const label = document.getElementById('replay-progress-label');
        const barRect = progressContainer.getBoundingClientRect();
        const barCX = barRect.left + barRect.width / 2;
        const barCY = barRect.top + barRect.height / 2;

        const lineArray = Array.from(litLines).sort((a, b) => a - b);
        const BEAM_DUR = 500;
        const STAGGER = 160;
        const STRANDS = 4; // 가닥 수

        // 각 줄마다 여러 가닥(strand) 생성
        const beams = lineArray.map((lineIdx, i) => {
            const line = visualLines[lineIdx];
            const baseX = line.rect ? (line.rect.left + line.rect.width * 0.78) : window.innerWidth * 0.78;
            const baseY = line.visualY;
            const strands = [];
            for (let s = 0; s < STRANDS; s++) {
                // 가닥마다 시작점 Y 오프셋 ±8px, 투명도 랜덤
                strands.push({
                    dx: (Math.random() - 0.5) * 16,
                    dy: (Math.random() - 0.5) * 12,
                    alpha: 0.55 + Math.random() * 0.45,
                    midPts: [],   // 꺾임점 (매 프레임 재생성)
                });
            }
            return { lineIdx, baseX, baseY, progress: 0, delay: i * STAGGER, arrived: false, strands };
        });

        // ── 번개 꺾임점 생성 헬퍼 ──
        const makeZigzag = (x0, y0, x1, y1, t, nKinks) => {
            const pts = [{ x: x0, y: y0 }];
            for (let k = 1; k <= nKinks; k++) {
                const frac = (k / (nKinks + 1)) * t;
                const mx = x0 + (x1 - x0) * frac + (Math.random() - 0.5) * 28;
                const my = y0 + (y1 - y0) * frac + (Math.random() - 0.5) * 22;
                pts.push({ x: mx, y: my });
            }
            // 현재 헤드 위치 계산 (선형 보간)
            const hx = x0 + (x1 - x0) * t;
            const hy = y0 + (y1 - y0) * t;
            pts.push({ x: hx, y: hy });
            return pts;
        };

        // beam canvas
        const bc = document.createElement('canvas');
        bc.width = window.innerWidth;
        bc.height = window.innerHeight;
        bc.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:999997;';
        document.body.appendChild(bc);
        const bCtx = bc.getContext('2d');

        let arrivedCount = 0;
        let beamTs = null;

        const animateBeams = (ts) => {
            if (!beamTs) beamTs = ts;
            const elapsed = ts - beamTs;
            bCtx.clearRect(0, 0, bc.width, bc.height);

            let allArrived = true;

            beams.forEach((beam) => {
                const be = elapsed - beam.delay;
                if (be < 0) { allArrived = false; return; }

                beam.progress = Math.min(1, be / BEAM_DUR);
                if (beam.progress < 1) allArrived = false;

                // 도착 직전 90% 이후 페이드아웃
                const globalAlpha = beam.progress > 0.88
                    ? 1 - (beam.progress - 0.88) / 0.12
                    : 1;

                // 각 가닥 그리기
                beam.strands.forEach((strand) => {
                    const sx = beam.baseX + strand.dx;
                    const sy = beam.baseY + strand.dy;
                    // 매 프레임 꺾임점 재생성 → 전기 떨림
                    const pts = makeZigzag(sx, sy, barCX, barCY, beam.progress, 3);

                    bCtx.save();
                    bCtx.globalAlpha = strand.alpha * globalAlpha;

                    // 보라 glow 레이어 (두꺼운)
                    bCtx.beginPath();
                    pts.forEach((p, pi) => pi === 0 ? bCtx.moveTo(p.x, p.y) : bCtx.lineTo(p.x, p.y));
                    bCtx.strokeStyle = 'rgba(155,89,182,0.6)';
                    bCtx.lineWidth = 5;
                    bCtx.shadowColor = '#9b59b6';
                    bCtx.shadowBlur = 18;
                    bCtx.stroke();

                    // 흰색 코어 레이어 (얇은)
                    bCtx.beginPath();
                    pts.forEach((p, pi) => pi === 0 ? bCtx.moveTo(p.x, p.y) : bCtx.lineTo(p.x, p.y));
                    bCtx.strokeStyle = '#ffffff';
                    bCtx.lineWidth = 1.5;
                    bCtx.shadowColor = '#ffffff';
                    bCtx.shadowBlur = 8;
                    bCtx.stroke();

                    bCtx.restore();
                });

                // 도착 처리
                if (beam.progress >= 1 && !beam.arrived) {
                    beam.arrived = true;
                    arrivedCount++;
                    const pct = Math.min(100, Math.round((arrivedCount / totalLines) * 100));
                    if (fill) fill.style.width = pct + '%';
                    if (label) label.textContent = pct + '%';
                }
            });

            if (!allArrived) {
                requestAnimationFrame(animateBeams);
            } else {
                bCtx.clearRect(0, 0, bc.width, bc.height);
                bc.remove();
                // 60% 이상이면 텍스트 웨이브 복원
                if (isSealed) this._waveTextWhite(visualLines);
                // 인라인 결과 메시지 표시 → 자동 소멸 → onDone
                this._showInlineResult(isSealed, progressContainer, onDone);
            }
        };

        requestAnimationFrame(animateBeams);
    }

    // ─── Phase 4: 프로그레스바 위 인라인 결과 메시지 ──────────────────────────
    _showInlineResult(isSealed, progressContainer, onDone) {
        const resultEl = document.getElementById('replay-rift-result');
        const titleEl = document.getElementById('replay-rift-title');
        if (!resultEl) { onDone(); return; }

        // title 라벨 숨기기
        if (titleEl) titleEl.style.opacity = '0';

        // 결과 메시지 스타일
        resultEl.textContent = isSealed ? '✦ RIFT SEALED' : '✦ RIFT NOT YET SEALED';
        resultEl.style.color = isSealed ? '#d7bde2' : 'rgba(160,160,190,0.8)';
        resultEl.style.textShadow = isSealed
            ? '0 0 16px rgba(155,89,182,0.9), 0 0 4px #fff'
            : 'none';

        // fade-in
        requestAnimationFrame(() => { resultEl.style.opacity = '1'; });

        // 2초 표시 후 fade-out → onDone
        setTimeout(() => {
            resultEl.style.opacity = '0';
            setTimeout(() => { onDone(); }, 500);
        }, 2000);
    }

    // ─── Phase 4-A: Wave text white top→bottom ────────────────────────────────
    _waveTextWhite(visualLines) {
        if (!visualLines || !this.words) return;
        visualLines.forEach((line, i) => {
            setTimeout(() => {
                if (!line.wordIndices) return;
                line.wordIndices.forEach(wIdx => {
                    const word = this.words[wIdx];
                    if (word && word.element) {
                        word.element.style.transition = 'color 0.45s ease, text-shadow 0.45s ease';
                        word.element.style.color = '#ffffff';
                        word.element.style.textShadow =
                            '0 0 12px rgba(155,89,182,0.7), 0 0 3px rgba(255,255,255,0.55)';
                    }
                });
            }, i * 70);
        });
    }

    // ─── Phase 4: Rift popup (폐기 — _showInlineResult로 대체) ───────────────
    _showRiftPopup() { }

    // ─── Legacy stubs (kept for external compatibility, no longer called) ─────
    _checkReplayCombo() { }
    _showMiniScore() { }
    _animateScoreToHud() { }
    _spawnReplayPulse() { }
}
window.TextRenderer = TextRenderer;
