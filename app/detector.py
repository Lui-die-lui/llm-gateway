"""Detection engine: built-in PII rules + industry taxonomy rules.

Regex only for now. NER / Presidio / local-LLM detection plug in here later
by returning more Match objects from `detect`.
"""
import re
from dataclasses import dataclass

from .taxonomy import Action, Industry

CONTEXT_WINDOW = 40  # chars on each side of a pattern hit searched for context_keywords


@dataclass(frozen=True)
class Match:
    start: int
    end: int
    label: str
    action: Action
    priority: int  # higher wins when matches overlap


# (label, regex, action)
BUILTIN_RULES: list[tuple[str, re.Pattern[str], Action]] = [
    ("시크릿", re.compile(r"sk-[A-Za-z0-9_-]{20,}"), "block"),
    ("이메일", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "redact"),
    ("주민번호", re.compile(r"(?<!\d)\d{6}-[1-4][\dxX*]{6}(?!\d)"), "redact"),
    ("전화번호", re.compile(r"(?<!\d)01[016789]-?\d{3,4}-?\d{4}(?!\d)"), "redact"),
    ("사업자번호", re.compile(r"(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)"), "redact"),
]


def _has_context(text: str, start: int, end: int, keywords: list[str]) -> bool:
    window = text[max(0, start - CONTEXT_WINDOW) : end + CONTEXT_WINDOW]
    return any(k in window for k in keywords)


def _builtin_matches(text: str) -> list[Match]:
    return [
        Match(m.start(), m.end(), label, action, priority=1)
        for label, rx, action in BUILTIN_RULES
        for m in rx.finditer(text)
    ]


def _taxonomy_matches(text: str, industries: list[Industry]) -> list[Match]:
    found: list[Match] = []
    for industry in industries:
        for entity in industry.entities:
            keywords = entity.detection.context_keywords
            for pattern in entity.detection.patterns:
                for m in re.finditer(pattern, text):
                    # If the pattern has a capture group, only that part is the sensitive value.
                    start, end = (m.start(1), m.end(1)) if m.re.groups else (m.start(), m.end())
                    if start == end:
                        continue
                    if keywords and not _has_context(text, start, end, keywords):
                        continue
                    found.append(Match(start, end, entity.label or entity.id, entity.action, priority=2))
    return found


def detect(text: str, industries: list[Industry]) -> list[Match]:
    """Return non-overlapping matches sorted by position. On overlap, higher priority then longer wins."""
    candidates = _builtin_matches(text) + _taxonomy_matches(text, industries)
    candidates.sort(key=lambda m: (-m.priority, -(m.end - m.start), m.start))
    chosen: list[Match] = []
    for c in candidates:
        if all(c.end <= k.start or c.start >= k.end for k in chosen):
            chosen.append(c)
    return sorted(chosen, key=lambda m: m.start)
