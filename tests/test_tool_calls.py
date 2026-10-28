"""Agent loops through the proxy: the model only sees placeholders, the app that runs the tool gets real values."""
import json

import pytest
from fastapi.testclient import TestClient

from app import main, upstream
from app.sanitizer import map_arguments
from app.vault import Vault

client = TestClient(main.app)

TOOLS = [{"type": "function", "function": {"name": "update_contact", "parameters": {"type": "object"}}}]
ASK = "고객 홍길동의 메일을 kim@new.co.kr 로 수정해줘"


@pytest.fixture
def mock(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")


@pytest.fixture
def seen(monkeypatch):
    """What actually left for the model, per call."""
    sent = []
    real = upstream.forward

    async def spy(payload, auth, route="external"):
        sent.append(json.dumps(payload["messages"], ensure_ascii=False))
        return await real(payload, auth, route)

    monkeypatch.setattr(upstream, "forward", spy)
    return sent


def chat(messages, **extra):
    return client.post("/v1/chat/completions", json={"model": "x", "messages": messages, "tools": TOOLS, **extra})


# ---- helpers ---------------------------------------------------------------------

def test_map_arguments_keeps_json_valid_when_the_restored_value_has_quotes():
    v = Vault()
    ph = v.placeholder("메모", '그는 "급여"를\n올렸다')
    out = map_arguments(json.dumps({"note": ph, "n": 3, "list": [ph]}), v.restore)
    assert json.loads(out) == {"note": '그는 "급여"를\n올렸다', "n": 3, "list": ['그는 "급여"를\n올렸다']}


def test_map_arguments_falls_back_to_plain_text_when_not_json():
    assert map_arguments("not json [메모_1]", lambda s: s.upper()) == "NOT JSON [메모_1]"


# ---- the loop ----------------------------------------------------------------------

def test_tool_call_arguments_come_back_restored_and_the_model_saw_placeholders(mock, seen):
    r = chat([{"role": "user", "content": ASK}])
    assert r.status_code == 200
    call = r.json()["choices"][0]["message"]["tool_calls"][0]["function"]
    assert call["name"] == "update_contact"
    # the app that runs the tool receives the real values
    assert json.loads(call["arguments"])["instruction"] == ASK
    # the model never did
    assert "홍길동" not in seen[0] and "kim@new.co.kr" not in seen[0]
    assert "[사람_1]" in seen[0] and "[이메일_1]" in seen[0]


def test_replayed_history_is_masked_again_including_earlier_tool_calls(mock, seen):
    """Step 2 of a loop: the app sends the whole conversation back, with real values in the assistant's tool call
    and in the tool result. Numbering stays the same, and nothing real goes out."""
    history = [
        {"role": "user", "content": ASK},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "update_contact", "arguments": json.dumps({"instruction": ASK}, ensure_ascii=False)}}],
        },
        {"role": "tool", "tool_call_id": "c1", "content": json.dumps({"name": "홍길동", "email": "kim@new.co.kr", "status": "updated"}, ensure_ascii=False)},
    ]
    r = chat(history)
    assert r.status_code == 200
    leaked = seen[0]
    assert "홍길동" not in leaked and "kim@new.co.kr" not in leaked
    assert leaked.count("[이메일_1]") >= 2 and "[이메일_2]" not in leaked  # the same value keeps the same placeholder
    assert leaked.count("[사람_1]") >= 2 and "[사람_2]" not in leaked
    # the final report is restored for the person
    report = r.json()["choices"][0]["message"]["content"]
    assert "홍길동" in report and "kim@new.co.kr" in report and "[" not in report.replace("[mock]", "")


def test_internal_route_keeps_everything_untouched(mock, seen):
    """An internal_only value sends the original messages to the internal model: nothing is masked, tool calls included."""
    r = client.post(
        "/v1/chat/completions",
        json={"model": "x", "messages": [{"role": "user", "content": "원료 공급사: 코스맥스 에서 납품"}], "tools": TOOLS},
        headers={"X-Gateway-Industry": "cosmetics"},
    )
    assert r.status_code == 200 and r.headers["X-Gateway-Route"] == "internal"
    assert "코스맥스" in seen[0]


