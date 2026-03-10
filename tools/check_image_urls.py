# -*- coding: utf-8 -*-
"""
check_image_urls.py — Firestore에 저장된 실제 이미지 URL 확인 + 접근 테스트
"""
import sys, io, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("tools/serviceAccountKey.json")
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)

db = firestore.client()

targets = [
    ("alice",   "remarkable"),
    ("alice",   "peep"),
    ("alice",   "pleasure"),
    ("aesop",   "flatter"),
    ("aesop",   "persevere"),
    ("aesop",   "deceit"),
    ("sherlock","astute"),
]

print("=== Firestore URL 전체 + HTTP 접근 테스트 ===\n")
for book_id, word_key in targets:
    doc = db.collection("vocab_images").document(book_id).get()
    data = doc.to_dict() if doc.exists else {}
    url  = data.get(word_key, "(없음)")
    print(f"[{book_id}] {word_key}:")
    print(f"  URL: {url}")
    if url.startswith("http"):
        try:
            req  = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            resp = urllib.request.urlopen(req, timeout=10)
            ct   = resp.headers.get("Content-Type", "-")
            cl   = resp.headers.get("Content-Length", "?")
            print(f"  HTTP: {resp.status} OK  type={ct}  size={cl} bytes  -> 접근 가능")
        except urllib.error.HTTPError as e:
            print(f"  HTTP Error: {e.code} {e.reason}  -> 접근 불가!")
        except Exception as e:
            print(f"  ERROR: {e}")
    print()
