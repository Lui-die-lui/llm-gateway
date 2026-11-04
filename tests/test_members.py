"""Members and sign-up requests: a public join form, the admin's decision, Slack notice, and nothing sensitive stored."""
import json

from fastapi.testclient import TestClient

from app import members
from app.main import app
from tests.test_settings_slack import Receiver  # a receiver on this machine standing in for Slack

client = TestClient(app)
JOIN = {"name": "김서연", "email": "Seoyeon.Kim@Example.com", "dept": "마케팅"}


def test_join_then_admin_approves_and_the_person_becomes_a_member():
    r = client.post("/v1/members/join", json=JOIN)
    assert r.status_code == 200 and r.json() == {"id": "M-0001", "status": "pending"}
    d = client.get("/v1/members").json()
    assert d["members"] == [] and len(d["pending"]) == 1
    assert d["pending"][0]["email"] == "seoyeon.kim@example.com"  # mail addresses are compared in lower case
    a = client.post("/v1/members/M-0001/approve")
    assert a.status_code == 200 and a.json()["status"] == "active" and a.json()["decided"]
    d = client.get("/v1/members").json()
    assert [m["name"] for m in d["members"]] == ["김서연"] and d["pending"] == []
    assert client.post("/v1/members/M-0001/approve").status_code == 404  # already decided


def test_reject_removes_the_request_and_the_person_may_apply_again():
    client.post("/v1/members/join", json=JOIN)
    assert client.post("/v1/members/M-0001/reject").status_code == 200
    d = client.get("/v1/members").json()
    assert d["members"] == [] and d["pending"] == []
    assert client.post("/v1/members/join", json=JOIN).status_code == 200
    log = client.get("/v1/settings").json()["log"]
    assert any(e["what"] == "가입 반려" and "seoyeon.kim@example.com" in e["detail"] for e in log)


def test_join_is_checked_and_duplicates_refused():
    for bad in ({**JOIN, "name": ""}, {**JOIN, "name": "가" * 21}, {**JOIN, "email": "not-a-mail"}, {**JOIN, "email": "a@b"}, {**JOIN, "dept": "부" * 31}):
        assert client.post("/v1/members/join", json=bad).status_code in (400, 422), bad
    assert client.post("/v1/members/join", json=JOIN).status_code == 200
    again = client.post("/v1/members/join", json={**JOIN, "email": "SEOYEON.KIM@example.com"})
    assert again.status_code == 409  # the same address, whatever its case


def test_the_list_decisions_and_clearing_need_the_admin_token(monkeypatch):
    client.post("/v1/members/join", json=JOIN)
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "adm-x")
    assert client.post("/v1/members/join", json={**JOIN, "email": "other@example.com"}).status_code == 200  # joining stays open
    for call in (client.get("/v1/members"), client.post("/v1/members/M-0001/approve"), client.post("/v1/members/M-0001/reject"), client.delete("/v1/members/M-0001"), client.delete("/v1/members")):
        assert call.status_code == 401
    assert client.get("/v1/members", headers={"X-Admin-Token": "adm-x"}).status_code == 200


def test_remove_member_and_clear_are_logged():
    for i in range(3):
        client.post("/v1/members/join", json={**JOIN, "email": f"p{i}@example.com", "name": f"사람{i}"})
    client.post("/v1/members/M-0001/approve")
    assert client.delete("/v1/members/M-0002").status_code == 404  # a waiting request is rejected, not deleted
    assert client.delete("/v1/members/M-0001").status_code == 200
    assert client.delete("/v1/members").json()["deleted"] == 2
    assert client.get("/v1/settings").json()["data"]["members"] == 0
    whats = [e["what"] for e in client.get("/v1/settings").json()["log"]]
    assert "가입 승인" in whats and "구성원 삭제" in whats and "데이터 비우기" in whats


def test_join_pending_cap(monkeypatch):
    monkeypatch.setattr(members, "MAX_PENDING", 2)
    for i in range(2):
        assert client.post("/v1/members/join", json={**JOIN, "email": f"c{i}@example.com"}).status_code == 200
    assert client.post("/v1/members/join", json={**JOIN, "email": "c9@example.com"}).status_code == 429


def test_new_join_notifies_slack_and_the_switch_turns_it_off(monkeypatch):
    rcv = Receiver()
    try:
        monkeypatch.setenv("SLACK_WEBHOOK_URL", rcv.url)
        monkeypatch.setenv("GATEWAY_CONSOLE_URL", "https://console.example.com")
        client.post("/v1/members/join", json=JOIN)
        got = rcv.wait()
        assert len(got) == 1
        text = got[0]["json"]["text"]
        assert "M-0001" in text and "김서연" in text and "마케팅" in text and "https://console.example.com/console/members" in text
        client.patch("/v1/settings", json={"notify_new_member": False})
        client.post("/v1/members/join", json={**JOIN, "email": "second@example.com"})
        import time
        time.sleep(0.3)
        assert len(rcv.got) == 1
    finally:
        rcv.close()


def test_no_password_or_secret_is_ever_stored_or_returned():
    client.post("/v1/members/join", json={**JOIN, "password": "hunter2", "token": "abc"})  # unknown fields are ignored, not stored
    row = dict(members._db.execute("SELECT * FROM members").fetchone())
    assert set(row) == {"id", "name", "email", "dept", "status", "created", "decided"}
    assert "hunter2" not in json.dumps(client.get("/v1/members").json())


