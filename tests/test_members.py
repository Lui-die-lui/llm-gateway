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
    assert client.get("/v1/members").json() == {"members": [], "pending": []}
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
