# -*- coding: utf-8 -*-
"""
generate_vocab_images.py
────────────────────────────────────────────────────────────────
The Book Wardens — Vocab 이미지 통합 생성·업로드 스크립트

[버그 수정 배경]
  - AesopContent.js / SherlockContent.js / QuizData.js(Alice)에 실제 사용되는
    vocab 단어(Flatter·Persevere·Deceit / Peep·Remarkable / Astute·Singular·Discern)에
    해당하는 이미지 파일이 Firebase Storage에 존재하지 않았음.
  - image_generator.py는 *_game_content.json 의 단어를 대상으로 동작하므로
    AesopContent.js에서 직접 정의한 단어와 연결이 없었음.

[이 스크립트가 하는 일]
  1. 각 책의 JS 콘텐츠 파일에서 실제 game vocab 단어 목록을 직접 파싱
  2. GPT-Image-1로 이미지 생성 → tools/output/images/<book_id>/<key>.jpg 저장
  3. Firebase Storage에 <key>.jpg 업로드 (공개 URL 취득)
  4. Firestore vocab_images/<book_id> 문서에 { key: url } 저장
  5. 이미 Firebase URL이 존재하는 항목은 건너뜀 (재개 가능)

실행:
  $env:OPENAI_API_KEY = 'sk-...'
  python tools/generate_vocab_images.py
"""

import sys, io, os, re, time, base64, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── 설정 ──────────────────────────────────────────────────────────────────────

API_KEY             = os.environ.get("OPENAI_API_KEY", "")
SERVICE_ACCOUNT_KEY = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
STORAGE_BUCKET      = "graphdebug-2c507.firebasestorage.app"
STORAGE_BASE_PATH   = "vocab-images"
COLLECTION_NAME     = "vocab_images"
IMAGES_DIR          = os.path.join(os.path.dirname(__file__), "output", "images")

IMAGE_MODEL = "gpt-image-1"
IMAGE_SIZE  = "1024x1024"
IMAGE_QUAL  = "medium"
DELAY       = 2.5          # API 속도 제한 대응
MAX_RETRIES = 3
JPEG_QUALITY = 82
TARGET_KB    = 200

# ── 실제 게임에서 사용하는 Vocab 단어 목록 ──────────────────────────────────
# AesopContent.js / QuizData.js / SherlockContent.js 에서 직접 파싱하지 않고
# 여기에 명시적으로 정의. JS 콘텐츠 파일 변경 시 여기도 함께 수정할 것.

GAME_VOCAB = {
    "aesop": [
        {
            "word": "Flatter",
            "definition": "To praise someone excessively and insincerely in order to gain their favour",
            "sentence": "The Fox began to flatter the Crow, praising her beauty to steal the cheese."
        },
        {
            "word": "Persevere",
            "definition": "To continue steadily despite difficulty or delay in achieving success",
            "sentence": "The Tortoise chose to persevere, one steady step at a time, never stopping to rest."
        },
        {
            "word": "Deceit",
            "definition": "The act of causing someone to believe something false; dishonesty",
            "sentence": "The boy laughed at his own deceit, never imagining the real danger that lay ahead."
        },
    ],
    "alice": [
        {
            "word": "Peep",
            "definition": "To look quickly and secretly at something, often through a small opening",
            "sentence": "Once or twice she had peeped into the book her sister was reading, but it had no pictures."
        },
        {
            "word": "Pleasure",
            "definition": "A feeling of happiness, enjoyment, or satisfaction",
            "sentence": "She wondered whether the pleasure of making a daisy-chain would be worth the trouble."
        },
        {
            "word": "Remarkable",
            "definition": "Worthy of attention; unusual or impressive in some way",
            "sentence": "There was nothing so VERY remarkable in that; nor did Alice think it so very much out of the way."
        },
    ],
    "sherlock": [
        {
            "word": "Astute",
            "definition": "Able to accurately assess situations or people and turn this to one's advantage; shrewd",
            "sentence": "Holmes was astute enough to notice the mud on Watson's boot and name the exact street."
        },
        {
            "word": "Singular",
            "definition": "Remarkably strange or unusual; extraordinary",
            "sentence": "It is a most singular case, said Holmes. I have never encountered its like before."
        },
        {
            "word": "Discern",
            "definition": "To perceive or recognise something clearly; to detect with the senses or mind",
            "sentence": "A man of your experience can surely discern the truth without my spelling it all out."
        },
    ],
}

# ── 단어별 맞춤 장면 정의 (추상어를 명확한 시각 장면으로 변환) ───────────────

