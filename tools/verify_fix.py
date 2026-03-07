import sys,io,json,os
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
out_dir = os.path.join("tools","output")
for book_id in ["aesop","alice","sherlock"]:
    with open(os.path.join(out_dir,f"{book_id}_game_content.json"),encoding="utf-8") as f:
        data=json.load(f)
    ch = data["chapters"][0]
    p = ch["passages"]["A"]
    print(f"=== {book_id.upper()} Day1 Passage A ===")
    print(f"  text[0:80]: {p['text'][:80]}")
    v = p.get("vocab",{})
    print(f"  word:       {v.get('word')}")
    print(f"  definition: {v.get('definition')}")
    print()
