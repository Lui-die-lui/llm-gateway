"""Optional detection assist from a local LLM (Ollama). Nothing leaves the machine.

Enabled by LOCAL_LLM_MODEL. It only ever *adds* matches: the model is asked to quote values that appear in
the text, and a quoted value is used only if it really occurs there, so a wrong or manipulated answer
can cost a false redaction but can never remove a regex hit.
If the local model is down the request continues with regex detection alone.
"""
import json
import logging
import os
import re

import httpx

from .detector import Match
from .taxonomy import Industry

log = logging.getLogger("gateway.llm_detector")

PERSON_HINT = "사람 이름 (성과 이름)"


def enabled() -> bool:
    return bool(os.getenv("LOCAL_LLM_MODEL"))


def _chat(prompt: str) -> str:
    base = os.getenv("LOCAL_LLM_URL", "http://localhost:11434").rstrip("/")
    resp = httpx.post(
        f"{base}/api/chat",
        json={
            "model": os.environ["LOCAL_LLM_MODEL"],
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": "json",
        },
        timeout=float(os.getenv("LOCAL_LLM_TIMEOUT", "30")),
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"]


def llm_matches(text: str, industries: list[Industry]) -> list[Match]:
    if not enabled() or len(text.strip()) < 2:
        return []
    targets = {"사람": (PERSON_HINT, "redact")}
    for industry in industries:
        for e in industry.entities:
            if e.detection.ner_hint:
                targets[e.label or e.id] = (e.detection.ner_hint, e.action)
    listing = "\n".join(f"- {label}: {hint}" for label, (hint, _) in targets.items())
    prompt = (
        "다음 텍스트에서 아래 항목에 해당하는 값을 찾아 JSON으로만 답하세요. "
        "텍스트에 그대로 나타난 문자열만 쓰고, 없으면 빈 배열을 쓰세요.\n"
        f"항목:\n{listing}\n"
        '형식: {"항목이름": ["값", ...]}\n'
        f"텍스트:\n{text}"
    )
    try:
        found = json.loads(_chat(prompt))
    except (httpx.HTTPError, ValueError, KeyError) as e:
        log.warning("local LLM detection skipped: %s", type(e).__name__)  # never log the text
        return []
    if not isinstance(found, dict):
        return []
    out: list[Match] = []
    for label, (_, action) in targets.items():
        values = found.get(label)
        if not isinstance(values, list):
            continue
        for v in values:
            if isinstance(v, str) and len(v) >= 2:
                out += [Match(m.start(), m.end(), label, action, priority=2) for m in re.finditer(re.escape(v), text)]
    return out
