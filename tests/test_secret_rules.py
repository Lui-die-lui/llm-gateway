import re
import time

import pytest
from fastapi.testclient import TestClient

from app import main, secret_rules, upstream
from app.detector import RESPONSE_LABELS, detect
from app.sanitizer import ResponseBlocked, scan_text
from app.stream import StreamFilter
from app.vault import Vault

# Fake values only. Token-shaped strings are assembled from pieces so no real-looking key sits in the repo
# (GitHub push protection); AWS's documented example key is the one literal.
BODY = secret_rules._fake  # repeating, obviously fake


def aws():
    return "key AKIAIOSFODNN7EXAMPLE end"


def github():
    return "token " + "gh" + "p_" + BODY(36)


def google():
    return "key=" + "AIza" + BODY(35)


def private_key():
    return "-----BEGIN " + "RSA PRIVATE KEY-----\n" + BODY(80) + "\n-----END " + "RSA PRIVATE KEY-----"


DB_URL = "postgres://app_user:fakepw1234@db.fake.internal:5432/shop"

SECRETS = {
    "aws": (aws(), "AKIAIOSFODNN7EXAMPLE"),
    "github": (github(), "gh" + "p_" + BODY(36)),
    "google": (google(), "AIza" + BODY(35)),
    "private key": (private_key(), BODY(80)),
    "db url": ("접속 주소 " + DB_URL, "fakepw1234"),
    "password (한글 라벨)": ("비밀번호: fakePw1234!", "fakePw1234!"),
    "password (영문, 대입)": ("DB_PASSWORD=fakepw1234", "fakepw1234"),
    "password (json)": ('{"password": "fakepw1234"}', "fakepw1234"),
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")
    return TestClient(main.app)


# ---- positives ---------------------------------------------------------------

@pytest.mark.parametrize("name", SECRETS)
def test_secret_is_blocked_and_covers_the_value(name):
    text, value = SECRETS[name]
    blocks = [m for m in detect(text, []) if m.label == "시크릿" and m.action == "block"]
    assert blocks, name
    assert any(text[m.start : m.end].find(value) >= 0 or value.find(text[m.start : m.end]) >= 0 for m in blocks)


@pytest.mark.parametrize("name", ["aws", "github", "db url", "password (한글 라벨)"])
def test_gateway_blocks_request_and_never_echoes_value(client, name):
    text, value = SECRETS[name]
    r = client.post("/v1/chat/completions", json={"model": "x", "messages": [{"role": "user", "content": text}]})
    assert r.status_code == 403 and r.json()["error"]["findings"]["시크릿"] >= 1
    assert value not in r.text
    r = client.post("/v1/sanitize", json={"text": text})
    assert r.status_code == 403 and value not in r.text


def test_aws_example_key_is_blocked_despite_gitleaks_allowlist():
    assert any(m.label == "시크릿" for m in detect(aws(), []))


def test_key_glued_to_korean_text_is_still_found():
    # Go's \b is ASCII-only; Python's would see "E입" as no boundary
    assert any(m.label == "시크릿" for m in detect("AKIAIOSFODNN7EXAMPLE입니다", []))


def test_db_password_wins_over_the_email_rule():
    labels = {m.label for m in detect(DB_URL, [])}
    assert labels == {"시크릿"}


def test_generic_api_key_rule_only_redacts():
    text = 'api_key = "' + BODY(32) + '"'
    ms = [m for m in detect(text, []) if m.label == "시크릿"]
    assert ms and {m.action for m in ms} == {"redact"}


def test_response_scan_covers_secrets():
    labels = {m.label for m in detect(aws(), [], only=RESPONSE_LABELS)}
    assert "시크릿" in labels
    with pytest.raises(ResponseBlocked):
        scan_text(aws())


def test_gateway_blocks_a_secret_in_the_model_answer(client, monkeypatch):
    async def fake(payload, auth, route="external"):
        return {"choices": [{"message": {"role": "assistant", "content": "키는 AKIAIOSFODNN7EXAMPLE 입니다"}}]}

    monkeypatch.setattr(upstream, "forward", fake)
    r = client.post("/v1/chat/completions", json={"model": "x", "messages": [{"role": "user", "content": "안녕"}]})
    assert r.status_code == 403 and r.json()["error"]["direction"] == "response"
    assert "AKIAIOSF" not in r.text


def test_stream_filter_blocks_a_secret_split_across_chunks():
    f = StreamFilter(Vault(), scan=True)
    with pytest.raises(ResponseBlocked):
        "".join(f.feed(piece) for piece in ["키는 AKIAIOSF", "ODNN7EXAMPLE 입니다"]) + f.flush()


# ---- gitleaks rules that needed a rewrite ------------------------------------

def test_inline_flag_rewrites_all_verified_against_their_samples():
    loaded = {r.id for r in secret_rules._RULES}
    for rid, sample in secret_rules._SAMPLES.items():
        assert rid in loaded, f"{rid} skipped: {secret_rules.SKIPPED.get(rid)}"
        assert any(m.label == "시크릿" for m in secret_rules.secret_matches(sample)), rid


def test_rewritten_case_rules_follow_gos_scoping():
    # alibaba: LTAI(?i)[a-z0-9]{20} -> the prefix is case-sensitive, only what follows is not
    assert secret_rules.secret_matches(" id = LTAI" + BODY(20).upper() + " ")
    assert not secret_rules.secret_matches(" id = ltai" + BODY(20) + " ")


def test_most_gitleaks_rules_are_loaded():
    assert len(secret_rules._RULES) >= 215
    assert set(secret_rules.SKIPPED) <= {"pkcs12-file"}, secret_rules.SKIPPED


# ---- negatives ---------------------------------------------------------------

@pytest.mark.parametrize(
    "text",
    [
        "비밀번호 변경 주기 알려줘",
        "API 키 발급 방법 알려줘",
        "비밀번호: 변경 주기는 90일입니다",
        "비밀번호는 정기적으로 바꾸세요",
        "Password: required",
        "password: ********",
        "DB_PASSWORD=${DB_PASSWORD}",
        "password = get_password()",  # 코드는 비밀번호가 아님
        "password = new_password",
        "const password = req.body.password;",
        "password = os.getenv('DB_PASSWORD')",
        "postgres://user:password@localhost:5432/db",
        "postgres://user:${DB_PASSWORD}@db:5432/app",
        "오늘 회의에서 고객 문의 응대 방식과 배송 지연 보상 정책을 논의했습니다.",
        "정제수 72.4% 배합 비율과 매입가 12,000원, 마진 22% 공유",
        "이번 분기 점유율 30% 상승, 대출 한도 3억원",
        "api key 와 access token 을 발급받으려면 어떻게 하나요?",
        "git clone git@github.com:octocat/hello.git",
    ],
)
def test_ordinary_text_is_not_flagged_as_secret(text):
    assert not [m for m in detect(text, []) if m.label == "시크릿"], text


def test_every_template_example_stays_clean():
    for ind in main.industries.values():
        for case in ind.tests:
            assert not [m for m in detect(case.text, []) if m.label == "시크릿"], (ind.industry, case.text)


# ---- loading and speed -------------------------------------------------------

def test_rules_are_compiled_once_not_per_call(monkeypatch):
    rules = secret_rules._RULES
    with monkeypatch.context() as mp:
        mp.setattr(re, "compile", lambda *a, **k: pytest.fail("re.compile called while scanning"))
        secret_rules.secret_matches(SECRETS["aws"][0])
        secret_rules.secret_matches("평범한 문장입니다 " * 50)
    assert secret_rules._RULES is rules


def test_long_ordinary_text_is_fast():
    prose = "오늘 회의에서 고객 문의 응대 방식과 배송 지연 보상 정책을 논의했습니다. " * 60  # ~2k chars, no rule keyword
    tech = "서버 설정 파일에서 api key 와 access token, secret, password 항목을 확인하고 auth 방식을 정리했습니다. " * 40
    for text in (prose, tech):
        secret_rules.secret_matches(text)  # warm up
        t0 = time.perf_counter()
        for _ in range(20):
            secret_rules.secret_matches(text)
        assert (time.perf_counter() - t0) / 20 < 0.05  # measured around 1 ms; generous so slow CI does not flake
