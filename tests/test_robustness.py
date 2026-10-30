"""Odd and hostile input: malformed requests are 400 (never 500), and nothing a client sends can make the server crawl.

Detection is regex based and Python's `re` holds the GIL, so a pattern that is quadratic on some input stalls every request.
"""
import random
import re
import time

import pytest
from fastapi.testclient import TestClient

from app import detector, main
from app.detector import Match, detect

client = TestClient(main.app, raise_server_exceptions=False)
M = [{"role": "user", "content": "hi"}]


@pytest.fixture(autouse=True)
def mock(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")


def chat(body):
    return client.post("/v1/chat/completions", json=body)


# ---- malformed requests ------------------------------------------------------------

@pytest.mark.parametrize(
    "body",
    [
        {"model": "x", "messages": ["hi"]},
        {"model": "x", "messages": [{"content": "no role"}]},
        {"model": "x", "messages": [{"role": 5, "content": "x"}]},
        {"model": "x", "messages": [{"role": "user", "content": 5}]},
        {"model": "x", "messages": [{"role": "user", "content": ["a"]}]},
        {"model": "x", "messages": [{"role": "user", "content": [{"type": "text"}]}]},
        {"model": "x", "messages": [{"role": "user", "content": [{"type": "text", "text": 5}]}]},
        {"model": "x", "messages": M, "tools": "nope"},
        {"model": "x", "messages": M, "tools": ["a"]},
    ],
)
def test_a_malformed_chat_request_is_a_400_with_a_reason(body):
    r = chat(body)
    assert r.status_code == 400, r.text
    assert r.json()["error"]["type"] == "invalid_request" and r.json()["error"]["message"]


@pytest.mark.parametrize(
    "body",
    [
        {"model": "x", "messages": [{"role": "user", "content": None}]},
        {"model": "x", "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:,"}}]}]},
        {"messages": M},
        {"model": "x", "messages": [{"role": "assistant", "content": None, "tool_calls": [1, None, {"function": 5}]}]},
        {"model": "x", "messages": [{"role": "assistant", "tool_calls": [{"function": {"arguments": "{oops"}}]}]},
        {"model": "x", "messages": [{"role": "tool", "content": "null"}, {"role": "tool", "content": "123"}]},
    ],
)
def test_odd_but_allowed_shapes_do_not_crash(body):
    assert chat(body).status_code < 500


# ---- size ---------------------------------------------------------------------------

def test_a_text_over_the_limit_is_refused_not_scanned(monkeypatch):
    long_text = "a" * (main.MAX_TEXT + 1)  # the field limits are fixed when the app is imported, so use the real limit
    assert client.post("/v1/analyze", json={"text": long_text}).status_code == 422
    assert client.post("/v1/sanitize", json={"text": long_text}).status_code == 422
    assert client.post("/v1/restore", json={"vault_id": "x", "text": long_text}).status_code == 422
    assert chat({"model": "x", "messages": [{"role": "user", "content": long_text}]}).status_code == 413
    monkeypatch.setattr(main, "MAX_TEXT", 1000)
    assert chat({"model": "x", "messages": [{"role": "user", "content": "a" * 900}]}).status_code == 200


# ---- speed --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "unit",
    ["1234567890", "1,", "1.", "1 ", "1,250,", "a@", "a", "010 ", "가", "-", ".", "=", '"', "[]", "비밀번호는 ", "고객 홍길동 ", "kim@corp.co.kr ", "010-1234-5678 "],
    ids=lambda u: repr(u)[:14],
)
def test_no_input_of_the_largest_allowed_size_takes_long_to_scan(unit):
    text = unit * (200_000 // len(unit))
    t = time.time()
    r = client.post("/v1/analyze", json={"text": text, "industries": list(main.industries)})
    took = time.time() - t
    assert r.status_code == 200
    # measured around 0.3 s; the old patterns needed minutes. Generous so a slow CI machine does not flake.
    assert took < 8, f"{took:.1f}s"


def _reference_resolution(candidates):
    """The first version of overlap resolution: simple and quadratic."""
    chosen = []
    for c in sorted(candidates, key=lambda m: (-m.priority, -(m.end - m.start), m.start)):
        if all(c.end <= k.start or c.start >= k.end for k in chosen):
            chosen.append(c)
    return sorted(chosen, key=lambda m: m.start)


def test_the_fast_overlap_resolution_chooses_exactly_what_the_simple_one_did():
    rng = random.Random(7)
    for _ in range(300):
        extra = []
        for _ in range(rng.randint(0, 40)):
            start = rng.randint(0, 90)
            extra.append(Match(start, start + rng.randint(1, 12), rng.choice("ABC"), "redact", rng.randint(1, 3)))
        assert detect("x" * 120, [], extra=extra) == _reference_resolution(extra)


def test_the_start_guard_on_template_patterns_finds_the_same_matches():
    corpus = [
        "수율 92.4%, 불량률 1.8% 보고", "대출 1,250,000원 상환", "연봉 5천만원, 성과급 1,200만원", "a,5000원 b", "1,5% 와 2.5%", "원가 3억 2천만원",
        "12345678901234567890 %", "9,9,9,9,9 원", "처방 500mg 과 2.5 mL", "온도 350℃ 압력 50mTorr", "100 %", "1.2.3.4%", "계약 20240315-0001234",
    ]
    from app.taxonomy import load_industries

    patterns = [p for ind in load_industries(main.INDUSTRIES_DIR).values() for e in ind.entities for p in e.detection.patterns]
    assert patterns
    for pattern in patterns:
        for text in corpus + [t.text for ind in main.industries.values() for t in ind.tests]:
            plain = [m.span() for m in re.finditer(pattern, text)]
            guarded = [m.span() for m in re.finditer(detector._linear(pattern), text)]
            assert plain == guarded, (pattern, text)
