"""See the whole loop: "check this data and change it", with the model never seeing a real value.

    python scripts/agent_demo.py [gateway-url]

Needs a gateway running with UPSTREAM_MODE=mock (dev.bat does that). The "model" is the gateway's scripted mock: it calls the
tool with the instruction it was given and then reports what the tool returned. That is enough to show what travels where;
with a real model (UPSTREAM_MODE unset and an OpenAI-compatible key) the same script exercises the real thing.

Everything below is fake data.
"""
import json
import os
import sys

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("GATEWAY_URL", "http://localhost:8000")).rstrip("/")
sys.stdout.reconfigure(encoding="utf-8")

# The company's "database". The tool below runs here, inside the company, on the real rows.
DB = {"C-1001": {"name": "홍길동", "email": "kim@corp.co.kr", "phone": "01012345678", "salary": 5000000}}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "update_customer",
            "description": "Look up a customer and change a field",
            "parameters": {"type": "object", "properties": {"instruction": {"type": "string"}}},
        },
    }
]


def update_customer(instruction: str) -> str:
    """The app's tool. `instruction` arrives with REAL values (the gateway restored them)."""
    row = DB["C-1001"]
    new_email = next((w for w in instruction.split() if "@" in w), None)
    if new_email:
        row["email"] = new_email
    return json.dumps({"id": "C-1001", **row, "status": "updated"}, ensure_ascii=False)


def step(title: str) -> None:
    print(f"\n── {title}")


def ask(messages: list[dict]) -> dict:
    r = httpx.post(f"{BASE}/v1/chat/completions", json={"model": "demo", "messages": messages, "tools": TOOLS}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"gateway answered {r.status_code}: {r.text}")
    print(f"   가려서 보낸 항목 {r.headers.get('x-gateway-redacted')}개 · 경로 {r.headers.get('x-gateway-route')}")
    return r.json()["choices"][0]["message"]


def main() -> None:
    try:
        httpx.get(f"{BASE}/health", timeout=3).raise_for_status()
    except httpx.HTTPError:
        sys.exit(f"게이트웨이({BASE})가 안 켜져 있습니다. dev.bat으로 먼저 켜 주세요.")

    request = "고객 홍길동의 메일 주소를 new.kim@corp.co.kr 로 바꾸고 결과를 알려줘"
    messages = [{"role": "user", "content": request}]

    step("1. 직원이 요청한다 (진짜 값이 들어 있음)")
    print(f"   {request}")

    step("2. 게이트웨이를 거쳐 모델이 도구를 부른다")
    call_msg = ask(messages)
    call = call_msg["tool_calls"][0]
    args = json.loads(call["function"]["arguments"])
    print(f"   앱이 받은 도구 호출: {call['function']['name']}({args})")
    print("   → 모델은 [사람_1], [이메일_1]만 봤고, 앱은 진짜 값을 받았다")

    step("3. 앱이 회사 안에서 도구를 실행한다 (진짜 DB 수정)")
    result = update_customer(**args)
    print(f"   DB 결과: {result}")

    step("4. 도구 결과를 다시 모델에 보낸다 (이름·메일·전화·급여가 키로 가려짐)")
    messages += [call_msg, {"role": "tool", "tool_call_id": call["id"], "content": result}]
    final = ask(messages)

    step("5. 모델의 완료 보고가 돌아온다 (직원에게는 진짜 값으로 복원)")
    print(f"   {final['content']}")


if __name__ == "__main__":
    main()
