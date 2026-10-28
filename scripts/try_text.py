"""Send one sentence through the running gateway and show what would leave the company.

    python scripts/try_text.py "고객 홍길동 메일 kim@corp.co.kr" [cosmetics medical ...]

Uses /v1/sanitize, so it goes through the real policy (applied rules, switched-off built-ins) and is written to the audit log,
but nothing is sent to an LLM. Windows consoles mangle Korean typed into curl; this avoids that.
"""
import json
import os
import sys

import httpx

BASE = os.getenv("GATEWAY_URL", "http://localhost:8000").rstrip("/")
# Needed only when the gateway has GATEWAY_API_KEYS set: GATEWAY_KEY=gw_...
KEY_HEADERS = {"Authorization": f"Bearer {os.environ['GATEWAY_KEY']}"} if os.getenv("GATEWAY_KEY") else {}


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    text, industries = sys.argv[1], sys.argv[2:]
    try:
        r = httpx.post(f"{BASE}/v1/sanitize", json={"text": text, "industries": industries, "client": "try_text"}, headers=KEY_HEADERS, timeout=10)
    except httpx.HTTPError:
        sys.exit(f"게이트웨이({BASE})에 연결하지 못했습니다. dev.bat으로 먼저 켜 주세요.")
    body = r.json()
    if r.status_code == 403:
        print("차단됨 (전송 안 됨):", json.dumps(body["error"]["findings"], ensure_ascii=False))
    elif r.status_code == 200:
        print("나가는 문장:", body["text"])
        print("찾은 것   :", json.dumps(body["findings"], ensure_ascii=False) or "없음")
    else:
        sys.exit(f"{r.status_code}: {body}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