# ---------------------------------------------------------------- departments, linked browsers, and the log that knows who sent what

def _member(name, mail, dept):
    mid = client.post("/v1/members/join", json={"name": name, "email": mail, "dept": dept}).json()["id"]
    client.post(f"/v1/members/{mid}/approve")
    return mid


def test_departments_are_a_small_fixed_list_and_the_join_checks_it():
    assert client.get("/v1/members/departments").json()["departments"] == ["경영지원", "개발", "영업", "마케팅"]
    assert client.post("/v1/members/join", json={**JOIN, "dept": "연구소"}).status_code == 422  # not one of them
    assert client.post("/v1/members/join", json={**JOIN, "dept": ""}).status_code == 200  # optional
    assert client.get("/v1/members").json()["departments"] == ["경영지원", "개발", "영업", "마케팅"]


def test_a_browser_is_linked_to_an_approved_member_by_mail_and_can_unlink():
    client.post("/v1/members/join", json=JOIN)  # still waiting
    assert client.post("/v1/members/link", json={"email": JOIN["email"], "client_id": "b-aaaa1111"}).status_code == 404
    client.post("/v1/members/M-0001/approve")
    r = client.post("/v1/members/link", json={"email": "SEOYEON.KIM@example.com", "client_id": "b-aaaa1111"})
    assert r.status_code == 200 and r.json() == {"name": "김서연", "dept": "마케팅"}
    assert client.get("/v1/members/me", params={"client_id": "b-aaaa1111"}).json() == {"linked": True, "name": "김서연", "dept": "마케팅"}
    assert client.get("/v1/members/me", params={"client_id": "b-other000"}).json() == {"linked": False}
    assert client.get("/v1/members").json()["members"][0]["browsers"] == 1
    assert "b-aaaa1111" not in json.dumps(client.get("/v1/members").json())  # the id is never listed
    assert client.post("/v1/members/link", json={"email": "nobody@example.com", "client_id": "b-aaaa1111"}).status_code == 404
    assert client.delete("/v1/members/link", params={"client_id": "b-aaaa1111"}).status_code == 200
    assert client.get("/v1/members/me", params={"client_id": "b-aaaa1111"}).json() == {"linked": False}


def test_the_log_says_who_sent_it_and_filters_by_department_person_and_exception(monkeypatch):
    seo = _member("김서연", "seoyeon@example.com", "마케팅")
    _member("이도윤", "doyoon@example.com", "개발")
    for mail, cid in (("seoyeon@example.com", "b-seo00001"), ("doyoon@example.com", "b-do000001")):
        client.post("/v1/members/link", json={"email": mail, "client_id": cid})
    for cid in ("b-seo00001", "b-seo00001", "b-do000001", "b-stranger1"):
        client.post("/v1/sanitize", json={"text": "010-2345-6789", "site": "chatgpt.com", "client_id": cid})
    allrows = client.get("/v1/audit/events").json()
    assert len(allrows) == 4 and all("client_id" not in r for r in allrows)  # the browser id is not returned
    assert {r["user"] for r in allrows} == {"김서연", "이도윤", None}
    mk = client.get("/v1/audit/events", params={"dept": "마케팅"})
    assert mk.headers["X-Total-Count"] == "2" and {r["dept"] for r in mk.json()} == {"마케팅"}
    assert client.get("/v1/audit/events", params={"dept": "개발"}).headers["X-Total-Count"] == "1"
    assert client.get("/v1/audit/events", params={"dept": "영업"}).headers["X-Total-Count"] == "0"  # a department nobody is linked to matches nothing
    assert client.get("/v1/audit/events", params={"user": seo}).headers["X-Total-Count"] == "2"
    assert client.get("/v1/audit/events", params={"site": "chatgpt.com"}).headers["X-Total-Count"] == "4"
    assert client.get("/v1/audit/events", params={"exception": "true"}).headers["X-Total-Count"] == "0"


def test_exception_filter_finds_what_an_approved_exception_let_through():
    cid = "b-excep0001"
    r = client.post("/v1/exceptions", json={"client_id": cid, "entity": "전화번호", "site": "chatgpt.com", "scope": "24시간", "reason": "고객 응대 업무에 번호가 그대로 필요합니다 확인 부탁드려요"}).json()
    client.post(f"/v1/exceptions/{r['id']}/decide", json={"decision": "approved", "ttl": "24h", "memo": ""})
    client.post("/v1/sanitize", json={"text": "010-2345-6789", "site": "chatgpt.com", "client_id": cid})  # let through under the approval
    client.post("/v1/sanitize", json={"text": "kim@corp.co.kr", "site": "chatgpt.com", "client_id": cid})  # a kind that was not approved: masked
    ex = client.get("/v1/audit/events", params={"exception": "true"})
    assert ex.headers["X-Total-Count"] == "1" and ex.json()[0]["exception_id"] == r["id"]
    assert client.get("/v1/audit/events", params={"exception": "false"}).headers["X-Total-Count"] == "1"


def test_removing_a_member_unlinks_the_browsers():
    mid = _member("김서연", "seoyeon@example.com", "마케팅")
    client.post("/v1/members/link", json={"email": "seoyeon@example.com", "client_id": "b-seo00001"})
    client.delete(f"/v1/members/{mid}")
    assert client.get("/v1/members/me", params={"client_id": "b-seo00001"}).json() == {"linked": False}
