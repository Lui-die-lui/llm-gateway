"""Request-side pipeline (detect -> mask) and response-side pipeline (scan -> restore)."""
from collections import Counter

from . import company_policy, policy
from .detector import RESPONSE_LABELS, Match, detect
from .llm_detector import llm_matches
from .taxonomy import Industry
from .vault import Vault


class ResponseBlocked(Exception):
    """The model's answer contained something that must not reach the employee. Labels only, never values."""

    def __init__(self, findings: dict[str, int]) -> None:
        super().__init__("response blocked by policy")
        self.findings = findings


def count_by_label(matches: list[Match]) -> dict[str, int]:
    """Labels of what was masked or blocked. Log-only matches were not touched, so they are not counted."""
    return dict(Counter(m.label for m in matches if m.action != "log"))


def find_matches(text: str, industries: list[Industry], engine: company_policy.Engine | None = None) -> list[Match]:
    """Everything that applies to this text: built-ins, selected industry templates, then the company's own policy."""
    eng = engine or company_policy.active()
    extra = eng.matches(text) + llm_matches(text, industries, eng.ai)
    matches = detect(text, industries, extra=extra, skip_labels=eng.skip_labels, skip_entities=eng.skip_entities)
    return eng.adjust(matches)


def redact_text(
    text: str, vault: Vault, industries: list[Industry], engine: company_policy.Engine | None = None
) -> tuple[str, list[Match]]:
    """-> (masked text, matches). `log` matches stay in the text and are only recorded."""
    matches = find_matches(text, industries, engine)
    out, pos = [], 0
    for m in matches:
        if m.action == "log":
            continue
        out.append(text[pos : m.start])
        out.append(vault.placeholder(m.label, text[m.start : m.end]))
        pos = m.end
    out.append(text[pos:])
    return "".join(out), matches


def sanitize_messages(
    messages: list[dict], vault: Vault, industries: list[Industry], internal_available: bool
) -> tuple[list[dict], list[Match], str]:
    """Mask every text part of an OpenAI-style messages list.

    Returns (messages to send, all matches, route). On route "internal" the original messages come back
    untouched, because they stay inside the company.
    """
    all_matches: list[Match] = []

    def mask(s: str) -> str:
        redacted, ms = redact_text(s, vault, industries)
        all_matches.extend(ms)
        return redacted

    masked = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            msg = {**msg, "content": mask(content)}
        elif isinstance(content, list):
            parts = [
                {**p, "text": mask(p["text"])} if isinstance(p, dict) and p.get("type") == "text" else p
                for p in content
            ]
            msg = {**msg, "content": parts}
        masked.append(msg)
    route = policy.decide(all_matches, internal_available)
    return (messages if route == "internal" else masked), all_matches, route


def scan_text(text: str) -> tuple[str, list[Match]]:
    """Reverse DLP on model output (run before restore, so restored originals are never flagged).

    Built-in PII only. Redacted spans become a non-restorable "[이메일 가림]"; a `block` hit raises.
    """
    matches = detect(text, [], only=RESPONSE_LABELS, skip_labels=company_policy.active().skip_labels)
    if any(m.action in ("block", "internal_only") for m in matches):
        raise ResponseBlocked(count_by_label(matches))
    out, pos = [], 0
    for m in matches:
        out.append(text[pos : m.start])
        out.append(f"[{m.label} 가림]")
        pos = m.end
    out.append(text[pos:])
    return "".join(out), matches


def scan_body(body: dict) -> list[Match]:
    found: list[Match] = []
    for choice in body.get("choices", []):
        message = choice.get("message") or {}
        if isinstance(message.get("content"), str):
            message["content"], ms = scan_text(message["content"])
            found += ms
    return found


def restore_response(body: dict, vault: Vault) -> dict:
    for choice in body.get("choices", []):
        message = choice.get("message") or {}
        if isinstance(message.get("content"), str):
            message["content"] = vault.restore(message["content"])
    return body
