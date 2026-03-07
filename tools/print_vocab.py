import sys, io, json, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

out_dir = os.path.join("tools", "output")
books = [
    ("aesop",   "Aesop's Fables",               "Easy"),
    ("alice",   "Alice's Adventures in Wonderland", "Normal"),
    ("sherlock","The Adventures of Sherlock Holmes", "Hard"),
]

lines = []

for book_id, book_name, diff in books:
    path = os.path.join(out_dir, f"{book_id}_game_content.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    lines.append(f"\n{'='*70}")
    lines.append(f"  {book_name}  [{diff}]")
    lines.append(f"{'='*70}")
    lines.append(f"  {'No':<8} {'Word':<18} {'Definition':<45} {'Sentence (example)'}")
    lines.append(f"  {'-'*7} {'-'*17} {'-'*44} {'-'*40}")

    for ch in data["chapters"]:
        ch_num = ch["chapter_num"]
        for label in ["A", "B", "C"]:
            p = ch["passages"].get(label, {})
            v = p.get("vocab")
            if not v:
                continue
            word       = v.get("word", "—")
            definition = v.get("definition", "—")
            sentence   = v.get("sentence", "")
            # <b> 태그 제거하고 단어 강조
            sentence_clean = re.sub(r"</?b>", "**", sentence)
            # 너무 길면 자르기
            if len(sentence_clean) > 70:
                sentence_clean = sentence_clean[:67] + "..."

            no = f"D{ch_num:02d}-{label}"
            lines.append(f"  {no:<8} {word:<18} {definition:<45} {sentence_clean}")

for line in lines:
    print(line)
