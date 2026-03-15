# -*- coding: utf-8 -*-
import sys, io, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "tools", "output")

for book_id in ["aesop", "alice", "sherlock"]:
    path = os.path.join(OUTPUT_DIR, f"{book_id}_game_content.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    done_vocab = done_mid = done_final = 0
    null_vocab = null_mid = null_final = 0

    for ch in data["chapters"]:
        for label in ["A", "B", "C"]:
            p = ch["passages"].get(label, {})
            if p.get("vocab"):   done_vocab += 1
            else:                null_vocab += 1
            if p.get("midBossQuiz"):  done_mid += 1
            else:                     null_mid += 1
        if ch.get("finalBossQuiz"):  done_final += 1
        else:                        null_final += 1

    print(f"[{book_id.upper()}]")
    print(f"  vocab:       완료 {done_vocab:3d}개 / 미완료 {null_vocab}개")
    print(f"  midBossQuiz: 완료 {done_mid:3d}개 / 미완료 {null_mid}개")
    print(f"  finalQuiz:   완료 {done_final:3d}개 / 미완료 {null_final}개")
    print()
