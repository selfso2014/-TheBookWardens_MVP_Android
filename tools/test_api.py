# -*- coding: utf-8 -*-
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

API_KEY = os.environ.get("OPENAI_API_KEY") or ""
print(f"API Key: {API_KEY[:20]}...")

from openai import OpenAI
client = OpenAI(api_key=API_KEY)

try:
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "user", "content": "Say hello in JSON: {\"greeting\": \"hello\"}"}
        ],
        response_format={"type": "json_object"},
        max_tokens=50
    )
    print("SUCCESS:", response.choices[0].message.content)
except Exception as e:
    print(f"FULL ERROR: {type(e).__name__}: {e}")
