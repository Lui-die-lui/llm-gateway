from fastapi.testclient import TestClient

from app import main, sessions

client = TestClient(main.app)


def test_sanitize_then_restore_roundtrip():
    r = client.post("/v1/sanitize", json={"text": "연락처 kim@corp.co.kr", "industries": []})
    body = r.json()
    assert body["text"] == "연락처 [이메일_1]"
    assert body["findings"] == {"이메일": 1}
    back = client.post("/v1/restore", json={"vault_id": body["vault_id"], "text": "답장은 [이메일_1] 로 보냈어요"})
    assert back.json()["text"] == "답장은 kim@corp.co.kr 로 보냈어요"


def test_vault_id_reuse_keeps_numbering():
    first = client.post("/v1/sanitize", json={"text": "a@b.com"}).json()
    second = client.post("/v1/sanitize", json={"text": "c@d.com and a@b.com", "vault_id": first["vault_id"]}).json()
    assert second["vault_id"] == first["vault_id"]
    assert second["text"] == "[이메일_2] and [이메일_1]"


def test_industry_applies_and_block_returns_403():
    r = client.post("/v1/sanitize", json={"text": "정제수 72.4% 배합", "industries": ["cosmetics"]})
    assert r.json()["findings"] == {"조성비": 1}
    b = client.post("/v1/sanitize", json={"text": "sk-abcdefghijklmnopqrstuvwxyz123456"})
    assert b.status_code == 403
    assert "sk-abcdef" not in b.text


def test_unknown_vault_and_industry():
    assert client.post("/v1/restore", json={"vault_id": "nope", "text": "x"}).status_code == 404
    assert client.post("/v1/sanitize", json={"text": "x", "vault_id": "nope"}).status_code == 404
    assert client.post("/v1/sanitize", json={"text": "x", "industries": ["zzz"]}).status_code == 400


def test_expired_vault_is_gone(monkeypatch):
    vault_id = client.post("/v1/sanitize", json={"text": "a@b.com"}).json()["vault_id"]
    monkeypatch.setattr(sessions.time, "monotonic", lambda: 10**9)
    assert client.post("/v1/restore", json={"vault_id": vault_id, "text": "[이메일_1]"}).status_code == 404
