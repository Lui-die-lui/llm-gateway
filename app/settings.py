"""Settings an admin changes from the console, kept on the server and followed at once (no restart).

What is here is only what the gateway really reads while it runs: the response check, how long things are kept, the Slack
webhook and the access keys. Everything is bounded, so a typo cannot turn a protection off by accident (a retention of 0 is not
accepted). Secrets are never returned: the webhook is shown as its host name, a key is shown once when made and afterwards only
by its name and last four characters (the server keeps a hash, never the key). Each change is written to a small log.
"""
import hashlib
import os
import secrets
import sqlite3
import threading
import time

from .company_policy import PolicyError

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, what TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, tail TEXT NOT NULL, created REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
"""

# key -> (kind, low, high, label). A number must stay inside [low, high]; a protection can be switched off but never set to "never expires".
SPEC = {
    "response_scan": ("bool", None, None, "답변 검사"),
    "vault_ttl_minutes": ("int", 5, 240, "되돌리기 매핑 보관 시간(분)"),
    "once_valid_hours": ("int", 1, 168, "1회 허용 유효 시간(시간)"),
    "keep_decided_days": ("int", 7, 730, "결정된 예외 요청 보관(일)"),
    "notify_new_exception": ("bool", None, None, "새 예외 요청 Slack 알림"),
    "notify_new_member": ("bool", None, None, "새 가입 신청 Slack 알림"),
}
DEFAULTS = {"response_scan": True, "vault_ttl_minutes": 30, "once_valid_hours": 24, "keep_decided_days": 180, "notify_new_exception": True, "notify_new_member": True}

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


def _log(what: str, detail: str) -> None:
    _db.execute("INSERT INTO settings_log(ts,what,detail) VALUES (?,?,?)", (time.time(), what, detail))
    _db.execute("DELETE FROM settings_log WHERE id NOT IN (SELECT id FROM settings_log ORDER BY id DESC LIMIT 200)")


def _raw(key: str) -> str | None:
    if _db is None:
        return None
    with _lock:
        r = _db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else None


def override(key: str):
    """What the admin set, or None when nothing was set (callers then use their own default)."""
    v = _raw(key)
    if v is None:
        return None
    return v == "1" if SPEC[key][0] == "bool" else int(v)


def values() -> dict:
    out = {}
    for k, d in DEFAULTS.items():
        v = override(k)
        out[k] = d if v is None else v
    env = os.getenv("RESPONSE_SCAN")
    if override("response_scan") is None and env is not None:
        out["response_scan"] = env.lower() != "off"
    return out


def _show(key: str, v) -> str:
    return ("켜짐" if v else "꺼짐") if SPEC[key][0] == "bool" else str(v)


def update(patch: dict) -> dict:
    """Validate everything first, then write. Unknown keys and out-of-range numbers are refused with a reason."""
    clean = {}
    for k, v in patch.items():
        if k not in SPEC:
            raise PolicyError(f"바꿀 수 없는 설정이에요: {k}", 422, "unknown_setting")
        kind, lo, hi, label = SPEC[k]
        if kind == "bool":
            if not isinstance(v, bool):
                raise PolicyError(f"{label}: 켜짐/꺼짐만 가능해요", 422, "invalid_setting")
        else:
            if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
                raise PolicyError(f"{label}: {lo}~{hi} 사이여야 해요", 422, "invalid_setting")
        clean[k] = v
    before = values()
    with _lock:
        for k, v in clean.items():
            if before[k] == v:
                continue
            _db.execute("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, "1" if v is True else "0" if v is False else str(v)))
            _log(SPEC[k][3], f"{_show(k, before[k])} → {_show(k, v)}")
        _db.commit()
    return values()


# ---- Slack webhook: set here, or by the SLACK_WEBHOOK_URL environment variable (the console value wins) ----

def slack_url() -> str:
    return (_raw("slack_url") or os.getenv("SLACK_WEBHOOK_URL", "")).strip()


def slack_source() -> str | None:
    if _raw("slack_url"):
        return "console"
    return "env" if os.getenv("SLACK_WEBHOOK_URL", "").strip() else None


def set_slack(url: str) -> None:
    """Store the address (empty = forget it and fall back to the environment). Never returned by any endpoint."""
    url = url.strip()
    with _lock:
        if url:
            _db.execute("INSERT INTO settings(key,value) VALUES ('slack_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (url,))
        else:
            _db.execute("DELETE FROM settings WHERE key='slack_url'")
        _log("Slack 웹훅", "주소를 저장했어요" if url else "저장한 주소를 지웠어요")
        _db.commit()


# ---- access keys: kept as a hash, shown once ----

def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(name: str) -> tuple[str, dict]:
    name = " ".join(name.split())
    if not 1 <= len(name) <= 40:
        raise PolicyError("키 이름은 1~40자로 적어 주세요", 422, "invalid_name")
    key = "gw_" + secrets.token_urlsafe(24)
    with _lock:
        cur = _db.execute("INSERT INTO api_keys(name,hash,tail,created) VALUES (?,?,?,?)", (name, _hash(key), key[-4:], time.time()))
        _log("접속 키", f"'{name}' 키를 만들었어요")
        _db.commit()
        row = _db.execute("SELECT * FROM api_keys WHERE id=?", (cur.lastrowid,)).fetchone()
    return key, _key_row(row)


def _key_row(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "name": r["name"], "tail": r["tail"], "created": r["created"], "revoked": bool(r["revoked"])}


def list_keys() -> list[dict]:
    with _lock:
        return [_key_row(r) for r in _db.execute("SELECT * FROM api_keys ORDER BY id DESC")]


def revoke_key(key_id: int) -> None:
    with _lock:
        r = _db.execute("SELECT * FROM api_keys WHERE id=? AND revoked=0", (key_id,)).fetchone()
        if not r:
            raise PolicyError("없거나 이미 폐기된 키예요", 404, "not_found")
        _db.execute("UPDATE api_keys SET revoked=1 WHERE id=?", (key_id,))
        _log("접속 키", f"'{r['name']}' 키(…{r['tail']})를 폐기했어요")
        _db.commit()


def active_key_count() -> int:
    if _db is None:
        return 0
    with _lock:
        return _db.execute("SELECT COUNT(*) FROM api_keys WHERE revoked=0").fetchone()[0]


def key_name(supplied: str) -> str | None:
    """The name of the active key that matches, else None."""
    h = _hash(supplied)
    with _lock:
        rows = _db.execute("SELECT name, hash FROM api_keys WHERE revoked=0").fetchall()
    for r in rows:
        if secrets.compare_digest(h, r["hash"]):
            return r["name"]
    return None


def log_event(what: str, detail: str) -> None:
    with _lock:
        _log(what, detail)
        _db.commit()


def recent_log(limit: int = 20) -> list[dict]:
    with _lock:
        return [{"t": r["ts"], "what": r["what"], "detail": r["detail"]} for r in _db.execute("SELECT * FROM settings_log ORDER BY id DESC LIMIT ?", (limit,))]
