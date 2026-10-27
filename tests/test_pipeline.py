import pytest
from fastapi.testclient import TestClient

from app import main, upstream
from app.detector import detect
from app.vault import Vault


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    return TestClient(main.app)


def chat(client, content, industry=None):
    headers = {"X-Gateway-Industry": industry} if industry else {}
    return client.post(
        "/v1/chat/completions",
        json={"model": "x", "messages": [{"role": "user", "content": content}]},
        headers=headers,
    )


def test_vault_same_value_same_placeholder_and_restore():
    v = Vault()
    a = v.placeholder("이메일", "a@b.com")
    assert v.placeholder("이메일", "a@b.com") == a
    assert v.placeholder("이메일", "c@d.com") != a
    assert v.restore(f"to {a}") == "to a@b.com"
    assert v.restore("[없는것_9]") == "[없는것_9]"


def test_builtin_korean_patterns():
    text = "메일 kim@corp.co.kr 주민 901010-1234567 폰 010-1234-5678 사업자 123-45-67890"
    labels = {m.label for m in detect(text, [])}
    assert labels == {"이메일", "주민번호", "전화번호", "사업자번호"}


def test_roundtrip_hides_upstream_and_restores(client, monkeypatch):
    sent = {}
    real = upstream.forward

    async def spy(payload, auth):
        sent.update(payload)
        return await real(payload, auth)

    monkeypatch.setattr(upstream, "forward", spy)
    r = chat(client, "연락처 kim@corp.co.kr 로 보내줘")
    assert "kim@corp.co.kr" not in str(sent)
    assert "[이메일_1]" in str(sent)
    assert "kim@corp.co.kr" in r.json()["choices"][0]["message"]["content"]
    assert r.headers["X-Gateway-Redacted"] == "1"


def test_secret_is_blocked_and_value_not_echoed(client):
    r = chat(client, "key sk-abcdefghijklmnopqrstuvwxyz123456")
    assert r.status_code == 403
    assert "sk-abcdef" not in r.text
    assert r.json()["error"]["findings"] == {"시크릿": 1}


def test_industry_template_catches_formulation_ratio(client):
    text = "정제수 72.4% 배합 분석해줘"
    generic = chat(client, text).json()["choices"][0]["message"]["content"]
    assert "72.4%" in generic  # no template -> passes through (the "before")
    r = chat(client, text, industry="cosmetics")
    assert r.headers["X-Gateway-Redacted"] == "1"  # template -> redacted (the "after")
    assert "72.4%" in r.json()["choices"][0]["message"]["content"]  # restored for the employee


def test_ratio_without_context_is_not_flagged(client):
    r = chat(client, "점유율 30% 상승", industry="cosmetics")
    assert r.headers["X-Gateway-Redacted"] == "0"


def test_supplier_capture_group_only(client):
    ms = detect("공급사: 코스맥스 에서 받음", [main.industries["cosmetics"]])
    assert [("공급처")] == [m.label for m in ms]
    assert "공급사" not in "공급사: 코스맥스 에서 받음"[ms[0].start : ms[0].end]


def test_unknown_industry_and_stream(client):
    assert chat(client, "hi", industry="nope").status_code == 400
    r = client.post("/v1/chat/completions", json={"messages": [], "stream": True})
    assert r.status_code == 501
