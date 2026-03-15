# -*- coding: utf-8 -*-
"""
compress_images.py
─────────────────────────────────────────────────────────────
The Book Wardens — 이미지 압축 스크립트

PNG (~1.5MB) → JPEG (~120-150KB) 변환
Firebase Storage 재업로드 포함

실행:
  python tools/compress_images.py
"""
import os, sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    from PIL import Image
except ImportError:
    print("[오류] Pillow 설치 필요: python -m pip install Pillow")
    sys.exit(1)

# ── 설정 ──────────────────────────────────────────────────────
IMAGES_DIR    = os.path.join(os.path.dirname(__file__), "..", "tools", "output", "images")
BOOK_IDS      = ["aesop", "alice", "sherlock"]
TARGET_SIZE   = (512, 512)   # 이미지 크기 (픽셀)
JPEG_QUALITY  = 82           # JPEG 품질 (75~85 권장, 높을수록 용량 증가)
TARGET_KB     = 180          # 목표 용량 (KB). 초과 시 품질 자동 낮춤
MIN_QUALITY   = 60           # 최소 품질 한도

SERVICE_ACCOUNT_KEY = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
STORAGE_BUCKET      = "graphdebug-2c507.firebasestorage.app"
STORAGE_BASE_PATH   = "vocab-images"
COLLECTION_NAME     = "vocab_images"
DELAY               = 0.2    # 업로드 간 딜레이(초)

def compress_image(src_path, quality=JPEG_QUALITY):
    """PNG → JPEG 변환 + 리사이즈. bytes 반환."""
    with Image.open(src_path) as img:
        # RGBA → RGB 변환 (JPEG는 알파채널 불가)
        if img.mode in ("RGBA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # 리사이즈 (비율 유지)
        img.thumbnail(TARGET_SIZE, Image.LANCZOS)

        # JPEG로 인메모리 압축
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        return buf.getvalue()


def auto_compress(src_path):
    """목표 용량 이하가 될 때까지 품질을 낮춰가며 압축."""
    quality = JPEG_QUALITY
    while quality >= MIN_QUALITY:
        data = compress_image(src_path, quality)
        if len(data) <= TARGET_KB * 1024:
            return data, quality
        quality -= 5
    return compress_image(src_path, MIN_QUALITY), MIN_QUALITY


def init_firebase():
    import firebase_admin
    from firebase_admin import credentials, storage, firestore
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
        firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
    return storage.bucket(), firestore.client()


def word_to_key(word):
    import re
    return re.sub(r"[^a-z0-9_]", "", word.lower().replace(" ", "_").replace("-", "_"))


def main():
    print("\n" + "="*55)
    print("  The Book Wardens - Image Compressor & Re-Uploader")
    print("="*55)

    bucket, db = init_firebase()

    total_orig = total_comp = 0
    img_count = 0

    for book_id in BOOK_IDS:
        print(f"\n[{book_id.upper()}] 압축 + 재업로드 시작")
        img_dir = os.path.join(IMAGES_DIR, book_id)
        url_map = {}

        doc_ref  = db.collection(COLLECTION_NAME).document(book_id)
        doc_snap = doc_ref.get()
        if doc_snap.exists:
            url_map = doc_snap.to_dict() or {}

        # [FIX] default.png 는 book 전용 이미지가 아니므로 제외
        png_files = [f for f in os.listdir(img_dir)
                     if f.endswith(".png") and f != "default.png"]

        for fname in sorted(png_files):
            src = os.path.join(img_dir, fname)
            # [FIX] word_to_key()와 동일 로직: 파일명은 이미 소문자+언더스코어 형식이므로
            # 확장자 제거 후 정규화 적용 → Firestore 키와 100% 일치 보장
            raw_key = fname[:-4]
            key = re.sub(r"[^a-z0-9_]", "", raw_key.lower())
            orig_kb = os.path.getsize(src) // 1024

            # 압축
            data, quality = auto_compress(src)
            comp_kb = len(data) // 1024
            ratio = int((1 - len(data)/os.path.getsize(src)) * 100)

            # Firebase Storage 업로드 (JPEG로 교체)
            storage_path = f"{STORAGE_BASE_PATH}/{book_id}/{key}.jpg"
            blob = bucket.blob(storage_path)
            blob.upload_from_string(data, content_type="image/jpeg")
            blob.make_public()
            url = blob.public_url

            url_map[key] = url
            total_orig += os.path.getsize(src)
            total_comp += len(data)
            img_count  += 1

            print(f"  {key:20s}  {orig_kb:>5}KB → {comp_kb:>4}KB  (-{ratio}%)  Q{quality}")
            time.sleep(DELAY)

        # [FIX] merge=True: 기존 Firestore 키(_default 등)를 보존하면서 .jpg URL 갱신
        doc_ref.set(url_map, merge=True)
        print(f"  → Firestore 업데이트 완료: {len(url_map)}개 키")

    print(f"\n{'='*55}")
    print(f"  압축 완료: {img_count}개")
    print(f"  원본 합계: {total_orig//1024//1024}MB")
    print(f"  압축 후:   {total_comp//1024//1024}MB  ({int((1-total_comp/total_orig)*100)}% 절감)")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    main()
