"""Exception requests: an employee asks to send something the gateway blocks, an admin approves or rejects (SQLite, exceptions.db).

Records only. Nothing tells the gateway who is typing, so an approval does not change what the gateway lets through; it is the
decision the console shows and the employee reads back. `client_id` is a random id the portal keeps in the browser, so
"my requests" is a convenience filter and not a login.
"""
import os
import sqlite3
import threading
import time
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .company_policy import PolicyError

MAX_PENDING = 1000  # the submit endpoint is open to the portal, so cap what a stray caller can pile up (undecided requests only)
KEEP_DECIDED_DAYS = 180  # decided requests older than this are dropped, so the table never fills up with history

_lock = threading.Lock()
_db: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS exception_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created REAL NOT NULL,
  client_id TEXT NOT NULL,
  requester TEXT NOT NULL,
  entity TEXT NOT NULL,
  site TEXT NOT NULL,
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  ttl TEXT,
  memo TEXT NOT NULL DEFAULT '',
  decided REAL,
  used INTEGER NOT NULL DEFAULT 0            -- a one-use (1x) approval that has been spent
);
"""


class ExceptionIn(BaseModel):
    client_id: str = Field(min_length=4, max_length=64)
    requester: str = Field(default="", max_length=40)
    entity: str = Field(default="", max_length=100)
    site: str = Field(default="", max_length=100)
    reason: str = Field(max_length=1000)
    scope: Literal["1회", "1시간", "24시간"]

    @field_validator("reason")
    @classmethod
    def long_enough(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 20:
            raise ValueError("사유를 20자 이상 적어 주세요")
        return v


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected"]
    ttl: Literal["1x", "1h", "24h", "7d"] = "1x"
    memo: str = Field(default="", max_length=500)


def configure(path: str) -> None:
    global _db
    if path != ":memory:":
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with _lock:
        if _db is not None:
            _db.close()
        _db = sqlite3.connect(path, check_same_thread=False)
        _db.row_factory = sqlite3.Row
        _db.executescript(SCHEMA)
        if "used" not in {r["name"] for r in _db.execute("PRAGMA table_info(exception_requests)")}:  # database from before grants
            _db.execute("ALTER TABLE exception_requests ADD COLUMN used INTEGER NOT NULL DEFAULT 0")
        _db.commit()


def _row(r: sqlite3.Row) -> dict:
    return {
        "id": f"REQ-{r['id']:04d}",
        "created": r["created"],
        "requester": r["requester"],
        "entity": r["entity"],
        "site": r["site"],
        "reason": r["reason"],
        "scope": r["scope"],
        "status": r["status"],
        "ttl": r["ttl"],
        "memo": r["memo"],
        "decided": r["decided"],
        "used": bool(r["used"]),
    }


def create(body: ExceptionIn) -> dict:
    # Without a name, tell the people sharing a demo apart by the tail of their browser id.
    requester = body.requester.strip() or f"직원-{body.client_id[-4:]}"
    with _lock:
        _db.execute("DELETE FROM exception_requests WHERE status!='pending' AND created<?", (time.time() - KEEP_DECIDED_DAYS * 86400,))
        if _db.execute("SELECT COUNT(*) FROM exception_requests WHERE status='pending'").fetchone()[0] >= MAX_PENDING:
            raise PolicyError("예외 요청이 너무 많이 쌓였어요. 관리자에게 문의하세요", 429, "too_many_requests")
        cur = _db.execute(
            "INSERT INTO exception_requests(created,client_id,requester,entity,site,reason,scope) VALUES (?,?,?,?,?,?,?)",
            (time.time(), body.client_id, requester, body.entity.strip(), body.site.strip(), body.reason, body.scope),
        )
        _db.commit()
        return _row(_db.execute("SELECT * FROM exception_requests WHERE id=?", (cur.lastrowid,)).fetchone())


def listing(client_id: str | None = None) -> list[dict]:
    """Newest first. With client_id, only that browser's requests."""
    with _lock:
        if client_id:
            rows = _db.execute("SELECT * FROM exception_requests WHERE client_id=? ORDER BY id DESC", (client_id,))
        else:
            rows = _db.execute("SELECT * FROM exception_requests ORDER BY id DESC")
        return [_row(r) for r in rows.fetchall()]


TTL_SECONDS = {"1h": 3600, "24h": 86400, "7d": 604800}


def grants(client_id: str | None, site: str | None = None, now: float | None = None) -> list[dict]:
    """Approvals in force for this browser: approved, not over, not spent, for this site. -> [{id, labels, once, left}] (`left`: seconds to go, None for a one-use approval).

    `labels` is what the request named (the kinds of information the person asked to send as they are). The browser id is not a
    login: whoever has it can use the approval, so an approval is only as private as the id. It is limited to those kinds of
    information, for the time the admin gave, and (when the request named a site) that site.
    """
    if not client_id:
        return []
    now = time.time() if now is None else now
    with _lock:
        rows = _db.execute("SELECT * FROM exception_requests WHERE client_id=? AND status='approved' AND used=0", (client_id,)).fetchall()
    out = []
    for r in rows:
        seconds = TTL_SECONDS.get(r["ttl"])
        end = (r["decided"] or 0) + seconds if seconds else None
        if end and now >= end:
            continue  # over
        if r["site"] and site and r["site"] != site:
            continue
        labels = {x.strip() for x in r["entity"].split(",") if x.strip()}
        if labels:
            out.append({"id": f"REQ-{r['id']:04d}", "labels": labels, "once": r["ttl"] == "1x", "left": int(end - now) if end else None})
    return out


def spend(public_id: str) -> None:
    """A one-use approval is used up the first time it lets something through."""
    num = public_id.removeprefix("REQ-")
    if num.isdigit():
        with _lock:
            _db.execute("UPDATE exception_requests SET used=1 WHERE id=? AND ttl='1x'", (int(num),))
            _db.commit()


def decide(public_id: str, body: DecisionIn) -> dict:
    num = public_id.removeprefix("REQ-")
    if not num.isdigit():
        raise PolicyError("없는 예외 요청이에요", 404, "not_found")
    with _lock:
        r = _db.execute("SELECT * FROM exception_requests WHERE id=?", (int(num),)).fetchone()
        if r is None:
            raise PolicyError("없는 예외 요청이에요", 404, "not_found")
        if r["status"] != "pending":
            raise PolicyError("이미 처리한 요청이에요", 409, "already_decided")
        if body.decision == "approved" and not any(x.strip() for x in r["entity"].split(",")):
            # Without a named kind of information an approval would let nothing through: say so instead of approving in silence.
            raise PolicyError("허용할 항목이 적혀 있지 않아 승인해도 아무것도 통과되지 않아요. 반려하고 다시 요청받아 주세요", 422, "no_entity")
        _db.execute(
            "UPDATE exception_requests SET status=?, ttl=?, memo=?, decided=? WHERE id=?",
            (body.decision, body.ttl if body.decision == "approved" else None, body.memo.strip(), time.time(), r["id"]),
        )
        _db.commit()
        return _row(_db.execute("SELECT * FROM exception_requests WHERE id=?", (r["id"],)).fetchone())


def clear() -> int:
    """Delete every exception request. Returns how many were deleted; numbering starts over at REQ-0001."""
    with _lock:
        n = _db.execute("SELECT COUNT(*) FROM exception_requests").fetchone()[0]
        _db.execute("DELETE FROM exception_requests")
        _db.execute("DELETE FROM sqlite_sequence WHERE name='exception_requests'")
        _db.commit()
    return n
