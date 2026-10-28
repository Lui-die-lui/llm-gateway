"""Company policy: custom rules, draft -> apply -> versions, built-in switches, the log action, the rules catalog."""
import pytest
from fastapi.testclient import TestClient

from app import audit, company_policy, detector, main, rules_catalog

client = TestClient(main.app)


def rule(**over):
    body = {"name": "프로젝트명", "kind": "words", "action": "redact", "words": "프로젝트 블루문\n코드명 HB-21", "tag": "[프로젝트_n]"}
    body.update(over)
    return body


def add(**over) -> str:
    r = client.post("/v1/policy/rules", json=rule(**over))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def analyze(text, **extra):
    return client.post("/v1/analyze", json={"text": text, **extra}).json()


# ---- catalog ------------------------------------------------------------------

def test_every_builtin_label_is_in_the_catalog():
    """Adding a detector rule without a catalog entry would make it invisible (and un-switchable) in the console."""
    labels = {label for label, *_ in detector.BUILTIN_RULES} | {"시크릿"}
    assert labels <= rules_catalog.covered_labels()


def test_catalog_endpoint_lists_groups_with_default_actions():
    groups = client.get("/v1/rules/builtin").json()["groups"]
    assert [g["id"] for g in groups] == ["basic", "secret"]
    actions = {r["id"]: r["action"] for g in groups for r in g["rules"]}
    assert actions["b:이메일"] == "redact" and actions["s:apikey"] == "block"


# ---- draft / apply / versions ---------------------------------------------------

def test_draft_rules_do_nothing_until_applied():
    add()
    assert analyze("프로젝트 블루문 일정")["findings"] == {}
    assert client.get("/v1/policy").json()["pending"] == [{"ruleId": "r1", "note": "프로젝트명 규칙 새로 만듦"}]
    # the playground can try the draft first
    assert analyze("프로젝트 블루문 일정", use_draft=True)["sanitized"] == "[프로젝트_1] 일정"

    assert client.post("/v1/policy/apply").json() == {"version": 1, "applied": 1}
    assert analyze("프로젝트 블루문 일정")["sanitized"] == "[프로젝트_1] 일정"
    assert client.get("/v1/policy").json()["pending"] == []
    assert client.post("/v1/policy/apply").status_code == 400  # nothing to apply


