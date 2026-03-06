/**
 * VocabImageManager.js  v4 (2026-03-07) — Same-Origin Local Images
 * ─────────────────────────────────────────────────────────────
 * COEP/CORS/Firestore/ServiceWorker 문제 완전 해결:
 *
 * 이미지를 GitHub Pages 리포지토리에 직접 커밋하여 same-origin으로 제공.
 * 경로: /images/vocab/{bookId}/{key}.jpg
 *
 * 장점:
 *  - COEP: same-origin → 차단 없음
 *  - CORS: 필요 없음
 *  - Firestore: 의존 없음
 *  - ServiceWorker: 일반 캐시와 동일하게 처리
 *  - Firebase Storage: 의존 없음
 */

const VocabImageManager = (() => {

    // ── Same-Origin 이미지 경로 (GitHub Pages 기준) ───────────
    // images/vocab/{bookId}/{key}.jpg 형식으로 리포지토리에 직접 커밋됨
    const LOCAL_BASE = './images/vocab';

    // ── 게임 단어 → 로컬 이미지 경로 맵 ────────────────────────
    // 9개 파일: images/vocab/aesop/flatter.jpg 등
    const VOCAB_IMAGES = {
        aesop: {
            flatter: `${LOCAL_BASE}/aesop/flatter.jpg`,
            persevere: `${LOCAL_BASE}/aesop/persevere.jpg`,
            deceit: `${LOCAL_BASE}/aesop/deceit.jpg`,
        },
        alice: {
            peep: `${LOCAL_BASE}/alice/peep.jpg`,
            pleasure: `${LOCAL_BASE}/alice/pleasure.jpg`,
            remarkable: `${LOCAL_BASE}/alice/remarkable.jpg`,
        },
        sherlock: {
            astute: `${LOCAL_BASE}/sherlock/astute.jpg`,
            singular: `${LOCAL_BASE}/sherlock/singular.jpg`,
            discern: `${LOCAL_BASE}/sherlock/discern.jpg`,
        },
    };

    // ── 유틸 ──────────────────────────────────────────────────
    function wordToKey(word) {
        return (word || '')
            .toLowerCase()
            .replace(/[\s\-']/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    }

    function getUrl(bookId, word) {
        const key = wordToKey(word);
        const url = (VOCAB_IMAGES[bookId] || {})[key];
        if (url) {
            console.log(`[VocabImage] v4 same-origin: ${url}`);
            return url;
        }
        // 등록되지 않은 단어 → null 반환 (VocabManager가 renderFallbackIcon 처리)
        console.warn(`[VocabImage] 미등록 단어: bookId=${bookId}, word=${word}, key=${key}`);
        return null;
    }

    // ── Public API ────────────────────────────────────────────

    async function init(db, initialBookId = 'aesop') {
        console.log('[VocabImage] v4 초기화 — same-origin 로컬 이미지 모드');
        for (const [book, map] of Object.entries(VOCAB_IMAGES)) {
            console.log(`  ${book}: ${Object.keys(map).join(', ')}`);
        }
    }

    async function preloadBook(bookId) { /* no-op */ }

    async function getImageUrl(bookId, word) {
        return getUrl(bookId, word);
    }

    function getImageUrlSync(bookId, word) {
        return getUrl(bookId, word);
    }

    function isReady(bookId) {
        return true;  // 항상 즉시 ready
    }

    function getCacheStats() {
        const stats = {};
        for (const book of ['aesop', 'alice', 'sherlock']) {
            stats[book] = `${Object.keys(VOCAB_IMAGES[book] || {}).length}개 (로컬 same-origin)`;
        }
        return stats;
    }

    return { init, preloadBook, getImageUrl, getImageUrlSync, isReady, getCacheStats };

})();

window.VocabImageManager = VocabImageManager;
