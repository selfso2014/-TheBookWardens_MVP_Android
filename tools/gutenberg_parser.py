# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

"""
gutenberg_parser.py
──────────────────────────────────────────────────────────────────
The Book Wardens — Project Gutenberg Full Text DB Builder (Method B)

3권의 전체 텍스트를 구텐베르크에서 다운로드하고
챕터/단락 단위로 파싱하여 JSON + JS Content 파일로 출력.

출력:
  output/alice_full.json
  output/aesop_full.json
  output/sherlock_full.json
  output/alice_full_content.js   (현재 게임 Content.js 구조 호환)
  output/aesop_full_content.js
  output/sherlock_full_content.js

사용:
  python tools/gutenberg_parser.py
"""

import urllib.request
import re
import json
import os
import time

# ── 설정 ─────────────────────────────────────────────────────────────────────

BOOKS = [
    {
        "id": "alice",
        "title": "Alice's Adventures in Wonderland",
        "author": "Lewis Carroll",
        "gutenberg_id": 11,
        "url": "https://www.gutenberg.org/cache/epub/11/pg11.txt",
        "chapter_pattern": r"^(CHAPTER\s+[IVXLCDM]+\.?\s*.*)$",
        "start_marker": "CHAPTER I.",
        "end_marker": "THE END",
    },
    {
        "id": "aesop",
        "title": "Aesop's Fables",
        "author": "Aesop (trans. George Fyler Townsend)",
        "gutenberg_id": 21,
        "url": "https://www.gutenberg.org/cache/epub/21/pg21.txt",
        "chapter_pattern": r"^([A-Z][A-Z\s,'-]{5,})\.$",   # 이솝은 우화 제목
        "start_marker": "THE FOX AND THE CROW",
        "end_marker": "End of the Project Gutenberg",
    },
    {
        "id": "sherlock",
        "title": "The Adventures of Sherlock Holmes",
        "author": "Arthur Conan Doyle",
        "gutenberg_id": 1661,
        "url": "https://www.gutenberg.org/cache/epub/1661/pg1661.txt",
        "chapter_pattern": r"^(ADVENTURE\s+[IVXLCDM]+\.\s*.*)$",
        "start_marker": "ADVENTURE I.",
        "end_marker": "End of the Project Gutenberg",
    },
]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "tools", "output")

# ── 유틸리티 함수 ─────────────────────────────────────────────────────────────

