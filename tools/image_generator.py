# -*- coding: utf-8 -*-
"""
image_generator.py
────────────────────────────────────────────────────────────────
The Book Wardens — Vocabulary Image Generator (GPT-Image-1)

각 vocab 단어에 대해 GPT-Image-1 Medium 품질 이미지를 자동 생성.
  - 단어 유형별(구체/추상/동사/형용사) 맞춤 프롬프트 적용
  - 책별 스타일 (Aesop 우화풍 / Alice 판타지풍 / Sherlock 빅토리안풍)
  - 중단 시 재실행하면 기존 이미지 보존 (재개 가능)
  - 완료 후 vocab.image 필드 자동 업데이트
"""

import sys, io, json, os, re, time, base64
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

API_KEY = os.environ.get("OPENAI_API_KEY") or ""

OUTPUT_DIR  = os.path.join(os.path.dirname(__file__), "..", "tools", "output")
IMAGES_DIR  = os.path.join(OUTPUT_DIR, "images")
BOOK_IDS    = ["aesop", "alice", "sherlock"]
IMAGE_MODEL = "gpt-image-1"
IMAGE_SIZE  = "1024x1024"
IMAGE_QUAL  = "medium"
DELAY       = 2.0        # 초당 호출 제한 대응
MAX_RETRIES = 3

# ── 스타일 베이스 (공통) ──────────────────────────────────────────────────────

STYLE_BASE = (
    "Flat vector illustration style for an educational children's reading game. "
    "Bold clean outlines. Vibrant but not garish colors. "
    "Centered subject on a clean white background. "
    "No text, no letters, no words, no numbers, no labels anywhere in the image. "
    "Square composition, simple and immediately understandable at small sizes."
)

BOOK_STYLES = {
    "aesop": (
        "Warm fable illustration style. Expressive animal characters preferred. "
        "Earthy amber, golden, and forest-green color palette. "
        "Soft watercolor-like texture."
    ),
    "alice": (
        "Whimsical Wonderland fantasy illustration. "
        "Bright pastel colors with vivid accent tones. "
        "Playful curved shapes. Surreal but cheerful mood."
    ),
    "sherlock": (
        "Victorian detective story illustration style. "
        "Sophisticated muted tones: amber, dark navy, sepia. "
        "Gas-lamp era objects and clothing details."
    ),
}

# ── 단어별 맞춤 장면 정의 ──────────────────────────────────────────────────────
# 추상어·특수어를 명확한 시각 장면으로 변환.
# 여기 없는 단어는 definition 기반 장면으로 자동 생성됨.

