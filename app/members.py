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
-- Which browsers belong to which member (a person may use several). The browser id is kept here and nowhere is it shown: it also opens that browser's approved exceptions.
CREATE TABLE IF NOT EXISTS member_links (
  client_id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id)
);
"""
# A small company: the broad departments only. Fixed so the join form, the member list and the log filter always agree.
DEPARTMENTS = ["경영지원", "개발", "영업", "마케팅"]
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
    if dept and dept not in DEPARTMENTS:
        raise PolicyError(f"부서는 {', '.join(DEPARTMENTS)} 중에서 골라 주세요", 422, "invalid_dept")
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
        linked = {r["member_id"]: r["n"] for r in _db.execute("SELECT member_id, COUNT(*) n FROM member_links GROUP BY member_id")}
    for r in rows:
        r["browsers"] = linked.get(_num(r["id"]), 0)  # how many browsers are linked; the ids themselves are never listed
    return {"members": [r for r in rows if r["status"] == "active"], "pending": [r for r in rows if r["status"] == "pending"], "departments": DEPARTMENTS}


def link(email: str, client_id: str) -> dict:
    """The person says "this browser is mine" by giving the company mail of an approved member. It is self-declared (nothing proves
    the mail is theirs), so it only attributes what the browser sends to that member in the log; it grants nothing."""
    email = email.strip().lower()
    if not 4 <= len(client_id) <= 64:
        raise PolicyError("브라우저 정보가 올바르지 않아요", 422, "invalid_client")
    with _lock:
        r = _db.execute("SELECT * FROM members WHERE email=? AND status='active'", (email,)).fetchone()
        if not r:
            raise PolicyError("승인된 구성원의 회사 메일이 아니에요", 404, "not_found")
        _db.execute("INSERT INTO member_links(client_id, member_id) VALUES (?,?) ON CONFLICT(client_id) DO UPDATE SET member_id=excluded.member_id", (client_id, r["id"]))
        _db.commit()
    return {"name": r["name"], "dept": r["dept"]}


def me(client_id: str) -> dict:
    with _lock:
        r = _db.execute("SELECT m.* FROM member_links l JOIN members m ON m.id=l.member_id WHERE l.client_id=?", (client_id,)).fetchone()
    return {"linked": True, "name": r["name"], "dept": r["dept"]} if r else {"linked": False}


def unlink(client_id: str) -> None:
    with _lock:
        _db.execute("DELETE FROM member_links WHERE client_id=?", (client_id,))
        _db.commit()


def who(client_ids: list[str]) -> dict[str, dict]:
    """client id -> {id, name, dept} for the browsers that are linked to a member."""
    ids = [c for c in set(client_ids) if c]
    if not ids:
        return {}
    with _lock:
        rows = _db.execute(f"SELECT l.client_id, m.id, m.name, m.dept FROM member_links l JOIN members m ON m.id=l.member_id WHERE l.client_id IN ({','.join('?' * len(ids))})", ids).fetchall()
    return {r["client_id"]: {"id": f"M-{r['id']:04d}", "name": r["name"], "dept": r["dept"]} for r in rows}


def browsers_of(dept: str | None = None, member_id: str | None = None) -> list[str]:
    """The browsers of everyone in a department, or of one member (for the log's filters)."""
    sql, args = "SELECT l.client_id FROM member_links l JOIN members m ON m.id=l.member_id WHERE m.status='active'", []
    if dept:
        sql += " AND m.dept=?"
        args.append(dept)
    if member_id:
        sql += " AND m.id=?"
        args.append(_num(member_id))
    with _lock:
        return [r["client_id"] for r in _db.execute(sql, args)]


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
        _db.execute("DELETE FROM member_links WHERE member_id=?", (num,))
        _db.execute("DELETE FROM members WHERE id=?", (num,))
        _db.commit()
        out = _row(r)
    settings.log_event("구성원 삭제", f"{r['name']} ({r['email']})")
    return out


def clear() -> int:
    with _lock:
        n = _db.execute("SELECT COUNT(*) FROM members").fetchone()[0]
        _db.execute("DELETE FROM member_links")
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
