# -*- coding: utf-8 -*-
"""
download_vocab_images.py — Firebase Storage에서 게임 vocab 이미지 다운로드
GitHub Pages에서 직접 제공하기 위해 로컬 경로에 저장합니다.
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import firebase_admin
from firebase_admin import credentials, storage

SERVICE_ACCOUNT  = "tools/serviceAccountKey.json"
STORAGE_BUCKET   = "graphdebug-2c507.firebasestorage.app"
STORAGE_BASE     = "vocab-images"
OUTPUT_DIR       = "images/vocab"   # 리포지토리 루트 기준 (GitHub Pages에서 직접 서빙)

# 게임에서 실제 사용하는 9개 단어
GAME_VOCAB = {
    "aesop":   ["flatter", "persevere", "deceit"],
    "alice":   ["peep", "pleasure", "remarkable"],
    "sherlock":["astute", "singular", "discern"],
}

def main():
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT)
        firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})

    bucket = storage.bucket()

    print("=== vocab 이미지 다운로드 → GitHub Pages 로컬 경로 ===\n")

    for book_id, words in GAME_VOCAB.items():
        dest_dir = os.path.join(OUTPUT_DIR, book_id)
        os.makedirs(dest_dir, exist_ok=True)

        for key in words:
            storage_path = f"{STORAGE_BASE}/{book_id}/{key}.jpg"
            local_path   = os.path.join(dest_dir, f"{key}.jpg")

            try:
                blob = bucket.blob(storage_path)
                blob.download_to_filename(local_path)
                size = os.path.getsize(local_path)
                print(f"  ✓  [{book_id}] {key}.jpg  ({size//1024}KB)  →  {local_path}")
            except Exception as e:
                print(f"  ✗  [{book_id}] {key}.jpg  ERROR: {e}")

    print(f"\n완료: {OUTPUT_DIR}/ 에 저장됨")
    print("이제 git add images/ && git commit && git push 하면 됩니다.")

if __name__ == "__main__":
    main()