WORD_SCENE = {
    # ── AESOP ──
    "kindness":      "A large lion gently freeing a tiny grateful mouse caught in a net, both smiling warmly",
    "seized":        "A large wolf claw suddenly grabbing a small lamb, motion blur on the grip, shocked expression",
    "gnawed":        "A small determined mouse sitting beside a thick rope, one section half-chewed through, focused expression",
    "extracted":     "A long-beaked crane carefully pulling a bone from a wolf's open mouth using tweezers-like beak",
    "wicked":        "A dark-cloaked fox with a curling sinister smile, hands together, surrounded by shadowy swirls",
    "idle":          "An ant lying in a hammock under the sun, hat over eyes, while other ants march past carrying food",
    "jewel":         "A bright sparkling gemstone sitting alone on a pile of dirt in a farmyard, roosters nearby",
    "heedless":      "A bird flying straight toward a net while ignoring warning signs on the path",
    "devoured":      "An animal with a wide-open mouth, food rapidly disappearing with speed lines and crumbs flying",
    "faithful":      "A loyal dog sitting steadfastly at a person's feet, looking up with devoted eyes",
    "diligent":      "A tiny ant carrying an enormous grain many times its own size with focused determination",
    "harvest":       "Baskets overflowing with fruits and grains, a cheerful farmer holding a full sheaf of wheat",
    "compatible":    "Two puzzle pieces fitting perfectly together, glowing at the connection point",
    "boasting":      "A frog puffed up to enormous size standing before smaller animals, chest out, arms spread wide",
    "counsellor":    "A wise old owl sitting in a throne-like chair, giving advice to a circle of listening animals",
    "reflection":    "A dog standing at the edge of a river, staring at its own mirrored image in the water",
    "blindness":     "A mole wearing a blindfold, arms outstretched, walking confidently in the wrong direction",
    "avarice":       "A hunched fox with gleaming eyes clutching an enormous glowing pile of gold coins, towers over him",
    "predator":      "A deer fawn nervously looking over its shoulder at a shadowy wolf shape lurking in trees",
    "burden":        "A donkey bent under the weight of an enormous pile of luggage, straining forward",
    "persuade":      "One animal gesturing expressively with open paws toward another who looks thoughtful, chin on hand",
    "ungrateful":    "A snake rearing up aggressively at the farmer who holds the warm coat that had sheltered it",
    "treacherous":   "A smiling character shaking hands in front while secretly holding a dagger behind their back",
    "cunning":       "A fox with a knowing smirk, one eye squinting cleverly, a glowing lightbulb above its head",
    "stork":         "A tall elegant white stork standing in a shallow marsh, long red beak, proud posture",
    "rumbled":       "A mountain with cracks forming at the top, small rocks tumbling, vibration lines radiating outward",
    "emerged":       "A tiny surprised mouse poking its head out of a cracked mountain cave, sunlight around it",
    "soared":        "A turtle wearing small feathered wings flying high above clouds, shocked expression on its face",
    "peril":         "A tiny figure standing at the edge of a crumbling cliff, wind blowing, storm behind",

    # ── ALICE ──
    "rabbit":        "A white rabbit in a blue waistcoat holding a golden pocket watch, looking anxiously at it",
    "curious":       "A wide-eyed girl leaning forward toward a tiny glowing door, full of wonder and excitement",
    "remarkable":    "A character pointing upward at an impossible floating island with a surprised expression",
    "pool":          "A girl swimming in a pool entirely made of blue crystalline tears, fish swimming around her",
    "caucus":        "A chaotic circle of animals running in a disorganized loop with a finish line at no clear end",
    "memory":        "An open head silhouette with tiny photographs and film strip floating inside like memories",
    "thimble":       "A small silver thimble on a fingertip, glowing slightly like a prize",
    "serpent":       "A long green snake coiled and rearing up with wide eyes, speaking to a startled bird",
    "pattern":       "A curled mouse tail forming the shape of a winding story with tiny illustrations inside",
    "gloves":        "A pair of tiny white gloves floating in mid-air, as if worn by an invisible hand",
    "enormous":      "A girl grown so huge she fills an entire room, knees against the ceiling, surprised look",
    "chimney":       "A lizard being launched upward out of a chimney like a rocket, spinning through smoke",
    "caterpillar":   "A large blue caterpillar sitting on a giant mushroom, smoking a hookah, looking regal",
    "mushroom":      "Two halves of a giant spotted mushroom, one glowing blue (grow) one glowing red (shrink)",
    "insolence":     "A rude character sticking out its tongue at a polite, shocked companion",
    "pepper":        "A huge pepper grinder spraying explosively, people nearby sneezing with watery eyes",
    "duchess":       "A stern noble woman in an elaborate ruffled gown and tall hat, arms crossed imperiously",
    "mad":           "A grinning Cheshire cat with swirling spiral eyes, floating against a surreal starry backdrop",
    "dormouse":      "A tiny round mouse asleep in a teacup, hat over its eyes, surrounded by tea and crumbs",
    "time":          "A giant ornate clock melting and stretching in impossible directions in a surreal landscape",
    "treacle":       "Three children inside a giant treacle well, golden syrup walls, drawing treacle pictures",
    "garden":        "A vibrant magical garden with roses being painted red by playing cards using brushes",
    "majesty":       "A small but fierce queen in a crown pointing regally at something off-screen",
    "queen":         "The Queen of Hearts in full regalia, red and gold, pointing with dramatic authority",
    "school":        "A school of fish in an underwater classroom, teacher fish at the board, books everywhere",
    "lobster":       "A bright red lobster in a bow tie, performing an elegant dance pose underwater",
    "crumbs":        "Tiny bread crumbs falling from a table leaving a trail, a mouse following them",
    "gryphon":       "A majestic creature with eagle's head and wings, lion's body, sitting proudly",
    "trial":         "An animal court scene with a judge in wig and gavel, packed gallery of creatures",
    "evidence":      "A magnifying glass revealing a clear footprint with a glowing arrow pointing to a suspect",
    "executed":      "A comic card soldier approaching with an axe toward an empty platform, all bystanders ducking",
    "jury-box":      "A box filled with twelve small animals seated in rows, all holding tiny notebooks",
    "meaning":       "A lightbulb inside a thought bubble, scattered shapes becoming organised and clear",

    # ── SHERLOCK ──
    "emotion":       "A face divided into four quadrants each showing a different emotion: joy, sadness, anger, surprise",
    "delicacy":      "A ballet dancer en pointe with arms raised gracefully, a butterfly landing gently on fingertip",
    "secreting":     "A character with finger pressed to lips in a shushing gesture, hiding a glowing box behind back",
    "cordially":     "Two characters shaking hands warmly with genuine smiles, one gesturing welcomingly inward",
    "billet":        "A Victorian job notice posted on a board, a suited figure looking at it with interest",
    "observation":   "A large ornate magnifying glass with a sharp detective's eye reflected clearly in the lens",
    "outre":         "A Victorian figure in wildly mismatched colours and outlandish accessories, standing proudly",
    "suggestive":    "A detective connecting two dots with an arrow on a blackboard, pointing to a logical conclusion",
    "signature":     "A fountain pen signing an elaborate cursive name on an official document, ink still wet",
    "telegram":      "An ornate envelope with a lightning bolt seal being passed urgently between two gloved hands",
    "carriage":      "A sleek Victorian horse-drawn carriage rolling on cobblestone streets, lanterns glowing",
    "sceptic":       "A character with arms crossed, one eyebrow raised skeptically, a clear question mark above head",
    "baffled":       "A detective in a cape with both hands on head, floating question marks of all sizes surrounding",
    "probability":   "Scales of justice, one side heavy and bright, the other light and shadowy, a coin mid-flip above",
    "opium":         "A dark hazy Victorian room with silhouettes slumped in chairs, lamplight barely cutting through fog",
    "eddies":        "Circular swirling water currents around a small boat, a whirlpool forming dangerously nearby",
    "divan":         "An ornate long Eastern-style couch with cushions, tassels and intricate patterns in rich colours",
    "trivial":       "A tiny pebble beside a massive boulder, a 'vs' arrow between them, the pebble labelled obviously",
    "innocent":      "A character with hands raised open and palms outward, wide honest eyes, small halo above head",
    "chagrined":     "A character looking downward with slumped shoulders and red-flushed cheeks, clearly embarrassed",
    "unusual":       "A row of identical ducks facing forward, one in the middle wearing a top hat and monocle",
    "dummy":         "A hinged tailor's dummy in a detective's cape standing in a window, obviously hollow inside",
    "hansom":        "A two-wheeled horse-drawn cab on a foggy gaslit Victorian street, driver perched up top",
    "groom":         "A Victorian man in a morning suit and top hat waiting anxiously at a church doorway",
    "dowry":         "An ornate wooden chest filled with gold coins and jewellery, sealed with a wax crest",
    "wedding-dress": "A flowing white Victorian bridal gown displayed on a mannequin, lace and pearl details",
    "eccentric":     "A Victorian character in impossibly clashing outfit, monocle, top hat with flowers, purple coat",
    "coronet":       "A delicate jewelled coronet resting on a velvet cushion under a beam of light",
    "recoiled":      "A suited Victorian figure leaning dramatically backward, arms raised, face in horror",
    "sensationalism":"An enormous newspaper with exploding dramatic graphics, tiny spark nearby showing exaggeration",
    "lunatic":       "A character spinning joyfully in circles with wild hair in a padded room, cartoonish style",
    "instinct":      "An animal sensing danger — fur raised, ears alert, eyes wide, no visible threat yet",
}


