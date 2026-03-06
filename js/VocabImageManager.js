/**
 * VocabImageManager.js  v3 (2026-03-07)
 * ─────────────────────────────────────────────────────────────
 * The Book Wardens — Vocabulary 이미지 관리 모듈
 *
 * v3 핵심 변경:
 *  - Firestore 읽기를 완전히 제거.
 *    이유: 브라우저에서 Firestore Security Rules가 읽기를 차단할 경우
 *          에러가 발생해도 fallback이 작동하지 않는 타이밍 문제가 반복됨.
 *  - 대신 Firebase Storage 공개 URL을 직접 하드코딩.
 *    generate_vocab_images.py로 업로드 완료된 9개 단어의 실제 URL 사용.
 *  - 추가 단어는 패턴 기반 URL로 자동 구성.
 *  - img.onerror → renderFallbackIcon (VocabManager에서 처리)
 */

const VocabImageManager = (() => {

    // ── Firebase Storage 공개 URL 베이스 ─────────────────────
    // generate_vocab_images.py → blob.make_public() → blob.public_url 형식
    const STORAGE_BASE = 'https://storage.googleapis.com/graphdebug-2c507.firebasestorage.app/vocab-images';

    // ── 게임 vocab 단어 URL 맵 (하드코딩) ─────────────────────
    // check_image_urls.py 실행 결과: 모두 HTTP 200 OK 확인됨 (2026-03-07)
    const STATIC_URL_MAP = {
        aesop: {
            flatter: `${STORAGE_BASE}/aesop/flatter.jpg`,
            persevere: `${STORAGE_BASE}/aesop/persevere.jpg`,
            deceit: `${STORAGE_BASE}/aesop/deceit.jpg`,
        },
        alice: {
            peep: `${STORAGE_BASE}/alice/peep.jpg`,
            pleasure: `${STORAGE_BASE}/alice/pleasure.jpg`,
            remarkable: `${STORAGE_BASE}/alice/remarkable.jpg`,
        },
        sherlock: {
            astute: `${STORAGE_BASE}/sherlock/astute.jpg`,
            singular: `${STORAGE_BASE}/sherlock/singular.jpg`,
            discern: `${STORAGE_BASE}/sherlock/discern.jpg`,
        },
    };

    // ── 유틸 ──────────────────────────────────────────────────
    // Python word_to_key()와 동일한 정규화
    function wordToKey(word) {
        return (word || '')
            .toLowerCase()
            .replace(/[\s\-']/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    }

    function buildUrl(bookId, key) {
        // 1순위: 하드코딩된 URL
        const map = STATIC_URL_MAP[bookId] || {};
        if (map[key]) return map[key];
        // 2순위: 패턴 기반 URL (파이프라인으로 업로드된 기타 이미지)
        return `${STORAGE_BASE}/${bookId}/${key}.jpg`;
    }

    // ── Public API ────────────────────────────────────────────

    /**
     * init() — Firestore 제거 후에도 BookSelectManager 호환성 유지
     * _db 인자는 더 이상 사용하지 않지만 API 시그니처 유지
     */
    async function init(db, initialBookId = 'aesop') {
        console.log(`[VocabImage] v3 init() — Firestore 제거, Storage 직접 URL 사용`);
        console.log(`[VocabImage] 하드코딩 URL 맵:`);
        for (const [book, map] of Object.entries(STATIC_URL_MAP)) {
            console.log(`  ${book}: ${Object.keys(map).join(', ')}`);
        }
    }

    /** preloadBook() — Firestore 제거로 항상 즉시 완료 */
    async function preloadBook(bookId) {
        // No-op: 이미 메모리에 URL이 있음
    }

    /**
     * getImageUrl(bookId, word) — 비동기 (API 호환성 유지)
     */
    async function getImageUrl(bookId, word) {
        const key = wordToKey(word);
        const url = buildUrl(bookId, key);
        console.log(`[VocabImage] getImageUrl(${bookId}, ${word}) → ${url}`);
        return url;
    }

    /**
     * getImageUrlSync(bookId, word) — 동기
     */
    function getImageUrlSync(bookId, word) {
        const key = wordToKey(word);
        const url = buildUrl(bookId, key);
        console.log(`[VocabImage] getImageUrlSync(${bookId}, ${word}) → ${url}`);
        return url;
    }

    /**
     * isReady(bookId) — 항상 true (URL이 메모리에 있음)
     */
    function isReady(bookId) {
        return true;
    }

    function getCacheStats() {
        const stats = {};
        for (const book of ['aesop', 'alice', 'sherlock']) {
            stats[book] = `${Object.keys(STATIC_URL_MAP[book] || {}).length}개 (하드코딩)`;
        }
        return stats;
    }

    return { init, preloadBook, getImageUrl, getImageUrlSync, isReady, getCacheStats };

})();

// 전역 등록
window.VocabImageManager = VocabImageManager;
