from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import main, upstream


def fake_message(text="hi", stop="end_turn"):
    return SimpleNamespace(
        id="msg_1",
        model="claude-opus-5-5",
        stop_reason=stop,
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=3, output_tokens=4),
    )


def test_request_conversion(monkeypatch):
    monkeypatch.delenv("UPSTREAM_MODEL", raising=False)
    req = upstream.to_anthropic_request(
        {
            "model": "gpt-4o",
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": "be brief"},
                {"role": "user", "content": [{"type": "text", "text": "a"}, {"type": "image_url", "image_url": {}}]},
                {"role": "assistant", "content": None},
            ],
        }
    )
    assert req == {
        "model": "gpt-4o",
        "max_tokens": 16000,
        "messages": [{"role": "user", "content": "a"}],
        "system": "be brief",
    }
    monkeypatch.setenv("UPSTREAM_MODEL", "claude-opus-5-5")
    assert upstream.to_anthropic_request({"model": "gpt-4o", "messages": []})["model"] == "claude-opus-5-5"


def test_response_conversion_skips_thinking_and_maps_finish():
    out = upstream.to_openai_response(fake_message("hello"))
    assert out["choices"][0]["message"]["content"] == "hello"
    assert out["choices"][0]["finish_reason"] == "stop"
    assert out["usage"]["total_tokens"] == 7
    assert upstream.to_openai_response(fake_message(stop="max_tokens"))["choices"][0]["finish_reason"] == "length"
    assert upstream.to_openai_response(fake_message(stop="refusal"))["choices"][0]["finish_reason"] == "content_filter"


def test_gateway_end_to_end_with_anthropic_provider(monkeypatch):
    monkeypatch.delenv("UPSTREAM_MODE", raising=False)
    monkeypatch.setenv("UPSTREAM_PROVIDER", "anthropic")
    seen = {}

    class FakeMessages:
        async def create(self, **kwargs):
            seen.update(kwargs)
            return fake_message(f"답장: {kwargs['messages'][-1]['content']}")

    monkeypatch.setattr(upstream, "_client", lambda: SimpleNamespace(messages=FakeMessages()))
    r = TestClient(main.app).post(
        "/v1/chat/completions",
        json={"model": "claude-opus-5-5", "messages": [{"role": "user", "content": "메일 kim@corp.co.kr"}]},
    )
    assert "kim@corp.co.kr" not in str(seen)  # Claude only sees the placeholder
    assert "[이메일_1]" in str(seen)
    assert r.json()["choices"][0]["message"]["content"] == "답장: 메일 kim@corp.co.kr"  # restored


def test_upstream_failure_returns_502(monkeypatch):
    monkeypatch.delenv("UPSTREAM_MODE", raising=False)

    async def boom(payload, auth, route="external"):
        raise upstream.UpstreamError("down")

    monkeypatch.setattr(upstream, "forward", boom)
    r = TestClient(main.app).post("/v1/chat/completions", json={"model": "x", "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 502
    assert r.json()["error"]["type"] == "upstream_error"
