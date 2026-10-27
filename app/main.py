import json
import os
import secrets
import time
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import audit, llm_detector, policy, sessions, upstream
from .evaluate import evaluate
from .sanitizer import (
    ResponseBlocked,
    count_by_label,
    redact_text,
    restore_response,
    sanitize_messages,
    scan_body,
)
from .stream import StreamFilter
from .taxonomy import load_industries
from .vault import Vault

INDUSTRIES_DIR = Path(os.getenv("INDUSTRIES_DIR", Path(__file__).resolve().parent.parent / "industries"))
industries = load_industries(INDUSTRIES_DIR)
audit.configure(os.getenv("AUDIT_DB", str(Path(__file__).resolve().parent.parent / "data" / "audit.db")))

app = FastAPI(title="LLM Gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("GATEWAY_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Gateway-Redacted", "X-Gateway-Route"],
)


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Stats / admin endpoints. Open when GATEWAY_ADMIN_TOKEN is unset (local dev), token-gated otherwise."""
    token = os.getenv("GATEWAY_ADMIN_TOKEN")
    if token and not (x_admin_token and secrets.compare_digest(x_admin_token, token)):
        raise HTTPException(401, "admin token required (X-Admin-Token)")


def error(status: int, type_: str, **extra) -> JSONResponse:
    return JSONResponse({"error": {"type": type_, **extra}}, status)


def pick_industries(names: list[str], use_case: str | None, flow: str | None):
    """-> (templates to apply, unknown names)"""
    unknown = [n for n in names if n not in industries]
    return policy.applicable([industries[n] for n in names if n in industries], use_case, flow), unknown


def split_header(value: str | None) -> list[str]:
    return [n.strip() for n in (value or "").split(",") if n.strip()]


def response_scan_enabled() -> bool:
    return os.getenv("RESPONSE_SCAN", "on").lower() != "off"


# ---------------------------------------------------------------- info

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/v1/config")
def config():
    """What this gateway instance is doing, for the UI's status panel. No secrets."""
    return {
        "provider": upstream.provider_name("external"),
        "mock": upstream.mock(),
        "internal_route": upstream.internal_available(),
        "response_scan": response_scan_enabled(),
        "local_llm_detector": llm_detector.enabled(),
        "streaming": True,
        "admin_protected": bool(os.getenv("GATEWAY_ADMIN_TOKEN")),
    }


@app.get("/v1/industries")
def list_industries():
    return [
        {
            "industry": i.industry,
            "entities": [
                {"id": e.id, "label": e.label or e.id, "sensitivity": e.sensitivity, "action": e.action, "regulation": e.regulation}
                for e in i.entities
            ],
            "applies_to": i.applies_to,
            "test_cases": len(i.tests),
        }
        for i in industries.values()
    ]


@app.get("/v1/industries/{name}")
def get_industry(name: str):
    if name not in industries:
        return error(404, "unknown_industry", message=name)
    return industries[name]


@app.post("/v1/industries/reload", dependencies=[Depends(require_admin)])
def reload_industries():
    """Pick up new/edited template files without restarting. A broken file leaves the loaded set untouched."""
    try:
        fresh = load_industries(INDUSTRIES_DIR)
    except ValueError as e:
        return error(400, "invalid_template", message=str(e))
    industries.clear()
    industries.update(fresh)
    return {"loaded": list(industries)}


@app.get("/v1/eval")
def eval_report():
    """Generic vs. template detection rate, computed from every template's `tests`."""
    return evaluate(industries)


# ---------------------------------------------------------------- proxy