# ── 자동 장면 생성 (매핑 없는 단어) ──────────────────────────────────────────

def auto_scene(word, definition):
    """definition 기반 자동 장면 생성."""
    return (
        f"An educational illustration clearly showing the concept of '{word}', "
        f"which means '{definition}'. "
        f"Show a simple scene or object that visually represents this idea. "
        f"No text in the image."
    )

def build_prompt(word, definition, book_id):
    """완전한 이미지 생성 프롬프트 조합."""
    word_lower = word.lower().replace("-", "").replace("'", "").replace(" ", "")
    scene = WORD_SCENE.get(word_lower) or WORD_SCENE.get(word.lower()) or auto_scene(word, definition)
    style = BOOK_STYLES.get(book_id, "")
    return f"{scene}.\n\n{style}\n\n{STYLE_BASE}"


# ── API 초기화 ────────────────────────────────────────────────────────────────

def init_client():
    if not API_KEY:
        print("\n[오류] OPENAI_API_KEY 환경변수가 설정되지 않았습니다.")
        print("  PowerShell: $env:OPENAI_API_KEY = 'sk-...'")
        sys.exit(1)
    from openai import OpenAI
    return OpenAI(api_key=API_KEY)


# ── API 호출 ──────────────────────────────────────────────────────────────────

