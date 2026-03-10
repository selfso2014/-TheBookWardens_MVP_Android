# -*- coding: utf-8 -*-
"""
quiz_generator.py
────────────────────────────────────────────────────────────────
The Book Wardens — AI Quiz & Vocab Generator (OpenAI ChatGPT)

각 발췌 지문(A·B·C)에 대해 GPT-4o-mini로 자동 생성:
  - vocab (단어 + 예문 + 3지선다 + 정답)
  - midBossQuiz (지문 이해 문제 + 3선지 + 정답)
  - finalBossQuiz (챕터 종합 패시지 + 4지선다 + 정답)

사용:
  1. OPENAI_API_KEY 환경변수 설정 또는 스크립트 내 직접 입력
  2. python tools/quiz_generator.py

진행 중 중단 시 재실행하면 이미 완료된 항목은 건너뜀 (재개 가능).
"""

import sys, io, json, os, re, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── API 키 설정 ───────────────────────────────────────────────────────────────
# 환경변수 OPENAI_API_KEY 사용 권장.
# 없으면 아래 줄에 직접 입력
API_KEY = os.environ.get("OPENAI_API_KEY") or ""

OPENAI_MODEL     = "gpt-4o-mini"   # 빠르고 저렴 ($0.15/1M input tokens)
DELAY_BETWEEN    = 1.0             # 호출 간 기본 대기 (초) — ChatGPT는 제한 넉넉함
MAX_RETRIES      = 3

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "tools", "output")
BOOK_IDS   = ["aesop", "alice", "sherlock"]

# ── OpenAI 클라이언트 초기화 ──────────────────────────────────────────────────

def init_client():
    if not API_KEY:
        print("\n[오류] OPENAI_API_KEY 가 설정되지 않았습니다.")
        print("  방법 1: 환경변수 설정")
        print("    PowerShell: $env:OPENAI_API_KEY = 'sk-...'")
        print("  방법 2: 스크립트 상단 API_KEY = '...' 직접 입력")
        print("\n  OpenAI API 키: https://platform.openai.com/api-keys")
        sys.exit(1)

    from openai import OpenAI
    client = OpenAI(api_key=API_KEY)
    return client

# ── 프롬프트 ─────────────────────────────────────────────────────────────────

def make_vocab_quiz_prompt(passage_text, book_title, chapter_title, label, difficulty):
    diff_map = {
        "Easy":   "B1 (intermediate, suitable for young learners)",
        "Normal": "B2 (upper-intermediate)",
        "Hard":   "C1 (advanced, SAT/academic level)"
    }
    diff_desc = diff_map.get(difficulty, "B2")

    return f"""You are an English reading game content designer for '{book_title}'.
Chapter: '{chapter_title}', Passage {label}. Difficulty: {difficulty} ({diff_desc}).

PASSAGE:
\"\"\"{passage_text}\"\"\"

Generate a vocabulary quiz item and a reading comprehension quiz item based ONLY on the passage above.
Return STRICTLY valid JSON only (no markdown, no explanation):

{{
  "vocab": {{
    "word": "<one word that APPEARS VERBATIM in the passage>",
    "sentence": "<exact sentence from the passage containing the word; wrap the word with <b> and </b>>",
    "options": [
      "A. <wrong definition>",
      "B. <correct definition>",
      "C. <wrong definition>"
    ],
    "answer": 1,
    "image": "./<word_lowercase>.png"
  }},
  "midBossQuiz": {{
    "q": "<comprehension question answerable ONLY from the passage>",
    "o": [
      "<plausible wrong answer>",
      "<correct answer>",
      "<clearly wrong answer>"
    ],
    "a": 1
  }}
}}

Rules:
- vocab "word" MUST appear verbatim in the passage text above
- "answer" / "a" must be the 0-based index of the correct option
- All text must be in English
- Output ONLY the JSON object — no other text"""


def make_final_quiz_prompt(chapter_passages, book_title, chapter_title, difficulty):
    diff_map = {
        "Easy":   "easy, for young learners",
        "Normal": "moderate challenge",
        "Hard":   "challenging and nuanced"
    }
    diff_desc = diff_map.get(difficulty, "moderate")

    combined = ""
    for label in ["A", "B", "C"]:
        p = chapter_passages.get(label)
        if p and p.get("text"):
            combined += f"[Passage {label}]\n{p['text']}\n\n"

    return f"""You are an English reading game content designer for '{book_title}'.
Chapter: '{chapter_title}'. Difficulty: {difficulty} ({diff_desc}).

CHAPTER CONTENT (3 passages):
\"\"\"{combined}\"\"\"

Create a Final Boss Quiz for the entire chapter.
Return STRICTLY valid JSON only (no markdown, no explanation):

{{
  "passage": "<3-5 sentence original summary of the chapter — do NOT copy text verbatim>",
  "q": "<higher-order question about theme, character motivation, or overall meaning>",
  "o": [
    "A. <wrong>",
    "B. <correct>",
    "C. <wrong>",
    "D. <wrong>"
  ],
  "a": 1
}}

Rules:
- "passage" must be your OWN summary, not copied from the text
- question must require understanding of ALL three passages
- "a" is the 0-based index of the correct option (B = 1)
- All text must be in English
- Output ONLY the JSON object"""


# ── API 호출 ──────────────────────────────────────────────────────────────────

