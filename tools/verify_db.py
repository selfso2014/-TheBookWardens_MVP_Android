# -*- coding: utf-8 -*-
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

books = ["alice", "aesop", "sherlock"]
for book_id in books:
    with open(f"tools/output/{book_id}_full.json", encoding="utf-8") as f:
        d = json.load(f)
    m = d["meta"]
    ch = d["chapters"][0]
    paragraphs = ch["paragraphs"]
    p = paragraphs[1] if len(paragraphs) > 1 else paragraphs[0]

    print(f"=== {m['title']} ===")
    print(f"  출처      : {m['source']}")
    print(f"  라이선스  : {m['license']}")
    print(f"  챕터 수   : {m['total_chapters']}")
    print(f"  총 단락수 : {m['total_paragraphs']}")
    print(f"  총 단어수 : {m['total_words']:,}")
    print(f"  --")
    print(f"  첫 챕터   : [{ch['chapter_id']}] {ch['title']}")
    print(f"  단락 예시 : ({p['word_count']}단어) {p['text'][:100]}...")
    print()