def generate_image(client, prompt, retries=MAX_RETRIES):
    for attempt in range(retries):
        try:
            response = client.images.generate(
                model=IMAGE_MODEL,
                prompt=prompt,
                size=IMAGE_SIZE,
                quality=IMAGE_QUAL,
                n=1,
            )
            # gpt-image-1 은 b64_json 반환
            b64 = response.data[0].b64_json
            return base64.b64decode(b64)

        except Exception as e:
            err = str(e)
            if "rate_limit" in err.lower() or "429" in err:
                wait = 30 * (attempt + 1)
                print(f"\n    [속도제한] {wait}초 대기 후 재시도 ({attempt+1}/{retries})...", end="")
                time.sleep(wait)
            elif "billing" in err.lower() or "quota" in err.lower():
                print(f"\n    [크레딧부족] 계정 잔액 확인 필요.")
                sys.exit(1)
            elif "content_policy" in err.lower() or "safety" in err.lower():
                print(f"\n    [콘텐츠정책] 프롬프트 거절됨 — 건너뜀")
                return None
            else:
                print(f"\n    [오류] {err[:80]}")
                time.sleep(5)
    return None


# ── 메인 처리 ─────────────────────────────────────────────────────────────────

def load_book(book_id):
    path = os.path.join(OUTPUT_DIR, f"{book_id}_game_content.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f), path

def save_book(data, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def process_book(client, book_id):
    print(f"\n{'='*60}")
    print(f"  [{book_id.upper()}] 이미지 생성 시작")
    print(f"{'='*60}")

    data, path = load_book(book_id)
    img_dir = os.path.join(IMAGES_DIR, book_id)
    os.makedirs(img_dir, exist_ok=True)

    done = skipped = failed = 0

    for ch in data["chapters"]:
        ch_num = ch["chapter_num"]
        for label in ["A", "B", "C"]:
            p = ch["passages"].get(label, {})
            vocab = p.get("vocab")
            if not vocab:
                continue

            word = vocab.get("word", "").strip()
            definition = vocab.get("definition", vocab.get("word", ""))
            if not word:
                continue

            # 파일명: word_lower (특수문자 제거)
            safe_name = re.sub(r"[^a-z0-9_]", "", word.lower().replace(" ", "_").replace("-", "_"))
            img_filename = f"{safe_name}.png"
            img_path = os.path.join(img_dir, img_filename)
            relative_path = f"./images/{book_id}/{img_filename}"

            # 이미 존재하면 건너뜀 (재개 가능)
            if os.path.exists(img_path):
                vocab["image"] = relative_path
                skipped += 1
                print(f"  Day{ch_num:02d}-{label} [{word:15s}] ✓ 건너뜀 (이미 존재)")
                continue

            print(f"  Day{ch_num:02d}-{label} [{word:15s}] 생성 중...", end=" ", flush=True)

            prompt = build_prompt(word, definition, book_id)
            img_bytes = generate_image(client, prompt)

            if img_bytes:
                with open(img_path, "wb") as f:
                    f.write(img_bytes)
                vocab["image"] = relative_path
                done += 1
                print(f"✓ 완료 ({len(img_bytes)//1024}KB)")
            else:
                failed += 1
                print("✗ 실패")

            # JSON 즉시 저장
            save_book(data, path)
            time.sleep(DELAY)

    status = "✅" if failed == 0 else "⚠"
    print(f"\n  {status} [{book_id.upper()}] 완료: "
          f"생성 {done}개 | 건너뜀 {skipped}개 | 실패 {failed}개")
    print(f"  이미지 저장: {img_dir}")


def main():
    print("\n" + "="*60)
    print("  The Book Wardens - Vocabulary Image Generator")
    print("  GPT-Image-1 Medium (1024×1024)")
    print("="*60)

    client = init_client()
    total_words = 99
    est_cost = total_words * 0.042
    print(f"  대상: {total_words}개 단어 (3권)")
    print(f"  예상 비용: ${est_cost:.2f} (GPT-Image-1 Medium 기준)")
    print(f"  이미지 저장 경로: tools/output/images/<book_id>/")
    print(f"  이미 생성된 이미지는 건너뜁니다 (재개 가능)\n")

    os.makedirs(IMAGES_DIR, exist_ok=True)

    for book_id in BOOK_IDS:
        process_book(client, book_id)

    print(f"\n{'='*60}")
    print("  전체 이미지 생성 완료!")
    print(f"  결과: tools/output/images/")
    print(f"  각 JSON의 vocab.image 필드가 업데이트됨")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
