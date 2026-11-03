"""Console settings (read-only, real state) and the Slack notice (a real HTTP post to the webhook; here to a receiver on this machine)."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from app import notify
from app.main import app

client = TestClient(app)
SECRET_PATH = "/services/T000/B000/xxxxSECRETxxxx"


class Receiver:
    def __init__(self, status=200):
        self.got: list[dict] = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                outer.got.append({"path": self.path, "json": json.loads(body)})
                self.send_response(status)
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *a):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_port}{SECRET_PATH}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def wait(self, n=1, secs=3.0):
        end = time.time() + secs
        while len(self.got) < n and time.time() < end:
            time.sleep(0.02)
        return self.got

    def close(self):
        self.server.shutdown()


@pytest.fixture
def receiver():
    r = Receiver()
    yield r
    r.close()


REQ = {"client_id": "b-test0000", "requester": "시연 계정", "entity": "조성비", "site": "chatgpt.com", "reason": "해외 파트너에게 보낼 배합 요청서 번역에 수치가 그대로 필요합니다", "scope": "1시간"}


def test_settings_reports_real_state_and_no_secrets(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    monkeypatch.setenv("GATEWAY_API_KEYS", "ext:gw_supersecretvalue")
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "adm-supersecret")
    r = client.get("/v1/settings", headers={"X-Admin-Token": "adm-supersecret"})
    assert r.status_code == 200
    d = r.json()
    assert d["environment"]["mock"] is True and d["environment"]["admin_protected"] is True
    assert d["keys"]["env_keys"] == 1 and d["keys"]["required"] is True
    assert d["values"] == {"response_scan": True, "vault_ttl_minutes": 30, "once_valid_hours": 24, "keep_decided_days": 180, "notify_new_exception": True, "notify_new_member": True}
    assert d["slack"] == {"configured": False, "host": None, "source": None, "console_link": False}
    assert "supersecret" not in r.text and "gw_" not in r.text


def test_settings_needs_the_admin_token(monkeypatch):
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "adm-x")
    assert client.get("/v1/settings").status_code == 401
    assert client.post("/v1/settings/slack/test").status_code == 401
    assert client.patch("/v1/settings", json={"response_scan": False}).status_code == 401
    assert client.put("/v1/settings/slack", json={"url": ""}).status_code == 401
    assert client.post("/v1/settings/keys", json={"name": "x"}).status_code == 401


def test_slack_test_without_webhook_says_so():
    d = client.post("/v1/settings/slack/test").json()
    assert d["ok"] is False and "SLACK_WEBHOOK_URL" in d["message"]


def test_slack_test_really_posts_and_never_shows_the_address(monkeypatch, receiver):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", receiver.url)
    s = client.get("/v1/settings").json()["slack"]
    assert s["configured"] is True and s["host"] == "127.0.0.1"
    assert "SECRET" not in json.dumps(s)
    d = client.post("/v1/settings/slack/test").json()
    assert d["ok"] is True and "SECRET" not in json.dumps(d)
    got = receiver.wait()
    assert len(got) == 1 and got[0]["path"] == SECRET_PATH and "연동 테스트" in got[0]["json"]["text"]


def test_new_exception_request_notifies_slack_with_metadata_only(monkeypatch, receiver):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", receiver.url)
    monkeypatch.setenv("GATEWAY_CONSOLE_URL", "https://console.example.com/")
    r = client.post("/v1/exceptions", json=REQ)
    assert r.status_code == 200
    got = receiver.wait()
    assert len(got) == 1
    text = got[0]["json"]["text"]
    assert r.json()["id"] in text and "조성비" in text and "chatgpt.com" in text and "1시간" in text and "시연 계정" in text
    assert "https://console.example.com/console/exceptions" in text


def test_slack_down_or_rejecting_never_breaks_the_request(monkeypatch):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "http://127.0.0.1:9/hook")  # nothing listens there
    assert client.post("/v1/exceptions", json=REQ).status_code == 200
    ok, msg = notify.send("x")
    assert ok is False and "127.0.0.1:9" not in msg and "/hook" not in msg
    bad = Receiver(status=404)
    try:
        monkeypatch.setenv("SLACK_WEBHOOK_URL", bad.url)
        ok, msg = notify.send("x")
        assert ok is False and "404" in msg and "SECRET" not in msg
    finally:
        bad.close()


def test_only_https_or_a_local_receiver_counts_as_configured(monkeypatch):
    for url, want in [("https://hooks.slack.com/services/a/b/c", True), ("http://evil.example.com/x", False), ("ftp://x/y", False), ("not a url", False), ("", False)]:
        monkeypatch.setenv("SLACK_WEBHOOK_URL", url)
        assert notify.configured() is want, url


# ---------------------------------------------------------------- what the admin changes, and that the gateway follows it at once

def test_changed_values_are_followed_immediately_and_logged():
    from app import exception_requests, main, sessions
    r = client.patch("/v1/settings", json={"response_scan": False, "vault_ttl_minutes": 60, "once_valid_hours": 2, "keep_decided_days": 30})
    assert r.status_code == 200 and r.json()["values"]["vault_ttl_minutes"] == 60
    assert main.response_scan_enabled() is False
    assert sessions._ttl() == 3600
    assert exception_requests._once_seconds() == 7200 and exception_requests._keep_days() == 30
    assert client.get("/v1/config").json()["response_scan"] is False
    log = r.json()["log"]
    assert any(e["what"] == "답변 검사" and e["detail"] == "켜짐 → 꺼짐" for e in log)
    assert any("30 → 60" in e["detail"] for e in log)
    # an unchanged value is not logged again
    again = client.patch("/v1/settings", json={"vault_ttl_minutes": 60}).json()["log"]
    assert len(again) == len(log)


def test_requests_carry_the_one_use_validity_so_the_extension_counts_the_same(monkeypatch):
    client.patch("/v1/settings", json={"once_valid_hours": 3})
    created = client.post("/v1/exceptions", json=REQ).json()
    assert created["once_seconds"] == 3 * 3600


def test_out_of_range_or_wrong_type_is_refused_and_nothing_is_written():
    for bad in ({"vault_ttl_minutes": 0}, {"vault_ttl_minutes": 100000}, {"once_valid_hours": -1}, {"keep_decided_days": 1}, {"response_scan": "no"}):
        assert client.patch("/v1/settings", json=bad).status_code in (400, 422), bad
    assert client.patch("/v1/settings", json={"vault_ttl_minutes": 60, "once_valid_hours": 0}).status_code in (400, 422)
    assert client.get("/v1/settings").json()["values"]["vault_ttl_minutes"] == 30  # the valid half of a refused request was not kept


def test_slack_webhook_from_the_console(monkeypatch, receiver):
    assert client.put("/v1/settings/slack", json={"url": "http://evil.example.com/x"}).status_code == 422
    d = client.put("/v1/settings/slack", json={"url": receiver.url}).json()
    assert d["slack"]["configured"] is True and d["slack"]["source"] == "console" and d["slack"]["host"] == "127.0.0.1"
    assert "SECRET" not in json.dumps(d)
    client.post("/v1/exceptions", json=REQ)
    assert len(receiver.wait()) == 1
    # alerts can be switched off without losing the address
    client.patch("/v1/settings", json={"notify_new_exception": False})
    client.post("/v1/exceptions", json=REQ)
    time.sleep(0.3)
    assert len(receiver.got) == 1
    assert client.post("/v1/settings/slack/test").json()["ok"] is True  # the test line still goes
    d = client.put("/v1/settings/slack", json={"url": ""}).json()
    assert d["slack"]["configured"] is False and d["slack"]["source"] is None


def test_the_console_webhook_wins_over_the_environment(monkeypatch, receiver):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/env/env/env")
    assert client.get("/v1/settings").json()["slack"] == {"configured": True, "host": "hooks.slack.com", "source": "env", "console_link": False}
    d = client.put("/v1/settings/slack", json={"url": receiver.url}).json()
    assert d["slack"]["source"] == "console" and d["slack"]["host"] == "127.0.0.1"


def test_access_keys_are_made_here_shown_once_and_can_be_revoked():
    body = {"text": "010-2345-6789"}
    assert client.post("/v1/sanitize", json=body).status_code == 200  # no key anywhere: open, as in local development
    made = client.post("/v1/settings/keys", json={"name": "인사팀 앱"})
    assert made.status_code == 200
    key = made.json()["key"]
    assert key.startswith("gw_") and len(key) > 20
    listing = client.get("/v1/settings").json()
    assert key not in json.dumps(listing) and listing["keys"]["required"] is True
    item = listing["keys"]["list"][0]
    assert item["name"] == "인사팀 앱" and item["tail"] == key[-4:] and item["revoked"] is False
    # from now on a key is needed, and this one works
    assert client.post("/v1/sanitize", json=body).status_code == 401
    assert client.post("/v1/sanitize", json=body, headers={"X-Gateway-Key": key}).status_code == 200
    assert client.post("/v1/sanitize", json=body, headers={"Authorization": f"Bearer {key}"}).status_code == 200
    assert client.post("/v1/sanitize", json=body, headers={"X-Gateway-Key": "gw_wrong"}).status_code == 401
    # revoked: refused again (and with no key left, the gateway is open again, which the page warns about)
    assert client.delete(f"/v1/settings/keys/{item['id']}").status_code == 200
    assert client.get("/v1/settings").json()["keys"]["list"][0]["revoked"] is True
    assert client.delete(f"/v1/settings/keys/{item['id']}").status_code == 404
    assert any("폐기" in e["detail"] for e in client.get("/v1/settings").json()["log"])


def test_keys_are_stored_as_a_hash_and_env_keys_keep_working(monkeypatch):
    from app import settings as st
    monkeypatch.setenv("GATEWAY_API_KEYS", "ext:gw_fromenv")
    key = client.post("/v1/settings/keys", json={"name": "새 앱"}).json()["key"]
    stored = [r["hash"] for r in st._db.execute("SELECT hash FROM api_keys")]
    assert stored and key not in stored and all(len(h) == 64 for h in stored)
    body = {"text": "hello"}
    assert client.post("/v1/sanitize", json=body, headers={"X-Gateway-Key": "gw_fromenv"}).status_code == 200
    assert client.post("/v1/sanitize", json=body, headers={"X-Gateway-Key": key}).status_code == 200
    assert client.post("/v1/sanitize", json=body).status_code == 401
    assert client.post("/v1/settings/keys", json={"name": "  "}).status_code in (400, 422)


def test_data_counts_and_clearing_are_logged():
    client.post("/v1/exceptions", json=REQ)
    client.post("/v1/sanitize", json={"text": "010-2345-6789"})
    d = client.get("/v1/settings").json()
    assert d["data"]["exception_requests"] == 1 and d["data"]["audit_events"] >= 1
    assert client.delete("/v1/exceptions").json()["deleted"] == 1
    client.delete("/v1/audit/events")
    d = client.get("/v1/settings").json()
    assert d["data"] == {"audit_events": 0, "exception_requests": 0, "members": 0}
    assert sum(1 for e in d["log"] if e["what"] == "데이터 비우기") == 2
