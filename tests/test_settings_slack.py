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
    assert d["upstream"]["mock"] is True
    assert d["protection"]["caller_auth"] is True and d["protection"]["caller_keys"] == 1 and d["protection"]["admin_protected"] is True
    assert d["retention"]["vault_ttl_seconds"] == 1800 and d["retention"]["stores_prompt_text"] is False
    assert d["slack"] == {"configured": False, "host": None, "console_link": False}
    assert "supersecret" not in r.text and "gw_" not in r.text


def test_settings_needs_the_admin_token(monkeypatch):
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "adm-x")
    assert client.get("/v1/settings").status_code == 401
    assert client.post("/v1/settings/slack/test").status_code == 401


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
