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


# ---- an approved request actually lets the item through
KEY = "sk-" + "a1B2c3D4" * 4
TEXT = f"배포 키는 {KEY} 입니다"


def sanitize(**over):
    body = {"text": TEXT, "client_id": "browser-aaaa", "site": "chatgpt.com"}
    body.update(over)
    return client.post("/v1/sanitize", json=body)


def passes(**over):
    """The text went out with the key as typed (a secret is otherwise blocked with 403)."""
    r = sanitize(**over)
    return r.status_code == 200 and KEY in r.json()["text"]


def approve(entity, ttl):
    rid = submit(entity=entity).json()["id"]
    client.post(f"/v1/exceptions/{rid}/decide", json={"decision": "approved", "ttl": ttl})
    return rid


LABEL = next(iter(client.post("/v1/analyze", json={"text": TEXT}).json()["findings"]))


def test_without_an_approval_the_key_is_blocked():
    assert not passes()


def test_an_approved_kind_goes_through_as_typed_for_that_browser_only(monkeypatch):
    from app import exception_requests as ex

    approve(LABEL, "1h")
    assert passes()
    assert not passes(client_id="browser-bbbb")  # someone else's browser
    assert not passes(site="claude.ai")  # the request named chatgpt.com
    monkeypatch.setattr(ex.time, "time", lambda: 10**10)  # long after the hour is over
    assert not passes()


def test_a_pending_or_rejected_request_lets_nothing_through():
    rid = submit(entity=LABEL).json()["id"]
    assert not passes()
    client.post(f"/v1/exceptions/{rid}/decide", json={"decision": "rejected"})
    assert not passes()


def test_a_one_use_approval_is_spent_by_the_first_message_it_lets_through():
    approve(LABEL, "1x")
    preview = client.post("/v1/analyze", json={"text": TEXT, "client_id": "browser-aaaa", "site": "chatgpt.com"}).json()
    assert KEY in preview["sanitized"]  # the preview spends nothing
    assert passes()
    assert not passes()  # used up


def test_an_approval_only_covers_the_kinds_it_names():
    approve(LABEL, "1h")
    r = sanitize(text=f"{TEXT} 연락처 010-1234-5678")
    assert r.status_code == 200 and KEY in r.json()["text"] and "010-1234-5678" not in r.json()["text"]


def test_the_response_says_which_approval_was_used_and_mine_shows_it_spent():
    rid = approve(LABEL, "1x")
    out = sanitize().json()
    assert out["exceptions"] == [{"id": rid, "once": True, "left": None}]
    mine = client.get("/v1/exceptions/mine", params={"client_id": "browser-aaaa"}).json()
    assert [x["used"] for x in mine if x["id"] == rid] == [True]
    timed = approve(LABEL, "1h")
    left = sanitize().json()["exceptions"][0]
    assert left["id"] == timed and not left["once"] and 3500 < left["left"] <= 3600


def test_a_message_that_is_blocked_anyway_does_not_spend_a_one_use_approval(monkeypatch):
    rid = approve(LABEL, "1x")
    monkeypatch.setattr(main.policy, "decide", lambda *a, **k: "block")  # something else in the text stops it
    assert sanitize().status_code == 403
    monkeypatch.undo()
    assert passes()  # still unused
    mine = client.get("/v1/exceptions/mine", params={"client_id": "browser-aaaa"}).json()
    assert [x["used"] for x in mine if x["id"] == rid] == [True]


def test_a_request_that_names_nothing_cannot_be_approved_but_can_be_rejected():
    rid = submit(entity="").json()["id"]
    r = client.post(f"/v1/exceptions/{rid}/decide", json={"decision": "approved", "ttl": "1h"})
    assert r.status_code == 422 and r.json()["error"]["type"] == "no_entity"
    assert client.post(f"/v1/exceptions/{rid}/decide", json={"decision": "rejected"}).status_code == 200


def test_only_undecided_requests_count_towards_the_cap_and_old_decided_ones_are_dropped(monkeypatch):
    from app import exception_requests as ex

    monkeypatch.setattr(ex, "MAX_PENDING", 2)
    done = submit().json()["id"]
    client.post(f"/v1/exceptions/{done}/decide", json={"decision": "rejected"})
    assert submit().status_code == 200 and submit().status_code == 200  # the decided one does not use up the room
    assert submit().status_code == 429  # two waiting: full
    monkeypatch.setattr(ex, "KEEP_DECIDED_DAYS", -1)  # everything decided counts as old
    submit.__globals__["client"].post(f"/v1/exceptions/{done}/decide", json={"decision": "rejected"})
    assert submit().status_code == 429 and all(x["status"] == "pending" for x in client.get("/v1/exceptions").json())


def test_a_one_use_approval_nobody_used_lapses_after_a_day(monkeypatch):
    from app import exception_requests as ex

    approve(LABEL, "1x")
    assert passes()
    approve(LABEL, "1x")
    monkeypatch.setattr(ex.time, "time", lambda: 10**10)
    assert not passes()  # a day has long gone by


def test_an_admin_can_take_an_approval_back():
    rid = approve(LABEL, "1h")
    assert client.post(f"/v1/exceptions/{rid}/revoke").json()["revoked"] is True
    assert not passes()
    assert client.post(f"/v1/exceptions/{rid}/revoke").status_code == 409  # already taken back
    assert client.post("/v1/exceptions/REQ-9999/revoke").status_code == 404
    pending = submit().json()["id"]
    assert client.post(f"/v1/exceptions/{pending}/revoke").status_code == 409  # nothing to take back yet
