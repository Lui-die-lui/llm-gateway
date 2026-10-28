"""Company policy: custom rules and built-in on/off switches, edited in the console and enforced on every request.

Custom rule kinds (what the console's "무엇을 찾을까요" offers):
  words    one company word per line, matched literally
  pattern  a Python regular expression (a capture group, if present, is the sensitive part)
  ai       a plain-language description, handed to the local LLM detector (does nothing without LOCAL_LLM_MODEL)
  builtin  not a new detector: changes the action for built-in labels ("이름, 이메일 -> 차단")
Actions: redact (mask), block (refuse the request), log (let it through, record it in the audit log).

Edits go to a draft that traffic never sees. `apply` turns the draft into the next numbered version; `rollback` re-applies an
old one as a new version. Built-in switches (rules_catalog ids, plus "i:<industry>:<entity>" for template entities) apply at once.

Not enforced yet: `scope`. Nothing tells the gateway who is typing, so a rule scoped to one department applies to everyone.
Stored in SQLite as one JSON document per key (policy.db). Rules are written by admins; a pathological pattern can still be slow
(Python's `re` has no timeout), so keep the console admin-only.
"""
import json
import os
import re
import sqlite3
import threading
import time
from dataclasses import dataclass, replace
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from . import rules_catalog
from .detector import Match

KINDS = ("builtin", "words", "pattern", "ai")
ACTIONS = ("redact", "block", "log")
MAX_RULES = 200
MAX_WORDS = 500
SECRET_LABEL = "시크릿"


class PolicyError(Exception):
    def __init__(self, message: str, status: int = 400, type_: str = "invalid_request") -> None:
        super().__init__(message)
        self.message, self.status, self.type = message, status, type_


class Options(BaseModel):
    ask: bool = False
    exc: bool = False
    notify: bool = False


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["builtin", "words", "pattern", "ai"]
    action: Literal["redact", "block", "log"]
    scope: list[str] = Field(default_factory=lambda: ["전사"])
    enabled: bool = True
    builtins: list[str] = Field(default_factory=list)
    words: str = Field(default="", max_length=20000)
    pattern: str = Field(default="", max_length=200)
    ai: str = Field(default="", max_length=300)
    tag: str = Field(default="", max_length=40)
    options: Options = Field(default_factory=Options)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("규칙명을 먼저 적어 주세요")
        return v

    @model_validator(mode="after")
    def _check_kind(self) -> "RuleIn":
        if self.kind == "builtin":
            unknown = [b for b in self.builtins if b not in rules_catalog.NAME_TO_LABELS]
            if not self.builtins or unknown:
                raise ValueError("고를 수 없는 기본 정보: " + ", ".join(unknown) if unknown else "기본 정보를 하나 이상 골라 주세요")
            secret = any(SECRET_LABEL in rules_catalog.NAME_TO_LABELS[b] for b in self.builtins)
            if secret and self.action != "block":
                raise ValueError("API 키 · 비밀번호 같은 보안 정보는 차단으로만 둘 수 있어요")
        elif self.kind == "words":
            words = _words(self.words)
            if not words:
                raise ValueError("단어를 한 줄에 하나씩 적어 주세요")
            if len(words) > MAX_WORDS or any(len(w) > 100 for w in words):
                raise ValueError(f"단어는 {MAX_WORDS}개까지, 하나에 100자까지예요")
        elif self.kind == "pattern":
            try:
                rx = re.compile(self.pattern)
            except re.error as e:
                raise ValueError(f"패턴이 올바르지 않아요: {e}") from e
            if not self.pattern or rx.search(""):
                raise ValueError("빈 글자에도 맞는 패턴은 쓸 수 없어요")
        elif not self.ai.strip():
            raise ValueError("찾을 것을 말로 설명해 주세요")
        return self


def _words(blob: str) -> list[str]:
    return [w.strip() for w in blob.splitlines() if w.strip()]


def _label(rule: dict) -> str:
    return rule["tag"].strip().strip("[]").removesuffix("_n").strip() or rule["name"]


def _cond(r: dict) -> str:
    if r["kind"] == "builtin":
        return ", ".join(r["builtins"])
    if r["kind"] == "words":
        return f"회사 단어 목록 {len(_words(r['words']))}개"
    if r["kind"] == "pattern":
        return f"{r['pattern']} 모양"
    return f'"{r["ai"]}"'