WORD_SCENE = {
    # AESOP
    "flatter":    "A sly fox standing below a tree, looking up with an exaggerated flattering smile at a crow sitting in the branches holding a piece of cheese; the fox's tail is raised and it gestures graciously with one paw",
    "persevere":  "A determined tortoise walking steadily along a path with a small backpack, never stopping, while a sleeping hare is visible far behind under a tree; sunlight ahead suggests the finish line",
    "deceit":     "A mischievous boy in a field pretending to shout in alarm at imaginary wolves, laughing to himself, while real villagers rush toward him from a distance with worried expressions",

    # ALICE
    "peep":       "A curious young girl with wide eyes peeking around the edge of a large door that is slightly ajar; light spills through the gap, showing a magical world beyond",
    "pleasure":   "A happy girl sitting on a sunny riverbank weaving a long chain of daisies, eyes closed and smiling contentedly, butterflies around her",
    "remarkable": "A startled girl pointing with open mouth at a white rabbit in a waistcoat nervously checking a golden pocket watch as it hurries past; a bright glow surrounds the unusual scene",

    # SHERLOCK
    "astute":     "A Victorian detective in a deerstalker cap and magnifying glass crouching to examine a single footprint, one eyebrow sharply raised in an expression of precise, brilliant deduction",
    "singular":   "A detective presenting an unusual object — a strange glowing letter with no signature — to a puzzled companion, both in Victorian dress; question marks float around the mysterious item",
    "discern":    "A Victorian detective looking intently through an elegant magnifying glass at a document; details of the clue are sharply revealed in the lens while the background remains blurry",
}

STYLE_BASE = (
    "Flat vector illustration style for an educational children's reading game. "
    "Bold clean outlines. Vibrant but not garish colors. "
    "Centered subject on a plain white background. "
    "No text, no letters, no words, no numbers, no labels anywhere in the image. "
    "Square composition, simple and immediately understandable at small sizes."
)

BOOK_STYLES = {
    "aesop":   "Warm fable illustration. Expressive animal characters. Earthy amber, golden and forest-green palette. Soft watercolor-like texture.",
    "alice":   "Whimsical Wonderland fantasy illustration. Bright pastel colors with vivid accents. Playful curved shapes. Surreal but cheerful mood.",
    "sherlock":"Victorian detective story illustration. Sophisticated muted tones: amber, dark navy, sepia. Gas-lamp era details.",
}


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def word_to_key(word):
    """단어를 Firestore 필드 키로 변환.  upload_to_firebase.py 와 동일 로직."""
    return re.sub(r"[^a-z0-9_]", "", word.lower().replace(" ", "_").replace("-", "_"))


def build_prompt(word, definition, book_id):
    key = word_to_key(word)
    scene = WORD_SCENE.get(key) or (
        f"An educational illustration clearly showing the concept of '{word}', "
        f"which means '{definition}'. Show a simple scene or object that visually "
        f"represents this idea. No text."
    )
    style = BOOK_STYLES.get(book_id, "")
    return f"{scene}.\n\n{style}\n\n{STYLE_BASE}"


