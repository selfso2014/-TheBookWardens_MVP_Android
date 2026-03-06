/**
 * VocabImageManager.js
 * ─────────────────────────────────────────────────────────────
 * The Book Wardens — Vocabulary 이미지 관리 모듈
 * v2 (2026-03-07): Firestore 실패 시 Storage 직접 URL 구성으로 폴백
 *
 * 역할:
 *  1. Firestore vocab_images/{book_id} 문서에서 URL 맵을 1회 fetch
 *  2. 메모리 캐시에 저장 (세션 중 재사용)
 *  3. getImageUrl(bookId, word) → Firebase Storage URL 반환
 *  4. Firestore 실패 시 → Storage 직접 URL 구성 (Firestore 룰 문제 우회)
 *  5. Storage URL도 실패 시 → renderFallbackIcon (img.onerror 에서 처리)
 */

const VocabImageManager = (() => {

    // ── 설정 ──────────────────────────────────────────────────
    const COLLECTION = 'vocab_images';
    const BOOK_IDS = ['aesop', 'alice', 'sherlock'];
    const PREFETCH_DELAY = 800;

    // ── [FIX 핵심] Storage 직접 URL 구성 ─────────────────────
    // Firestore 보안 룰이 읽기를 거부해도 Storage 공개 URL은 항상 접근 가능.
    // generate_vocab_images.py가 blob.make_public() 후 업로드했으므로
    // https://storage.googleapis.com/{bucket}/vocab-images/{bookId}/{key}.jpg 패턴으로 접근 가능.
    const STORAGE_BUCKET = 'graphdebug-2c507.firebasestorage.app';
    const STORAGE_BASE = `https://storage.googleapis.com/${STORAGE_BUCKET}/vocab-images`;

    function buildDirectUrl(bookId, key) {
        return `${STORAGE_BASE}/${bookId}/${key}.jpg`;
    }

    // ── 내부 상태 ──────────────────────────────────────────────
    let _db = null;
    let _firestoreApi = null;          // dynamic import 결과 1회 캐싱
    let _firestoreOk = true;           // Firestore 접근 가능 여부 (실패 시 false로 전환)
    const _cache = {};                 // { 'aesop': { 'kindness': 'https://...' } } — null이면 미로드, {}이면 로드됐지만 비어있음
    const _loading = {};               // { 'aesop': Promise }  중복 fetch 방지

    // ── 유틸 ──────────────────────────────────────────────────
    // Python의 word_to_key()와 동일한 정규화 로직
    function wordToKey(word) {
        return (word || '')
            .toLowerCase()
            .replace(/[\s\-']/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    }

    // ── Firestore fetch ───────────────────────────────────────
    async function fetchBookUrls(bookId) {
        // [FIX] _cache[bookId]가 null이 아닌 객체면 캐시됨 (빈 객체는 Firestore 실패를 의미)
        if (_cache[bookId] !== undefined) return _cache[bookId];
        if (_loading[bookId]) return _loading[bookId];

        _loading[bookId] = (async () => {
            // [FIX] _db null 가드: Firestore 초기화 전이면 빈 객체 반환
            if (!_db) {
                console.warn(`[VocabImage] ⚠ _db is null — Firestore 미초기화. Storage 직접 URL 사용.`);
                _cache[bookId] = {};
                return _cache[bookId];
            }

            if (!_firestoreOk) {
                // 이미 Firestore 접근 실패 확인 → 즉시 빈 캐시 반환 (Storage 직접 URL로 폴백됨)
                _cache[bookId] = {};
                return _cache[bookId];
            }

            try {
                console.log(`[VocabImage] Firestore fetch 시도: ${COLLECTION}/${bookId}`);

                if (!_firestoreApi) {
                    const mod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
                    _firestoreApi = { doc: mod.doc, getDoc: mod.getDoc };
                }

                const { doc, getDoc } = _firestoreApi;
                const snapshot = await getDoc(doc(_db, COLLECTION, bookId));

                if (snapshot.exists()) {
                    _cache[bookId] = snapshot.data() || {};
                    const count = Object.keys(_cache[bookId]).length;
                    console.log(`[VocabImage] ✅ ${bookId}: Firestore에서 ${count}개 URL 로드`);
                } else {
                    console.warn(`[VocabImage] ⚠ ${bookId} Firestore 문서 없음 → Storage 직접 URL로 폴백`);
                    _cache[bookId] = {};
                }
            } catch (err) {
                // [FIX] 에러 로그를 구체적으로 출력해 Firestore 룰 문제 등 진단 가능하게 함
                const code = err?.code || err?.name || 'unknown';
                console.error(`[VocabImage] ❌ Firestore 오류 (${bookId}) [${code}]:`, err.message || err);
                if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
                    console.warn('[VocabImage] Firestore 보안 룰이 읽기를 차단하고 있습니다.');
                    console.warn('[VocabImage] Storage 직접 URL로 자동 폴백합니다. (이미지가 공개 업로드된 경우 정상 작동)');
                    _firestoreOk = false;  // 이후 모든 책은 Firestore 시도 생략
                }
                _cache[bookId] = {};
            }
            return _cache[bookId];
        })();

        return _loading[bookId];
    }

    // ── Public API ────────────────────────────────────────────

    /**
     * init(db, initialBookId)
     * Firebase Firestore 인스턴스를 등록하고 현재 북의 URL 맵을 프리로드.
     */
    async function init(db, initialBookId = 'aesop') {
        _db = db;
        console.log(`[VocabImage] init() 호출 — _db: ${db ? 'OK' : 'null'}, initialBookId: ${initialBookId}`);

        // 현재 책 즉시 로드
        await fetchBookUrls(initialBookId);

        const count = Object.keys(_cache[initialBookId] || {}).length;
        console.log(`[VocabImage] 초기화 완료 — ${initialBookId}: ${count > 0 ? count + '개 URL' : '⚠ Firestore 빈 결과 (Storage 직접 URL 폴백 활성)'}`);

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
     * getImageUrl(bookId, word) — 비동기
     * Firestore URL → 없으면 Storage 직접 URL 반환.
     * Storage URL이 실제로 존재하지 않으면 img.onerror가 renderFallbackIcon을 호출.
     */
    async function getImageUrl(bookId, word) {
        const key = wordToKey(word);
        try {
            const urlMap = await fetchBookUrls(bookId);
            if (urlMap[key] && urlMap[key].startsWith('http')) {
                return urlMap[key];
            }
        } catch (err) {
            console.warn('[VocabImage] getImageUrl fetch 실패:', err);
        }
        // [FIX] SVG 폴백 대신 Storage 직접 URL 반환 → img.onerror가 최후 보험
        const directUrl = buildDirectUrl(bookId, key);
        console.log(`[VocabImage] Storage 직접 URL 사용: ${directUrl}`);
        return directUrl;
    }

    /**
     * getImageUrlSync(bookId, word) — 동기
     * 캐시에 있으면 Firestore URL, 없으면 Storage 직접 URL 즉시 반환.
     */
    function getImageUrlSync(bookId, word) {
        const urlMap = _cache[bookId] || {};
        const key = wordToKey(word);
        if (urlMap[key] && urlMap[key].startsWith('http')) {
            return urlMap[key];
        }
        // [FIX] SVG 폴백 → Storage 직접 URL로 교체
        return buildDirectUrl(bookId, key);
    }

    /**
     * isReady(bookId)
     * [FIX] 캐시가 설정되었는지 확인 (빈 객체도 '시도 완료'로 간주).
     * 이전 버그: !!_cache[bookId]가 빈 객체{}에 대해서도 true여서 Firestore 실패를 숨겼음.
     * 수정: _cache[bookId]가 undefined가 아니면 ready (fetch 시도 완료 상태)
     */
    function isReady(bookId) {
        return _cache[bookId] !== undefined;
    }

    /**
     * getCacheStats() — 디버그용
     */
    function getCacheStats() {
        const stats = {};
        for (const id of BOOK_IDS) {
            if (_cache[id] === undefined) {
                stats[id] = '미로드';
            } else {
                const count = Object.keys(_cache[id]).length;
                stats[id] = count > 0
                    ? `${count}개 URL (Firestore)`
                    : '⚠ Firestore 빈결과 → Storage 직접 URL 폴백';
            }
        }
        return stats;
    }

    return { init, preloadBook, getImageUrl, getImageUrlSync, isReady, getCacheStats };

})();

// 전역 등록
window.VocabImageManager = VocabImageManager;
