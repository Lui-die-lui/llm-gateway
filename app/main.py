import json
import logging
import os
import secrets
import time
from pathlib import Path

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import audit, company_policy, exception_requests, policy, rules_catalog, sessions, upstream
from .evaluate import evaluate
from .sanitizer import (
    ResponseBlocked,
    count_by_label,
    map_arguments,
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
company_policy.configure(os.getenv("POLICY_DB", str(Path(__file__).resolve().parent.parent / "data" / "policy.db")))
exception_requests.configure(os.getenv("EXCEPTIONS_DB", str(Path(__file__).resolve().parent.parent / "data" / "exceptions.db")))

app = FastAPI(title="LLM Gateway")
if not os.getenv("GATEWAY_ADMIN_TOKEN"):
    logging.getLogger("uvicorn.error").warning(
        "GATEWAY_ADMIN_TOKEN is not set: stats, audit log and policy endpoints are open to anyone who can reach this server."
    )
if not os.getenv("GATEWAY_API_KEYS"):
    logging.getLogger("uvicorn.error").warning(
        "GATEWAY_API_KEYS is not set: anyone who can reach this server can use the gateway (and the model behind it)."
    )
elif os.getenv("UPSTREAM_MODE") != "mock" and not os.getenv("UPSTREAM_API_KEY") and not os.getenv("INTERNAL_MODEL"):
    logging.getLogger("uvicorn.error").warning(
        "GATEWAY_API_KEYS is set but UPSTREAM_API_KEY is not: callers' keys are not forwarded, so the model provider will refuse."
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("GATEWAY_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Gateway-Redacted", "X-Gateway-Route", "X-Total-Count"],
)


class AdminTokenRequired(Exception):
    pass


# Detection is regex based and Python's `re` holds the GIL, so one huge text can stall every other request. Nothing a person types
# or pastes into a chat is this long; refuse it instead of scanning it.
MAX_TEXT = int(os.getenv("GATEWAY_MAX_TEXT", "200000"))  # characters, per text and per chat request


def error(status: int, type_: str, **extra) -> JSONResponse:
    return JSONResponse({"error": {"type": type_, **extra}}, status)


@app.exception_handler(AdminTokenRequired)
def admin_token_required(_request: Request, _exc: AdminTokenRequired) -> JSONResponse:
    # Same {"error": {...}} shape as every other gateway error, instead of FastAPI's {"detail": ...}.
    return error(401, "unauthorized", message="admin token required (X-Admin-Token)")


@app.exception_handler(company_policy.PolicyError)
def policy_error(_request: Request, exc: company_policy.PolicyError) -> JSONResponse:
    return error(exc.status, exc.type, message=exc.message)


@app.exception_handler(RequestValidationError)
def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    # Same {"error": {...}} shape as every other gateway error; the first problem, in plain words.
    first = exc.errors()[0] if exc.errors() else {}
    msg = str(first.get("msg", "invalid request"))
    if first.get("type") == "value_error":  # our own validators already write a full sentence
        message = msg.removeprefix("Value error, ")
    else:
        where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        message = f"{where}: {msg}" if where else msg
    return error(422, "invalid_request", message=message)


class CallerKeyRequired(Exception):
    pass


@app.exception_handler(CallerKeyRequired)
def caller_key_required(_request: Request, _exc: CallerKeyRequired) -> JSONResponse:
    resp = error(401, "unauthorized", message="API key required: Authorization: Bearer <key> (or X-Gateway-Key)")
    resp.headers["WWW-Authenticate"] = "Bearer"
    return resp


def api_keys() -> dict[str, str]:
    """GATEWAY_API_KEYS="hr-app:gw_abc,extension:gw_xyz" -> {key: name}. Unset = open (local development)."""
    keys = {}
    for item in os.getenv("GATEWAY_API_KEYS", "").split(","):
        name, _, key = item.strip().partition(":")
        if name and key:
            keys[key] = name
    return keys


def require_caller(
    authorization: str | None = Header(default=None), x_gateway_key: str | None = Header(default=None)
) -> str | None:
    """Apps, the extension and the demo page must present a key to use the gateway. Returns the key's name for the audit log.
    The key is for this gateway only: it is never forwarded to the model provider."""
    keys = api_keys()
    if not keys:
        return None
    bearer = authorization[7:].strip() if authorization and authorization[:7].lower() == "bearer " else None
    for supplied in (x_gateway_key, bearer):
        if supplied:
            for key, name in keys.items():
                if secrets.compare_digest(supplied.encode(), key.encode()):
                    return name
    raise CallerKeyRequired


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Stats / admin endpoints. Open when GATEWAY_ADMIN_TOKEN is unset (local dev), token-gated otherwise."""
    token = os.getenv("GATEWAY_ADMIN_TOKEN")
    if token and not (x_admin_token and secrets.compare_digest(x_admin_token, token)):
        raise AdminTokenRequired


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
        "streaming": True,
        "admin_protected": bool(os.getenv("GATEWAY_ADMIN_TOKEN")),
        "caller_auth": bool(api_keys()),
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


def chat_shape_problem(payload: dict) -> str | None:
    """What the pipeline relies on, checked once up front so a malformed request is a 400 and not a 500 from deep inside."""
    for i, m in enumerate(payload["messages"]):
        if not isinstance(m, dict) or not isinstance(m.get("role"), str):
            return f"messages[{i}] must be an object with a string role"
        content = m.get("content")
        if content is None or isinstance(content, str):
            continue
        if not isinstance(content, list):
            return f"messages[{i}].content must be a string, a list of parts, or null"
        for j, part in enumerate(content):
            if not isinstance(part, dict):
                return f"messages[{i}].content[{j}] must be an object"
            if part.get("type") == "text" and not isinstance(part.get("text"), str):
                return f"messages[{i}].content[{j}] is a text part without a string text"
    tools = payload.get("tools")
    if tools is not None and (not isinstance(tools, list) or not all(isinstance(t, dict) for t in tools)):
        return "tools must be a list of objects"
    return None


@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    caller: str | None = Depends(require_caller),
    authorization: str | None = Header(default=None),
    x_gateway_industry: str | None = Header(default=None),
    x_gateway_use_case: str | None = Header(default=None),
    x_gateway_flow: str | None = Header(default=None),
    x_gateway_site: str | None = Header(default=None),
    x_gateway_client: str | None = Header(default=None),
):
    t0 = time.monotonic()
    try:
        payload = await request.json()
    except ValueError:  # malformed JSON or not UTF-8 (UnicodeDecodeError is a ValueError)
        return error(400, "invalid_request", message="body must be valid UTF-8 JSON")
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list) or not payload["messages"]:
        return error(400, "invalid_request", message="messages must be a non-empty list")

    problem = chat_shape_problem(payload)
    if problem:
        return error(400, "invalid_request", message=problem)
    if len(json.dumps(payload["messages"], ensure_ascii=False)) > MAX_TEXT:
        return error(413, "payload_too_large", message=f"messages are longer than {MAX_TEXT} characters")

    names = split_header(x_gateway_industry)
    templates, unknown = pick_industries(names, x_gateway_use_case, x_gateway_flow)
    if unknown:
        return error(400, "unknown_industry", message=", ".join(unknown))

    # With gateway keys on, the Authorization header is the gateway key: the provider is called with the server's own key.
    authorization = None if api_keys() else authorization
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
            site=x_gateway_site,
            client=x_gateway_client,
            caller=caller,
            request_matches=matches,
            response_matches=response_matches,
        )

    if route == "block":
        log("blocked")
        return error(403, "gateway_blocked", direction="request", findings=count_by_label(matches))

    uses_tools = bool(payload.get("tools") or payload.get("functions")) or any(
        isinstance(m, dict) and m.get("role") in ("tool", "function") for m in payload["messages"]
    )
    if uses_tools and not upstream.supports_tools(route):
        log("blocked")
        return error(400, "unsupported", message="tool calls are not supported with UPSTREAM_PROVIDER=anthropic yet; use an OpenAI-compatible provider")

    outbound = {**payload, "messages": messages}
    scan = route == "external" and response_scan_enabled()  # internal answers never left the company
    headers = {"X-Gateway-Redacted": str(sum(m.action != "log" for m in matches)), "X-Gateway-Route": route}

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
            calls: dict[int, dict] = {}  # streamed tool calls, put together here and sent once restored
            try:
                async for delta in upstream.stream(outbound, authorization, route):
                    if isinstance(delta, upstream.ToolDelta):
                        call = calls.setdefault(delta.index, {"id": None, "name": "", "arguments": ""})
                        call["id"] = delta.id or call["id"]
                        call["name"] += delta.name or ""
                        call["arguments"] += delta.arguments
                        continue
                    text = flt.feed(delta)
                    if text:
                        yield sse(chunk(text))
                tail = flt.flush()
                if tail:
                    yield sse(chunk(tail))
                if calls:
                    # A placeholder can be split across fragments, so the arguments are released whole, after restoring.
                    restored = [
                        {
                            "index": i,
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": map_arguments(c["arguments"], vault.restore_value)},
                        }
                        for i, c in sorted(calls.items())
                    ]
                    first = chunk("")
                    first["choices"] = [{"index": 0, "delta": {"tool_calls": restored}, "finish_reason": None}]
                    yield sse(first)
                yield sse(chunk("", finish="tool_calls" if calls else "stop"))
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
    text: str = Field(max_length=MAX_TEXT)
    industries: list[str] = []
    use_case: str | None = None
    flow: str | None = None
    vault_id: str | None = None  # pass the previous one to keep placeholder numbering across messages
    site: str | None = None  # where the text was typed, e.g. "chatgpt.com": an exception can be limited to a site
    client_id: str | None = Field(default=None, max_length=64)  # the browser's id: approved exception requests are looked up by it
    client: str | None = None  # audit label only: e.g. "extension/0.3.0"


class RestoreIn(BaseModel):
    vault_id: str = Field(max_length=100)
    text: str = Field(max_length=MAX_TEXT)


@app.post("/v1/sanitize")
def sanitize(body: SanitizeIn, caller: str | None = Depends(require_caller)):
    """Browser extension etc.: mask text, keep the mapping here (in memory, 30 min)."""
    t0 = time.monotonic()
    templates, unknown = pick_industries(body.industries, body.use_case, body.flow)
    if unknown:
        return error(400, "unknown_industry", message=", ".join(unknown))
    vault = sessions.get(body.vault_id) if body.vault_id else Vault()
    if vault is None:
        return error(404, "unknown_vault")
    approved = exception_requests.grants(body.client_id, body.site)
    text, matches = redact_text(body.text, vault, templates, approved=frozenset().union(*(g["labels"] for g in approved)))
    used = [g for g in approved if any(m.action == "log" and m.label in g["labels"] for m in matches)]
    # Nothing here can route to an internal model, so internal_only is a block too.
    route = policy.decide(matches, internal_available=False)
    if route != "block":  # a message that is stopped anyway does not use up a one-use approval
        for g in used:
            if g["once"]:
                exception_requests.spend(g["id"])
    audit.record(
        endpoint="sanitize",
        status="blocked" if route == "block" else "ok",
        route=route,
        provider="browser",
        industries=body.industries,
        use_case=body.use_case,
        stream=False,
        latency_ms=int((time.monotonic() - t0) * 1000),
        site=body.site,
        client=body.client,
        caller=caller,
        exception_id=",".join(g["id"] for g in used) or None,
        request_matches=matches,
    )
    if route == "block":
        return error(403, "gateway_blocked", direction="request", findings=count_by_label(matches))
    out = {"text": text, "vault_id": body.vault_id or sessions.create(vault), "findings": count_by_label(matches)}
    if used:  # so the person can be told: used up, or how much time is left
        out["exceptions"] = [{"id": g["id"], "once": g["once"], "left": g["left"]} for g in used]
    return out


@app.post("/v1/restore")
def restore(body: RestoreIn, _caller: str | None = Depends(require_caller)):
    vault = sessions.get(body.vault_id)
    if vault is None:
        return error(404, "unknown_vault")
    return {"text": vault.restore(body.text)}


class AnalyzeIn(BaseModel):
    text: str = Field(max_length=MAX_TEXT)
    industries: list[str] = []
    use_case: str | None = None
    flow: str | None = None
    site: str | None = None
    client_id: str | None = Field(default=None, max_length=64)  # so the preview matches what sanitize will do for this browser
    use_draft: bool = False  # also apply the console's unapplied draft rules, to try them before applying


@app.post("/v1/analyze")
def analyze(body: AnalyzeIn):
    """Dry run for a playground UI: what would be masked, where, and which route. Not audited, nothing stored.

    Span offsets are Python string indices (Unicode code points); in JS use Array.from(text) to match them.
    """
    templates, unknown = pick_industries(body.industries, body.use_case, body.flow)
    if unknown:
        return error(400, "unknown_industry", message=", ".join(unknown))
    engine = company_policy.draft_engine() if body.use_draft else None
    approved = frozenset().union(*(g["labels"] for g in exception_requests.grants(body.client_id, body.site)))  # preview only: nothing is spent
    text, matches = redact_text(body.text, Vault(), templates, engine, approved)
    return {
        "sanitized": text,
        "route": policy.decide(matches, upstream.internal_available()),
        "spans": [{"start": m.start, "end": m.end, "label": m.label, "action": m.action} for m in matches],
        "findings": count_by_label(matches),
    }


# ---------------------------------------------------------------- company policy (console)

@app.get("/v1/rules/builtin")
def builtin_rules():
    """The built-in rules the console lists, with the action each one has by default."""
    return {"groups": rules_catalog.catalog()}


admin = [Depends(require_admin)]


@app.get("/v1/policy", dependencies=admin)
def policy_get():
    return company_policy.view()


@app.post("/v1/policy/rules", dependencies=admin)
def policy_add(body: company_policy.RuleIn):
    state, rule_id = company_policy.add_rule(body)
    return {"policy": state, "id": rule_id}


@app.put("/v1/policy/rules/{rule_id}", dependencies=admin)
def policy_save(rule_id: str, body: company_policy.RuleIn):
    return company_policy.save_rule(rule_id, body)


@app.post("/v1/policy/rules/{rule_id}/toggle", dependencies=admin)
def policy_toggle(rule_id: str):
    return company_policy.toggle_rule(rule_id)


@app.delete("/v1/policy/rules/{rule_id}", dependencies=admin)
def policy_delete(rule_id: str):
    return company_policy.delete_rule(rule_id)


@app.post("/v1/policy/apply", dependencies=admin)
def policy_apply():
    return company_policy.apply()


@app.get("/v1/policy/versions", dependencies=admin)
def policy_versions():
    return company_policy.versions()


@app.post("/v1/policy/versions/{version}/rollback", dependencies=admin)
def policy_rollback(version: int):
    return company_policy.rollback(version)


class BuiltinIn(BaseModel):
    enabled: dict[str, bool]


@app.get("/v1/policy/builtin", dependencies=admin)
def policy_builtin_get():
    return company_policy.builtin_view()


@app.put("/v1/policy/builtin", dependencies=admin)
def policy_builtin_put(body: BuiltinIn):
    return company_policy.set_builtin(body.enabled)


# ---------------------------------------------------------------- exception requests (record only, see exception_requests.py)

@app.post("/v1/exceptions")
def exception_create(body: exception_requests.ExceptionIn):
    return exception_requests.create(body)


@app.get("/v1/exceptions/mine")
def exception_mine(client_id: str = Query(min_length=4, max_length=64)):
    return exception_requests.listing(client_id)


@app.get("/v1/exceptions", dependencies=admin)
def exception_list():
    return exception_requests.listing()


@app.post("/v1/exceptions/{request_id}/decide", dependencies=admin)
def exception_decide(request_id: str, body: exception_requests.DecisionIn):
    return exception_requests.decide(request_id, body)


# ---------------------------------------------------------------- audit / dashboard (metadata only)

@app.get("/v1/stats/summary", dependencies=[Depends(require_admin)])
def stats_summary(since: float = 0.0):
    """`since` = unix seconds. Omit for all time."""
    return audit.summary(since)


TZ_OFFSET = Query(0, ge=-840, le=840, description="minutes east of UTC, e.g. 540 for Korea")


@app.get("/v1/stats/timeseries", dependencies=[Depends(require_admin)])
def stats_timeseries(bucket: str = "hour", since: float = 0.0, tz_offset: int = TZ_OFFSET):
    """Bucket labels carry the offset ("2026-10-28T00:00:00+09:00"); without `tz_offset` they are UTC ("...Z")."""
    if bucket not in ("minute", "hour", "day"):
        return error(400, "invalid_request", message="bucket must be minute, hour or day")
    return audit.timeseries(bucket, since, tz_offset)


@app.get("/v1/audit/events", dependencies=[Depends(require_admin)])
def audit_events(
    limit: int = 50,
    offset: int = 0,
    label: str | None = None,
    status: str | None = None,
    since: float | None = None,
    until: float | None = None,
    site: str | None = None,
    client: str | None = None,
):
    """Newest first. `since` (inclusive) / `until` (exclusive) are unix seconds. Total matches: X-Total-Count header."""
    rows, total = audit.events(limit, offset, label, status, since, until, site, client)
    return JSONResponse(rows, headers={"X-Total-Count": str(total)})


# ---------------------------------------------------------------- the console, served from here (optional)

def mount_console(application: FastAPI, directory: Path) -> None:
    """Serve the built console (frontend/dist) from this server, so a single deployment hosts both.

    Registered last: every API route above wins. The console uses browser routing, so any other path gets index.html.
    """
    root = directory.resolve()

    @application.get("/{path:path}", include_in_schema=False)
    def console(path: str):
        if path == "v1" or path.startswith("v1/"):
            return error(404, "not_found", message="no such endpoint")
        target = (root / path).resolve()
        if path and target.is_file() and root in target.parents:
            return FileResponse(target)
        return FileResponse(root / "index.html")


if (_console := os.getenv("CONSOLE_DIR")) and (Path(_console) / "index.html").is_file():
    mount_console(app, Path(_console))
