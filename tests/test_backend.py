"""Names, local-LLM assist, routing, response scan, streaming, audit, templates, config."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import audit, llm_detector, main, upstream
from app.check_templates import check_industry
from app.detector import detect
from app.evaluate import evaluate
from app.stream import StreamFilter
from app.vault import Vault

client = TestClient(main.app)


def chat(content, industry=None, stream=False, **headers):
    h = {"X-Gateway-Industry": industry} if industry else {}
    h.update(headers)
    return client.post(
        "/v1/chat/completions",
        json={"model": "x", "stream": stream, "messages": [{"role": "user", "content": content}]},
        headers=h,
    )


def sse_text(resp) -> tuple[str, list[dict]]:
    events = [json.loads(line[5:]) for line in resp.text.splitlines() if line.startswith("data:") and "[DONE]" not in line]
    text = "".join(c["choices"][0]["delta"].get("content", "") for c in events if "choices" in c)
    return text, events


@pytest.fixture
def mock(monkeypatch):
    monkeypatch.setenv("UPSTREAM_MODE", "mock")


# ---- names -----------------------------------------------------------------

def test_blueprint_hero_sentence():
    text = "고객 홍길동(901010-1xxxxxx)의 처방 조성비 정제수 72.4% 분석해줘"
    ms = detect(text, [main.industries["cosmetics"]])
    assert [(text[m.start : m.end], m.label) for m in ms] == [
        ("홍길동", "사람"),
        ("901010-1xxxxxx", "주민번호"),
        ("72.4%", "조성비"),
    ]


@pytest.mark.parametrize("text", ["김철수 부장님께 전달", "담당자: 이영희에게 문의", "환자 박지민씨"])
def test_names_with_title(text):
    assert any(m.label == "사람" for m in detect(text, []))


@pytest.mark.parametrize("text", ["고객 이메일을 알려줘", "고객 이름을 입력하세요", "김치찌개 레시피", "고객 정보를 요약해줘"])
def test_common_words_are_not_names(text):
    assert not any(m.label == "사람" for m in detect(text, []))


# ---- local LLM assist ------------------------------------------------------

def test_llm_assist_adds_only_values_present_in_text(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM_MODEL", "fake")
    monkeypatch.setattr(
        llm_detector, "_chat", lambda prompt: json.dumps({"사람": ["박철민", "유령이름"], "공급처": ["한국콜마"]})
    )
    cosmetics = main.industries["cosmetics"]
    ms = llm_detector.llm_matches("박철민 대리가 한국콜마 에서 받았다", [cosmetics])
    assert sorted((m.label, "박철민 대리가 한국콜마 에서 받았다"[m.start : m.end]) for m in ms) == [
        ("공급처", "한국콜마"),
        ("사람", "박철민"),
    ]


def test_llm_assist_failure_falls_back_to_regex(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM_MODEL", "fake")

    def down(prompt):
        raise llm_detector.httpx.ConnectError("down")

    monkeypatch.setattr(llm_detector, "_chat", down)
    assert llm_detector.llm_matches("아무 텍스트", []) == []


def test_llm_assist_is_off_by_default():
    assert llm_detector.llm_matches("박철민", []) == []


# ---- routing + response scan ----------------------------------------------

def test_internal_only_routes_to_internal_model_with_original_text(mock):
    r = chat("원료 공급사: 코스맥스 에서 납품", industry="cosmetics")
    assert r.status_code == 200
    assert r.headers["X-Gateway-Route"] == "internal"
    assert "[mock-internal]" in r.json()["choices"][0]["message"]["content"]
    assert "코스맥스" in r.json()["choices"][0]["message"]["content"]  # original text reached the internal model


def test_internal_only_is_blocked_without_internal_model():
    r = chat("원료 공급사: 코스맥스 에서 납품", industry="cosmetics")  # not mock, no INTERNAL_MODEL
    assert r.status_code == 403
    assert r.json()["error"]["findings"] == {"공급처": 1}


def test_use_case_header_limits_templates(mock):
    hit = chat("정제수 72.4% 배합", industry="cosmetics", **{"X-Gateway-Use-Case": "translation"})
    assert hit.headers["X-Gateway-Redacted"] == "1"
    skipped = chat("정제수 72.4% 배합", industry="cosmetics", **{"X-Gateway-Use-Case": "customer_support"})
    assert skipped.headers["X-Gateway-Redacted"] == "0"


def test_response_scan_redacts_new_pii_and_blocks_secrets(monkeypatch):
    async def answer(text):
        async def fake(payload, auth, route="external"):
            return {"choices": [{"message": {"role": "assistant", "content": text}}]}
        return fake

    import asyncio

    monkeypatch.setattr(upstream, "forward", asyncio.run(answer("문의는 new@evil.com 로")))
    r = chat("안녕")
    assert r.json()["choices"][0]["message"]["content"] == "문의는 [이메일 가림] 로"
    monkeypatch.setattr(upstream, "forward", asyncio.run(answer("키는 sk-abcdefghijklmnopqrstuvwxyz123456")))
    r = chat("안녕")
    assert r.status_code == 403 and r.json()["error"]["direction"] == "response"
    assert "sk-abcdef" not in r.text


def test_response_scan_can_be_disabled(mock, monkeypatch):
    monkeypatch.setenv("RESPONSE_SCAN", "off")
    assert main.response_scan_enabled() is False


# ---- streaming -------------------------------------------------------------

def test_stream_filter_restores_across_chunk_boundaries():
    v = Vault()
    ph = v.placeholder("이메일", "kim@corp.co.kr")
    f = StreamFilter(v, scan=True)
    out = "".join(f.feed(piece) for piece in ["연락은 [이메", "일_1] 로 주", "세요. 다른 a@", "b.com 도"]) + f.flush()
    assert out == "연락은 kim@corp.co.kr 로 주세요. 다른 [이메일 가림] 도"
    assert ph not in out


def test_stream_endpoint_roundtrip(mock):
    r = chat("메일 kim@corp.co.kr 확인", stream=True)
    assert r.headers["content-type"].startswith("text/event-stream")
    text, events = sse_text(r)
    assert text == "[mock] 메일 kim@corp.co.kr 확인"  # sent as [이메일_1], restored for the client
    assert events[-1]["choices"][0]["finish_reason"] == "stop"
    assert r.text.rstrip().endswith("data: [DONE]")


def test_stream_blocked_before_start_is_plain_403():
    r = chat("sk-abcdefghijklmnopqrstuvwxyz123456", stream=True)
    assert r.status_code == 403


def test_stream_with_claude_provider(monkeypatch):
    monkeypatch.setenv("UPSTREAM_PROVIDER", "anthropic")
    seen = {}

    class FakeStream:
        def __init__(self, **kw):
            seen.update(kw)

        async def __aenter__(self):
            async def deltas():
                for d in ["답장: [이", "메일_1]"]:
                    yield d
            return SimpleNamespace(text_stream=deltas())

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(upstream, "_client", lambda: SimpleNamespace(messages=SimpleNamespace(stream=FakeStream)))
    text, _ = sse_text(chat("메일 kim@corp.co.kr", stream=True))
    assert "kim@corp.co.kr" not in str(seen)
    assert text == "답장: kim@corp.co.kr"


def test_stream_upstream_error_becomes_event(monkeypatch):
    async def boom(payload, auth, route="external"):
        raise upstream.UpstreamError("down")
        yield  # pragma: no cover

    monkeypatch.setattr(upstream, "stream", boom)
    _, events = sse_text(chat("안녕", stream=True))
    assert events[-1]["error"]["type"] == "upstream_error"


# ---- audit / stats ---------------------------------------------------------

def test_audit_records_metadata_never_values(mock):
    chat("메일 kim@corp.co.kr 와 홍길동", industry=None)
    chat("정제수 72.4% 배합", industry="cosmetics")
    chat("sk-abcdefghijklmnopqrstuvwxyz123456")
    s = client.get("/v1/stats/summary").json()
    assert s["requests"] == 3
    assert s["by_status"] == {"ok": 2, "blocked": 1}
    assert {(f["label"], f["direction"]) for f in s["findings"]} >= {("이메일", "request"), ("조성비", "request"), ("시크릿", "request")}
    assert s["redacted_items"] == 2
    dump = json.dumps(client.get("/v1/audit/events").json(), ensure_ascii=False)
    for secret in ("kim@corp", "72.4", "sk-abc"):
        assert secret not in dump
    rows = audit._db.execute("SELECT * FROM requests").fetchall() + audit._db.execute("SELECT * FROM findings").fetchall()
    assert "kim@corp" not in str([tuple(r) for r in rows])


def test_timeseries_and_event_filters(mock):
    chat("a@b.com")
    chat("sk-abcdefghijklmnopqrstuvwxyz123456")
    ts = client.get("/v1/stats/timeseries?bucket=day").json()
    assert ts[0]["requests"] == 2 and ts[0]["blocked"] == 1 and ts[0]["redacted_items"] == 1
    assert len(client.get("/v1/audit/events?status=blocked").json()) == 1
    assert len(client.get("/v1/audit/events?label=이메일").json()) == 1
    assert client.get("/v1/stats/timeseries?bucket=year").status_code == 400


def test_stats_require_token_when_configured(monkeypatch):
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "s3cret")
    assert client.get("/v1/stats/summary").status_code == 401
    assert client.get("/v1/stats/summary", headers={"X-Admin-Token": "wrong"}).status_code == 401
    assert client.get("/v1/stats/summary", headers={"X-Admin-Token": "s3cret"}).status_code == 200
    assert client.post("/v1/industries/reload").status_code == 401


# ---- frontend helpers ------------------------------------------------------

def test_analyze_returns_spans_and_route(mock):
    text = "고객 홍길동 메일 kim@corp.co.kr"
    r = client.post("/v1/analyze", json={"text": text}).json()
    assert r["sanitized"] == "고객 [사람_1] 메일 [이메일_1]"
    assert [(text[s["start"] : s["end"]], s["label"]) for s in r["spans"]] == [("홍길동", "사람"), ("kim@corp.co.kr", "이메일")]
    assert r["route"] == "external"
    assert client.post("/v1/analyze", json={"text": "x", "industries": ["nope"]}).status_code == 400


def test_config_industries_and_validation(mock):
    cfg = client.get("/v1/config").json()
    assert cfg["mock"] and cfg["internal_route"] and cfg["streaming"]
    inds = {i["industry"]: i for i in client.get("/v1/industries").json()}
    assert {"cosmetics", "medical"} <= set(inds)
    assert inds["cosmetics"]["entities"][0]["label"] == "조성비"
    assert client.get("/v1/industries/cosmetics").json()["industry"] == "cosmetics"
    assert client.get("/v1/industries/nope").status_code == 404
    assert client.post("/v1/chat/completions", json={"messages": []}).status_code == 400


def test_reload_keeps_old_set_when_a_template_is_broken(tmp_path, monkeypatch):
    (tmp_path / "ok.yaml").write_text("industry: ok\nentities: []\n", encoding="utf-8")
    original_dir, before = main.INDUSTRIES_DIR, set(main.industries)
    try:
        monkeypatch.setattr(main, "INDUSTRIES_DIR", tmp_path)
        assert client.post("/v1/industries/reload").json() == {"loaded": ["ok"]}
        (tmp_path / "bad.yaml").write_text("industry: bad\nentities: [{id: x}]\n", encoding="utf-8")
        r = client.post("/v1/industries/reload")
        assert r.status_code == 400 and "bad.yaml" in r.json()["error"]["message"]
        assert list(main.industries) == ["ok"]  # untouched by the failed reload
    finally:
        monkeypatch.setattr(main, "INDUSTRIES_DIR", original_dir)
        client.post("/v1/industries/reload")
    assert set(main.industries) == before


# ---- templates -------------------------------------------------------------

@pytest.mark.parametrize("name", ["cosmetics", "medical"])
def test_shipped_templates_pass_their_own_tests(name):
    assert check_industry(main.industries[name]) == []


def test_template_beats_generic_detection():
    result = evaluate(main.industries)
    assert result["overall"]["generic_recall"] == 0 and result["overall"]["template_recall"] == 1
    assert client.get("/v1/eval").json() == result


def test_checker_reports_broken_template():
    from app.taxonomy import Industry

    bad = Industry.model_validate(
        {
            "industry": "bad",
            "entities": [{"id": "x", "sensitivity": "high", "action": "redact", "detection": {"patterns": ["("]}}],
        }
    )
    assert any("bad regex" in p for p in check_industry(bad))
