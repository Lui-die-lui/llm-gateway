"""Anomalies are computed from the real audit log; clearing data is admin-only."""
import time

from fastapi.testclient import TestClient

from app import audit, main
from app.detector import Match

client = TestClient(main.app)
KEY = "sk-abcdefghijklmnopqrstuvwx1234"


def record(status="ok", matches=(), site="chatgpt.com", client_name="extension/0.5.0", **kw):
    audit.record(
        endpoint="sanitize", status=status, route="external", provider="browser", industries=[], use_case=None,
        stream=False, latency_ms=3, site=site, client=client_name, request_matches=list(matches), **kw,
    )


def secret_block():
    record(status="blocked", matches=[Match(0, 5, "시크릿", "block", 3)])


def test_nothing_unusual_means_an_empty_list():
    record(matches=[Match(0, 3, "사람", "redact", 2)])
    assert client.get("/v1/anomalies").json() == []


def test_repeated_blocked_secrets_from_one_source_are_high():
    for _ in range(3):
        secret_block()
    found = client.get("/v1/anomalies").json()
    assert [a["sev"] for a in found] == ["HIGH"]
    assert "extension/0.5.0" in found[0]["desc"] and "3회" in found[0]["desc"]
    assert found[0]["primary_href"] == "/console/logs" and found[0]["acked"] is False


def test_two_blocked_secrets_are_not_enough():
    secret_block()
    secret_block()
    assert client.get("/v1/anomalies").json() == []


def test_the_real_pipeline_feeds_it():
    """Not just hand-made rows: three real sends with a key in them end up as an anomaly."""
    for _ in range(3):
        assert client.post("/v1/sanitize", json={"text": f"키는 {KEY} 입니다", "site": "chatgpt.com", "client": "extension/test"}).status_code == 403
    assert [a["sev"] for a in client.get("/v1/anomalies").json()] == ["HIGH"]


def test_a_sudden_rise_in_masking_is_medium_and_compares_with_the_day_before():
    for _ in range(12):
        record(matches=[Match(0, 3, "조성비", "redact", 2)])
    found = client.get("/v1/anomalies").json()
    assert [a["sev"] for a in found] == ["MEDIUM"] and "조성비" in found[0]["title"]
    # the same count spread over the day before is the usual level, so no anomaly
    audit.configure(":memory:")
    old = time.time() - 5 * 3600
    for _ in range(12):
        record(matches=[Match(0, 3, "조성비", "redact", 2)])
    audit._db.execute("UPDATE requests SET ts=?", (old,))
    assert client.get("/v1/anomalies").json() == []


def test_withheld_answers_and_model_errors_are_listed():
    record(status="response_blocked")
    for _ in range(3):
        record(status="upstream_error")
    sevs = {a["sev"] for a in client.get("/v1/anomalies").json()}
    assert sevs == {"MEDIUM", "LOW"}


def test_acknowledging_marks_it_and_keeps_it_marked():
    for _ in range(3):
        secret_block()
    a = client.get("/v1/anomalies").json()[0]
    assert client.post("/v1/anomalies/ack", json={"id": a["id"]}).status_code == 200
    again = client.get("/v1/anomalies").json()
    assert again[0]["id"] == a["id"] and again[0]["acked"] is True


def test_clearing_the_audit_log_and_the_exception_requests():
    for _ in range(3):
        secret_block()
    r = client.post("/v1/exceptions", json={"client_id": "browser-aaaa", "requester": "q", "entity": "이름표", "site": "chatgpt.com", "reason": "해외 OEM 파트너에게 보낼 배합 변경 요청서를 번역해야 합니다", "scope": "1회"})
    assert r.status_code == 200
    assert client.delete("/v1/audit/events").json() == {"deleted": 3}
    assert client.delete("/v1/exceptions").json() == {"deleted": 1}
    assert client.get("/v1/audit/events").json() == [] or client.get("/v1/audit/events").json()["events"] == []
    assert client.get("/v1/exceptions").json() == []
    assert client.get("/v1/anomalies").json() == []
    # numbering starts over
    again = client.post("/v1/exceptions", json={"client_id": "browser-aaaa", "requester": "q", "entity": "이름표", "site": "chatgpt.com", "reason": "해외 OEM 파트너에게 보낼 배합 변경 요청서를 번역해야 합니다", "scope": "1회"}).json()
    assert again["id"] == "REQ-0001"


def test_clearing_needs_the_admin_token_when_one_is_set(monkeypatch):
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "t0ken-for-test")
    for path in ("/v1/audit/events", "/v1/exceptions"):
        assert client.delete(path).status_code == 401
        assert client.delete(path, headers={"X-Admin-Token": "t0ken-for-test"}).status_code == 200
    assert client.get("/v1/anomalies").status_code == 401
    assert client.post("/v1/anomalies/ack", json={"id": "x"}).status_code == 401
