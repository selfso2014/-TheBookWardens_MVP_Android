# -*- coding: utf-8 -*-
"""
upload_to_firebase.py
────────────────────────────────────────────────────────────────
The Book Wardens — Firebase 이미지 업로더

1. tools/output/images/ 의 PNG를 Firebase Storage에 업로드
2. 공개 다운로드 URL을 Firestore vocab_images 컬렉션에 저장
3. *_game_content.json 의 vocab.image 필드를 FB URL로 업데이트

사전 준비:
  pip install firebase-admin
  Firebase 콘솔 → 서비스 계정 → 새 비공개 키 생성 → serviceAccountKey.json 저장

실행:
  python tools/upload_to_firebase.py
"""

import sys, io, json, os, re, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── 설정 ──────────────────────────────────────────────────────────────────────

SERVICE_ACCOUNT_KEY = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
STORAGE_BUCKET      = "graphdebug-2c507.firebasestorage.app"
OUTPUT_DIR          = os.path.join(os.path.dirname(__file__), "..", "tools", "output")
IMAGES_DIR          = os.path.join(OUTPUT_DIR, "images")
BOOK_IDS            = ["aesop", "alice", "sherlock"]
COLLECTION_NAME     = "vocab_images"
STORAGE_BASE_PATH   = "vocab-images"
DELAY               = 0.3   # 업로드 간 딜레이(초)

# ── Firebase 초기화 ────────────────────────────────────────────────────────────

def init_firebase():
    if not os.path.exists(SERVICE_ACCOUNT_KEY):
        print(f"\n[오류] 서비스 계정 키 파일이 없습니다: {SERVICE_ACCOUNT_KEY}")
        print("  Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성")
        print("  저장 경로: tools/serviceAccountKey.json")
        sys.exit(1)

    import firebase_admin
    from firebase_admin import credentials, storage, firestore

    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
        firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})

    bucket = storage.bucket()
    db     = firestore.client()
    print(f"  Firebase 초기화 완료 (bucket: {STORAGE_BUCKET})")
    return bucket, db


# ── 이미지 업로드 ──────────────────────────────────────────────────────────────

def upload_image(bucket, local_path, storage_path):
    """
    로컬 PNG → Firebase Storage 업로드 → 공개 URL 반환.
    이미 존재하는 파일은 덮어씀.
    """
    blob = bucket.blob(storage_path)
    blob.upload_from_filename(local_path, content_type="image/png")
    blob.make_public()       # 공개 읽기 설정
    return blob.public_url  # https://storage.googleapis.com/... 형식


def word_to_key(word):
    """단어를 Firestore 필드 키로 변환 (소문자, 특수문자 제거)."""
    return re.sub(r"[^a-z0-9_]", "", word.lower().replace(" ", "_").replace("-", "_"))


# ── 메인 처리 ─────────────────────────────────────────────────────────────────

