import os
from collections import Counter
from pathlib import Path

from fastapi import FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import sessions, upstream
from .sanitizer import Blocked, restore_response, sanitize_messages, sanitize_text
from .taxonomy import load_industries
from .vault import Vault

INDUSTRIES_DIR = Path(os.getenv("INDUSTRIES_DIR", Path(__file__).resolve().parent.parent / "industries"))
industries = load_industries(INDUSTRIES_DIR)

app = FastAPI(title="LLM Gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("GATEWAY_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/v1/industries")
def list_industries():
    return [
        {"industry": i.industry, "entities": [e.id for e in i.entities], "applies_to": i.applies_to}
        for i in industries.values()
    ]


@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str | None = Header(default=None),
    x_gateway_industry: str | None = Header(default=None),
):
    payload = await request.json()
    if payload.get("stream"):
        return JSONResponse({"error": {"type": "not_implemented", "message": "stream=true not supported yet"}}, 501)

    names = [n.strip() for n in (x_gateway_industry or "").split(",") if n.strip()]
    unknown = [n for n in names if n not in industries]
    if unknown:
        return JSONResponse({"error": {"type": "unknown_industry", "message": ", ".join(unknown)}}, 400)

    vault = Vault()
    try:
        messages, findings = sanitize_messages(payload["messages"], vault, [industries[n] for n in names])
    except Blocked as b:
        return JSONResponse({"error": {"type": "gateway_blocked", "findings": b.findings}}, 403)

    try:
        body = await upstream.forward({**payload, "messages": messages}, authorization)
    except upstream.UpstreamError as e:
        return JSONResponse({"error": {"type": "upstream_error", "message": str(e)}}, 502)

    body = restore_response(body, vault)
    return JSONResponse(body, headers={"X-Gateway-Redacted": str(sum(findings.values()))})


class SanitizeIn(BaseModel):
    text: str
    industries: list[str] = []
    vault_id: str | None = None  # pass the previous one to keep placeholder numbering across messages


class RestoreIn(BaseModel):
    vault_id: str
    text: str


@app.post("/v1/sanitize")
def sanitize(body: SanitizeIn):
    """For clients that talk to the LLM themselves (browser extension): mask text, keep the mapping here."""
    unknown = [n for n in body.industries if n not in industries]
    if unknown:
        return JSONResponse({"error": {"type": "unknown_industry", "message": ", ".join(unknown)}}, 400)
    vault = sessions.get(body.vault_id) if body.vault_id else Vault()
    if vault is None:
        return JSONResponse({"error": {"type": "unknown_vault"}}, 404)
    findings: Counter = Counter()
    try:
        text = sanitize_text(body.text, vault, [industries[n] for n in body.industries], findings)
    except Blocked as b:
        return JSONResponse({"error": {"type": "gateway_blocked", "findings": b.findings}}, 403)
    return {"text": text, "vault_id": body.vault_id or sessions.create(vault), "findings": dict(findings)}


@app.post("/v1/restore")
def restore(body: RestoreIn):
    vault = sessions.get(body.vault_id)
    if vault is None:
        return JSONResponse({"error": {"type": "unknown_vault"}}, 404)
    return {"text": vault.restore(body.text)}