def test_policy_applies_to_chat_and_sanitize_not_only_analyze(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    add()
    client.post("/v1/policy/apply")
    r = client.post("/v1/sanitize", json={"text": "프로젝트 블루문"})
    assert r.json()["text"] == "[프로젝트_1]"
    r = client.post("/v1/chat/completions", json={"model": "x", "messages": [{"role": "user", "content": "프로젝트 블루문"}]})
    assert r.status_code == 200 and r.headers["X-Gateway-Redacted"] == "1"


def test_toggle_edit_delete_are_pending_changes_with_notes():
    rid = add()
    client.post("/v1/policy/apply")
    client.post(f"/v1/policy/rules/{rid}/toggle")
    assert client.get("/v1/policy").json()["pending"][0]["note"] == "프로젝트명 끄기"
    client.post(f"/v1/policy/rules/{rid}/toggle")
    assert client.get("/v1/policy").json()["pending"] == []  # toggled back: no change left
    client.put(f"/v1/policy/rules/{rid}", json=rule(words="새 단어"))
    assert client.get("/v1/policy").json()["pending"][0]["note"] == "프로젝트명 수정"
    client.delete(f"/v1/policy/rules/{rid}")
    assert client.get("/v1/policy").json()["pending"][0]["note"] == "프로젝트명 삭제"
    client.post("/v1/policy/apply")
    assert analyze("프로젝트 블루문")["findings"] == {}


def test_versions_and_rollback():
    add()
    client.post("/v1/policy/apply")  # v1: one rule
    client.delete("/v1/policy/rules/r1")
    client.post("/v1/policy/apply")  # v2: none
    assert analyze("프로젝트 블루문")["findings"] == {}
    versions = client.get("/v1/policy/versions").json()
    assert [v["version"] for v in versions] == [2, 1] and versions[1]["rules"] == 1
    assert client.post("/v1/policy/versions/1/rollback").json()["version"] == 3  # a new version, not a rewrite of history
    assert analyze("프로젝트 블루문")["sanitized"] == "[프로젝트_1]"
    assert client.post("/v1/policy/versions/99/rollback").status_code == 404


def test_policy_survives_a_restart(tmp_path):
    path = str(tmp_path / "policy.db")
    company_policy.configure(path)
    add()
    client.post("/v1/policy/apply")
    company_policy.configure(path)  # "restart"
    assert analyze("프로젝트 블루문")["sanitized"] == "[프로젝트_1]"
    assert client.get("/v1/policy").json()["version"] == 1
    company_policy.configure(":memory:")


# ---- rule kinds and actions -------------------------------------------------------

def test_pattern_rule_uses_the_capture_group_and_block_beats_redact():
    add(name="사번", kind="pattern", pattern=r"사번 (EMP-\d{4})", words="", tag="[번호_n]")
    add(name="금지어", kind="words", action="block", words="극비")
    client.post("/v1/policy/apply")
    r = analyze("사번 EMP-1234 확인")
    assert r["sanitized"] == "사번 [번호_1] 확인"
    assert analyze("극비 자료")["route"] == "block"


def test_log_action_records_but_does_not_mask_or_count_as_masked(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    add(name="참고", words="내부용", action="log", tag="")
    client.post("/v1/policy/apply")
    r = analyze("내부용 문서")
    assert r["sanitized"] == "내부용 문서" and r["findings"] == {} and r["spans"][0]["action"] == "log"
    s = client.post("/v1/sanitize", json={"text": "내부용 문서"}).json()
    assert s["text"] == "내부용 문서" and s["findings"] == {}
    f = client.get("/v1/stats/summary").json()["findings"]
    assert {"direction": "request", "label": "참고", "action": "log", "count": 1} in f
    assert client.get("/v1/stats/summary").json()["redacted_items"] == 0


def test_builtin_rule_changes_the_action_for_chosen_labels():
    add(name="이메일 차단", kind="builtin", action="block", builtins=["이메일"], words="")
    client.post("/v1/policy/apply")
    assert analyze("a@b.com")["route"] == "block"
    assert analyze("010-1234-5678")["route"] == "external"  # untouched


def test_secrets_cannot_be_downgraded():
    r = client.post("/v1/policy/rules", json=rule(name="키", kind="builtin", action="redact", builtins=["API 키"], words=""))
    assert r.status_code == 422 and "보안 정보" in r.json()["error"]["message"]


def test_disabled_rule_is_ignored():
    rid = add()
    client.post(f"/v1/policy/rules/{rid}/toggle")  # draft: off
    client.post("/v1/policy/apply")
    assert analyze("프로젝트 블루문")["findings"] == {}


@pytest.mark.parametrize(
    "bad",
    [
        {"name": " "},
        {"words": "  \n"},
        {"kind": "pattern", "pattern": "("},
        {"kind": "pattern", "pattern": "a*"},  # matches the empty string: would hit everywhere
        {"kind": "ai", "ai": ""},
        {"kind": "builtin", "builtins": ["없는항목"]},
        {"action": "delete"},
    ],
)
def test_invalid_rules_are_rejected_in_the_gateway_error_shape(bad):
    r = client.post("/v1/policy/rules", json=rule(**bad))
    assert r.status_code == 422
    assert r.json()["error"]["type"] == "invalid_request" and r.json()["error"]["message"]


# ---- built-in switches --------------------------------------------------------------

def test_switching_off_a_builtin_stops_detection_for_requests_and_responses():
    assert analyze("a@b.com")["findings"] == {"이메일": 1}
    r = client.put("/v1/policy/builtin", json={"enabled": {"b:이메일": False}})
    assert r.json() == {"version": 1, "applied": {"b:이메일": False}}
    assert analyze("a@b.com")["findings"] == {}
    assert analyze("010-1234-5678")["findings"] == {"전화번호": 1}
    client.put("/v1/policy/builtin", json={"enabled": {"b:이메일": True}})
    assert analyze("a@b.com")["findings"] == {"이메일": 1}


def test_a_secret_label_is_only_off_when_every_secret_entry_is():
    key = "sk-abcdefghijklmnopqrstuvwxyz123456"
    client.put("/v1/policy/builtin", json={"enabled": {"s:apikey": False}})
    assert analyze(key)["route"] == "block"  # password / db url / private key entries still on
    client.put("/v1/policy/builtin", json={"enabled": {k: False for k in ("s:password", "s:dburl", "s:privkey")}})
    assert analyze(key)["findings"] == {}


def test_switching_off_a_template_entity():
    text = "정제수 72.4% 배합"
    assert "조성비" in analyze(text, industries=["cosmetics"])["findings"]
    client.put("/v1/policy/builtin", json={"enabled": {"i:cosmetics:formulation_ratio": False}})
    assert "조성비" not in analyze(text, industries=["cosmetics"])["findings"]


def test_unknown_builtin_key_is_rejected():
    assert client.put("/v1/policy/builtin", json={"enabled": {"x:nope": False}}).status_code == 400


# ---- admin gate -----------------------------------------------------------------------

def test_policy_endpoints_need_the_admin_token_when_configured(monkeypatch):
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "s3cret")
    for method, path in (("get", "/v1/policy"), ("post", "/v1/policy/apply"), ("put", "/v1/policy/builtin"), ("get", "/v1/policy/versions")):
        assert getattr(client, method)(path).status_code == 401, path
    assert client.get("/v1/rules/builtin").status_code == 200  # the catalog is public like /v1/industries
    assert client.get("/v1/policy", headers={"X-Admin-Token": "s3cret"}).status_code == 200


def test_audit_log_never_contains_the_company_words():
    add(words="프로젝트 블루문")
    client.post("/v1/policy/apply")
    client.post("/v1/sanitize", json={"text": "프로젝트 블루문 일정"})
    rows = audit._db.execute("SELECT * FROM requests").fetchall() + audit._db.execute("SELECT * FROM findings").fetchall()
    assert "블루문" not in str([tuple(r) for r in rows])