def test_streamed_tool_call_is_released_whole_and_restored(mock):
    r = chat([{"role": "user", "content": ASK}], stream=True)
    assert r.status_code == 200
    events = [json.loads(line[5:]) for line in r.text.splitlines() if line.startswith("data:") and "[DONE]" not in line]
    deltas = [c["choices"][0]["delta"] for c in events if c.get("choices")]
    calls = [d["tool_calls"] for d in deltas if d.get("tool_calls")]
    assert len(calls) == 1  # fragments were put together, not forwarded one by one
    fn = calls[0][0]["function"]
    assert fn["name"] == "update_contact" and json.loads(fn["arguments"])["instruction"] == ASK
    assert events[-1]["choices"][0]["finish_reason"] == "tool_calls"
    assert "[사람_" not in r.text and "[이메일_" not in r.text  # no placeholder leaked into the stream


def test_streamed_final_answer_still_ends_with_stop(mock):
    r = chat([{"role": "tool", "tool_call_id": "c1", "content": "끝"}], stream=True)
    events = [json.loads(line[5:]) for line in r.text.splitlines() if line.startswith("data:") and "[DONE]" not in line]
    assert events[-1]["choices"][0]["finish_reason"] == "stop"


def test_tools_are_refused_instead_of_silently_dropped_by_the_claude_adapter(monkeypatch):
    monkeypatch.setenv("UPSTREAM_PROVIDER", "anthropic")
    r = chat([{"role": "user", "content": "안녕"}])
    assert r.status_code == 400 and r.json()["error"]["type"] == "unsupported"
    # plain chat is unaffected by the guard
    assert not upstream.supports_tools("external") and upstream.supports_tools("internal")


def test_tool_results_are_masked_by_field_name_even_when_the_value_looks_like_nothing(mock, seen):
    """A database row has no "고객" in front of the name and no "원" behind the salary. The key tells what it is."""
    rows = [{"name": "박영희", "phone": "01099998888", "salary": 5000000, "memo": "VIP", "active": True}]
    r = chat([{"role": "user", "content": "조회해줘"}, {"role": "tool", "tool_call_id": "c1", "content": json.dumps(rows, ensure_ascii=False)}])
    assert r.status_code == 200
    out = seen[0]
    assert "박영희" not in out and "01099998888" not in out and "5000000" not in out
    assert "[급여_1]" in out and "[사람_1]" in out
    assert "VIP" in out and "true" in out  # fields that are not sensitive keep their value and type
    assert r.headers["X-Gateway-Redacted"] == "3"
    # the person sees the real row again
    assert "박영희" in r.json()["choices"][0]["message"]["content"]


def test_company_field_names_can_be_added(mock, seen, monkeypatch):
    monkeypatch.setenv("SENSITIVE_KEYS", "cust_nm=사람")
    chat([{"role": "tool", "tool_call_id": "c1", "content": json.dumps({"cust_nm": "정수민"}, ensure_ascii=False)}])
    assert "정수민" not in seen[0] and "[사람_1]" in seen[0]


def test_replayed_tool_arguments_are_masked_by_key_too(mock, seen):
    args = json.dumps({"name": "정수민", "memo": "수정"}, ensure_ascii=False)
    chat([
        {"role": "user", "content": "수정해줘"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "update", "arguments": args}}]},
    ])
    assert "정수민" not in seen[0] and "[사람_1]" in seen[0]


def test_a_masked_number_goes_back_into_the_arguments_as_a_number():
    v = Vault()
    ph = v.placeholder("급여", "5000000", numeric=True)
    text = v.placeholder("사람", "홍길동")
    out = json.loads(map_arguments(json.dumps({"salary": ph, "name": text, "memo": f"{ph} 원"}), v.restore_value))
    assert out == {"salary": 5000000, "name": "홍길동", "memo": "5000000 원"}  # inside a sentence it stays text
