"""Fill the console with demo traffic: python scripts/seed_demo.py [gateway-url]

Goes through /v1/sanitize only, so nothing is ever forwarded to an LLM, whatever UPSTREAM_MODE says.
Every value below is fake. The requests land in the real audit database (data/audit.db): delete that file to start clean.
"""
import os
import sys
import time

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
# Needed only when the gateway has GATEWAY_API_KEYS set: GATEWAY_KEY=gw_...
KEY_HEADERS = {"Authorization": f"Bearer {os.environ['GATEWAY_KEY']}"} if os.getenv("GATEWAY_KEY") else {}

# (text, industries, site)
DEMO = [
    ("고객 홍길동 메일 kim@corp.co.kr 로 보내줘", [], "chatgpt.com"),
    ("010-1234-5678 번호로 연락 부탁드려요", [], "chatgpt.com"),
    ("박과장님께 회의록 요약해서 전달해줘", [], "claude.ai"),
    ("오늘 날씨 좋은데 점심 메뉴 추천해줘", [], "chatgpt.com"),
    ("사업자번호 123-45-67890 확인해줘", [], "claude.ai"),
    ("정제수 72.4%, 글리세린 5% 배합 비율 공유", ["cosmetics"], "chatgpt.com"),
    ("원료 공급사: 코스맥스 에서 납품", ["cosmetics"], "claude.ai"),
    ("주문번호 20240315-0001234 취소 요청", ["ecommerce"], "chatgpt.com"),
    ("신한은행 110-123-456789 계좌로 송금해줘", ["finance"], "chatgpt.com"),
    ("사번 20190345 영업팀 이동 기록", ["hr"], "claude.ai"),
    ("서버 db01.fake.internal 접속 확인", ["it_dev"], "chatgpt.com"),
    ("3월 라인 수율 92.4%, 불량률 1.8% 보고", ["manufacturing"], "claude.ai"),
    ("환자번호 20240115 내원 기록 요약해줘", ["medical"], "chatgpt.com"),
    ("선하증권번호: KOSL20240315A001 조회 요청", ["logistics"], "claude.ai"),
    ("API 키 sk-abcdefghijklmnopqrstuvwxyz123456 이거 맞아?", [], "chatgpt.com"),
    ("AWS 키 AKIAIOSFODNN7EXAMPLE 점검해줘", ["it_dev"], "claude.ai"),
]


def wait_for_gateway() -> None:
    for _ in range(30):
        try:
            if httpx.get(BASE + "/health", timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            time.sleep(1)
    sys.exit(f"게이트웨이({BASE})가 응답하지 않습니다. 먼저 띄워 주세요.")


def main() -> None:
    wait_for_gateway()
    counts = {"통과/가림": 0, "차단": 0}
    for text, industries, site in DEMO:
        r = httpx.post(
            BASE + "/v1/sanitize",
            json={"text": text, "industries": industries, "site": site, "client": "demo-seed"},
            headers=KEY_HEADERS,
            timeout=10,
        )
        if r.status_code == 401:
            sys.exit("게이트웨이에 접속 키가 필요합니다. GATEWAY_KEY=gw_... 를 설정하고 다시 실행하세요.")
        counts["차단" if r.status_code == 403 else "통과/가림"] += 1
    print(f"데모 요청 {len(DEMO)}건을 보냈습니다: {counts}")


if __name__ == "__main__":
    main()