def process_book(bucket, db, book_id):
    print(f"\n{'='*55}")
    print(f"  [{book_id.upper()}] 업로드 시작")
    print(f"{'='*55}")

    img_dir    = os.path.join(IMAGES_DIR, book_id)
    json_path  = os.path.join(OUTPUT_DIR, f"{book_id}_game_content.json")
    url_map    = {}   # { "kindness": "https://..." }

    # ① 기존 Firestore 데이터 로드 (재개 가능)
    doc_ref    = db.collection(COLLECTION_NAME).document(book_id)
    doc_snap   = doc_ref.get()
    if doc_snap.exists:
        url_map = doc_snap.to_dict() or {}
        print(f"  기존 Firestore 데이터 로드: {len(url_map)}개 키")

    # ② JSON 로드
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    uploaded = skipped = failed = 0

    # ③ 각 vocab 이미지 업로드
    for ch in data["chapters"]:
        ch_num = ch["chapter_num"]
        for label in ["A", "B", "C"]:
            p     = ch["passages"].get(label, {})
            vocab = p.get("vocab")
            if not vocab:
                continue

            word     = vocab.get("word", "").strip()
            if not word:
                continue

            key      = word_to_key(word)
            img_name = f"{key}.png"
            local_path   = os.path.join(img_dir, img_name)
            storage_path = f"{STORAGE_BASE_PATH}/{book_id}/{img_name}"

            # 이미 업로드된 항목 건너뜀
            if key in url_map and url_map[key].startswith("http"):
                vocab["image"] = url_map[key]
                skipped += 1
                print(f"  Day{ch_num:02d}-{label} [{word:15s}] ✓ 건너뜀 (이미 존재)")
                continue

            if not os.path.exists(local_path):
                # 로컬 이미지 없으면 default 사용
                print(f"  Day{ch_num:02d}-{label} [{word:15s}] ⚠ 로컬 이미지 없음 → default 사용")
                vocab["image"] = url_map.get("_default", "")
                continue

            print(f"  Day{ch_num:02d}-{label} [{word:15s}] 업로드 중...", end=" ", flush=True)
            try:
                url = upload_image(bucket, local_path, storage_path)
                url_map[key]  = url
                vocab["image"] = url
                uploaded += 1
                print(f"✓  ({os.path.getsize(local_path)//1024}KB)")
            except Exception as e:
                failed += 1
                print(f"✗ 실패: {str(e)[:60]}")

            # Firestore 중간 저장 (10개마다)
            if (uploaded + failed) % 10 == 0:
                doc_ref.set(url_map, merge=True)
                print(f"  ... Firestore 중간 저장 ({uploaded}개 완료)")

            time.sleep(DELAY)

    # ④ default 이미지 업로드
    default_local = os.path.join(IMAGES_DIR, "default.png")
    if os.path.exists(default_local) and "_default" not in url_map:
        print(f"\n  [default.png] 업로드 중...", end=" ")
        try:
            url = upload_image(bucket, default_local, f"{STORAGE_BASE_PATH}/default.png")
            url_map["_default"] = url
            print(f"✓")
        except Exception as e:
            print(f"✗ {e}")

    # ⑤ Firestore 최종 저장
    doc_ref.set(url_map)
    print(f"\n  Firestore 저장 완료: vocab_images/{book_id} ({len(url_map)}개 키)")

    # ⑥ JSON 업데이트
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  JSON 업데이트: {os.path.basename(json_path)}")
    print(f"\n  ✅ [{book_id.upper()}] 완료: 업로드 {uploaded}개 | 건너뜀 {skipped}개 | 실패 {failed}개")


def main():
    print("\n" + "="*55)
    print("  The Book Wardens - Firebase Image Uploader")
    print("="*55)

    # firebase-admin 설치 확인
    try:
        import firebase_admin
    except ImportError:
        print("\n[필요] firebase-admin 설치:")
        print("  pip install firebase-admin")
        sys.exit(1)

    bucket, db = init_firebase()

    # default 이미지 먼저 업로드 (전체 공통)
    default_local = os.path.join(IMAGES_DIR, "default.png")
    default_doc_ref = db.collection(COLLECTION_NAME).document("_meta")
    meta_snap = default_doc_ref.get()
    default_url = ""
    if meta_snap.exists and "_default" in (meta_snap.to_dict() or {}):
        default_url = meta_snap.to_dict()["_default"]
        print(f"  default.png 기존 URL: {default_url[:60]}...")
    elif os.path.exists(default_local):
        print(f"  default.png 업로드 중...", end=" ", flush=True)
        try:
            default_url = upload_image(bucket, default_local, f"{STORAGE_BASE_PATH}/default.png")
            default_doc_ref.set({"_default": default_url})
            print("✓")
        except Exception as e:
            print(f"✗ {e}")

    for book_id in BOOK_IDS:
        process_book(bucket, db, book_id)

    print(f"\n{'='*55}")
    print("  Firebase 업로드 전체 완료!")
    print(f"  Storage 경로: {STORAGE_BASE_PATH}/")
    print(f"  Firestore 컬렉션: {COLLECTION_NAME}/")
    print("="*55 + "\n")


if __name__ == "__main__":
    main()
