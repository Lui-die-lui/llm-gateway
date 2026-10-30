"""Request-side pipeline (detect -> mask) and response-side pipeline (scan -> restore)."""
import json
import os
from collections import Counter
from collections.abc import Callable
from dataclasses import replace

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


def _map_strings(value, fn: Callable[[str], object]):
    """Apply fn to every string value of a JSON document (keys stay as they are)."""
    if isinstance(value, str):
        return fn(value)
    if isinstance(value, list):
        return [_map_strings(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _map_strings(v, fn) for k, v in value.items()}
    return value


def map_arguments(arguments: str, fn: Callable[[str], object]) -> str:
    """Tool-call arguments are a JSON document inside a string. Transform its string values and keep it valid JSON
    (a restored value may contain quotes or newlines, which must be escaped again). Not JSON: transform the whole string."""
    try:
        doc = json.loads(arguments)
    except ValueError:
        out = fn(arguments)
        return out if isinstance(out, str) else str(out)
    return json.dumps(_map_strings(doc, fn), ensure_ascii=False)


def _map_calls(message: dict, fn_args: Callable[[str], str]) -> dict:
    """Return the message with fn_args applied to the arguments string of its tool_calls / legacy function_call."""
    out = dict(message)
    calls = message.get("tool_calls")
    if isinstance(calls, list):
        out["tool_calls"] = [
            {**c, "function": {**c["function"], "arguments": fn_args(c["function"]["arguments"])}}
            if isinstance(c, dict) and isinstance(c.get("function"), dict) and isinstance(c["function"].get("arguments"), str)
            else c
            for c in calls
        ]
    legacy = message.get("function_call")
    if isinstance(legacy, dict) and isinstance(legacy.get("arguments"), str):
        out["function_call"] = {**legacy, "arguments": fn_args(legacy["arguments"])}
    return out


# Structured data (tool results, tool arguments) says what a value is through its key, even when the value alone looks like
# nothing: "홍길동" has no title, "5000000" no unit. Key (lowercase, no spaces/_/-) -> placeholder label.
# Extend with SENSITIVE_KEYS="cust_nm=사람,tel_no=전화번호" for a company's own field names.
_KEY_GROUPS = {
    "사람": ("name", "fullname", "customername", "username", "이름", "성명", "고객명", "담당자", "담당자명"),
    "이메일": ("email", "emailaddress", "mail", "이메일", "메일"),
    "전화번호": ("phone", "phonenumber", "mobile", "tel", "telephone", "전화", "전화번호", "휴대폰", "휴대전화", "연락처"),
    "주민번호": ("ssn", "rrn", "주민번호", "주민등록번호"),
    "주소": ("address", "주소"),
    "계좌번호": ("account", "accountnumber", "계좌", "계좌번호"),
    "카드번호": ("card", "cardnumber", "카드번호"),
    "급여": ("salary", "wage", "급여", "연봉"),
}


def _norm_key(key: str) -> str:
    return "".join(ch for ch in key.lower() if ch not in " _-")


def key_labels() -> dict[str, str]:
    labels = {_norm_key(k): label for label, keys in _KEY_GROUPS.items() for k in keys}
    for pair in os.getenv("SENSITIVE_KEYS", "").split(","):
        key, _, label = pair.partition("=")
        if key.strip() and label.strip():
            labels[_norm_key(key)] = label.strip()
    return labels


def count_by_label(matches: list[Match]) -> dict[str, int]:
    """Labels of what was masked or blocked. Log-only matches were not touched, so they are not counted."""
    return dict(Counter(m.label for m in matches if m.action != "log"))


def find_matches(text: str, industries: list[Industry], engine: company_policy.Engine | None = None) -> list[Match]:
    """Everything that applies to this text: built-ins, selected industry templates, then the company's own policy."""
    eng = engine or company_policy.active()
    extra = eng.matches(text) + llm_matches(text, industries, eng.ai)
    matches = detect(text, industries, extra=extra, skip_labels=eng.skip_labels, skip_entities=eng.skip_entities)
    return eng.adjust(matches)


def let_through(matches: list[Match], labels: frozenset[str] | set[str]) -> list[Match]:
    """Matches of an approved kind of information stay as typed (recorded, not masked, not blocked)."""
    return [replace(m, action="log") if m.label in labels and m.action != "log" else m for m in matches]


def redact_text(
    text: str,
    vault: Vault,
    industries: list[Industry],
    engine: company_policy.Engine | None = None,
    approved: frozenset[str] | set[str] = frozenset(),
) -> tuple[str, list[Match]]:
    """-> (masked text, matches). `log` matches stay in the text and are only recorded."""
    matches = let_through(find_matches(text, industries, engine), approved)
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
    labels = key_labels()
    skip = company_policy.active().skip_labels

    def mask(s: str) -> str:
        redacted, ms = redact_text(s, vault, industries)
        all_matches.extend(ms)
        return redacted

    def mask_doc(value):
        if isinstance(value, dict):
            out = {}
            for k, v in value.items():
                label = labels.get(_norm_key(k)) if isinstance(k, str) else None
                if label and label not in skip and isinstance(v, (str, int, float)) and not isinstance(v, bool) and str(v).strip():
                    all_matches.append(Match(0, 0, label, "redact", 1))  # for the audit log and the findings count
                    out[k] = vault.placeholder(label, str(v), numeric=isinstance(v, (int, float)))
                else:
                    out[k] = mask_doc(v)
            return out
        if isinstance(value, list):
            return [mask_doc(v) for v in value]
        return mask(value) if isinstance(value, str) else value

    def mask_structured(text: str) -> str:
        """JSON (a tool result, tool arguments) is masked by key and by content; anything else by content."""
        try:
            doc = json.loads(text)
        except ValueError:
            return mask(text)
        return json.dumps(mask_doc(doc), ensure_ascii=False) if isinstance(doc, (dict, list)) else mask(text)

    masked = []
    for msg in messages:
        content = msg.get("content")
        text_mask = mask_structured if msg.get("role") in ("tool", "function") else mask
        if isinstance(content, str):
            msg = {**msg, "content": text_mask(content)}
        elif isinstance(content, list):
            parts = [
                {**p, "text": text_mask(p["text"])} if isinstance(p, dict) and p.get("type") == "text" else p
                for p in content
            ]
            msg = {**msg, "content": parts}
        masked.append(_map_calls(msg, mask_structured))  # an assistant turn replayed from history carries real values in its tool calls
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
    """Put the original values back into the answer and into the arguments of any tool call, so the app that runs
    the tool (inside the company) gets real values while the model only ever saw placeholders."""
    for choice in body.get("choices", []):
        message = choice.get("message") or {}
        if isinstance(message.get("content"), str):
            message["content"] = vault.restore(message["content"])
        choice["message"] = _map_calls(message, lambda args: map_arguments(args, vault.restore_value))
    return body
