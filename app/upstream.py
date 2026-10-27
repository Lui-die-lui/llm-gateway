"""Forward the sanitized request to the external LLM (OpenAI-compatible)."""
import os

import httpx


async def forward(payload: dict, incoming_auth: str | None) -> dict:
    if os.getenv("UPSTREAM_MODE") == "mock":
        # Offline dev mode: echo the last message so redact/restore can be seen without an API key.
        last = payload["messages"][-1].get("content", "")
        return {"choices": [{"index": 0, "message": {"role": "assistant", "content": f"[mock] {last}"}}]}

    base = os.getenv("UPSTREAM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    key = os.getenv("UPSTREAM_API_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else ({"Authorization": incoming_auth} if incoming_auth else {})
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{base}/chat/completions", json=payload, headers=headers)
    resp.raise_for_status()
    return resp.json()
