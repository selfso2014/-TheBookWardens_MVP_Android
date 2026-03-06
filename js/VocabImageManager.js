/**
 * VocabImageManager.js
 * ─────────────────────────────────────────────────────────────
 * The Book Wardens — Vocabulary 이미지 관리 모듈
 *
 * 역할:
 *  1. Firestore vocab_images/{book_id} 문서에서 URL 맵을 1회 fetch
 *  2. 메모리 캐시에 저장 (세션 중 재사용)
 *  3. getImageUrl(bookId, word) → Firebase Storage URL 반환
 *  4. 이미지 없는 경우 → default URL 또는 인라인 SVG fallback
 *
 * 사용법:
 *  await VocabImageManager.init(db);   // Firebase db 인스턴스 전달
 *  const url = await VocabImageManager.getImageUrl('alice', 'Rabbit');
 */

const VocabImageManager = (() => {

    // ── 설정 ──────────────────────────────────────────────────
    const COLLECTION = 'vocab_images';
    const BOOK_IDS = ['aesop', 'alice', 'sherlock'];
    const PREFETCH_DELAY = 1000;   // 첫 챕터 로드 후 다음 책 프리패치 지연(ms)

    // ── 인라인 SVG 폴백 (Firestore 자체 실패 시 최후 보험) ──────
    const FALLBACK_SVG = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' \
viewBox='0 0 160 160'><rect width='160' height='160' rx='12' fill='%231a1d27'/>\
<text x='80' y='100' font-size='64' text-anchor='middle'>📖</text></svg>`;

    // ── 내부 상태 ──────────────────────────────────────────────
    let _db = null;
    let _defaultUrl = FALLBACK_SVG;   // Storage의 default.png URL (init 시 로드)
    const _cache = {};             // { 'aesop': { 'kindness': 'https://...' } }
    const _loading = {};             // { 'aesop': Promise }  중복 fetch 방지

    // ── 유틸 ──────────────────────────────────────────────────
    function wordToKey(word) {
        return (word || '')
            .toLowerCase()
            .replace(/[\s\-']/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    }

    // ── Firestore fetch ───────────────────────────────────────
    async function fetchBookUrls(bookId) {
        if (_cache[bookId]) return _cache[bookId];      // 이미 캐시됨
        if (_loading[bookId]) return _loading[bookId];  // 이미 로딩 중

        _loading[bookId] = (async () => {
            try {
                console.log(`[VocabImage] Firestore fetch: ${COLLECTION}/${bookId}`);
                const { getFirestore, doc, getDoc } = await import(
                    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
                );
                const snapshot = await getDoc(doc(_db, COLLECTION, bookId));

                if (snapshot.exists()) {
                    _cache[bookId] = snapshot.data() || {};
                    // _default URL 갱신
                    if (_cache[bookId]['_default']) {
                        _defaultUrl = _cache[bookId]['_default'];
                    }
                    console.log(`[VocabImage] ${bookId}: ${Object.keys(_cache[bookId]).length}개 URL 로드 완료`);
                } else {
                    console.warn(`[VocabImage] ${bookId} 문서 없음 → 폴백 사용`);
                    _cache[bookId] = {};
                }
            } catch (err) {
                console.error(`[VocabImage] Firestore 오류 (${bookId}):`, err);
                _cache[bookId] = {};
            }
            return _cache[bookId];
        })();

        return _loading[bookId];
    }

    // ── Public API ────────────────────────────────────────────

    /**
     * init(db)
     * Firebase Firestore 인스턴스를 등록하고 현재 북의 URL 맵을 프리로드.
     * @param {object} db - Firestore db 인스턴스
     * @param {string} [initialBookId] - 즉시 프리패치할 첫 번째 책 ID
     */
    async function init(db, initialBookId = 'aesop') {
        _db = db;
        // 현재 책 즉시 로드
        await fetchBookUrls(initialBookId);
        // 나머지 책은 백그라운드에서 지연 프리패치
        setTimeout(() => {
            BOOK_IDS.filter(id => id !== initialBookId)
                .forEach(id => fetchBookUrls(id));
        }, PREFETCH_DELAY);
    }

    /**
     * preloadBook(bookId)
     * 특정 책의 URL 맵을 미리 로드. 책 전환 직전에 호출 권장.
     */
    async function preloadBook(bookId) {
        await fetchBookUrls(bookId);
    }

    /**
     * getImageUrl(bookId, word)
     * 단어에 해당하는 Firebase Storage URL을 반환.
     * 없으면 default URL 반환.
     * @returns {string} 이미지 URL
     */
    async function getImageUrl(bookId, word) {
        const urlMap = await fetchBookUrls(bookId);
        const key = wordToKey(word);
        return urlMap[key] || _defaultUrl;
    }

    /**
     * getImageUrlSync(bookId, word)
     * 동기 버전 — 캐시에 있는 경우만 즉시 반환 (없으면 default).
     * 이미 preload된 책에만 유효.
     */
    function getImageUrlSync(bookId, word) {
        const urlMap = _cache[bookId] || {};
        const key = wordToKey(word);
        return urlMap[key] || _defaultUrl;
    }

    /**
     * isReady(bookId)
     * 캐시 로드 여부 확인.
     */
    function isReady(bookId) {
        return !!_cache[bookId];
    }

    /**
     * getCacheStats()
     * 디버그용 캐시 상태 반환.
     */
    function getCacheStats() {
        const stats = {};
        for (const id of BOOK_IDS) {
            stats[id] = _cache[id]
                ? `${Object.keys(_cache[id]).length}개 로드됨`
                : '미로드';
        }
        return stats;
    }

    return { init, preloadBook, getImageUrl, getImageUrlSync, isReady, getCacheStats };

})();

// 전역 등록
window.VocabImageManager = VocabImageManager;
