/**
 * BookSelectManager.js
 * Book selection screen (screen-book-select) rendering and selection logic.
 * Flow: rift-intro complete → render() → user taps SELECT button → selectBook() → screen-word
 */
import { BOOKS } from '../data/BookData.js?v=20260226-BS3';

export class BookSelectManager {
    constructor(game) {
        this.game = game;
        this._locked = false; // prevent double-tap
    }

    /**
     * Initialises screen-book-select and renders 3 vertical cards.
     * Called by IntroManager after startRiftIntro() completes.
     */
    render() {
        const container = document.getElementById('book-card-list');
        if (!container) {
            console.error('[BookSelectManager] #book-card-list not found in DOM.');
            return;
        }

        container.innerHTML = '';
        this._locked = false;

        BOOKS.forEach((book, idx) => {
            const card = this._buildCard(book);
            card.style.opacity = '0';
            card.style.transform = 'translateY(24px)';
            container.appendChild(card);

            // Staggered fade-in
            setTimeout(() => {
                card.style.transition = 'opacity 0.45s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 120 + idx * 150);
        });
    }

    /**
     * Build a single book card element.
     * Selection is triggered ONLY by the SELECT button (not the whole card).
     */
    _buildCard(book) {
        const card = document.createElement('div');
        card.className = 'bs-card';
        card.setAttribute('data-book-id', book.id);

        // Difficulty stars
        const starsHtml = Array.from({ length: 3 }, (_, i) =>
            `<span class="bs-star" style="${i < book.difficultyStars
                ? `color:${book.difficultyColor};text-shadow:0 0 8px ${book.difficultyColor}80;`
                : 'color:#2a2a3a;'
            }">★</span>`
        ).join('');

        card.innerHTML = `
            <!-- Left: Book cover image -->
            <div class="bs-cover-wrap">
                <img class="bs-cover-img" src="${book.image}" alt="${book.title}"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <div class="bs-cover-fallback" style="display:none;">📖</div>
            </div>

            <!-- Right: Info panel -->
            <div class="bs-info">
                <div class="bs-title" style="color:${book.accentColor};">${book.title}</div>
                <div class="bs-subtitle">${book.subtitle}</div>

                <div class="bs-meta-row">
                    <span class="bs-meta-item">📄 <b>${book.pages}</b> pages</span>
                    <span class="bs-meta-item">📚 <b>${book.chapters}</b> ch.</span>
                </div>
                <div class="bs-meta-row">
                    <span class="bs-meta-item">💎 <b>${book.gemCost.toLocaleString()}</b> gems</span>
                    <span class="bs-meta-item bs-rifts" style="color:${book.difficultyColor};">
                        ⚡ <b>${book.riftDamage.toLocaleString()}</b> rifts
                    </span>
                </div>
                <div class="bs-bottom-row">
                    <span class="bs-difficulty">
                        ${starsHtml}
                        <span class="bs-diff-label" style="color:${book.difficultyColor};">${book.difficulty}</span>
                    </span>
                    <button class="bs-select-btn"
                            id="btn-select-book-${book.id}"
                            style="--accent:${book.accentColor}; border-color:${book.accentColor}; color:${book.accentColor};"
                            data-book-id="${book.id}">
                        SELECT
                    </button>
                </div>
            </div>
        `;

        // SELECT button only (not whole card)
        const btn = card.querySelector('.bs-select-btn');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectBook(book.id, card, btn);
        });
        // iOS sticky-hover fix
        btn.addEventListener('touchstart', () => {
            requestAnimationFrame(() => btn.blur());
        }, { passive: true });

        return card;
    }

    /**
     * Book selection handler:
     * 1. Lock to prevent double-tap
     * 2. Visual feedback on button + card
     * 3. Inject book data into Game.state
     * 4. Amplitude event
     * 5. Navigate to Word Forge
     */
    selectBook(bookId, cardEl, btnEl) {
        if (this._locked) return;
        this._locked = true;

        const book = BOOKS.find(b => b.id === bookId);
        if (!book) {
            console.error('[BookSelectManager] Unknown bookId:', bookId);
            this._locked = false;
            return;
        }

        console.log(`[BookSelectManager] Book selected: ${book.title}`);

        // Visual feedback
        document.querySelectorAll('.bs-card').forEach(c => {
            c.style.opacity = c === cardEl ? '1' : '0.35';
        });
        if (cardEl) {
            cardEl.style.border = `1.5px solid ${book.accentColor}`;
            cardEl.style.boxShadow = `0 0 20px ${book.glowColor}, 0 4px 24px rgba(0,0,0,0.6)`;
        }
        if (btnEl) {
            btnEl.textContent = '✓ SELECTED';
            btnEl.style.background = book.accentColor;
            btnEl.style.color = '#fff';
            btnEl.disabled = true;
        }

        // Inject into Game.state
        this.game.state.selectedBook = book;
        this.game.state.storyParagraphs = book.storyParagraphs;
        this.game.state.midBossQuizzes = book.midBossQuizzes;
        this.game.state.finalBossQuiz = book.finalBossQuiz;

        if (this.game.vocabManager) {
            this.game.vocabManager.init(book.vocabList);
        }

        // Amplitude
        if (window.amplitude) {
            window.amplitude.track('Book_Selected', {
                book: book.id,
                title: book.title,
                difficulty: book.difficulty,
                gemCost: book.gemCost,
                riftDamage: book.riftDamage
            });
        }

        setTimeout(() => {
            this.game.state.vocabIndex = 0;
            this.game.loadVocab(0);
            this.game.switchScreen('screen-word');
        }, 480);
    }
}
