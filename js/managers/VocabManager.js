export class VocabManager {
    constructor(game) {
        this.game = game;
        this.vocabList = [];
        this.currentIndex = 0;
        this.isProcessing = false;
    }

    init(vocabList, bookId) {
        this.vocabList = vocabList || [];
        this.currentIndex = 0;
        this.bookId = bookId || 'aesop';   // Firebase URL fetch에 사용
    }

    async loadVocab(index) {
        if (!this.vocabList || index >= this.vocabList.length) return;

        this.currentIndex = index;
        const data = this.vocabList[index];

        // ── 단어 제목 업데이트 ──────────────────────────────────
        const titleEl = document.getElementById("vocab-word");
        if (titleEl) titleEl.textContent = data.word;

        // ── 이미지 로드 ──────────────────────────────────────────
        // VocabImageManager v4: same-origin 로컬 이미지 → COEP/CORS 문제 없음
        const imgPlaceholder = document.querySelector(".word-image-placeholder");
        if (imgPlaceholder) {
            imgPlaceholder.innerHTML = `<div style="
                width:60px;height:60px;border-radius:50%;
                border:4px solid rgba(255,215,0,0.3);
                border-top-color:#ffd700;
                animation:spin 0.8s linear infinite;
            "></div>`;

            let imageUrl = null;

            if (window.VocabImageManager && window.VocabImageManager.isReady(this.bookId)) {
                imageUrl = window.VocabImageManager.getImageUrlSync(this.bookId, data.word);
            } else if (window.VocabImageManager) {
                try {
                    imageUrl = await window.VocabImageManager.getImageUrl(this.bookId, data.word);
                } catch (e) {
                    console.warn('[VocabManager] VocabImageManager 오류:', e);
                }
            }

            if (imageUrl) {
                const img = document.createElement("img");
                img.alt = data.word;
                img.style.maxWidth = "100%";
                img.style.maxHeight = "100%";
                img.style.objectFit = "contain";
                img.style.filter = "drop-shadow(0 0 10px rgba(255, 215, 0, 0.5))";
                img.onload = () => {
                    imgPlaceholder.innerHTML = "";
                    imgPlaceholder.appendChild(img);
                };
                img.onerror = () => {
                    console.warn(`[VocabManager] 이미지 로드 실패: ${imageUrl}`);
                    this.renderFallbackIcon(imgPlaceholder, data.word);
                };
                img.src = imageUrl;
            } else {
                this.renderFallbackIcon(imgPlaceholder, data.word);
            }
        }

        // ── 예문 업데이트 ─────────────────────────────────────────
        const card = document.querySelector(".word-card");
        if (card) {
            const p = card.querySelector("p");
            if (p) p.innerHTML = data.sentence;
        }

        // ── 카운터 업데이트 ───────────────────────────────────────
        const counterDiv = document.querySelector("#screen-word > div:first-child");
        if (counterDiv) counterDiv.textContent = `WORD FORGE (${index + 1}/${this.vocabList.length})`;

        // ── 선택지 업데이트 ───────────────────────────────────────
        const optionsDiv = document.getElementById("vocab-options");
        if (optionsDiv) {
            optionsDiv.innerHTML = "";
            data.options.forEach((optText, idx) => {
                const btn = document.createElement("button");
                btn.className = "option-btn";
                btn.textContent = optText;
                btn.onclick = (e) => this.game.checkVocab(idx, e);
                btn.addEventListener('touchstart', () => {
                    requestAnimationFrame(() => btn.blur());
                }, { passive: true });
                optionsDiv.appendChild(btn);
            });
        }
    }


    /**
     * _loadImageViaBlobUrl(url, container, word)
     * [COEP Fix] fetch → blob URL 방식으로 cross-origin 이미지 로드.
     *
     * coi-serviceworker.js가 Cross-Origin-Embedder-Policy를 활성화하므로
     * img.src = "https://storage.googleapis.com/..." 방식은 차단됨.
     * fetch()로 이미지 바이트를 직접 가져와 로컬 blob URL을 생성하면
     * same-origin으로 취급되어 COEP 제한이 적용되지 않음.
     */
    _loadImageViaBlobUrl(url, container, word) {
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.blob();
            })
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                const img = document.createElement("img");
                img.alt = word;
                img.style.maxWidth = "100%";
                img.style.maxHeight = "100%";
                img.style.objectFit = "contain";
                img.style.filter = "drop-shadow(0 0 10px rgba(255, 215, 0, 0.5))";
                img.onload = () => {
                    container.innerHTML = "";
                    container.appendChild(img);
                    // blob URL은 img 로드 후 즉시 해제 (메모리 누수 방지)
                    URL.revokeObjectURL(blobUrl);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(blobUrl);
                    this.renderFallbackIcon(container, word);
                };
                img.src = blobUrl;
            })
            .catch(err => {
                console.warn(`[VocabManager] 이미지 fetch 실패 (${word}):`, err);
                this.renderFallbackIcon(container, word);
            });
    }

    renderFallbackIcon(container, word) {
        let icon = "📜";
        if (word === "Luminous") icon = "✨";
        if (word === "Peculiar") icon = "🎩";
        if (word === "Vanish") icon = "💨";

        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";
        container.innerHTML = `<div style="font-size: 80px; text-shadow: 0 0 20px rgba(255,215,0,0.5); animation: float 3s infinite ease-in-out;">${icon}</div>`;
    }

    async checkVocab(optionIndex, event) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const currentData = this.vocabList[this.currentIndex];
        const isCorrect = (optionIndex === currentData.answer);

        // UI Feedback
        const optionsDiv = document.getElementById("vocab-options");
        const btns = optionsDiv ? optionsDiv.querySelectorAll(".option-btn") : [];
        const selectedBtn = btns[optionIndex];

        btns.forEach(btn => btn.disabled = true);

        if (isCorrect) {
            // Success
            if (selectedBtn) {
                selectedBtn.classList.add("correct");
                this.spawnFloatingText(selectedBtn, "+100 Runes!", "bonus");

                // FX
                const rect = selectedBtn.getBoundingClientRect();
                const startX = event ? event.clientX : (rect.left + rect.width / 2);
                const startY = event ? event.clientY : (rect.top + rect.height / 2);
                this.spawnRuneParticles(startX, startY);
            }

            await new Promise(r => setTimeout(r, 1200));

            this.currentIndex++;
            this.isProcessing = false;

            if (this.currentIndex < this.vocabList.length) {
                this.loadVocab(this.currentIndex);
            } else {
                console.log("[VocabManager] Word Forge Complete.");
                this.game.switchScreen("screen-wpm");
            }
        } else {
            // Fail
            // Penalty
            if (this.game.scoreManager) this.game.scoreManager.addRunes(-50);

            if (selectedBtn) {
                selectedBtn.classList.add("wrong");
                this.spawnFloatingText(selectedBtn, "-50 Rune", "error");
            }

            // Retry Logic: Re-enable others
            btns.forEach((btn, idx) => {
                if (idx !== optionIndex) btn.disabled = false;
            });

            this.isProcessing = false;
        }
    }

    // --- FX ---
    spawnFloatingText(targetEl, text, type) {
        const rect = targetEl.getBoundingClientRect();
        const floatEl = document.createElement("div");
        floatEl.className = `feedback-text ${type}`;
        floatEl.innerText = text;
        floatEl.style.left = (rect.left + rect.width / 2) + "px";
        floatEl.style.top = (rect.top) + "px";
        document.body.appendChild(floatEl);
        setTimeout(() => floatEl.remove(), 1000);
    }

    spawnRuneParticles(startX, startY) {
        const targetEl = document.getElementById("rune-count");
        if (!targetEl) return;

        // Add Score (Deferred or Immediate? Original was immediate inside anim? No, onfinish)
        // Original: if (i===0) this.addRunes(10);
        // We'll do it via callback or inside loop.

        const targetRect = targetEl.getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;

        const particleCount = 12;
        const colors = ["#ffd700", "#ffae00", "#ffffff", "#e0ffff"];

        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement("div");
            p.className = "rune-particle";

            const size = 5 + Math.random() * 8;
            p.style.width = size + "px";
            p.style.height = size + "px";
            p.style.borderRadius = "50%";
            p.style.position = "fixed";
            p.style.zIndex = "10000";
            p.style.left = startX + "px";
            p.style.top = startY + "px";

            const color = colors[Math.floor(Math.random() * colors.length)];
            p.style.backgroundColor = color;
            p.style.boxShadow = "0 0 10px " + color;

            document.body.appendChild(p);

            // Bezier Logic
            const midX = (startX + targetX) / 2;
            const midY = (startY + targetY) / 2;
            const curveStrength = 150 + Math.random() * 200;
            const curveAngle = Math.random() * Math.PI * 2;
            const cpX = midX + Math.cos(curveAngle) * curveStrength;
            const cpY = midY + Math.sin(curveAngle) * curveStrength;

            const keyframes = [];
            const steps = 30;
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const xx = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * targetX;
                const yy = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * targetY;

                let scale = 1;
                let opacity = 1;

                if (t < 0.2) scale = 0.5 + (t * 5);
                else if (t < 0.8) scale = 1.5 - ((t - 0.2) * 0.5);
                else { scale = 1.2 - ((t - 0.8) * 4); opacity = 1; }

                keyframes.push({ left: `${xx}px`, top: `${yy}px`, transform: `scale(${scale})`, opacity: opacity, offset: t });
            }

            const duration = 1200 + Math.random() * 600;
            const anim = p.animate(keyframes, { duration: duration, easing: "linear", fill: "forwards" });

            anim.onfinish = () => {
                // [FIX] Cancel the animation before removing the element.
                // fill:'forwards' locks computed styles on the node, preventing GC.
                // anim.cancel() reverts to the element's base style, releasing the hold.
                anim.cancel();
                p.remove();
                if (i === 0) {
                    // Reward
                    if (this.game.scoreManager) this.game.scoreManager.addRunes(100);

                    // Pulse
                    targetEl.style.transition = "transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
                    targetEl.style.transform = "scale(1.8)";
                    targetEl.style.filter = "brightness(2.5) drop-shadow(0 0 20px gold)";
                    setTimeout(() => {
                        targetEl.style.transform = "scale(1)";
                        targetEl.style.filter = "brightness(1)";
                    }, 200);
                }
            };
        }
    }
}