def download_text(url, book_id):
    """구텐베르크에서 텍스트 다운로드 (캐시 지원)"""
    cache_path = os.path.join(OUTPUT_DIR, f"{book_id}_raw.txt")
    
    if os.path.exists(cache_path):
        print(f"  [캐시] {book_id} 원문 재사용: {cache_path}")
        with open(cache_path, "r", encoding="utf-8") as f:
            return f.read()

    print(f"  [다운로드] {book_id} 원문: {url}")
    headers = {
        "User-Agent": "Mozilla/5.0 TheBookWardens-DB-Builder/1.0 (educational use)"
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8-sig")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        f.write(raw)
    print(f"  [저장] 캐시 파일: {cache_path}")
    return raw


def strip_gutenberg_boilerplate(text):
    """구텐베르크 머리글/꼬리글 제거"""
    # 머리글 제거: *** START OF ... *** 이후부터
    start_match = re.search(r"\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG.*?\*\*\*", text, re.IGNORECASE)
    if start_match:
        text = text[start_match.end():]

    # 꼬리글 제거: *** END OF ... *** 이전까지
    end_match = re.search(r"\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG.*?\*\*\*", text, re.IGNORECASE)
    if end_match:
        text = text[:end_match.start()]

    return text.strip()


def normalize_text(text):
    """
    텍스트 기본 정규화 (CRLF 통일, 줄 끝 공백 제거만).
    단락 병합은 extract_paragraphs 에서 처리.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines)


def split_into_chapters_alice(text):
    """Alice: CHAPTER I. 형식으로 챕터 분리"""
    chapters = []
    pattern = re.compile(r"^(CHAPTER\s+([IVXLCDM]+)\.?)\s*\n([^\n]+)", re.MULTILINE)
    matches = list(pattern.finditer(text))

    for i, match in enumerate(matches):
        chapter_num_str = match.group(2).strip()   # 로마숫자만
        chapter_title = match.group(3).strip()
        
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        
        chapter_num = roman_to_int(chapter_num_str)
        
        chapters.append({
            "chapter_num": chapter_num,
            "chapter_id": f"ch{chapter_num}",
            "title": chapter_title,
            "raw_body": body
        })

    print(f"    총 {len(chapters)} 챕터 감지")
    return chapters


def split_into_chapters_sherlock(text):
    """Sherlock: 'I. A SCANDAL IN BOHEMIA' 형식으로 챕터 분리"""
    chapters = []
    # 실제 구조: 줄 시작에 로마숫자. 대문자 제목 (예: 'I. A SCANDAL IN BOHEMIA')
    pattern = re.compile(
        r"^([IVXLCDM]+)\.\s+([A-Z][A-Z\s'\-,]+)$",
        re.MULTILINE
    )
    matches = list(pattern.finditer(text))
    
    # 목차 이후의 매치만 사용 (실제 챕터 본문)
    # 목차에서도 같은 패턴이 등장하므로, 연속 빈 줄이 많은 지점 이후만 선택
    # → 매치 간격이 200자 이상인 경우만 실제 챕터로 간주
    real_matches = []
    for i, match in enumerate(matches):
        if i + 1 < len(matches):
            gap = matches[i + 1].start() - match.end()
        else:
            gap = len(text) - match.end()
        if gap > 500:  # 최소 500자 이상 본문이 있어야 실제 챕터
            real_matches.append(match)
    
    for i, match in enumerate(real_matches):
        roman_str = match.group(1).strip()
        chapter_title = match.group(2).strip().title()  # Title Case 변환
        chapter_num = roman_to_int(roman_str)
        
        start = match.start()
        end = real_matches[i + 1].start() if i + 1 < len(real_matches) else len(text)
        body = text[start:end].strip()
        
        chapters.append({
            "chapter_num": chapter_num,
            "chapter_id": f"ch{chapter_num}",
            "title": chapter_title,
            "raw_body": body
        })

    print(f"    총 {len(chapters)} 챕터(단편) 감지")
    return chapters


def split_into_chapters_aesop(text):
    """
    Aesop: Title Case 우화 제목 감지.
    실제 구조: 제목이 'The Lion And The Mouse' 형식으로 빈 줄 4개 이상으로 둘러싸임.
    목차에도 같은 제목이 있으므로, 실제 우화 본문 섹션(AESOP'S FABLES 이후)만 처리.
    """
    chapters = []
    
    # 실제 우화 시작점 찾기: 'AESOP\'S FABLES' 섹션 헤더 이후
    # 원문에서 'LIFE OF AESOP' 섹션 다음에 우화 본문이 시작됨
    fables_start = re.search(r'LIFE OF AESOP', text, re.IGNORECASE)
    if not fables_start:
        fables_start_idx = 0
    else:
        # LIFE OF AESOP 섹션 끝 이후 (약 200줄)
        # 첫 번째 우화 제목 찾기: 빈 줄 3개 이상 + Title Case 제목 + 빈 줄 3개 이상
        after_life = text[fables_start.start():]
        # 'The Lion' 같은 실제 우화 시작점
        first_fable = re.search(r'\n{3,}(The [A-Z][a-z]+(?:\s+(?:And|The|Of|With|In|A|An|His|And The|Or|Who|And|Vs\.?)\s+[A-Z][a-z]+)+)\n', after_life)
        if first_fable:
            fables_start_idx = fables_start.start() + first_fable.start()
        else:
            fables_start_idx = fables_start.start()
    
    body_text = text[fables_start_idx:]
    
    # 우화 제목 패턴: 4개 이상 빈 줄 다음에 오는 Title Case 제목 줄
    # 제목은 단독 줄, 이후 4개 이상 빈 줄
    pattern = re.compile(
        r'\n{4,}((?:The|A|An) [A-Z][a-zA-Z\s,\'-]+(?:[A-Z][a-zA-Z]+))\n{2,}',
    )
    matches = list(pattern.finditer(body_text))
    
    if not matches:
        # 대안 패턴: 3개 이상 빈 줄
        pattern = re.compile(
            r'\n{3,}([A-Z][a-zA-Z]+(?:\s+[A-Za-z,\'-]+){1,8})\n{3,}'
        )
        matches = list(pattern.finditer(body_text))
    
    # 너무 짧거나 긴 제목 필터링
    fable_matches = [
        m for m in matches
        if 5 <= len(m.group(1).strip()) <= 80
        and not m.group(1).strip().isupper()  # 전체 대문자 헤더 제외
    ]
    
    print(f"    총 {len(fable_matches)} 우화 감지")
    
    for i, match in enumerate(fable_matches):
        fable_title = match.group(1).strip()
        
        start = match.start()
        end = fable_matches[i + 1].start() if i + 1 < len(fable_matches) else len(body_text)
        body = body_text[start:end].strip()

        chapters.append({
            "chapter_num": i + 1,
            "chapter_id": f"fable{i + 1}",
            "title": fable_title,
            "raw_body": body
        })

    return chapters


def extract_paragraphs(chapter_body, chapter_id):
    """
    챕터 본문에서 의미 단위 단락 추출.
    
    구텐베르크 텍스트 구조:
    - 모든 줄 사이에 빈 줄 1개 삽입 (편집 관습)
    - 실제 단락 구분 = 빈 줄 3개 이상
    → \n{3,} 기준으로 블록 분리, 블록 내 \n은 공백으로 합침
    """
    paragraphs = []
    # 빈 줄 3개 이상을 실제 단락 구분자로 사용
    raw_blocks = re.split(r"\n{3,}", chapter_body)

    p_index = 0
    for raw_block in raw_blocks:
        # 블록 내 모든 개행(래핑) → 공백으로 합치기
        lines_in_block = raw_block.strip().splitlines()
        merged_lines = [line.strip() for line in lines_in_block if line.strip()]
        text = " ".join(merged_lines).strip()

        if not text:
            continue
        # 챕터/섹션 헤더 제외: 전체 대문자 + 짧은 줄
        if re.match(r"^[A-Z\s\.\,\-']+$", text) and len(text) < 60:
            continue
        # 로마숫자 단독 줄 제외
        if re.match(r"^[IVXLCDM]+\.$", text):
            continue
        # 너무 짧은 단락 제외 (10자 미만)
        if len(text) < 10:
            continue
        # 연속 공백 정리
        text = re.sub(r"  +", " ", text)

        word_count = len(text.split())
        p_index += 1
        paragraphs.append({
            "id": f"{chapter_id}_p{p_index}",
            "paragraph_index": p_index,
            "text": text,
            "word_count": word_count,
            "is_game_scene": False
        })

    return paragraphs


def roman_to_int(s):
    """로마 숫자 → 정수"""
    roman = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    result = 0
    prev = 0
    for c in reversed(s):
        val = roman.get(c, 0)
        if val < prev:
            result -= val
        else:
            result += val
        prev = val
    return result


# ── JSON 직렬화 ───────────────────────────────────────────────────────────────

def build_book_json(book_cfg, chapters_with_paragraphs):
    """책 전체 JSON 구조 생성"""
    total_paragraphs = sum(len(ch["paragraphs"]) for ch in chapters_with_paragraphs)
    total_words = sum(
        p["word_count"]
        for ch in chapters_with_paragraphs
        for p in ch["paragraphs"]
    )

    return {
        "meta": {
            "id": book_cfg["id"],
            "title": book_cfg["title"],
            "author": book_cfg["author"],
            "source": f"Project Gutenberg #{book_cfg['gutenberg_id']}",
            "source_url": f"https://www.gutenberg.org/ebooks/{book_cfg['gutenberg_id']}",
            "license": "Public Domain (US)",
            "parsed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_chapters": len(chapters_with_paragraphs),
            "total_paragraphs": total_paragraphs,
            "total_words": total_words,
        },
        "chapters": chapters_with_paragraphs
    }


def save_json(data, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    size_kb = os.path.getsize(path) / 1024
    print(f"  [JSON 저장] {path} ({size_kb:.1f} KB)")


# ── JS Content 파일 생성 ──────────────────────────────────────────────────────

def save_js_content(book_id, book_json, path):
    """
    현재 게임 ContentFile 구조와 호환되는 JS 파일 생성.
    storyParagraphs (slash-separated), storyChapter (token-level) 제외:
    → 이 단계에서는 전체 텍스트 DB 용도의 fullTextChapters만 export.
    퀴즈/단어/토큰 작업은 다음 phase에서 별도 진행.
    """
    lines = []
    lines.append(f"/**")
    lines.append(f" * {book_id}_full_content.js")
    lines.append(f" * Auto-generated by gutenberg_parser.py")
    lines.append(f" * Source: {book_json['meta']['source']}")
    lines.append(f" * Total chapters: {book_json['meta']['total_chapters']}")
    lines.append(f" * Total paragraphs: {book_json['meta']['total_paragraphs']}")
    lines.append(f" * Total words: {book_json['meta']['total_words']:,}")
    lines.append(f" * Parsed: {book_json['meta']['parsed_at']}")
    lines.append(f" * License: {book_json['meta']['license']}")
    lines.append(f" */")
    lines.append(f"")
    lines.append(f"export const {book_id}FullText = {{")
    lines.append(f"  meta: {json.dumps(book_json['meta'], ensure_ascii=False, indent=4).replace(chr(10), chr(10) + '  ')},")
    lines.append(f"  chapters: [")

    for ch in book_json["chapters"]:
        lines.append(f"    {{")
        lines.append(f"      chapter_num: {ch['chapter_num']},")
        lines.append(f"      chapter_id: {json.dumps(ch['chapter_id'])},")
        lines.append(f"      title: {json.dumps(ch['title'])},")
        lines.append(f"      paragraphs: [")
        for p in ch["paragraphs"]:
            p_json = json.dumps(p, ensure_ascii=False)
            lines.append(f"        {p_json},")
        lines.append(f"      ]")
        lines.append(f"    }},")

    lines.append(f"  ]")
    lines.append(f"}};")
    lines.append(f"")

    content = "\n".join(lines)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    size_kb = os.path.getsize(path) / 1024
    print(f"  [JS 저장]   {path} ({size_kb:.1f} KB)")


# ── 통계 출력 ─────────────────────────────────────────────────────────────────

def print_stats(book_json):
    meta = book_json["meta"]
    print(f"\n  {'─'*50}")
    print(f"  제목:         {meta['title']}")
    print(f"  저자:         {meta['author']}")
    print(f"  출처:         {meta['source']}")
    print(f"  라이선스:     {meta['license']}")
    print(f"  총 챕터 수:   {meta['total_chapters']}")
    print(f"  총 단락 수:   {meta['total_paragraphs']}")
    print(f"  총 단어 수:   {meta['total_words']:,}")
    print(f"  {'─'*50}")
    print(f"  챕터별 단락 수:")
    for ch in book_json["chapters"][:5]:
        print(f"    {ch['chapter_id']:10s} | {ch['title'][:40]:40s} | {len(ch['paragraphs'])} 단락")
    if len(book_json["chapters"]) > 5:
        print(f"    ... (총 {len(book_json['chapters'])} 챕터)")


# ── 메인 파이프라인 ───────────────────────────────────────────────────────────

def process_book(book_cfg):
    print(f"\n{'='*60}")
    print(f"  처리 중: {book_cfg['title']}")
    print(f"{'='*60}")

    # Step 1: 다운로드
    raw = download_text(book_cfg["url"], book_cfg["id"])

    # Step 2: 보일러플레이트 제거
    text = strip_gutenberg_boilerplate(raw)
    text = normalize_text(text)
    print(f"  [정제 완료] 텍스트 길이: {len(text):,} 자")

    # Step 3: 챕터 분리
    book_id = book_cfg["id"]
    if book_id == "alice":
        chapters = split_into_chapters_alice(text)
    elif book_id == "sherlock":
        chapters = split_into_chapters_sherlock(text)
    elif book_id == "aesop":
        chapters = split_into_chapters_aesop(text)
    else:
        raise ValueError(f"알 수 없는 book_id: {book_id}")

    # Step 4: 단락 분리 + 메타데이터 부착
    chapters_with_paragraphs = []
    for ch in chapters:
        paragraphs = extract_paragraphs(ch["raw_body"], ch["chapter_id"])
        chapters_with_paragraphs.append({
            "chapter_num": ch["chapter_num"],
            "chapter_id": ch["chapter_id"],
            "title": ch["title"],
            "paragraph_count": len(paragraphs),
            "paragraphs": paragraphs
        })

    # Step 5: JSON 구조 생성
    book_json = build_book_json(book_cfg, chapters_with_paragraphs)

    # Step 6: 통계 출력
    print_stats(book_json)

    # Step 7: 파일 저장
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    json_path = os.path.join(OUTPUT_DIR, f"{book_id}_full.json")
    js_path   = os.path.join(OUTPUT_DIR, f"{book_id}_full_content.js")

    save_json(book_json, json_path)
    save_js_content(book_id, book_json, js_path)

    return book_json


def main():
    print("\n" + "="*60)
    print("  The Book Wardens - Gutenberg Full Text DB Builder")
    print("  Python Script v1.0")
    print("="*60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    results = {}

    for book_cfg in BOOKS:
        try:
            book_json = process_book(book_cfg)
            results[book_cfg["id"]] = {
                "status": "success",
                "chapters": book_json["meta"]["total_chapters"],
                "paragraphs": book_json["meta"]["total_paragraphs"],
                "words": book_json["meta"]["total_words"],
            }
        except Exception as e:
            print(f"\n  [오류] {book_cfg['id']}: {e}")
            import traceback
            traceback.print_exc()
            results[book_cfg["id"]] = {"status": "error", "error": str(e)}

    # 최종 요약
    print(f"\n{'='*60}")
    print("  최종 처리 결과 요약")
    print(f"{'='*60}")
    for book_id, r in results.items():
        if r["status"] == "success":
            print(f"  ✅ {book_id:10s} | {r['chapters']:3d} 챕터 | {r['paragraphs']:5d} 단락 | {r['words']:7,} 단어")
        else:
            print(f"  ❌ {book_id:10s} | 오류: {r.get('error', '알 수 없음')}")

    print(f"\n  출력 폴더: {os.path.abspath(OUTPUT_DIR)}")
    print(f"  생성 파일:")
    for f in sorted(os.listdir(OUTPUT_DIR)):
        fpath = os.path.join(OUTPUT_DIR, f)
        if os.path.isfile(fpath):
            size_kb = os.path.getsize(fpath) / 1024
            print(f"    {f:40s} ({size_kb:.1f} KB)")

    print(f"\n  다음 단계: output/*.json 에서 is_game_scene: true 마킹 작업")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
