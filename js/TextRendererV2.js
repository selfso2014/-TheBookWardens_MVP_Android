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
        // Snapshot the original border value for later restoration.
        // getComputedStyle gives the live computed border; reading .style gives
        // the inline attribute which is what we actually need to restore.
        this._origBorderInline = this.container.getAttribute('style') || '';
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
                    // New: single rolling slot ? remove previous id before registering next.
                    if (currentRevealRAFId !== null) {
                        const idx = this.activeRAFs.indexOf(currentRevealRAFId);
                        if (idx !== -1) this.activeRAFs.splice(idx, 1);
                    }
                    currentRevealRAFId = requestAnimationFrame(animateReveal);
                    this.activeRAFs.push(currentRevealRAFId);
                } else {
                    // Done ? remove slot from tracking
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

        // Reset Style instantly (no reflow needed ? CSS transition handles it)
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

    // ???????????????????????????????????????????????????????????????????????????
    // 5-PHASE RIFT SEALING REPLAY
    // Phase 1: Gray text  →  Phase 2: Dot + line light-up  →
    // Phase 3: Energy beams + progress bar  →  Phase 4: Popup  →  Phase 5: Mid-Boss
    // ???????????????????????????????????????????????????????????????????????????
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
            // Replay watermark label: ?? Gaze Replay (blinks throughout)
            // _showReplayIntroCard is preserved for future use but not called.
            // ─────────────────────────────────────────────
            (() => {
                const old = document.getElementById('replay-watermark-label');
                if (old) try { old.remove(); } catch (e) { }

                // Cancel any previous label animation RAF
                if (this._replayLabelRAF) {
                    cancelAnimationFrame(this._replayLabelRAF);
                    this._replayLabelRAF = null;
                }

                // ── Container (always opaque) ──────────────────────────────
                const label = document.createElement('div');
                label.id = 'replay-watermark-label';
                Object.assign(label.style, {
                    position      : 'fixed',
                    display       : 'flex',
                    alignItems    : 'center',
                    padding       : '3px 11px 3px 6px',
                    background    : 'rgba(18,6,38,0.96)',
                    border        : '1.5px solid rgba(180,120,255,0.60)',
                    borderRadius  : '50px',
                    boxShadow     : '0 0 16px rgba(120,60,220,0.40)',
                    backdropFilter: 'blur(8px)',
                    pointerEvents : 'none',
                    zIndex        : '9999999',
                    opacity       : '1',
                });

                // ── Mini canvas: same plasma sphere as Phase 2 ────────────
                const cvs = document.createElement('canvas');
                cvs.width  = 80;   // same scale as full canvas sphere (r=34 outer ring -> 80px fits)
                cvs.height = 80;
                Object.assign(cvs.style, {
                    width       : '32px',
                    height      : '32px',
                    marginRight : '8px',
                    flexShrink  : '0',
                    display     : 'block',
                    imageRendering: 'crisp-edges',
                });
                const mCtx = cvs.getContext('2d');
                const cx = 40, cy = 40;   // center of the 80x80 canvas

                // ── Text (blink independently) ──────────────────────────────
                if (!document.getElementById('replay-blink-style')) {
                    const st = document.createElement('style');
                    st.id = 'replay-blink-style';
                    st.textContent = '@keyframes replayTextBlink{0%,40%,100%{opacity:1}50%,90%{opacity:0.08}}';
                    document.head.appendChild(st);
                }
                const textWrap = document.createElement('span');
                Object.assign(textWrap.style, {
                    display  : 'inline-block',
                    animation: 'replayTextBlink 1.8s ease-in-out infinite',
                });
                const txt = document.createElement('span');
                txt.textContent = 'Gaze Replay';
                Object.assign(txt.style, {
                    fontFamily   : "'Cinzel', 'Georgia', serif",
                    fontSize     : 'clamp(11px, 2.9vw, 15px)',
                    fontWeight   : '700',
                    letterSpacing: '4px',
                    color        : '#ffffff',
                    textShadow   : '0 0 12px rgba(200,140,255,0.9), 0 1px 3px rgba(0,0,0,0.8)',
                    whiteSpace   : 'nowrap',
                });
                textWrap.appendChild(txt);
                label.appendChild(cvs);
                label.appendChild(textWrap);

                // ── Position: between HUD bottom and chapter badge top ─────
                document.body.appendChild(label);
                try {
                    const hud   = document.getElementById('hud') ||
                                  document.querySelector('.hud-container, .hud, #resource-hud');
                    const badge = document.getElementById('chapter-title-badge');
                    const lh    = label.getBoundingClientRect().height;
                    if (badge) {
                        const br = badge.getBoundingClientRect();
                        // Place below text box (this.container) bottom border
                        const contRect = this.container ? this.container.getBoundingClientRect() : br;
                        label.style.top       = (contRect.bottom + 6) + 'px';
                        label.style.left      = (contRect.left + contRect.width / 2) + 'px';
                        label.style.transform = 'translateX(-50%)';
                    } else {
                        label.style.top       = '88%';
                        label.style.left      = '50%';
                        label.style.transform = 'translateX(-50%)';
                    }
                } catch (e) {
                    label.style.top       = '14%';
                    label.style.left      = '50%';
                    label.style.transform = 'translateX(-50%)';
                }

                // ── RAF loop: draw EXACT same plasma sphere as Phase 2 ─────
                let rafStart = null;
                const drawLabel = (timestamp) => {
                    if (!cvs.isConnected) return;   // stop if removed from DOM
                    if (!rafStart) rafStart = timestamp;
                    const elapsed = timestamp - rafStart;
                    const theta   = elapsed * 0.003;  // same rotation speed as Phase 2

                    mCtx.clearRect(0, 0, 80, 80);

                    // Plasma core (white + green glow) — IDENTICAL to Phase 2
                    mCtx.save();
                    mCtx.beginPath();
                    mCtx.arc(cx, cy, 6, 0, Math.PI * 2);
                    mCtx.fillStyle    = '#ffffff';
                    mCtx.shadowColor  = '#00ff88';
                    mCtx.shadowBlur   = 20;
                    mCtx.fill();
                    mCtx.restore();

                    // Inner ring (rotating) — IDENTICAL to Phase 2
                    mCtx.save();
                    mCtx.translate(cx, cy);
                    mCtx.rotate(theta);
                    mCtx.beginPath();
                    mCtx.arc(0, 0, 18, 0, Math.PI * 2);
                    mCtx.strokeStyle = 'rgba(0,255,120,0.5)';
                    mCtx.lineWidth   = 1.5;
                    mCtx.shadowColor = 'rgba(0,255,120,0.8)';
                    mCtx.shadowBlur  = 12;
                    mCtx.stroke();
                    mCtx.restore();

                    // Outer ring (counter-rotating) — IDENTICAL to Phase 2
                    mCtx.save();
                    mCtx.translate(cx, cy);
                    mCtx.rotate(-theta * 0.6);
                    mCtx.beginPath();
                    mCtx.arc(0, 0, 34, 0, Math.PI * 2);
                    mCtx.strokeStyle = 'rgba(0,255,120,0.2)';
                    mCtx.lineWidth   = 1;
                    mCtx.shadowColor = 'rgba(0,255,120,0.4)';
                    mCtx.shadowBlur  = 6;
                    mCtx.stroke();
                    mCtx.restore();

                    this._replayLabelRAF = requestAnimationFrame(drawLabel);
                };
                this._replayLabelRAF = requestAnimationFrame(drawLabel);

                this._replayIntroLabel = label;
            })();
            this._grayOutAllText();
            // Phase 2: kick off plasma animation (1 extra RAF so gray paint settles)
            requestAnimationFrame(() => {
                this._replayRAFId = requestAnimationFrame(animate);
            });

            // ─────────────────────────────────────────────
            // PHASE 2: Plasma dot + Charging nodes (No progress bar)
            // ─────────────────────────────────────────────
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:999999;';
            document.body.appendChild(canvas);
            const ctx = canvas.getContext('2d');

            const path = processedPath;
            const duration = Math.max(1500, replaySegments.length * 500);
            let startTime = null;

            const litLines = new Set();
            const PANG_X = window.innerWidth - 24;
            const CHARGE_THRESH = window.innerWidth * 0.25;

            // chargedNodesMap: lineIdx → node (pre-populate all visual lines as idle)
            const chargedNodesMap = new Map();
            visualLines.forEach((vl, lineIdx) => {
                chargedNodesMap.set(lineIdx, {
                    lineIdx,
                    x: PANG_X,
                    y: vl ? vl.visualY : 0,
                    radius: 14,
                    state: 'idle',     // 'idle' | 'entering' | 'charging' | 'charged'
                    chargePct: 0,
                    fixedAngles: null, // locked on 'charged' confirm
                    glowAlpha: 1.0,    // faded during Phase 3 discharge
                    inkDropFired: false, // fire once when charged
                });
            });

            const trailBuffer = [];
            let prevLineIdx = null;

            const animate = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const elapsed = timestamp - startTime;
                const progress = elapsed / duration;

                if (progress >= 1.0) {
                    // Finalize remaining nodes → 'charged'
                    chargedNodesMap.forEach(node => {
                        if (node.state !== 'charged' && node.state !== 'idle') {
                            node.state = 'charged';
                            node.chargePct = 1;
                        }
                        if (node.state === 'charged' && !node.fixedAngles) {
                            node.fixedAngles = [
                                Math.random() * Math.PI * 2,
                                Math.random() * Math.PI * 2,
                                Math.random() * Math.PI * 2,
                            ];
                        }
                        // Fire ink drop for any newly charged nodes
                        if (node.state === 'charged' && !node.inkDropFired) {
                            node.inkDropFired = true;
                            this._fireInkDrop(node);
                        }
                    });
                    this._replayRAFId = null;
                    canvas.style.transition = 'opacity 0.4s';
                    canvas.style.opacity = '0';
                    setTimeout(() => {
                        canvas.remove();
                        // ─────────────────────────────────────
                        // PHASE 3: Wire Discharge
                        // ─────────────────────────────────────
                        this._runWireDischarge(chargedNodesMap, litLines, visualLines, onComplete);
                    }, 500);
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const maxIdx = Math.floor(path.length * progress);
                const head = (maxIdx >= 0 && maxIdx < path.length) ? path[maxIdx] : null;

                if (head && head.isJump) {
                    trailBuffer.length = 0;
                } else if (head && !head.isJump) {
                    const lineIdx = this._findLineForY(head.y, visualLines);

                    // New line entered
                    if (lineIdx !== null && !litLines.has(lineIdx)) {
                        litLines.add(lineIdx);
                        this._lightUpLine(lineIdx);
                        const node = chargedNodesMap.get(lineIdx);
                        if (node) node.state = 'entering';
                    }

                    if (lineIdx !== null) {
                        const node = chargedNodesMap.get(lineIdx);
                        // Charging distance check
                        if (node && (node.state === 'entering' || node.state === 'charging')) {
                            const dist = PANG_X - head.x;
                            if (dist <= CHARGE_THRESH) {
                                node.state = 'charging';
                                node.chargePct = Math.max(0, Math.min(1, 1 - dist / CHARGE_THRESH));
                            }
                        }
                        // Line transition → confirm previous as charged
                        if (prevLineIdx !== null && prevLineIdx !== lineIdx) {
                            const prevNode = chargedNodesMap.get(prevLineIdx);
                            if (prevNode && prevNode.state !== 'charged') {
                                prevNode.state = 'charged';
                                prevNode.chargePct = 1;
                                if (!prevNode.fixedAngles) {
                                    prevNode.fixedAngles = [
                                        Math.random() * Math.PI * 2,
                                        Math.random() * Math.PI * 2,
                                        Math.random() * Math.PI * 2,
                                    ];
                                }
                                // Fire ink drop on charge confirm
                                if (!prevNode.inkDropFired) {
                                    prevNode.inkDropFired = true;
                                    this._fireInkDrop(prevNode);
                                }
                            }
                        }
                        prevLineIdx = lineIdx;
                    }

                    // Trail buffer
                    trailBuffer.push({ x: head.x, y: head.y });
                    if (trailBuffer.length > 12) trailBuffer.shift();

                    // Draw trail
                    for (let i = trailBuffer.length - 1; i >= 0; i--) {
                        const tp = trailBuffer[i];
                        const alpha = (i + 1) / trailBuffer.length * 0.5;
                        const r = 4 * ((i + 1) / trailBuffer.length);
                        ctx.save();
                        ctx.globalAlpha = alpha;
                        ctx.beginPath();
                        ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2);
                        ctx.fillStyle = '#00ff88';
                        ctx.shadowColor = '#00ff88';
                        ctx.shadowBlur = 6;
                        ctx.fill();
                        ctx.restore();
                    }

                    // Plasma core
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = '#00ff88';
                    ctx.shadowBlur = 20;
                    ctx.fill();
                    ctx.restore();

                    // Inner ring (rotating)
                    const theta = elapsed * 0.003;
                    ctx.save();
                    ctx.translate(head.x, head.y);
                    ctx.rotate(theta);
                    ctx.beginPath();
                    ctx.arc(0, 0, 18, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(0,255,120,0.5)';
                    ctx.lineWidth = 1.5;
                    ctx.shadowColor = 'rgba(0,255,120,0.8)';
                    ctx.shadowBlur = 12;
                    ctx.stroke();
                    ctx.restore();

                    // Outer ring (counter-rotating)
                    ctx.save();
                    ctx.translate(head.x, head.y);
                    ctx.rotate(-theta * 0.6);
                    ctx.beginPath();
                    ctx.arc(0, 0, 34, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(0,255,120,0.2)';
                    ctx.lineWidth = 1;
                    ctx.shadowColor = 'rgba(0,255,120,0.4)';
                    ctx.shadowBlur = 6;
                    ctx.stroke();
                    ctx.restore();
                }

                // Draw all charged nodes (purple spheres with lightning)
                chargedNodesMap.forEach(node => {
                    this._drawChargedNode(ctx, node, elapsed);
                });

                this._replayRAFId = requestAnimationFrame(animate);
            };
            // Phase 2 RAF is now started exclusively from the _showReplayIntroCard
            // callback above. Do NOT add a direct kick-off here.

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

    // ─── Phase 2: Light up line (flash → settle) ─────────────────────────────
    _lightUpLine(lineIndex) {
        if (!this.lines || !this.lines[lineIndex]) return;
        const line = this.lines[lineIndex];
        if (!line.wordIndices) return;
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
        setTimeout(() => {
            line.wordIndices.forEach(wIdx => {
                const word = this.words[wIdx];
                if (word && word.element) {
                    word.element.style.transition = 'text-shadow 0.4s ease-out, filter 0.4s ease-out';
                    word.element.style.textShadow = '0 0 6px rgba(155,89,182,0.5), 0 0 2px rgba(255,255,255,0.4)';
                    word.element.style.filter = 'brightness(1.0)';
                }
            });
        }, 100);
    }

    // ─── Progress bar: REMOVED (no-op stub kept for legacy safety) ───────────
    _createProgressBar() { return null; }

    // ─── Phase 3: Chain → 강력 방전 ───────────────────────────────────────────
    _runWireDischarge(chargedNodesMap, litLines, visualLines, onDone) {
        const totalLines = visualLines.length;
        const isSealed = totalLines > 0 && (litLines.size / totalLines) >= 0.6;

        let loopRunning = true;
        let completed = false;
        let rafId = null;
        let borderGlowSet = false;

        const dischargeCanvas = document.createElement('canvas');
        dischargeCanvas.width = window.innerWidth;
        dischargeCanvas.height = window.innerHeight;
        dischargeCanvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:999998;';
        document.body.appendChild(dischargeCanvas);
        const dCtx = dischargeCanvas.getContext('2d');

        const finish = () => {
            if (completed) return;
            completed = true;
            loopRunning = false;
            clearTimeout(hardTimeout);
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            // Immediately reset container styles (no lag into next screen)
            this._replayContainerReset();
            try { dischargeCanvas.remove(); } catch (e) { }
            this._restoreTextWave(litLines, visualLines, isSealed, onDone);
        };

        const hardTimeout = setTimeout(finish, 10000);

        // Container geometry
        const cRect = this.container ? this.container.getBoundingClientRect() : null;
        const cLeft = cRect ? cRect.left : 10;
        const cTop = cRect ? cRect.top : 10;
        const cW = cRect ? cRect.width : window.innerWidth - 20;
        const cH = cRect ? cRect.height : window.innerHeight - 20;
        // Gather point: center of container
        const gatherX = cLeft + cW * 0.5;
        const gatherY = cTop + cH * 0.5;

        // Discharge nodes (charged + in litLines), Y-ascending
        const dischargeNodes = [];
        chargedNodesMap.forEach(node => {
            if (litLines.has(node.lineIdx) && node.state === 'charged') {
                dischargeNodes.push(node);
            }
        });
        dischargeNodes.sort((a, b) => a.y - b.y);

        // ── timing ──────────────────────────────────────────────────────────
        const INITIAL_WAIT = 400;            // nodes vibrate before chain
        const CHAIN_DUR = 200;            // single bolt duration
        const CHAIN_OVERLAP = 55;             // overlap between sequential bolts
        const chainTotalDur = Math.max(0, dischargeNodes.length - 1) * (CHAIN_DUR - CHAIN_OVERLAP);
        // Phase B: border electric crawl
        const BORDER_START_T = INITIAL_WAIT + chainTotalDur + 80;
        const BORDER_DUR = 700;           // "파지직" border crawl duration
        // Phase C: scan bar
        const SCAN_START_T = BORDER_START_T + BORDER_DUR;
        const SCAN_DUR = 550;           // top→bottom travel time
        const PHASE3_DUR = SCAN_START_T + SCAN_DUR + 1000;

        // ── helper: zigzag path ──────────────────────────────────────────────
        const makeZigzag = (x0, y0, x1, y1, jitter = 18, steps = 5) => {
            const pts = [{ x: x0, y: y0 }];
            for (let k = 1; k <= steps; k++) {
                const f = k / (steps + 1);
                pts.push({
                    x: x0 + (x1 - x0) * f + (Math.random() - 0.5) * jitter,
                    y: y0 + (y1 - y0) * f + (Math.random() - 0.5) * jitter,
                });
            }
            pts.push({ x: x1, y: y1 });
            return pts;
        };

        const drawZigzag = (c, pts, outerColor, outerW, blur, innerW = 1.5) => {
            c.save();
            c.beginPath();
            pts.forEach((p, pi) => pi === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
            c.strokeStyle = outerColor; c.lineWidth = outerW;
            c.shadowColor = outerColor; c.shadowBlur = blur; c.stroke();
            c.beginPath();
            pts.forEach((p, pi) => pi === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
            c.strokeStyle = '#ffffff'; c.lineWidth = innerW;
            c.shadowColor = '#fff'; c.shadowBlur = 8; c.stroke();
            c.restore();
        };

        // Pre-generate chain bolt variants
        const chainBolts = [];
        for (let i = 0; i < dischargeNodes.length - 1; i++) {
            const from = dischargeNodes[i];
            const to = dischargeNodes[i + 1];
            chainBolts.push({
                from, to,
                startT: INITIAL_WAIT + i * (CHAIN_DUR - CHAIN_OVERLAP),
                endT: INITIAL_WAIT + i * (CHAIN_DUR - CHAIN_OVERLAP) + CHAIN_DUR,
                variants: Array.from({ length: 3 }, () => makeZigzag(from.x, from.y, to.x, to.y, 12)),
            });
        }



        // RAF loop
        let phaseStart = null;
        const phase3Loop = (timestamp) => {
            if (!loopRunning) return;
            if (!phaseStart) phaseStart = timestamp;
            const elapsed = timestamp - phaseStart;

            dCtx.clearRect(0, 0, dischargeCanvas.width, dischargeCanvas.height);

            // Always: draw all charged nodes (fading during discharge)
            chargedNodesMap.forEach(node => {
                if (node.state !== 'idle' && node.glowAlpha > 0) {
                    this._drawChargedNode(dCtx, node, elapsed);
                }
            });

            // ── Phase A: chain bolts node → node (sequential) ──
            chainBolts.forEach(bolt => {
                if (elapsed < bolt.startT || elapsed > bolt.endT + 60) return;
                const progress = Math.min(1, (elapsed - bolt.startT) / CHAIN_DUR);
                const fadeOut = elapsed > bolt.endT ? 1 - (elapsed - bolt.endT) / 60 : 1;
                const vi = Math.floor(elapsed / 30) % 3;
                dCtx.save();
                dCtx.globalAlpha = progress * fadeOut;
                drawZigzag(dCtx, bolt.variants[vi], 'rgba(180,100,255,0.95)', 4, 24);
                dCtx.restore();
            });

            // ── Phase B: border electric crawl ("파지직") ────────────────────
            if (elapsed >= BORDER_START_T && elapsed < SCAN_START_T + 100) {
                const bElapsed = elapsed - BORDER_START_T;
                // intensity: fade-in 100ms → MAX → fade-out last 100ms
                const rawIntensity = Math.min(bElapsed / 100, 1,
                    (BORDER_DUR - bElapsed + 100) / 100);
                const intensity = Math.max(0, rawIntensity);

                // ── DOM border glow (set once at start) ──
                if (!borderGlowSet && this.container) {
                    borderGlowSet = true;
                    this.container.style.transition = 'none';
                    this.container.style.boxShadow =
                        '0 0 0 2px rgba(255,255,255,0.85), ' +
                        '0 0 18px 4px rgba(255,255,255,0.55), ' +
                        '0 0 40px 8px rgba(200,140,255,0.45)';
                    this.container.style.borderColor = 'rgba(240,220,255,1)';
                    // start fade-out of DOM glow at end of border phase
                    setTimeout(() => {
                        if (!this.container) return;
                        this.container.style.transition =
                            'box-shadow 0.35s ease-out, border-color 0.35s ease-out';
                        this.container.style.boxShadow = '';
                        this.container.style.borderColor = '';
                    }, BORDER_DUR - 80);
                }

                // ── Canvas: perimeter spark walkers ──
                const numSparks = Math.round(6 + intensity * 4); // 6~10
                const perimeter = 2 * (cW + cH);

                // helper: perimeter pos → {x,y}
                const perimPt = (d) => {
                    d = ((d % perimeter) + perimeter) % perimeter;
                    if (d <= cW) return { x: cLeft + d, y: cTop };
                    d -= cW;
                    if (d <= cH) return { x: cLeft + cW, y: cTop + d };
                    d -= cH;
                    if (d <= cW) return { x: cLeft + cW - d, y: cTop + cH };
                    d -= cW;
                    return { x: cLeft, y: cTop + cH - d };
                };

                for (let s = 0; s < numSparks; s++) {
                    // Each spark: random start position, random short arc length
                    const startD = Math.random() * perimeter;
                    const arcLen = 30 + Math.random() * 70; // 30~100px along perimeter
                    const steps = 5;
                    const jitter = 4 + Math.random() * 8;   // perpendicular jitter
                    const pts = [];
                    for (let k = 0; k <= steps; k++) {
                        const d = startD + (arcLen / steps) * k;
                        const base = perimPt(d);
                        // Jitter perpendicular to border: outward-facing
                        const onTop = base.y === cTop;
                        const onBot = Math.abs(base.y - (cTop + cH)) < 1;
                        const onLeft = base.x === cLeft;
                        const jx = onTop || onBot ? (Math.random() - 0.5) * jitter * 0.5
                            : (onLeft ? -1 : 1) * Math.random() * jitter;
                        const jy = onLeft || (!onTop && !onBot) ? (Math.random() - 0.5) * jitter * 0.5
                            : (onTop ? -1 : 1) * Math.random() * jitter;
                        pts.push({ x: base.x + jx, y: base.y + jy });
                    }

                    const alpha = intensity * (0.55 + Math.random() * 0.45);
                    const lw = 1.5 + Math.random() * 2.5;
                    const blur = 10 + Math.random() * 20;
                    dCtx.save();
                    dCtx.globalAlpha = alpha;
                    dCtx.beginPath();
                    pts.forEach((p, pi) => pi === 0 ? dCtx.moveTo(p.x, p.y) : dCtx.lineTo(p.x, p.y));
                    dCtx.strokeStyle = `rgba(200,160,255,0.9)`;
                    dCtx.lineWidth = lw + 1;
                    dCtx.shadowColor = 'rgba(180,120,255,1)';
                    dCtx.shadowBlur = blur;
                    dCtx.stroke();
                    // white core
                    dCtx.beginPath();
                    pts.forEach((p, pi) => pi === 0 ? dCtx.moveTo(p.x, p.y) : dCtx.lineTo(p.x, p.y));
                    dCtx.strokeStyle = '#ffffff';
                    dCtx.lineWidth = lw * 0.5;
                    dCtx.shadowColor = '#ffffff';
                    dCtx.shadowBlur = 8;
                    dCtx.stroke();
                    dCtx.restore();
                }

                // Node fade-out during border phase
                const nodeFade = Math.max(0, 1 - bElapsed / BORDER_DUR);
                dischargeNodes.forEach(node => { node.glowAlpha = nodeFade; });
            }

            // ── Phase C: scan bar sweeps top→bottom ──────────────────────────
            if (elapsed >= SCAN_START_T && this.container) {
                const scanProg = Math.min(1, (elapsed - SCAN_START_T) / SCAN_DUR);
                const eased = scanProg < 0.5
                    ? 2 * scanProg * scanProg
                    : 1 - Math.pow(-2 * scanProg + 2, 2) / 2;

                const r = this.container.getBoundingClientRect();
                const scanY = r.top + eased * r.height;
                const barAlpha = scanProg < 0.97 ? 0.92 : (1 - (scanProg - 0.97) / 0.03);

                // Layer 1: trailing gradient above bar
                const grad = dCtx.createLinearGradient(0, scanY - 40, 0, scanY);
                grad.addColorStop(0, 'rgba(255,255,255,0)');
                grad.addColorStop(1, `rgba(255,255,255,${(barAlpha * 0.18).toFixed(3)})`);
                dCtx.save();
                dCtx.fillStyle = grad;
                dCtx.fillRect(r.left, scanY - 40, r.width, 40);
                dCtx.restore();

                // Layer 2: core bright bar (4x thick = 12px)
                dCtx.save();
                dCtx.globalAlpha = barAlpha;
                dCtx.shadowColor = '#ffffff';
                dCtx.shadowBlur = 32;
                dCtx.fillStyle = '#ffffff';
                dCtx.fillRect(r.left, scanY - 6, r.width, 12);
                dCtx.restore();

                // Layer 3: soft halo below bar
                dCtx.save();
                dCtx.globalAlpha = barAlpha * 0.22;
                dCtx.fillStyle = 'rgba(220,190,255,1)';
                dCtx.fillRect(r.left, scanY + 6, r.width, 20);
                dCtx.restore();
            }

            if (elapsed >= PHASE3_DUR) { finish(); return; }
            rafId = requestAnimationFrame(phase3Loop);
        };

        if (dischargeNodes.length === 0) { setTimeout(finish, 400); return; }
        rafId = requestAnimationFrame(phase3Loop);
    }

    // === Phase 0: Replay Opening Card ========================================
    _showReplayIntroCard(onDone) {
        try {
            const old = document.getElementById('replay-intro-card');
            if (old) { try { old.remove(); } catch (e) { } }

            // ── Meta data ──
            const chapterBadge = document.getElementById('chapter-title-badge');
            const chapterText = chapterBadge ? chapterBadge.textContent.trim() : 'The Book Wardens';
            const wpmEl = document.getElementById('wpm-display');
            const wpmVal = wpmEl ? wpmEl.textContent.trim() : '0';
            const now = new Date();
            const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

            // ── Book cover image mapping ──
            const ct = chapterText.toLowerCase();
            const bookImg = ct.includes('sherlock') ? './SherlockBook.png'
                : ct.includes('aesop') ? './aesopBook.png'
                    : './aliceBook.png';

            // ── Popup card (centered over the passage) ──
            const overlay = document.createElement('div');
            overlay.id = 'replay-intro-card';
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -52%) scale(0.92)',
                width: 'min(304px, 72vw)',
                background: 'rgba(28,4,52,0.96)',
                border: '1.5px solid rgba(180,110,255,0.65)',
                borderRadius: '18px',
                padding: '22px 19px 18px',
                boxSizing: 'border-box',
                boxShadow: '0 0 48px rgba(140,60,255,0.5), 0 8px 32px rgba(0,0,0,0.7)',
                backdropFilter: 'blur(12px)',
                zIndex: '9999998',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 0.45s ease, transform 0.45s cubic-bezier(0.34,1.56,0.64,1)',
                gap: '0',
            });

            // ── Hero title: GAZE REPLAY ──
            const badge = document.createElement('div');
            badge.textContent = 'GAZE REPLAY';
            Object.assign(badge.style, {
                fontFamily: "'Cinzel', 'Georgia', serif",
                fontSize: 'clamp(24px, 7vw, 36px)',
                fontWeight: '900',
                letterSpacing: '6px',
                color: '#ffffff',
                textTransform: 'uppercase',
                textAlign: 'center',
                textShadow: '0 0 36px rgba(200,120,255,1), 0 0 14px rgba(255,255,255,0.8), 0 2px 6px rgba(0,0,0,0.9)',
                lineHeight: '1.2',
                marginBottom: '16px',
            });

            // ── Book cover image ──
            const cover = document.createElement('img');
            cover.src = bookImg;
            cover.alt = chapterText;
            Object.assign(cover.style, {
                width: 'clamp(80px, 22vw, 130px)',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '6px',
                boxShadow: '0 0 32px rgba(180,100,255,0.7), 0 4px 20px rgba(0,0,0,0.8)',
                marginBottom: '20px',
                border: '1.5px solid rgba(200,140,255,0.5)',
            });

            // ── Sub-title: chapter name ──
            const title = document.createElement('div');
            title.textContent = chapterText;
            Object.assign(title.style, {
                fontFamily: 'monospace',
                fontSize: 'clamp(10px, 2.6vw, 13px)',
                fontWeight: '400',
                color: 'rgba(200,170,240,0.85)',
                textAlign: 'center',
                maxWidth: '82vw',
                lineHeight: '1.5',
                letterSpacing: '2px',
                textShadow: '0 0 8px rgba(180,130,255,0.5)',
                padding: '0 12px',
                marginBottom: '10px',
                textTransform: 'uppercase',
            });

            // ── Divider ──
            const divider = document.createElement('div');
            Object.assign(divider.style, {
                width: '160px', height: '1.5px',
                background: 'linear-gradient(90deg, transparent, rgba(200,140,255,0.9), transparent)',
                margin: '4px 0 16px',
            });

            // ── Stats row ──
            const stats = document.createElement('div');
            Object.assign(stats.style, {
                display: 'flex',
                flexDirection: 'row',
                gap: '36px',
                alignItems: 'center',
            });
            const mkStat = (label, val) => {
                const s = document.createElement('div');
                Object.assign(s.style, { textAlign: 'center' });
                const v = document.createElement('div');
                v.textContent = val;
                Object.assign(v.style, {
                    fontSize: 'clamp(16px, 4vw, 22px)',
                    fontWeight: '700',
                    color: '#ffffff',
                    fontFamily: 'monospace',
                    textShadow: '0 0 12px rgba(210,170,255,0.9)',
                });
                const l = document.createElement('div');
                l.textContent = label;
                Object.assign(l.style, {
                    fontSize: 'clamp(9px, 2vw, 11px)',
                    color: 'rgba(200,170,240,0.85)',
                    letterSpacing: '3px',
                    marginTop: '3px',
                    fontFamily: 'monospace',
                });
                s.appendChild(v); s.appendChild(l);
                return s;
            };
            stats.appendChild(mkStat('WPM', wpmVal));
            // vertical sep
            const sep = document.createElement('div');
            Object.assign(sep.style, { width: '1px', height: '32px', background: 'rgba(180,140,255,0.35)' });
            stats.appendChild(sep);
            stats.appendChild(mkStat('DATE', dateStr));

            // ── Logo ──
            const logo = document.createElement('div');
            logo.textContent = 'THE BOOK WARDENS';
            Object.assign(logo.style, {
                fontFamily: "'Cinzel', monospace",
                fontSize: 'clamp(9px, 2.2vw, 11px)',
                letterSpacing: '5px',
                color: 'rgba(180,140,220,0.55)',
                marginTop: '28px',
                textTransform: 'uppercase',
            });

            overlay.appendChild(badge);
            overlay.appendChild(cover);
            overlay.appendChild(title);
            overlay.appendChild(divider);
            overlay.appendChild(stats);
            overlay.appendChild(logo);
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                overlay.style.transform = 'translate(-50%, -52%) scale(1)';
            });

            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    try { if (overlay.parentNode) overlay.remove(); } catch (e) { }
                    if (typeof onDone === 'function') onDone();
                }, 500);
            }, 5000);

        } catch (err) {
            console.error('[_showReplayIntroCard]', err);
            if (typeof onDone === 'function') onDone();
        }
    }

    // === Phase 4: Replay Ending Card ==========================================
    _showReplayEndCard(isSealed, litLines, visualLines, onDone) {
        try {
            const old = document.getElementById('replay-rift-result');
            if (old) { try { old.remove(); } catch (e) { } }

            const sealed = isSealed;

            // ── Collect stats ──
            const inkEl = document.getElementById('ink-count');
            const inkVal = inkEl ? (parseInt(inkEl.textContent, 10) || 0) : 0;
            const wpmEl = document.getElementById('wpm-display');
            const wpmVal = wpmEl ? (wpmEl.textContent.trim() || '0') : '0';
            const totalL = visualLines ? visualLines.length : 0;
            const litCount = litLines ? litLines.size : 0;
            const sealPct = totalL > 0 ? Math.round((litCount / totalL) * 100) : 0;

            // ── Colors ──
            const bgMain = sealed ? 'radial-gradient(ellipse at 50% 30%, rgba(70,0,110,0.98) 0%, rgba(8,4,22,1) 70%)'
                : 'radial-gradient(ellipse at 50% 30%, rgba(20,10,45,0.98) 0%, rgba(5,3,15,1) 70%)';
            const accent = sealed ? '#ffffff' : 'rgba(210,200,240,0.9)';
            const accentSub = sealed ? 'rgba(220,180,255,0.85)' : 'rgba(170,160,210,0.7)';
            const bdrClr = sealed ? 'rgba(200,140,255,0.7)' : 'rgba(100,85,150,0.5)';
            const glow = sealed
                ? '0 0 30px rgba(210,120,255,1), 0 0 12px rgba(255,255,255,0.8), 0 2px 4px rgba(0,0,0,0.8)'
                : '0 0 10px rgba(130,110,180,0.7), 0 2px 4px rgba(0,0,0,0.8)';

            const resultText = sealed ? 'RIFT SEALED' : 'NOT YET';
            const resultSub = sealed ? 'All seals restored' : `${sealPct}% seals active`;

            // ── Popup card ──
            const overlay = document.createElement('div');
            overlay.id = 'replay-rift-result';
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -52%) scale(0.88)',
                width: 'min(304px, 72vw)',
                background: sealed ? 'rgba(36,0,62,0.96)' : 'rgba(12,8,28,0.96)',
                border: `1.5px solid ${bdrClr}`,
                borderRadius: '18px',
                padding: '22px 19px 18px',
                boxSizing: 'border-box',
                boxShadow: `0 0 52px rgba(140,60,255,0.45), 0 8px 32px rgba(0,0,0,0.7)`,
                backdropFilter: 'blur(14px)',
                zIndex: '9999990',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                gap: '0',
            });

            // Result title
            const title = document.createElement('div');
            title.textContent = resultText;
            Object.assign(title.style, {
                color: accent,
                fontSize: 'clamp(20px, 6vw, 32px)',
                fontWeight: '900',
                fontFamily: "'Cinzel', monospace",
                letterSpacing: '5px',
                textAlign: 'center',
                textShadow: glow,
                lineHeight: '1.3',
                marginBottom: '6px',
            });

            // Sub text
            const sub = document.createElement('div');
            sub.textContent = resultSub;
            Object.assign(sub.style, {
                color: accentSub,
                fontSize: 'clamp(11px, 2.8vw, 14px)',
                fontFamily: 'monospace',
                letterSpacing: '3px',
                textTransform: 'uppercase',
                textShadow: '0 0 8px rgba(180,140,255,0.6)',
                marginBottom: '28px',
            });

            // Divider
            const div = document.createElement('div');
            Object.assign(div.style, {
                width: '200px', height: '1.5px',
                background: `linear-gradient(90deg, transparent, ${bdrClr}, transparent)`,
                margin: '0 0 28px',
            });

            // Stats row container
            const statsRow = document.createElement('div');
            Object.assign(statsRow.style, {
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: '0',
                alignItems: 'stretch',
            });

            const mkStat = (icon, val, lbl, last) => {
                const s = document.createElement('div');
                Object.assign(s.style, {
                    textAlign: 'center',
                    padding: '0 28px',
                    borderRight: last ? 'none' : `1px solid rgba(180,140,255,0.3)`,
                });
                const ic = document.createElement('div');
                ic.textContent = icon;
                Object.assign(ic.style, { fontSize: 'clamp(20px,5vw,28px)', lineHeight: '1', marginBottom: '6px' });
                const vv = document.createElement('div');
                vv.textContent = val;
                Object.assign(vv.style, {
                    fontSize: 'clamp(22px, 6vw, 34px)',
                    fontWeight: '900',
                    color: accent,
                    fontFamily: 'monospace',
                    lineHeight: '1',
                    textShadow: '0 0 16px rgba(210,170,255,0.9)',
                    marginBottom: '5px',
                });
                const ll = document.createElement('div');
                ll.textContent = lbl;
                Object.assign(ll.style, {
                    fontSize: 'clamp(9px, 2.2vw, 11px)',
                    color: accentSub,
                    letterSpacing: '3px',
                    fontFamily: 'monospace',
                    textTransform: 'uppercase',
                });
                if (icon) s.appendChild(ic); s.appendChild(vv); s.appendChild(ll);
                return s;
            };
            // Accuracy = litLines read / totalLines
            const accuracyVal = sealPct;  // already computed as litCount/totalL * 100
            statsRow.appendChild(mkStat('', wpmVal, 'WPM', false));
            statsRow.appendChild(mkStat('', accuracyVal + '%', 'ACCURACY', true));

            // Logo
            const logo = document.createElement('div');
            logo.textContent = 'THE BOOK WARDENS';
            Object.assign(logo.style, {
                fontFamily: "'Cinzel', monospace",
                fontSize: 'clamp(9px, 2.2vw, 11px)',
                letterSpacing: '5px',
                color: 'rgba(180,140,220,0.45)',
                marginTop: '36px',
                textTransform: 'uppercase',
            });

            overlay.appendChild(title);
            overlay.appendChild(sub);
            overlay.appendChild(div);
            overlay.appendChild(statsRow);
            overlay.appendChild(logo);
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                overlay.style.transform = 'translate(-50%, -50%) scale(1)';
            });

            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    try { if (overlay.parentNode) overlay.remove(); } catch (e) { }
                    // Remove watermark label + cancel its RAF
                    try {
                        if (this._replayLabelRAF) { cancelAnimationFrame(this._replayLabelRAF); this._replayLabelRAF = null; }
                        if (this._replayIntroLabel && this._replayIntroLabel.parentNode)
                            this._replayIntroLabel.remove();
                        this._replayIntroLabel = null;
                    } catch (e) { }
                    if (typeof onDone === 'function') onDone();
                }, 500);
            }, 3000);

        } catch (err) {
            console.error('[_showReplayEndCard]', err);
            if (typeof onDone === 'function') onDone();
        }
    }


    // === Phase 4: Text Restoration Wave ======================================
    _restoreTextWave(litLines, visualLines, isSealed, onDone) {
        if (isSealed && visualLines && this.words) {
            // SUCCESS: restore ALL lines to white (not just litLines)
            visualLines.forEach((line, i) => {
                setTimeout(() => {
                    if (!line.wordIndices) return;
                    line.wordIndices.forEach(wIdx => {
                        const word = this.words[wIdx];
                        if (word && word.element) {
                            word.element.style.transition = 'color 0.4s ease, text-shadow 0.4s ease';
                            word.element.style.color = '#ffffff';
                            word.element.style.textShadow = '0 0 8px rgba(155,89,182,0.5), 0 0 2px rgba(255,255,255,0.4)';
                        }
                    });
                }, i * 50);
            });
        }
        // FAIL: all text stays grey (no restoration)
        const waveDur = isSealed ? (visualLines ? visualLines.length * 50 : 0) + 200 : 0;
        setTimeout(() => { this._showReplayEndCard(isSealed, litLines, visualLines, onDone); }, waveDur);
    }

    // === Helper: Draw purple charged node (sphere + wrapping lightning) =======
    _drawChargedNode(ctx, node, elapsed) {
        const { x, y, radius, state, chargePct, fixedAngles } = node;
        const alpha = (node.glowAlpha !== undefined) ? node.glowAlpha : 1;
        if (alpha <= 0) return;

        ctx.save();
        ctx.globalAlpha = alpha;

        if (state === 'idle') {
            // Dim glow only
            ctx.globalAlpha = 0.35 * alpha;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = '#2a0044';
            ctx.shadowColor = 'rgba(155,89,182,0.5)';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.restore();
            return;
        }

        // Sphere body (radial gradient for 3D look)
        const sphereAlpha = 0.6 + chargePct * 0.4;
        ctx.globalAlpha = sphereAlpha * alpha;
        const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 1, x, y, radius);
        grad.addColorStop(0, '#b066dd');
        grad.addColorStop(0.5, '#5c0099');
        grad.addColorStop(1, '#1a0033');
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.shadowColor = `rgba(180, 100, 255, ${chargePct * 0.9})`;
        ctx.shadowBlur = 10 + chargePct * 22;
        ctx.fill();
        ctx.restore();

        if (state !== 'charging' && state !== 'charged') return;

        // Wrapping lightning bolts
        const numBolts = (state === 'charged' || chargePct >= 0.5) ? 3 : 2;
        const angles = (state === 'charged' && fixedAngles)
            ? fixedAngles
            : Array.from({ length: numBolts }, () => Math.random() * Math.PI * 2);

        for (let b = 0; b < numBolts; b++) {
            const startAngle = angles[b];
            const sweep = Math.PI * 0.6 + (Math.random() - 0.5) * 0.3; // ~108°
            const numSeg = 5;
            const pts = [];
            const jitterAmt = state === 'charged' ? 3 : 7;
            for (let s = 0; s <= numSeg; s++) {
                const a = startAngle + (sweep / numSeg) * s;
                const sr = radius + (Math.random() - 0.5) * jitterAmt;
                pts.push({ x: x + Math.cos(a) * sr, y: y + Math.sin(a) * sr });
            }

            // Outer glow
            ctx.save();
            ctx.globalAlpha = (0.7 + chargePct * 0.3) * alpha;
            ctx.beginPath();
            pts.forEach((p, pi) => pi === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.strokeStyle = `rgba(180, 100, 255, 0.85)`;
            ctx.lineWidth = 3 + chargePct * 2;
            ctx.shadowColor = '#9b59b6';
            ctx.shadowBlur = 16 + chargePct * 10;
            ctx.stroke();
            // Inner white core
            ctx.beginPath();
            pts.forEach((p, pi) => pi === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2;
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 6;
            ctx.stroke();
            ctx.restore();
        }
    }

    // === Helper: Border position interpolation (clockwise) ===================
    _borderPos(d, left, top, w, h) {
        const p = 2 * (w + h);
        d = ((d % p) + p) % p;
        if (d <= w) return { x: left + d, y: top };
        d -= w;
        if (d <= h) return { x: left + w, y: top + d };
        d -= h;
        if (d <= w) return { x: left + w - d, y: top + h };
        d -= w;
        return { x: left, y: top + h - d };
    }

    // === Helper: Ink drop VFX → HUD =========================================
    // Fires when a purple node becomes fully charged (line transition confirm).
    // Spawns a flying ink particle that travels to the HUD ink icon.
    _fireInkDrop(node) {
        const INK_PER_LINE = 10;
        try {
            // 1. Spawn flying ink via Game helper (bezier → HUD → addInk)
            if (window.Game && typeof window.Game.spawnFlyingResource === 'function') {
                window.Game.spawnFlyingResource(node.x, node.y, INK_PER_LINE, 'ink');
            }

            // 2. HUD icon pop animation
            const inkCountEl = document.getElementById('ink-count');
            const iconEl = inkCountEl
                ? inkCountEl.parentElement && inkCountEl.parentElement.querySelector('img.res-icon')
                : null;
            if (iconEl) {
                iconEl.classList.remove('ink-pop');
                // Force reflow to restart animation if already running
                void iconEl.offsetWidth;
                iconEl.classList.add('ink-pop');
                setTimeout(() => iconEl.classList.remove('ink-pop'), 400);
            }
        } catch (e) {
            console.warn('[_fireInkDrop]', e);
        }
    }

    // === Replay cleanup: fully restore container styles ======================
    // Called by _runWireDischarge.finish() so no style leaks into the next screen.
    _replayContainerReset() {
        const c = this.container;
        if (!c) return;

        // 1. Stop any running CSS transition immediately
        c.style.transition = 'none';
        c.style.boxShadow = '';
        c.style.filter = '';

        // 2. Restore border: We CANNOT use c.style.borderColor = '' because
        //    JS borderColor is a longhand that breaks the 'border' shorthand.
        //    Instead rebuild the inline style from the original snapshot,
        //    then reapply the renderer-managed properties on top.
        if (this._origBorderInline !== undefined) {
            // Re-apply original inline style string (contains the HTML border attr)
            c.setAttribute('style', this._origBorderInline);
            // Then re-apply renderer-overridden properties that must persist
            c.style.position = 'relative';
            c.style.fontFamily = this.options.fontFamily;
            c.style.fontSize = this.options.fontSize;
            c.style.lineHeight = this.options.lineHeight;
            c.style.padding = this.options.padding;
            c.style.textAlign = 'left';
        } else {
            // Fallback: just clear the glow-related properties
            c.style.borderColor = ''; // may still break shorthand but better than stuck glow
        }

        // 3. One RAF later: clear the transition override so CSS rules resume normally
        requestAnimationFrame(() => {
            if (!c) return;
            c.style.transition = '';
        });
    }


    // === Legacy stubs ========================================================
    _sealRiftVFX(visualLines, onDone) { if (typeof onDone === 'function') onDone(); }
    _waveTextWhite(visualLines) { }
    _runEnergyTransfer(litLines, visualLines, progressContainer, onDone) {
        if (typeof onDone === 'function') onDone();
    }
    _showRiftPopup() { }
    _checkReplayCombo() { }
    _showMiniScore() { }
    _animateScoreToHud() { }
    _spawnReplayPulse() { }
}
window.TextRenderer = TextRenderer;

