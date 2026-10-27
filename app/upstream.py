"""Forward the sanitized request to the external LLM.

Inbound format is always OpenAI chat.completions. UPSTREAM_PROVIDER picks the outbound side:
  openai    (default) any OpenAI-compatible endpoint, via UPSTREAM_BASE_URL
  anthropic Claude Messages API via the official SDK; request/response are converted to/from OpenAI shape
"""
import os

import anthropic
import httpx


class UpstreamError(Exception):
    pass


async def forward(payload: dict, incoming_auth: str | None) -> dict:
    if os.getenv("UPSTREAM_MODE") == "mock":
        # Offline dev mode: echo the last message so redact/restore can be seen without an API key.
        last = payload["messages"][-1].get("content", "")
        return {"choices": [{"index": 0, "message": {"role": "assistant", "content": f"[mock] {last}"}}]}
    if os.getenv("UPSTREAM_PROVIDER", "openai") == "anthropic":
        return await _forward_anthropic(payload)
    return await _forward_openai(payload, incoming_auth)


async def _forward_openai(payload: dict, incoming_auth: str | None) -> dict:
    base = os.getenv("UPSTREAM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    key = os.getenv("UPSTREAM_API_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else ({"Authorization": incoming_auth} if incoming_auth else {})
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{base}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise UpstreamError(str(e)) from e
    return resp.json()


def _client() -> anthropic.AsyncAnthropic:
    # The caller's Authorization header is an OpenAI-style key, so it is never forwarded here.
    return anthropic.AsyncAnthropic(api_key=os.getenv("UPSTREAM_API_KEY") or None)


async def _forward_anthropic(payload: dict) -> dict:
    try:
        msg = await _client().messages.create(**to_anthropic_request(payload))
    except anthropic.APIError as e:
        raise UpstreamError(str(e)) from e
    return to_openai_response(msg)


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # text parts only; images/tools are not supported by this adapter
        return "".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


def to_anthropic_request(payload: dict) -> dict:
    """OpenAI chat request -> Claude Messages request. Sampling params are dropped on purpose
    (newer Claude models reject temperature/top_p/top_k)."""
    system, messages = [], []
    for m in payload["messages"]:
        text = _text(m.get("content"))
        if not text:
            continue
        if m["role"] in ("system", "developer"):
            system.append(text)
        else:
            messages.append({"role": m["role"], "content": text})
    req = {
        # Internal apps usually send an OpenAI model name, so UPSTREAM_MODEL overrides it.
        "model": os.getenv("UPSTREAM_MODEL") or payload["model"],
        "max_tokens": payload.get("max_completion_tokens") or payload.get("max_tokens") or 16000,
        "messages": messages,
    }
    if system:
        req["system"] = "\n\n".join(system)
    return req


def to_openai_response(msg) -> dict:
    text = "".join(b.text for b in msg.content if b.type == "text")  # skips thinking blocks
    finish = {"max_tokens": "length", "refusal": "content_filter"}.get(msg.stop_reason, "stop")
    return {
        "id": msg.id,
        "object": "chat.completion",
        "model": msg.model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": finish}],
        "usage": {
            "prompt_tokens": msg.usage.input_tokens,
            "completion_tokens": msg.usage.output_tokens,
            "total_tokens": msg.usage.input_tokens + msg.usage.output_tokens,
        },
    }
