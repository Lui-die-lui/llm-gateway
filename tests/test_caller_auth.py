"""Who may use the gateway: API keys for apps, the extension and the demo page (the admin token is a separate thing)."""
import pytest
from fastapi.testclient import TestClient

from app import audit, keys, main, upstream

client = TestClient(main.app)
KEYS = "hr-app:gw_hrkey,extension:gw_extkey"


@pytest.fixture
def locked(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    monkeypatch.setenv("GATEWAY_API_KEYS", KEYS)


def chat(headers=None, content="안녕"):
    return client.post("/v1/chat/completions", json={"model": "x", "messages": [{"role": "user", "content": content}]}, headers=headers or {})


def test_without_keys_configured_the_gateway_is_open(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    assert chat().status_code == 200
    assert client.get("/v1/config").json()["caller_auth"] is False


@pytest.mark.parametrize("path,body", [
    ("/v1/chat/completions", {"model": "x", "messages": [{"role": "user", "content": "hi"}]}),
    ("/v1/sanitize", {"text": "hi"}),
    ("/v1/restore", {"vault_id": "x", "text": "hi"}),
])
def test_the_endpoints_that_spend_money_or_memory_need_a_key(locked, path, body):
    r = client.post(path, json=body)
    assert r.status_code == 401
    assert r.json()["error"]["type"] == "unauthorized" and r.headers["www-authenticate"] == "Bearer"
    assert client.post(path, json=body, headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.post(path, json=body, headers={"X-Gateway-Key": "nope"}).status_code == 401
    assert client.post(path, json=body, headers={"Authorization": "gw_hrkey"}).status_code == 401  # not a Bearer header


def test_both_header_styles_work_and_the_name_is_audited(locked):
    assert chat({"Authorization": "Bearer gw_hrkey"}).status_code == 200
    assert chat({"Authorization": "bearer gw_hrkey"}).status_code == 200  # the scheme is case-insensitive
    assert client.post("/v1/sanitize", json={"text": "a@b.com"}, headers={"X-Gateway-Key": "gw_extkey"}).status_code == 200
    callers = [e["caller"] for e in audit.events()[0]]
    assert sorted(callers) == ["extension", "hr-app", "hr-app"]


def test_a_blocked_request_is_still_attributed(locked):
    r = chat({"Authorization": "Bearer gw_hrkey"}, content="sk-abcdefghijklmnopqrstuvwxyz123456")
    assert r.status_code == 403
    assert audit.events()[0][0]["caller"] == "hr-app" and audit.events()[0][0]["status"] == "blocked"


def test_rejected_requests_leave_no_audit_row_and_no_vault(locked):
    client.post("/v1/sanitize", json={"text": "a@b.com"})
    assert audit.events()[1] == 0


def test_the_gateway_key_is_never_sent_to_the_model_provider(locked, monkeypatch):
    seen = []

    async def spy(payload, auth, route="external"):
        seen.append(auth)
        return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

    monkeypatch.setattr(upstream, "forward", spy)
    assert chat({"Authorization": "Bearer gw_hrkey"}).status_code == 200
    assert seen == [None]


def test_without_keys_the_callers_own_authorization_still_goes_through(monkeypatch):
    """The older setup: the app sends its own provider key and the gateway passes it on."""
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    seen = []

    async def spy(payload, auth, route="external"):
        seen.append(auth)
        return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

    monkeypatch.setattr(upstream, "forward", spy)
    chat({"Authorization": "Bearer sk-theirs"})
    assert seen == ["Bearer sk-theirs"]


def test_dry_run_and_info_endpoints_and_admin_stay_as_they_were(locked, monkeypatch):
    assert client.get("/health").status_code == 200
    assert client.get("/v1/industries").status_code == 200
    assert client.get("/v1/rules/builtin").status_code == 200
    assert client.post("/v1/analyze", json={"text": "a@b.com"}).status_code == 200  # dry run: nothing is stored or sent
    assert client.get("/v1/config").json()["caller_auth"] is True
    # an API key does not open the admin side
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "adm")
    assert client.get("/v1/policy", headers={"Authorization": "Bearer gw_hrkey", "X-Gateway-Key": "gw_hrkey"}).status_code == 401


def test_malformed_key_entries_are_ignored(monkeypatch):
    monkeypatch.setenv("GATEWAY_API_KEYS", "no-colon,:nokey,name:,ok:gw_1")
    assert main.api_keys() == {"gw_1": "ok"}


def test_key_generator():
    entry = keys.new_entry("hr-app")
    name, _, key = entry.partition(":")
    assert name == "hr-app" and key.startswith("gw_") and len(key) > 30
    assert keys.new_entry("hr-app") != entry
    for bad in ("", "a b", "a:b", "a,b"):
        with pytest.raises(ValueError):
            keys.new_entry(bad)


def test_old_audit_databases_get_the_caller_column(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    db = sqlite3.connect(path)
    db.executescript(
        "CREATE TABLE requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, endpoint TEXT NOT NULL,"
        " provider TEXT NOT NULL, route TEXT NOT NULL, status TEXT NOT NULL, industries TEXT NOT NULL, use_case TEXT,"
        " stream INTEGER NOT NULL, latency_ms INTEGER NOT NULL, site TEXT, client TEXT);"
        "INSERT INTO requests VALUES (1, 1.0, 'chat', 'mock', 'external', 'ok', '', NULL, 0, 5, NULL, NULL);"
    )
    db.commit()
    db.close()
    audit.configure(str(path))
    rows, total = audit.events()
    assert total == 1 and rows[0]["caller"] is None
    audit.configure(":memory:")
