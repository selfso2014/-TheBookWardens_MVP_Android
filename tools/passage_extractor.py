# -*- coding: utf-8 -*-
"""
passage_extractor.py
────────────────────────────────────────────────────────────────
The Book Wardens — Chapter Passage Extractor

각 책의 챕터에서 지문 A·B·C 를 자동 발췌.

규칙:
  - Alice / Sherlock: 챕터를 3등분하여 각 구간에서 150~300단어 발췌
  - Aesop: 우화 3편 = 1일치, 각 우화 전체 = 지문 A / B / C

출력:
  tools/output/alice_game_content.json
  tools/output/aesop_game_content.json
  tools/output/sherlock_game_content.json

사용:
  python tools/passage_extractor.py
"""

import sys, io, json, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "tools", "output")

TARGET_MIN_WORDS = 150
TARGET_MAX_WORDS = 300

# MERGE_MODE: True이면 기존 *_game_content.json의 vocab·quiz 데이터를 보존하고
# passage 텍스트만 새로 추출해서 덮어씀.
MERGE_MODE = True

# ── 유틸 ──────────────────────────────────────────────────────────────────────

def load_json(book_id):
    path = os.path.join(OUTPUT_DIR, f"{book_id}_full.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_json(data, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    size_kb = os.path.getsize(path) / 1024
    print(f"  [저장] {os.path.basename(path)} ({size_kb:.1f} KB)")

def is_likely_title(text, wc, chapter_title=None):
    """
    단락이 챕터/섹션 제목인지 판별.
    True이면 지문 발췌에서 제외.
    """
    stripped = text.strip()

    # 3단어 이하는 무조건 제외
    if wc <= 3:
        return True

    # 10단어 이하이고 영문 대문자 비율이 80% 이상이면 제목으로 간주
    if wc <= 10:
        alpha_chars = [c for c in stripped if c.isalpha()]
        if alpha_chars:
            upper_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
            if upper_ratio >= 0.80:
                return True

    # 챕터 제목과 일치하거나 포함하는 경우 (12단어 이하)
    if chapter_title and wc <= 12:
        norm_text  = re.sub(r'[^a-z0-9 ]', '', stripped.lower())
        norm_title = re.sub(r'[^a-z0-9 ]', '', chapter_title.lower())
        if norm_title and (norm_title in norm_text or norm_text in norm_title):
            return True

    # 로마 숫자 단독 패턴 (예: "I.", "CHAPTER IV")
    if re.match(r'^(CHAPTER\s+)?[IVXLCDM]+\.?\s*$', stripped.upper()):
        return True

    return False


def merge_paragraphs_to_passage(paragraphs, start_idx, end_idx, chapter_title=None):
    """
    paragraphs[start_idx:end_idx] 구간에서
    제목성 단락을 제외하고 TARGET_MIN_WORDS 이상이 될 때까지 누적 후 반환.
    """
    selected_paragraphs = paragraphs[start_idx:end_idx]
    if not selected_paragraphs:
        return None

    accumulated = []
    accumulated_ids = []
    total_words = 0

    for p in selected_paragraphs:
        text = p["text"].strip()
        wc   = p["word_count"]

        # 제목성 단락 건너뜀 (강화된 필터)
        if is_likely_title(text, wc, chapter_title):
            continue

        accumulated.append(text)
        accumulated_ids.append(p["id"])
        total_words += wc

        if total_words >= TARGET_MIN_WORDS:
            break

    if not accumulated:
        return None

    merged_text = " ".join(accumulated)
    merged_text = re.sub(r"  +", " ", merged_text)

    return {
        "text": merged_text,
        "word_count": total_words,
        "source_ids": accumulated_ids,
        "vocab": None,
        "midBossQuiz": None
    }

# ── Alice / Sherlock 처리 (챕터 3등분) ───────────────────────────────────────

def extract_chapter_3sections(chapter, chapter_num, book_title):
    """
    챕터 단락을 3등분(A:앞·B:중간·C:뒤)하여 각 구간에서 지문 발췌.
    """
    paragraphs = chapter["paragraphs"]
    total = len(paragraphs)

    if total < 3:
        # 단락이 너무 적으면 전체를 A에 몰아넣음
        boundaries = [(0, total, 0, 0)]
    else:
        t1 = total // 3
        t2 = 2 * total // 3
        # 각 구간: (시작, 끝) — 최대 end_idx 제한
        boundaries = [
            (0,      t1,      0,      t1),      # A: 앞 1/3
            (t1,     t2,      t1,     t2),      # B: 중간 1/3
            (t2,     total,   t2,     total),   # C: 뒤 1/3
        ]

    passages = {}
    labels = ["A", "B", "C"]

    ch_title = chapter.get("title", "")

    for i, (start, end, _, __) in enumerate(boundaries):
        label = labels[i]
        # chapter_title 전달 → 제목 단락 필터링
        passage = merge_paragraphs_to_passage(paragraphs, start, end, chapter_title=ch_title)

        if passage is None:
            print(f"    ⚠ Chapter {chapter_num} 지문 {label}: 발췌 실패 (단락 부족)")
            passage = {
                "text": "",
                "word_count": 0,
                "source_ids": [],
                "vocab": None,
                "midBossQuiz": None
            }

        passages[label] = passage

    return passages

# ── Aesop 처리 (우화 3편 = 1일치) ────────────────────────────────────────────

def build_aesop_chapters(all_fables, num_days=10):
    """
    288편의 우화 중 첫 num_days×3 편을 선택.
    우화 3편을 묶어 1일치(1챕터)로 구성.
    각 우화 전체 텍스트 = 지문 A / B / C.
    """
    days = []
    fable_idx = 0

    for day_num in range(1, num_days + 1):
        group = []
        for slot_label in ["A", "B", "C"]:
            if fable_idx >= len(all_fables):
                break
            fable = all_fables[fable_idx]
            fable_idx += 1

            # 우화 전체 텍스트 합치기 (제목 단락 제외)
            paragraphs = fable["paragraphs"]
            fable_title = fable.get("title", "")
            valid_paras = [
                p for p in paragraphs
                if not is_likely_title(p["text"].strip(), p["word_count"], fable_title)
            ]
            texts = [p["text"] for p in valid_paras]
            full_text = " ".join(texts)
            full_text = re.sub(r"  +", " ", full_text)
            total_wc = sum(p["word_count"] for p in valid_paras)

            group.append({
                "label": slot_label,
                "fable_id": fable["chapter_id"],
                "fable_title": fable["title"],
                "text": full_text,
                "word_count": total_wc,
                "source_ids": [p["id"] for p in paragraphs],
                "vocab": None,
                "midBossQuiz": None
            })

        if not group:
            break

        # 묶인 우화 제목들로 챕터 제목 생성
        title_parts = [g["fable_title"] for g in group]
        chapter_title = " / ".join(title_parts)

        passages = {g["label"]: {
            "fable_id": g["fable_id"],
            "fable_title": g["fable_title"],
            "text": g["text"],
            "word_count": g["word_count"],
            "source_ids": g["source_ids"],
            "vocab": None,
            "midBossQuiz": None
        } for g in group}

        days.append({
            "chapter_num": day_num,
            "chapter_id": f"day{day_num}",
            "title": chapter_title,
            "passages": passages,
            "finalBossQuiz": None  # 나중에 채움
        })

    return days

# ── 메인 처리 ─────────────────────────────────────────────────────────────────

def load_existing_game_content(book_id):
    """기존 *_game_content.json 로드. 없으면 None 반환."""
    path = os.path.join(OUTPUT_DIR, f"{book_id}_game_content.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def preserve_quiz_data(new_passage, existing_passages, label):
    """
    MERGE_MODE: 기존 passage의 vocab·midBossQuiz를 새 passage에 복사.
    """
    if not MERGE_MODE or not existing_passages:
        return new_passage
    old = existing_passages.get(label, {})
    if old.get("vocab") is not None:
        new_passage["vocab"] = old["vocab"]
    if old.get("midBossQuiz") is not None:
        new_passage["midBossQuiz"] = old["midBossQuiz"]
    return new_passage


def process_alice():
    print("\n[Alice] 처리 중" + (" (MERGE MODE)" if MERGE_MODE else "") + "...")
    data     = load_json("alice")
    existing = load_existing_game_content("alice")
    chapters = data["chapters"]

    existing_map = {}
    if existing:
        for ch in existing["chapters"]:
            existing_map[ch["chapter_id"]] = ch

    result_chapters = []
    for ch in chapters:
        passages = extract_chapter_3sections(ch, ch["chapter_num"], data["meta"]["title"])

        # MERGE: 기존 quiz 데이터 보존
        ex_ch = existing_map.get(ch["chapter_id"], {})
        ex_passages = ex_ch.get("passages", {})
        for label in ["A", "B", "C"]:
            if label in passages:
                passages[label] = preserve_quiz_data(passages[label], ex_passages, label)

        wc_a = passages["A"]["word_count"]
        wc_b = passages["B"]["word_count"]
        wc_c = passages["C"]["word_count"]
        print(f"  Ch{ch['chapter_num']:2d} [{ch['title'][:30]}] A:{wc_a}w B:{wc_b}w C:{wc_c}w")

        result_chapters.append({
            "chapter_num": ch["chapter_num"],
            "chapter_id":  ch["chapter_id"],
            "title":       ch["title"],
            "day":         ch["chapter_num"],
            "passages":    passages,
            "finalBossQuiz": ex_ch.get("finalBossQuiz") if MERGE_MODE else None
        })

    result = {
        "book_id":    "alice",
        "title":      data["meta"]["title"],
        "author":     data["meta"]["author"],
        "total_days": len(result_chapters),
        "chapters":   result_chapters
    }
    save_json(result, os.path.join(OUTPUT_DIR, "alice_game_content.json"))
    return result


def process_sherlock():
    print("\n[Sherlock] 처리 중" + (" (MERGE MODE)" if MERGE_MODE else "") + "...")
    data     = load_json("sherlock")
    existing = load_existing_game_content("sherlock")
    chapters = data["chapters"]

    existing_map = {}
    if existing:
        for ch in existing["chapters"]:
            existing_map[ch["chapter_id"]] = ch

    result_chapters = []
    for ch in chapters:
        passages = extract_chapter_3sections(ch, ch["chapter_num"], data["meta"]["title"])

        ex_ch = existing_map.get(ch["chapter_id"], {})
        ex_passages = ex_ch.get("passages", {})
        for label in ["A", "B", "C"]:
            if label in passages:
                passages[label] = preserve_quiz_data(passages[label], ex_passages, label)

        wc_a = passages["A"]["word_count"]
        wc_b = passages["B"]["word_count"]
        wc_c = passages["C"]["word_count"]
        print(f"  Ch{ch['chapter_num']:2d} [{ch['title'][:30]}] A:{wc_a}w B:{wc_b}w C:{wc_c}w")

        result_chapters.append({
            "chapter_num": ch["chapter_num"],
            "chapter_id":  ch["chapter_id"],
            "title":       ch["title"],
            "day":         ch["chapter_num"],
            "passages":    passages,
            "finalBossQuiz": ex_ch.get("finalBossQuiz") if MERGE_MODE else None
        })

    result = {
        "book_id":    "sherlock",
        "title":      data["meta"]["title"],
        "author":     data["meta"]["author"],
        "total_days": len(result_chapters),
        "chapters":   result_chapters
    }
    save_json(result, os.path.join(OUTPUT_DIR, "sherlock_game_content.json"))
    return result


def process_aesop():
    print("\n[Aesop] 처리 중" + (" (MERGE MODE)" if MERGE_MODE else "") + "...")
    data     = load_json("aesop")
    existing = load_existing_game_content("aesop")
    all_fables = data["chapters"]
    days = build_aesop_chapters(all_fables, num_days=10)

    existing_map = {}
    if existing:
        for ch in existing["chapters"]:
            existing_map[ch["chapter_id"]] = ch

    for d in days:
        ex_ch = existing_map.get(d["chapter_id"], {})
        ex_passages = ex_ch.get("passages", {})
        for label in ["A", "B", "C"]:
            if label in d["passages"]:
                d["passages"][label] = preserve_quiz_data(d["passages"][label], ex_passages, label)
        if MERGE_MODE and ex_ch.get("finalBossQuiz"):
            d["finalBossQuiz"] = ex_ch["finalBossQuiz"]

        wc_a = d["passages"].get("A", {}).get("word_count", 0)
        wc_b = d["passages"].get("B", {}).get("word_count", 0)
        wc_c = d["passages"].get("C", {}).get("word_count", 0)
        print(f"  Day{d['chapter_num']:2d} [{d['title'][:40]}] A:{wc_a}w B:{wc_b}w C:{wc_c}w")

    result = {
        "book_id":    "aesop",
        "title":      data["meta"]["title"],
        "author":     data["meta"]["author"],
        "total_days": len(days),
        "chapters":   days
    }
    save_json(result, os.path.join(OUTPUT_DIR, "aesop_game_content.json"))
    return result

def print_summary(results):
    print(f"\n{'='*60}")
    print("  발췌 완료 요약")
    print(f"{'='*60}")
    for r in results:
        chapters = r["chapters"]
        total_passages = 0
        total_words = 0
        for ch in chapters:
            for label in ["A", "B", "C"]:
                p = ch["passages"].get(label)
                if p:
                    total_passages += 1
                    total_words += p.get("word_count", 0)
        avg_wc = total_words // total_passages if total_passages else 0
        print(f"  [{r['book_id'].upper():10s}] {r['total_days']:2d}일 | "
              f"{total_passages:3d}개 지문 | 평균 {avg_wc}단어/지문 | "
              f"총 {total_words:,}단어")
    print(f"\n  * vocab / midBossQuiz / finalBossQuiz 는 null 상태")
    print(f"    → 다음 단계: AI 보조 퀴즈 생성 스크립트로 채울 예정")
    print("="*60)

def main():
    print("\n" + "="*60)
    print("  The Book Wardens - Passage Extractor")
    print("  챕터별 지문 A·B·C 자동 발췌")
    print("="*60)

    results = []
    results.append(process_aesop())
    results.append(process_alice())
    results.append(process_sherlock())
    print_summary(results)

if __name__ == "__main__":
    main()