# ---------------------------------------------------------------- engine (what traffic sees)

@dataclass(frozen=True)
class Engine:
    words: tuple[tuple[re.Pattern[str], str, str], ...] = ()  # (regex, label, action)
    patterns: tuple[tuple[re.Pattern[str], str, str], ...] = ()
    ai: tuple[tuple[str, str, str], ...] = ()  # (label, description, action)
    overrides: tuple[tuple[str, str], ...] = ()  # built-in label -> action
    skip_labels: frozenset[str] = frozenset()
    skip_entities: frozenset[tuple[str, str]] = frozenset()

    def matches(self, text: str) -> list[Match]:
        found: list[Match] = []
        for rx, label, action in self.words + self.patterns:
            priority = 3 if action == "block" else 2
            for m in rx.finditer(text):
                start, end = (m.start(1), m.end(1)) if rx.groups and m.group(1) else (m.start(), m.end())
                if end > start:
                    found.append(Match(start, end, label, action, priority))
        return found

    def adjust(self, matches: list[Match]) -> list[Match]:
        """Apply the "builtin" rules: a different action for built-in labels. Order of rules = later wins."""
        if not self.overrides:
            return matches
        action_for = dict(self.overrides)
        return [replace(m, action=action_for[m.label]) if m.priority <= 1 and m.label in action_for else m for m in matches]


def compile_engine(rules: list[dict], builtin_enabled: dict[str, bool]) -> Engine:
    words, patterns, ai, overrides = [], [], [], []
    for r in sorted(rules, key=lambda r: r["prio"]):
        if not r["enabled"]:
            continue
        label, action = _label(r), r["action"]
        if r["kind"] == "words":
            ws = sorted(set(_words(r["words"])), key=len, reverse=True)
            words.append((re.compile("|".join(re.escape(w) for w in ws)), label, action))
        elif r["kind"] == "pattern":
            patterns.append((re.compile(r["pattern"]), label, action))
        elif r["kind"] == "ai":
            ai.append((label, r["ai"].strip(), action))
        else:
            for name in r["builtins"]:
                for lab in rules_catalog.NAME_TO_LABELS.get(name, ()):
                    if lab == SECRET_LABEL and action != "block":
                        continue  # never let a secret through, whatever an old draft says
                    overrides.append((lab, action))
    skip_labels = set()
    for lab in rules_catalog.covered_labels():
        entries = [e for e in rules_catalog.ENTRIES if lab in e.labels]
        if all(builtin_enabled.get(e.id, True) is False for e in entries):
            skip_labels.add(lab)
    skip_entities = set()
    for key, on in builtin_enabled.items():
        parts = key.split(":", 2)
        if on is False and len(parts) == 3 and parts[0] == "i":
            skip_entities.add((parts[1], parts[2]))
    return Engine(tuple(words), tuple(patterns), tuple(ai), tuple(overrides), frozenset(skip_labels), frozenset(skip_entities))


# ---------------------------------------------------------------- store

_lock = threading.RLock()
_db: sqlite3.Connection | None = None
_state: dict = {}
_engine: Engine = Engine()


def _fresh() -> dict:
    return {"version": 0, "applied": [], "draft": [], "versions": [], "next_id": 1, "builtin": {"version": 0, "enabled": {}}}


def configure(path: str) -> None:
    global _db, _state, _engine
    with _lock:
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        if _db is not None:
            _db.close()
        _db = sqlite3.connect(path, check_same_thread=False)
        _db.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        row = _db.execute("SELECT value FROM kv WHERE key='state'").fetchone()
        _state = json.loads(row[0]) if row else _fresh()
        _engine = compile_engine(_state["applied"], _state["builtin"]["enabled"])


