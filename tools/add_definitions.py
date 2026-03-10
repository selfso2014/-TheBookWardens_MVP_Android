# -*- coding: utf-8 -*-
"""
add_definitions.py
────────────────────────────────────────────────────────────────
기존 *_game_content.json의 각 vocab 항목에
definition 필드를 추가.

definition = options[answer] 에서 "A. " 접두사 제거한 값.

사용:
  python tools/add_definitions.py
"""

import sys, io, json, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "tools", "output")
BOOK_IDS   = ["aesop", "alice", "sherlock"]

def strip_option_prefix(text):
    """'A. ...', 'B. ...' 같은 접두사 제거."""
    return re.sub(r'^[A-Da-d][.\)]\s*', '', (text or "").strip())

def process_book(book_id):
    path = os.path.join(OUTPUT_DIR, f"{book_id}_game_content.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    updated = 0
    skipped = 0
    missing = 0

    for ch in data["chapters"]:
        for label in ["A", "B", "C"]:
            p = ch["passages"].get(label)
            if not p:
                continue
            vocab = p.get("vocab")
            if not vocab:
                missing += 1
                continue

            # 이미 definition 필드가 있으면 건너뜀
            if vocab.get("definition"):
                skipped += 1
                continue

            options = vocab.get("options", [])
            answer_idx = vocab.get("answer", 1)  # 기본값 1 (B)

            if answer_idx < len(options):
                raw_def = options[answer_idx]
                definition = strip_option_prefix(raw_def)
                vocab["definition"] = definition
                updated += 1
            else:
                missing += 1

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(path) / 1024
    print(f"  [{book_id.upper():10s}] definition 추가: {updated}개 | 기존 보존: {skipped}개 | 누락: {missing}개  ({size_kb:.1f} KB)")
    return updated

def main():
    print("\n" + "="*55)
    print("  add_definitions.py — vocab.definition 필드 추가")
    print("="*55)
    total = 0
    for book_id in BOOK_IDS:
        total += process_book(book_id)
    print(f"\n  완료: 총 {total}개 definition 추가됨")
    print("="*55 + "\n")

if __name__ == "__main__":
    main()