def compress_to_jpeg(png_bytes, quality=JPEG_QUALITY):
    """PNG bytes → JPEG bytes (Pillow)."""
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(png_bytes))
        if img.mode in ("RGBA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((512, 512), Image.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        return buf.getvalue()
    except ImportError:
        print("  [경고] Pillow 미설치 → PNG 원본 사용 (pip install Pillow 권장)")
        return png_bytes


# ── OpenAI 이미지 생성 ────────────────────────────────────────────────────────

def init_openai():
    if not API_KEY:
        print("\n[오류] OPENAI_API_KEY 환경변수 미설정")
        print("  PowerShell: $env:OPENAI_API_KEY = 'sk-...'")
        sys.exit(1)
    from openai import OpenAI
    return OpenAI(api_key=API_KEY)


def generate_image_bytes(client, prompt):
    for attempt in range(MAX_RETRIES):
        try:
            response = client.images.generate(
                model=IMAGE_MODEL,
                prompt=prompt,
                size=IMAGE_SIZE,
                quality=IMAGE_QUAL,
                n=1,
            )
            b64 = response.data[0].b64_json
            return base64.b64decode(b64)
        except Exception as e:
            err = str(e)
            if "rate_limit" in err.lower() or "429" in err:
                wait = 30 * (attempt + 1)
                print(f"\n    [속도제한] {wait}s 대기 후 재시도 ({attempt+1}/{MAX_RETRIES})...", end="")
                time.sleep(wait)
            elif "billing" in err.lower() or "quota" in err.lower():
                print("\n    [크레딧부족] OpenAI 계정 잔액 확인 필요.")
                sys.exit(1)
            elif "content_policy" in err.lower() or "safety" in err.lower():
                print("\n    [콘텐츠정책] 프롬프트 거절 → 건너뜀")
                return None
            else:
                print(f"\n    [오류] {err[:80]}", end="")
                time.sleep(5)
    return None


# ── Firebase 초기화 ───────────────────────────────────────────────────────────

def init_firebase():
    if not os.path.exists(SERVICE_ACCOUNT_KEY):
        print(f"\n[오류] 서비스 계정 키 파일 없음: {SERVICE_ACCOUNT_KEY}")
        print("  Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성")
        sys.exit(1)
    import firebase_admin
    from firebase_admin import credentials, storage, firestore
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
        firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
    return storage.bucket(), firestore.client()


# ── 메인 처리 ─────────────────────────────────────────────────────────────────

def process_book(client, bucket, db, book_id, vocab_list):
    print(f"\n{'='*60}")
    print(f"  [{book_id.upper()}] 처리 시작 ({len(vocab_list)}개 단어)")
    print(f"{'='*60}")

    img_dir = os.path.join(IMAGES_DIR, book_id)
    os.makedirs(img_dir, exist_ok=True)

    # Firestore 기존 URL 맵 로드
    doc_ref  = db.collection(COLLECTION_NAME).document(book_id)
    doc_snap = doc_ref.get()
    url_map  = doc_snap.to_dict() or {} if doc_snap.exists else {}
    print(f"  Firestore 기존 키 수: {len(url_map)}개")

    done = skipped = failed = 0

    for item in vocab_list:
        word       = item["word"]
        definition = item["definition"]
        key        = word_to_key(word)
        jpg_path   = os.path.join(img_dir, f"{key}.jpg")
        storage_path = f"{STORAGE_BASE_PATH}/{book_id}/{key}.jpg"

        # ① 이미 Firebase URL이 있으면 건너뜀
        if key in url_map and url_map[key].startswith("http"):
            print(f"  [{word:15s}] ✓ 이미 Firebase에 존재 → 건너뜀")
            skipped += 1
            continue

        # ② 로컬 JPEG 파일이 있으면 재업로드만
        if os.path.exists(jpg_path):
            print(f"  [{word:15s}] 로컬 파일 있음 → Firebase 재업로드...", end=" ", flush=True)
            with open(jpg_path, "rb") as f:
                jpg_bytes = f.read()
        else:
            # ③ 이미지 생성
            print(f"  [{word:15s}] 이미지 생성 중...", end=" ", flush=True)
            prompt    = build_prompt(word, definition, book_id)
            png_bytes = generate_image_bytes(client, prompt)
            if not png_bytes:
                print("✗ 생성 실패")
                failed += 1
                continue

            jpg_bytes = compress_to_jpeg(png_bytes)
            with open(jpg_path, "wb") as f:
                f.write(jpg_bytes)
            print(f"생성 완료 ({len(jpg_bytes)//1024}KB) → 업로드...", end=" ", flush=True)

        # ④ Firebase Storage 업로드
        try:
            blob = bucket.blob(storage_path)
            blob.upload_from_string(jpg_bytes, content_type="image/jpeg")
            blob.make_public()
            url = blob.public_url
            url_map[key] = url
            done += 1
            print(f"✓  ({len(jpg_bytes)//1024}KB)")
        except Exception as e:
            print(f"✗ 업로드 실패: {str(e)[:60]}")
            failed += 1

        time.sleep(DELAY)

    # ⑤ Firestore 저장
    doc_ref.set(url_map, merge=True)
    print(f"\n  Firestore 저장 완료: {COLLECTION_NAME}/{book_id} ({len(url_map)}개 키)")
    print(f"  ✅ [{book_id.upper()}] 생성 {done}개 | 건너뜀 {skipped}개 | 실패 {failed}개")
    return done, skipped, failed


def main():
    print("\n" + "="*60)
    print("  The Book Wardens — Vocab Image Generator (Game Words)")
    print("  대상: 실제 게임에서 사용하는 9개 단어")
    print("="*60)

    # 의존성 검사
    try:
        import firebase_admin
    except ImportError:
        print("[필요] pip install firebase-admin")
        sys.exit(1)

    client         = init_openai()
    bucket, db     = init_firebase()

    total_done = total_skipped = total_failed = 0

    for book_id, vocab_list in GAME_VOCAB.items():
        d, s, f = process_book(client, bucket, db, book_id, vocab_list)
        total_done    += d
        total_skipped += s
        total_failed  += f

    print(f"\n{'='*60}")
    print(f"  전체 완료: 생성 {total_done}개 | 건너뜀 {total_skipped}개 | 실패 {total_failed}개")
    print(f"  Firestore 컬렉션: {COLLECTION_NAME}/")
    print(f"  Storage 경로: {STORAGE_BASE_PATH}/")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
