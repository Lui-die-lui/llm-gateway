"""Exception requests: an employee submits, an admin decides, the employee reads the outcome back."""
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)
REASON = "해외 OEM 파트너에게 보낼 배합 변경 요청서를 번역해야 합니다"


def submit(**over):
    body = {"client_id": "browser-aaaa", "requester": "김민지", "entity": "조성비 ×6", "site": "chatgpt.com", "reason": REASON, "scope": "1회"}
    body.update(over)
    return client.post("/v1/exceptions", json=body)


def test_submit_then_the_admin_sees_it_pending():
    r = submit()
    assert r.status_code == 200
    made = r.json()
    assert made["id"].startswith("REQ-") and made["status"] == "pending" and made["requester"] == "김민지"
    listed = client.get("/v1/exceptions").json()
    assert [x["id"] for x in listed] == [made["id"]]


def test_reason_must_be_long_enough_and_scope_known():
    assert submit(reason="짧음").status_code == 422
    assert submit(scope="영원히").status_code == 422
    assert client.get("/v1/exceptions").json() == []


def test_a_nameless_requester_is_told_apart_by_the_browser_id():
    assert submit(requester="", client_id="browser-wxyz").json()["requester"] == "직원-wxyz"


def test_mine_only_returns_this_browsers_requests():
    submit(client_id="browser-aaaa")
    submit(client_id="browser-bbbb")
    mine = client.get("/v1/exceptions/mine", params={"client_id": "browser-bbbb"}).json()
    assert len(mine) == 1
    assert client.get("/v1/exceptions/mine").status_code == 422  # a client id is required


def test_approve_records_the_decision_for_the_employee():
    rid = submit().json()["id"]
    r = client.post(f"/v1/exceptions/{rid}/decide", json={"decision": "approved", "ttl": "1h", "memo": "한 번만 허용"})
    assert r.status_code == 200
    assert r.json()["status"] == "approved"
    mine = client.get("/v1/exceptions/mine", params={"client_id": "browser-aaaa"}).json()[0]
    assert mine["status"] == "approved" and mine["ttl"] == "1h" and mine["memo"] == "한 번만 허용"


def test_reject_drops_the_ttl_and_a_second_decision_is_refused():
    rid = submit().json()["id"]
    done = client.post(f"/v1/exceptions/{rid}/decide", json={"decision": "rejected", "ttl": "24h", "memo": "내부 모델 먼저"}).json()
    assert done["status"] == "rejected" and done["ttl"] is None
    again = client.post(f"/v1/exceptions/{rid}/decide", json={"decision": "approved"})
    assert again.status_code == 409 and again.json()["error"]["type"] == "already_decided"


def test_unknown_request_is_404():
    assert client.post("/v1/exceptions/REQ-9999/decide", json={"decision": "approved"}).status_code == 404
    assert client.post("/v1/exceptions/nope/decide", json={"decision": "approved"}).status_code == 404


def test_admin_endpoints_need_the_token_but_submitting_and_mine_do_not(monkeypatch):
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "s3cret")
    assert submit().status_code == 200
    assert client.get("/v1/exceptions/mine", params={"client_id": "browser-aaaa"}).status_code == 200
    assert client.get("/v1/exceptions").status_code == 401
    assert client.post("/v1/exceptions/REQ-0001/decide", json={"decision": "approved"}).status_code == 401
    assert client.get("/v1/exceptions", headers={"X-Admin-Token": "s3cret"}).status_code == 200