def _save() -> None:
    _db.execute("INSERT INTO kv VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(_state, ensure_ascii=False),))
    _db.commit()


def active() -> Engine:
    return _engine


def draft_engine() -> Engine:
    with _lock:
        return compile_engine(_state["draft"], _state["builtin"]["enabled"])


def _pending() -> list[dict]:
    applied = {r["id"]: r for r in _state["applied"]}
    draft = {r["id"]: r for r in _state["draft"]}
    notes = []
    for rid, r in draft.items():
        old = applied.get(rid)
        if old is None:
            notes.append({"ruleId": rid, "note": f"{r['name']} 규칙 새로 만듦"})
        elif old["enabled"] != r["enabled"]:
            notes.append({"ruleId": rid, "note": f"{r['name']} {'켜기' if r['enabled'] else '끄기'}"})
        elif {k: v for k, v in old.items() if k not in ("prio", "hits")} != {k: v for k, v in r.items() if k not in ("prio", "hits")}:
            notes.append({"ruleId": rid, "note": f"{r['name']} 수정"})
    notes += [{"ruleId": rid, "note": f"{r['name']} 삭제"} for rid, r in applied.items() if rid not in draft]
    return notes


def view() -> dict:
    with _lock:
        return {"version": _state["version"], "rules": json.loads(json.dumps(_state["draft"])), "pending": _pending()}


def _rule(rid: str) -> dict:
    for r in _state["draft"]:
        if r["id"] == rid:
            return r
    raise PolicyError("없는 규칙이에요", 404, "not_found")


def _store(body: RuleIn, rule: dict) -> None:
    rule.update(body.model_dump())
    rule["cond"] = _cond(rule)


def add_rule(body: RuleIn) -> tuple[dict, str]:
    with _lock:
        if len(_state["draft"]) >= MAX_RULES:
            raise PolicyError(f"규칙은 {MAX_RULES}개까지 만들 수 있어요")
        rid = f"r{_state['next_id']}"
        _state["next_id"] += 1
        prio = max((r["prio"] for r in _state["draft"]), default=0) + 10
        rule = {"id": rid, "prio": prio, "hits": "—"}
        _store(body, rule)
        _state["draft"].append(rule)
        _save()
        return view(), rid


def save_rule(rid: str, body: RuleIn) -> dict:
    with _lock:
        _store(body, _rule(rid))
        _save()
        return view()


def toggle_rule(rid: str) -> dict:
    with _lock:
        r = _rule(rid)
        r["enabled"] = not r["enabled"]
        _save()
        return view()


def delete_rule(rid: str) -> dict:
    with _lock:
        _rule(rid)
        _state["draft"] = [r for r in _state["draft"] if r["id"] != rid]
        _save()
        return view()


def apply() -> dict:
    with _lock:
        pending = _pending()
        if not pending:
            raise PolicyError("적용할 변경이 없어요")
        return _publish("; ".join(p["note"] for p in pending), len(pending))


def _publish(note: str, count: int) -> dict:
    global _engine
    _state["version"] += 1
    snapshot = json.loads(json.dumps(_state["draft"]))
    _state["applied"] = snapshot
    _state["versions"].append({"version": _state["version"], "ts": time.time(), "note": note[:500], "rules": json.loads(json.dumps(snapshot))})
    _state["versions"] = _state["versions"][-50:]
    _save()
    _engine = compile_engine(_state["applied"], _state["builtin"]["enabled"])
    return {"version": _state["version"], "applied": count}


def versions() -> list[dict]:
    with _lock:
        return [{"version": v["version"], "ts": v["ts"], "note": v["note"], "rules": len(v["rules"])} for v in reversed(_state["versions"])]


def rollback(version: int) -> dict:
    with _lock:
        old = next((v for v in _state["versions"] if v["version"] == version), None)
        if old is None:
            raise PolicyError("없는 버전이에요 (최근 50개만 보관해요)", 404, "not_found")
        _state["draft"] = json.loads(json.dumps(old["rules"]))
        return _publish(f"버전 {version}으로 되돌림", len(old["rules"]))


def builtin_view() -> dict:
    with _lock:
        return {"version": _state["builtin"]["version"], "applied": dict(_state["builtin"]["enabled"])}


def set_builtin(enabled: dict[str, bool]) -> dict:
    global _engine
    with _lock:
        for key in enabled:
            if key not in rules_catalog.BY_ID and not (key.startswith("i:") and key.count(":") == 2):
                raise PolicyError(f"알 수 없는 기본 규칙: {key}")
        merged = {**_state["builtin"]["enabled"], **{k: bool(v) for k, v in enabled.items()}}
        _state["builtin"] = {"version": _state["builtin"]["version"] + 1, "enabled": merged}
        _save()
        _engine = compile_engine(_state["applied"], merged)
        return builtin_view()