def call_openai(client, prompt, retries=MAX_RETRIES):
    """OpenAI API 호출. 실패 시 재시도."""
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": "You are a helpful content generator. Always respond with valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                response_format={"type": "json_object"}
            )
            raw = response.choices[0].message.content.strip()
            parsed = json.loads(raw)
            return parsed

        except json.JSONDecodeError as e:
            print(f"\n    [JSON 오류] {str(e)[:60]}")
            time.sleep(3)
        except Exception as e:
            err_msg = str(e)
            if "rate_limit" in err_msg.lower() or "429" in err_msg:
                wait = 30 * (attempt + 1)
                print(f"\n    [속도제한] {wait}초 대기 후 재시도 ({attempt+1}/{retries})...")
                time.sleep(wait)
            elif "insufficient_quota" in err_msg.lower() or "billing" in err_msg.lower():
                print(f"\n    [크레딧 부족] OpenAI 계정 크레딧을 확인하세요.")
                print(f"    https://platform.openai.com/settings/billing")
                sys.exit(1)
            else:
                print(f"\n    [API 오류] {err_msg[:100]}")
                time.sleep(5)

    print(f"    [실패] {retries}회 재시도 후 포기.")
    return None


# ── 진행 상태 저장/로드 ───────────────────────────────────────────────────────

def load_game_content(book_id):
    path = os.path.join(OUTPUT_DIR, f"{book_id}_game_content.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f), path

def save_game_content(data, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_difficulty(book_id):
    return {"aesop": "Easy", "alice": "Normal", "sherlock": "Hard"}.get(book_id, "Normal")


# ── 메인 생성 루프 ────────────────────────────────────────────────────────────

def process_book(client, book_id):
    print(f"\n{'='*60}")
    print(f"  [{book_id.upper()}] 퀴즈 생성 시작")
    print(f"{'='*60}")

    data, path     = load_game_content(book_id)
    difficulty     = get_difficulty(book_id)
    book_title     = data["title"]
    chapters       = data["chapters"]
    total          = len(chapters)
    done_v = done_m = done_f = skipped = failed = 0

    for ch in chapters:
        ch_title  = ch["title"]
        passages  = ch["passages"]
        ch_num    = ch["chapter_num"]

        print(f"\n  Day {ch_num:2d}/{total} — {ch_title[:40]}")

        # ── 지문 A·B·C ────────────────────────────────────────────────────────
        for label in ["A", "B", "C"]:
            p = passages.get(label)
            if not p or not p.get("text"):
                continue

            already_done = p.get("vocab") is not None and p.get("midBossQuiz") is not None
            if already_done:
                print(f"    [{label}] ✓ 이미 완료")
                skipped += 1
                continue

            wc = p.get("word_count", 0)
            print(f"    [{label}] 생성 중 ({wc}단어)...", end=" ", flush=True)

            result = call_openai(client, make_vocab_quiz_prompt(
                p["text"], book_title, ch_title, label, difficulty
            ))

            if result:
                if p.get("vocab") is None:
                    p["vocab"] = result.get("vocab")
                    done_v += 1
                if p.get("midBossQuiz") is None:
                    p["midBossQuiz"] = result.get("midBossQuiz")
                    done_m += 1
                save_game_content(data, path)
                print("✓ 완료")
            else:
                failed += 1
                print("✗ 실패")

            time.sleep(DELAY_BETWEEN)

        # ── 파이널 보스 퀴즈 ──────────────────────────────────────────────────
        if ch.get("finalBossQuiz") is not None:
            print(f"    [Final] ✓ 이미 완료")
            skipped += 1
        else:
            print(f"    [Final] 생성 중...", end=" ", flush=True)
            result = call_openai(client, make_final_quiz_prompt(
                passages, book_title, ch_title, difficulty
            ))
            if result:
                ch["finalBossQuiz"] = result
                done_f += 1
                save_game_content(data, path)
                print("✓ 완료")
            else:
                failed += 1
                print("✗ 실패")
            time.sleep(DELAY_BETWEEN)

    status = "✅" if failed == 0 else "⚠"
    print(f"\n  {status} [{book_id.upper()}] 완료: "
          f"vocab {done_v}개 | midBoss {done_m}개 | final {done_f}개 | "
          f"건너뜀 {skipped}개 | 실패 {failed}개")


def main():
    print("\n" + "="*60)
    print("  The Book Wardens - AI Quiz Generator (ChatGPT)")
    print("  OpenAI GPT-4o-mini 기반 퀴즈·단어 자동 생성")
    print("="*60)

    client = init_client()
    print(f"  모델: {OPENAI_MODEL}")
    print(f"  처리: aesop(10일) + alice(12일) + sherlock(11일) = 33일")
    print(f"  예상 API 호출: 33일 × 4회 = 132회")
    print(f"  예상 비용: $0.05 미만 (GPT-4o-mini 기준)")
    print(f"  예상 시간: 약 5~8분\n")

    for book_id in BOOK_IDS:
        process_book(client, book_id)

    print(f"\n{'='*60}")
    print("  전체 생성 완료!")
    print(f"  결과: tools/output/*_game_content.json")
    print(f"  ※ 내용 검토 후 오류 항목은 수동 수정하세요.")
    print("="*60 + "\n")

    # 진행 현황 요약 출력
    print("  [최종 현황]")
    for book_id in BOOK_IDS:
        data, _ = load_game_content(book_id)
        dv = dm = df = nv = nm = nf = 0
        for ch in data["chapters"]:
            for label in ["A", "B", "C"]:
                p = ch["passages"].get(label, {})
                if p.get("vocab"):    dv += 1
                else:                 nv += 1
                if p.get("midBossQuiz"): dm += 1
                else:                    nm += 1
            if ch.get("finalBossQuiz"):  df += 1
            else:                        nf += 1
        print(f"  {book_id.upper():10s}: vocab {dv}/{dv+nv} | "
              f"midBoss {dm}/{dm+nm} | final {df}/{df+nf}")


if __name__ == "__main__":
    main()
