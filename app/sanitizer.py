"""Request-side pipeline: detect -> decide -> replace with placeholders."""
from collections import Counter

from . import policy
from .detector import detect
from .taxonomy import Industry
from .vault import Vault


class Blocked(Exception):
    """Raised when policy says the request must not leave. Carries metadata only, never values."""

    def __init__(self, findings: dict[str, int]) -> None:
        super().__init__("blocked by policy")
        self.findings = findings


def sanitize_text(text: str, vault: Vault, industries: list[Industry], findings: Counter) -> str:
    matches = detect(text, industries)
    for m in matches:
        findings[m.label] += 1
    if policy.should_block(matches):
        raise Blocked(dict(findings))
    out, pos = [], 0
    for m in matches:
        out.append(text[pos : m.start])
        out.append(vault.placeholder(m.label, text[m.start : m.end]))
        pos = m.end
    out.append(text[pos:])
    return "".join(out)


def sanitize_messages(
    messages: list[dict], vault: Vault, industries: list[Industry]
) -> tuple[list[dict], dict[str, int]]:
    """Sanitize every text part of an OpenAI-style messages list. Returns (new messages, finding counts)."""
    findings: Counter = Counter()
    result = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            msg = {**msg, "content": sanitize_text(content, vault, industries, findings)}
        elif isinstance(content, list):
            parts = [
                {**p, "text": sanitize_text(p["text"], vault, industries, findings)}
                if isinstance(p, dict) and p.get("type") == "text"
                else p
                for p in content
            ]
            msg = {**msg, "content": parts}
        result.append(msg)
    return result, dict(findings)


def restore_response(body: dict, vault: Vault) -> dict:
    for choice in body.get("choices", []):
        message = choice.get("message") or {}
        if isinstance(message.get("content"), str):
            message["content"] = vault.restore(message["content"])
    return body
