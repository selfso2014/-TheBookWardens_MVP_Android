/**
 * BookSelectManager.js
 * 책 선택 화면(screen-book-select) 렌더링 및 선택 처리.
 * rift-intro 완료 → render() → 사용자 선택 → selectBook() → screen-word 진입
 */
import { BOOKS } from '../data/BookData.js?v=20260226-BS';

export class BookSelectManager {
    constructor(game) {
        this.game = game;
    }

    /**
     * screen-book-select 를 초기화하고 카드 3장을 렌더링한다.
     * IntroManager.startRiftIntro() 완료 후 호출된다.
     */
    render() {
        const container = document.getElementById('book-card-list');
        if (!container) {
            console.error('[BookSelectManager] #book-card-list not found in DOM.');
            return;
        }

        // 이전 렌더링 초기화 (재진입 대비)
        container.innerHTML = '';

        BOOKS.forEach((book, idx) => {
            const card = this._buildCard(book);
            card.style.opacity = '0';
            card.style.transform = 'translateY(24px)';
            container.appendChild(card);

            // Staggered fade-in (카드별 0.15s 간격)
            setTimeout(() => {
                card.style.transition = 'opacity 0.45s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 120 + idx * 150);
        });
    }

    /**
     * DOM 카드 엘리먼트를 생성하고 반환한다.
     */
    _buildCard(book) {
        const card = document.createElement('div');
        card.className = 'bs-card';
        card.setAttribute('data-book-id', book.id);

        // 별점 HTML
        const starsHtml = Array.from({ length: 3 }, (_, i) =>
            `<span class="bs-star ${i < book.difficultyStars ? 'active' : ''}"
                   style="${i < book.difficultyStars ? `color:${book.difficultyColor};text-shadow:0 0 8px ${book.difficultyColor};` : 'color:#333;'}">★</span>`
        ).join('');

        card.innerHTML = `
            <!-- 왼쪽: 표지 이미지 -->
            <div class="bs-cover-wrap">
                <img class="bs-cover-img" src="${book.image}" alt="${book.title}"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <div class="bs-cover-fallback" style="display:none;">📖</div>
            </div>

            <!-- 오른쪽: 정보 영역 -->
            <div class="bs-info">
                <div class="bs-title" style="color:${book.accentColor};">${book.title}</div>
                <div class="bs-subtitle">${book.subtitle}</div>

                <div class="bs-meta-row">
                    <span class="bs-meta-item">📄 <b>${book.pages}</b> pages</span>
                    <span class="bs-meta-item">📚 <b>${book.chapters}</b> chapters</span>
                </div>
                <div class="bs-meta-row">
                    <span class="bs-meta-item">💎 <b>${book.gemCost.toLocaleString()}</b> gems</span>
                    <span class="bs-difficulty" style="color:${book.difficultyColor};">
                        ${starsHtml}
                        <span class="bs-diff-label">${book.difficulty}</span>
                    </span>
                </div>

                <button class="bs-select-btn"
                        id="btn-select-book-${book.id}"
                        style="border-color:${book.accentColor}; color:${book.accentColor};"
                        data-book-id="${book.id}">
                    SELECT
                </button>
            </div>
        `;

        // SELECT 버튼 이벤트
        const btn = card.querySelector('.bs-select-btn');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectBook(book.id);
        });
        // iOS sticky-hover 방어
        btn.addEventListener('touchstart', () => {
            requestAnimationFrame(() => btn.blur());
        }, { passive: true });

        return card;
    }

    /**
     * 책 선택 처리:
     * 1. Game.state에 선택 저장
     * 2. 게임 데이터 주입
     * 3. Amplitude 이벤트
     * 4. Word Forge 진입
     */
    selectBook(bookId) {
        const book = BOOKS.find(b => b.id === bookId);
        if (!book) {
            console.error('[BookSelectManager] Unknown bookId:', bookId);
            return;
        }

        console.log(`[BookSelectManager] Book selected: ${book.title}`);

        // 1. Game.state 저장
        this.game.state.selectedBook = book;

        // 2. 게임 데이터 주입
        this.game.state.storyParagraphs = book.storyParagraphs;
        this.game.state.midBossQuizzes = book.midBossQuizzes;
        this.game.state.finalBossQuiz = book.finalBossQuiz;

        // 3. VocabManager 교체 초기화
        if (this.game.vocabManager) {
            this.game.vocabManager.init(book.vocabList);
        }

        // 4. Amplitude 이벤트
        if (window.amplitude) {
            window.amplitude.track('Book_Selected', {
                book: book.id,
                title: book.title,
                difficulty: book.difficulty,
                difficultyStars: book.difficultyStars
            });
        }

        // 5. 선택 시각 피드백 (버튼 강조 → 약간의 딜레이 후 전환)
        const selectedBtn = document.getElementById(`btn-select-book-${bookId}`);
        if (selectedBtn) {
            selectedBtn.textContent = '✓ SELECTED';
            selectedBtn.style.background = book.accentColor;
            selectedBtn.style.color = '#fff';
        }

        setTimeout(() => {
            // Word Forge 진입
            this.game.state.vocabIndex = 0;
            this.game.loadVocab(0);
            this.game.switchScreen('screen-word');
        }, 500);
    }
}
