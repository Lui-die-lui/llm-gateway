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

MAX_ROWS = 1000  # the submit endpoint is open to the portal, so cap what a stray caller can pile up

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
  decided REAL
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
    }


def create(body: ExceptionIn) -> dict:
    # Without a name, tell the people sharing a demo apart by the tail of their browser id.
    requester = body.requester.strip() or f"직원-{body.client_id[-4:]}"
    with _lock:
        if _db.execute("SELECT COUNT(*) FROM exception_requests").fetchone()[0] >= MAX_ROWS:
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
        _db.execute(
            "UPDATE exception_requests SET status=?, ttl=?, memo=?, decided=? WHERE id=?",
            (body.decision, body.ttl if body.decision == "approved" else None, body.memo.strip(), time.time(), r["id"]),
        )
        _db.commit()
        return _row(_db.execute("SELECT * FROM exception_requests WHERE id=?", (r["id"],)).fetchone())
