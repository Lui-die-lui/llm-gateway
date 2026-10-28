"""Forward the request to a model and (optionally) stream the answer back as text deltas.

Inbound format is always OpenAI chat.completions. Routes:
  external  UPSTREAM_PROVIDER=openai (default, any OpenAI-compatible endpoint via UPSTREAM_BASE_URL)
            or UPSTREAM_PROVIDER=anthropic (Claude Messages API via the official SDK, converted to/from OpenAI shape)
  internal  an OpenAI-compatible internal model (Ollama etc.) at INTERNAL_BASE_URL, model INTERNAL_MODEL
UPSTREAM_MODE=mock answers locally without any API, for development and tests.
"""
import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass

import anthropic
import httpx

INTERNAL_DEFAULT_URL = "http://localhost:11434/v1"  # Ollama's OpenAI-compatible endpoint


class UpstreamError(Exception):
    pass


@dataclass(frozen=True)
class ToolDelta:
    """One fragment of a streamed tool call (OpenAI shape): the arguments arrive in pieces, the id and name once."""

    index: int
    id: str | None
    name: str | None
    arguments: str


def supports_tools(route: str) -> bool:
    """The Claude adapter converts text only: it would silently drop tool definitions and tool results."""
    return mock() or route == "internal" or os.getenv("UPSTREAM_PROVIDER", "openai") != "anthropic"


def mock() -> bool:
    return os.getenv("UPSTREAM_MODE") == "mock"


def provider_name(route: str) -> str:
    if mock():
        return "mock"
    return "internal" if route == "internal" else os.getenv("UPSTREAM_PROVIDER", "openai")


def internal_available() -> bool:
    return bool(os.getenv("INTERNAL_MODEL")) or mock()


def _mock_text(payload: dict, route: str) -> str:
    tag = "[mock-internal]" if route == "internal" else "[mock]"
    return f"{tag} {_text(payload['messages'][-1].get('content'))}"


def _mock_tool_call(payload: dict) -> tuple[str, str] | None:
    """Mock "agent": when tools are offered and the last message is not a tool result, call the first tool with the
    user's instruction as its argument (so what the model saw, placeholders included, is what comes back)."""
    tools = payload.get("tools") or []
    last = payload["messages"][-1]
    if not tools or last.get("role") == "tool" or not isinstance(tools[0].get("function"), dict):
        return None
    return tools[0]["function"]["name"], json.dumps({"instruction": _text(last.get("content"))}, ensure_ascii=False)


def _openai_target(payload: dict, incoming_auth: str | None, route: str) -> tuple[str, dict, dict]:
    if route == "internal":
        base = os.getenv("INTERNAL_BASE_URL", INTERNAL_DEFAULT_URL).rstrip("/")
        key = os.getenv("INTERNAL_API_KEY")
        payload = {**payload, "model": os.getenv("INTERNAL_MODEL") or payload.get("model")}
        headers = {"Authorization": f"Bearer {key}"} if key else {}
    else:
        base = os.getenv("UPSTREAM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        key = os.getenv("UPSTREAM_API_KEY")
        headers = {"Authorization": f"Bearer {key}"} if key else ({"Authorization": incoming_auth} if incoming_auth else {})
        if os.getenv("UPSTREAM_MODEL"):
            payload = {**payload, "model": os.environ["UPSTREAM_MODEL"]}
    return f"{base}/chat/completions", payload, headers


async def forward(payload: dict, incoming_auth: str | None, route: str = "external") -> dict:
    payload = {k: v for k, v in payload.items() if k != "stream"}
    if mock():
        # Offline dev mode: echo the last message so redact/restore can be seen without an API key.
        call = _mock_tool_call(payload)
        if call:
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [{"id": "call_mock_1", "type": "function", "function": {"name": call[0], "arguments": call[1]}}],
            }
            return {"choices": [{"index": 0, "message": message, "finish_reason": "tool_calls"}]}
        return {"choices": [{"index": 0, "message": {"role": "assistant", "content": _mock_text(payload, route)}}]}
    if route == "external" and os.getenv("UPSTREAM_PROVIDER", "openai") == "anthropic":
        return await _forward_anthropic(payload)
    url, payload, headers = _openai_target(payload, incoming_auth, route)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise UpstreamError(str(e)) from e
    return resp.json()


async def stream(payload: dict, incoming_auth: str | None, route: str = "external") -> AsyncIterator[str | ToolDelta]:
    """Yield the answer's text deltas, and ToolDelta fragments when the model calls a tool."""
    payload = {k: v for k, v in payload.items() if k != "stream"}
    if mock():
        call = _mock_tool_call(payload)
        if call:
            name, args = call
            yield ToolDelta(0, "call_mock_1", name, "")
            for i in range(0, len(args), 5):  # small pieces on purpose: a placeholder can be cut anywhere
                yield ToolDelta(0, None, None, args[i : i + 5])
            return
        text = _mock_text(payload, route)
        for i in range(0, len(text), 4):  # small pieces on purpose: exercises boundary handling
            yield text[i : i + 4]
        return
    if route == "external" and os.getenv("UPSTREAM_PROVIDER", "openai") == "anthropic":
        async for delta in _stream_anthropic(payload):
            yield delta
        return
    url, payload, headers = _openai_target(payload, incoming_auth, route)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, read=None)) as client:
            async with client.stream("POST", url, json={**payload, "stream": True}, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    choices = json.loads(data).get("choices") or []
                    delta = choices[0].get("delta", {}) if choices else {}
                    if delta.get("content"):
                        yield delta["content"]
                    for tc in delta.get("tool_calls") or []:
                        fn = tc.get("function") or {}
                        yield ToolDelta(tc.get("index", 0), tc.get("id"), fn.get("name"), fn.get("arguments") or "")
    except (httpx.HTTPError, ValueError) as e:
        raise UpstreamError(str(e)) from e


def _client() -> anthropic.AsyncAnthropic:
    # The caller's Authorization header is an OpenAI-style key, so it is never forwarded here.
    return anthropic.AsyncAnthropic(api_key=os.getenv("UPSTREAM_API_KEY") or None)


async def _forward_anthropic(payload: dict) -> dict:
    try:
        msg = await _client().messages.create(**to_anthropic_request(payload))
    except anthropic.APIError as e:
        raise UpstreamError(str(e)) from e
    return to_openai_response(msg)


async def _stream_anthropic(payload: dict) -> AsyncIterator[str]:
    try:
        async with _client().messages.stream(**to_anthropic_request(payload)) as s:
            async for delta in s.text_stream:
                yield delta
    except anthropic.APIError as e:
        raise UpstreamError(str(e)) from e


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