def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str | None = Header(default=None),
    x_gateway_industry: str | None = Header(default=None),
    x_gateway_use_case: str | None = Header(default=None),
    x_gateway_flow: str | None = Header(default=None),
):
    t0 = time.monotonic()
    payload = await request.json()
    if not isinstance(payload.get("messages"), list) or not payload["messages"]:
        return error(400, "invalid_request", message="messages must be a non-empty list")

    names = split_header(x_gateway_industry)
    templates, unknown = pick_industries(names, x_gateway_use_case, x_gateway_flow)
    if unknown:
        return error(400, "unknown_industry", message=", ".join(unknown))

    streaming = bool(payload.get("stream"))
    vault = Vault()
    messages, matches, route = await run_in_threadpool(
        sanitize_messages, payload["messages"], vault, templates, upstream.internal_available()
    )

    def log(status: str, response_matches=()):
        audit.record(
            endpoint="chat",
            status=status,
            route=route,
            provider=upstream.provider_name(route),
            industries=names,
            use_case=x_gateway_use_case,
            stream=streaming,
            latency_ms=int((time.monotonic() - t0) * 1000),
            request_matches=matches,
            response_matches=response_matches,
        )

    if route == "block":
        log("blocked")
        return error(403, "gateway_blocked", direction="request", findings=count_by_label(matches))

    outbound = {**payload, "messages": messages}
    scan = route == "external" and response_scan_enabled()  # internal answers never left the company
    headers = {"X-Gateway-Redacted": str(len(matches)), "X-Gateway-Route": route}

    if streaming:
        flt = StreamFilter(vault, scan)
        completion_id = f"chatcmpl-gw-{secrets.token_hex(8)}"

        def chunk(text: str, finish: str | None = None) -> dict:
            return {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "model": payload.get("model"),
                "choices": [{"index": 0, "delta": {"content": text} if text else {}, "finish_reason": finish}],
            }

        async def events():
            status = "ok"
            try:
                async for delta in upstream.stream(outbound, authorization, route):
                    text = flt.feed(delta)
                    if text:
                        yield sse(chunk(text))
                tail = flt.flush()
                if tail:
                    yield sse(chunk(tail))
                yield sse(chunk("", finish="stop"))
                yield "data: [DONE]\n\n"
            except upstream.UpstreamError as e:
                status = "upstream_error"
                yield sse({"error": {"type": "upstream_error", "message": str(e)}})
            except ResponseBlocked as b:
                status = "response_blocked"
                yield sse({"error": {"type": "gateway_blocked", "direction": "response", "findings": b.findings}})
            finally:
                log(status, flt.matches)

        return StreamingResponse(events(), media_type="text/event-stream", headers=headers)

    try:
        body = await upstream.forward(outbound, authorization, route)
    except upstream.UpstreamError as e:
        log("upstream_error")
        return error(502, "upstream_error", message=str(e))
    response_matches = []
    if scan:
        try:
            response_matches = scan_body(body)
        except ResponseBlocked as b:
            log("response_blocked")
            return error(403, "gateway_blocked", direction="response", findings=b.findings)
    body = restore_response(body, vault)
    log("ok", response_matches)
    return JSONResponse(body, headers=headers)


# ---------------------------------------------------------------- for clients that call the LLM themselves

class SanitizeIn(BaseModel):
    text: str
    industries: list[str] = []
    use_case: str | None = None
    flow: str | None = None
    vault_id: str | None = None  # pass the previous one to keep placeholder numbering across messages


class RestoreIn(BaseModel):
    vault_id: str
    text: str


@app.post("/v1/sanitize")
def sanitize(body: SanitizeIn):
    """Browser extension etc.: mask text, keep the mapping here (in memory, 30 min)."""
    t0 = time.monotonic()
    templates, unknown = pick_industries(body.industries, body.use_case, body.flow)
    if unknown:
        return error(400, "unknown_industry", message=", ".join(unknown))
    vault = sessions.get(body.vault_id) if body.vault_id else Vault()
    if vault is None:
        return error(404, "unknown_vault")
    text, matches = redact_text(body.text, vault, templates)
    # Nothing here can route to an internal model, so internal_only is a block too.
    route = policy.decide(matches, internal_available=False)
    audit.record(
        endpoint="sanitize",
        status="blocked" if route == "block" else "ok",
        route=route,
        provider="browser",
        industries=body.industries,
        use_case=body.use_case,
        stream=False,
        latency_ms=int((time.monotonic() - t0) * 1000),
        request_matches=matches,
    )
    if route == "block":
        return error(403, "gateway_blocked", direction="request", findings=count_by_label(matches))
    return {"text": text, "vault_id": body.vault_id or sessions.create(vault), "findings": count_by_label(matches)}


@app.post("/v1/restore")
def restore(body: RestoreIn):
    vault = sessions.get(body.vault_id)
    if vault is None:
        return error(404, "unknown_vault")
    return {"text": vault.restore(body.text)}


class AnalyzeIn(BaseModel):
    text: str
    industries: list[str] = []
    use_case: str | None = None
    flow: str | None = None


@app.post("/v1/analyze")
def analyze(body: AnalyzeIn):
    """Dry run for a playground UI: what would be masked, where, and which route. Not audited, nothing stored.

    Span offsets are Python string indices (Unicode code points); in JS use Array.from(text) to match them.
    """
    templates, unknown = pick_industries(body.industries, body.use_case, body.flow)
    if unknown:
        return error(400, "unknown_industry", message=", ".join(unknown))
    text, matches = redact_text(body.text, Vault(), templates)
    return {
        "sanitized": text,
        "route": policy.decide(matches, upstream.internal_available()),
        "spans": [{"start": m.start, "end": m.end, "label": m.label, "action": m.action} for m in matches],
        "findings": count_by_label(matches),
    }


# ---------------------------------------------------------------- audit / dashboard (metadata only)

@app.get("/v1/stats/summary", dependencies=[Depends(require_admin)])
def stats_summary(since: float = 0.0):
    """`since` = unix seconds. Omit for all time."""
    return audit.summary(since)


@app.get("/v1/stats/timeseries", dependencies=[Depends(require_admin)])
def stats_timeseries(bucket: str = "hour", since: float = 0.0):
    if bucket not in ("hour", "day"):
        return error(400, "invalid_request", message="bucket must be hour or day")
    return audit.timeseries(bucket, since)


@app.get("/v1/audit/events", dependencies=[Depends(require_admin)])
def audit_events(limit: int = 50, offset: int = 0, label: str | None = None, status: str | None = None):
    return audit.events(limit, offset, label, status)
