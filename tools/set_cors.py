# -*- coding: utf-8 -*-
"""
set_cors.py — Firebase Storage CORS 설정 스크립트
COEP(Cross-Origin-Embedder-Policy) 환경에서 이미지 로딩을 허용하기 위해
Firebase Storage 버킷에 CORS 헤더를 설정합니다.
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import firebase_admin
from firebase_admin import credentials
from google.cloud import storage

SERVICE_ACCOUNT = "tools/serviceAccountKey.json"
BUCKET_NAME     = "graphdebug-2c507.firebasestorage.app"

CORS_CONFIG = [
    {
        "origin": ["https://selfso2014.github.io", "*"],
        "method": ["GET", "HEAD"],
        "responseHeader": [
            "Content-Type",
            "Content-Length",
            "Cross-Origin-Resource-Policy",
            "Access-Control-Allow-Origin",
        ],
        "maxAgeSeconds": 3600,
    }
]

def main():
    print(f"[CORS] Firebase Storage 버킷 CORS 설정 시작: {BUCKET_NAME}")

    # Google Cloud Storage 클라이언트 (서비스 계정 사용)
    client = storage.Client.from_service_account_json(SERVICE_ACCOUNT)
    bucket = client.bucket(BUCKET_NAME)

    # CORS 설정 적용
    bucket.cors = CORS_CONFIG
    bucket.patch()

    print(f"[CORS] ✅ CORS 설정 완료!")
    print(f"[CORS] 허용 Origin: {CORS_CONFIG[0]['origin']}")
    print(f"[CORS] 허용 Method: {CORS_CONFIG[0]['method']}")

    # vocab-images 폴더 오브젝트에 Cross-Origin-Resource-Policy 헤더 설정
    print(f"\n[CORS] vocab-images 폴더의 이미지에 CORP 헤더 설정 중...")
    blobs = list(client.list_blobs(BUCKET_NAME, prefix="vocab-images/"))
    print(f"  대상 파일 수: {len(blobs)}개")

    for blob in blobs:
        if blob.name.endswith(".jpg") or blob.name.endswith(".png"):
            blob.reload()
            if blob.metadata is None:
                blob.metadata = {}
            blob.metadata["Cross-Origin-Resource-Policy"] = "cross-origin"
            blob.patch()
            print(f"  ✓ {blob.name}")

    print(f"\n[CORS] 전체 완료! vocab-images/{len(blobs)}개 파일 CORP 헤더 설정됨")

if __name__ == "__main__":
    main()
