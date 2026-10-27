"""Keyless demo: shows what the gateway masks, what leaves the company, and what the employee sees.

Run: python -m app.demo      (no server, no API key; uses the mock upstream)
"""
import os

os.environ["UPSTREAM_MODE"] = "mock"
os.environ.setdefault("AUDIT_DB", ":memory:")

from fastapi.testclient import TestClient  # noqa: E402

from . import main  # noqa: E402

PROMPT = "고객 홍길동(901010-1xxxxxx)의 처방 조성비 정제수 72.4% 분석해줘. 담당 kim@corp.co.kr"


def main_demo() -> None:
    client = TestClient(main.app)
    for industries in ([], ["cosmetics"]):
        label = "범용 규칙만" if not industries else f"템플릿 {industries}"
        a = client.post("/v1/analyze", json={"text": PROMPT, "industries": industries}).json()
        r = client.post(
            "/v1/chat/completions",
            json={"model": "demo", "messages": [{"role": "user", "content": PROMPT}]},
            headers={"X-Gateway-Industry": ",".join(industries)} if industries else {},
        )
        print(f"=== {label} ===")
        print(f"원본        : {PROMPT}")
        print(f"외부로 나감 : {a['sanitized']}")
        print(f"직원이 봄   : {r.json()['choices'][0]['message']['content']}")
        print(f"가린 건수   : {r.headers['X-Gateway-Redacted']}  경로: {r.headers['X-Gateway-Route']}\n")
    print("=== 통계 (내용 없이 유형·건수만) ===")
    for f in client.get("/v1/stats/summary").json()["findings"]:
        print(f"  {f['label']}: {f['count']}건 ({f['action']})")


if __name__ == "__main__":
    main_demo()
