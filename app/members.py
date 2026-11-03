"""Company members and the sign-up requests waiting for an admin's decision.

A person asks to join (public form: name, company mail, department); the admin approves or rejects in the console. This is a
directory the admin keeps: it records who is in, it does not by itself change what the gateway allows (the gateway does not know
who is typing, only which browser). Nothing secret is stored: no password, no key.
"""
import os
import re
import sqlite3
import threading
import time

from . import settings
from .company_policy import PolicyError

SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  dept TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | active
  created REAL NOT NULL,
  decided REAL
);
"""
MAX_PENDING = 100  # the join form is open to anyone who can reach the server: cap what a stray caller can pile up
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,120}\.[^@\s]{2,}$")

_lock = threading.Lock()
_db: sqlite3.Connection | None = None


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
    return {"id": f"M-{r['id']:04d}", "name": r["name"], "email": r["email"], "dept": r["dept"], "status": r["status"], "created": r["created"], "decided": r["decided"]}


def _num(public_id: str) -> int:
    try:
        return int(public_id.removeprefix("M-"))
    except ValueError:
        raise PolicyError("없는 구성원이에요", 404, "not_found") from None


def join(name: str, email: str, dept: str = "") -> dict:
    name, dept, email = " ".join(name.split()), " ".join(dept.split()), email.strip().lower()
    if not 1 <= len(name) <= 20:
        raise PolicyError("이름은 1~20자로 적어 주세요", 422, "invalid_name")
    if not EMAIL.match(email) or len(email) > 120:
        raise PolicyError("메일 주소를 확인해 주세요", 422, "invalid_email")
    if len(dept) > 30:
        raise PolicyError("부서는 30자 이하로 적어 주세요", 422, "invalid_dept")
    with _lock:
        if _db.execute("SELECT COUNT(*) FROM members WHERE status='pending'").fetchone()[0] >= MAX_PENDING:
            raise PolicyError("가입 신청이 너무 많이 쌓였어요. 관리자에게 문의하세요", 429, "too_many_requests")
        if _db.execute("SELECT 1 FROM members WHERE email=?", (email,)).fetchone():
            raise PolicyError("이미 신청했거나 가입된 메일 주소예요", 409, "already_exists")
        cur = _db.execute("INSERT INTO members(name,email,dept,created) VALUES (?,?,?,?)", (name, email, dept, time.time()))
        _db.commit()
        return _row(_db.execute("SELECT * FROM members WHERE id=?", (cur.lastrowid,)).fetchone())


def listing() -> dict:
    with _lock:
        rows = [_row(r) for r in _db.execute("SELECT * FROM members ORDER BY created DESC, id DESC")]
    return {"members": [r for r in rows if r["status"] == "active"], "pending": [r for r in rows if r["status"] == "pending"]}


def count() -> int:
    with _lock:
        return _db.execute("SELECT COUNT(*) FROM members").fetchone()[0]


def _pending(num: int) -> sqlite3.Row:
    r = _db.execute("SELECT * FROM members WHERE id=? AND status='pending'", (num,)).fetchone()
    if not r:
        raise PolicyError("없거나 이미 처리된 신청이에요", 404, "not_found")
    return r


def approve(public_id: str) -> dict:
    num = _num(public_id)
    with _lock:
        r = _pending(num)
        _db.execute("UPDATE members SET status='active', decided=? WHERE id=?", (time.time(), num))
        _db.commit()
        out = _row(_db.execute("SELECT * FROM members WHERE id=?", (num,)).fetchone())
    settings.log_event("가입 승인", f"{r['name']} ({r['email']})")
    return out


def reject(public_id: str) -> dict:
    """A rejected request is removed (the person may apply again); the decision stays in the change log."""
    num = _num(public_id)
    with _lock:
        r = _pending(num)
        _db.execute("DELETE FROM members WHERE id=?", (num,))
        _db.commit()
        out = _row(r)
    settings.log_event("가입 반려", f"{r['name']} ({r['email']})")
    return out


def remove(public_id: str) -> dict:
    num = _num(public_id)
    with _lock:
        r = _db.execute("SELECT * FROM members WHERE id=? AND status='active'", (num,)).fetchone()
        if not r:
            raise PolicyError("없는 구성원이에요", 404, "not_found")
        _db.execute("DELETE FROM members WHERE id=?", (num,))
        _db.commit()
        out = _row(r)
    settings.log_event("구성원 삭제", f"{r['name']} ({r['email']})")
    return out


def clear() -> int:
    with _lock:
        n = _db.execute("SELECT COUNT(*) FROM members").fetchone()[0]
        _db.execute("DELETE FROM members")
        _db.execute("DELETE FROM sqlite_sequence WHERE name='members'")
        _db.commit()
    return n


def backdate(public_id: str, created: float, decided: float | None) -> None:
    """For the presentation seed script only: give a record the time it should have had."""
    with _lock:
        _db.execute("UPDATE members SET created=?, decided=? WHERE id=?", (created, decided, _num(public_id)))
        _db.commit()


def new_member_text(m: dict) -> str:
    console = os.getenv("GATEWAY_CONSOLE_URL", "").strip().rstrip("/")
    link = f"\n승인·반려: {console}/console/members" if console.startswith(("http://", "https://")) else ""
    return f":bust_in_silhouette: 새 가입 신청 {m['id']}\n• 이름: {m['name']}\n• 메일: {m['email']}\n• 부서: {m['dept'] or '—'}{link}"
