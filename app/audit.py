"""Audit log (SQLite). Metadata only: type, count, action, route, time. Never prompt text, never values."""
import os
import sqlite3
import threading
import time
from collections import Counter

from .detector import Match

_lock = threading.Lock()
_db: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  endpoint TEXT NOT NULL,      -- chat | sanitize
  provider TEXT NOT NULL,      -- openai | anthropic | internal | mock | browser
  route TEXT NOT NULL,         -- external | internal | block
  status TEXT NOT NULL,        -- ok | blocked | response_blocked | upstream_error
  industries TEXT NOT NULL,    -- comma separated
  use_case TEXT,
  stream INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS findings (
  request_id INTEGER NOT NULL REFERENCES requests(id),
  direction TEXT NOT NULL,     -- request | response
  label TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(ts);
CREATE INDEX IF NOT EXISTS idx_findings_request ON findings(request_id);
"""


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


def record(
    *,
    endpoint: str,
    status: str,
    route: str,
    provider: str,
    industries: list[str],
    use_case: str | None,
    stream: bool,
    latency_ms: int,
    request_matches: list[Match] = (),
    response_matches: list[Match] = (),
) -> None:
    with _lock:
        cur = _db.execute(
            "INSERT INTO requests(ts,endpoint,provider,route,status,industries,use_case,stream,latency_ms)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (time.time(), endpoint, provider, route, status, ",".join(industries), use_case, int(stream), latency_ms),
        )
        rows = [
            (cur.lastrowid, direction, label, action, n)
            for direction, matches in (("request", request_matches), ("response", response_matches))
            for (label, action), n in Counter((m.label, m.action) for m in matches).items()
        ]
        _db.executemany("INSERT INTO findings VALUES (?,?,?,?,?)", rows)
        _db.commit()


def _q(sql: str, *args) -> list[sqlite3.Row]:
    return _db.execute(sql, args).fetchall()


def summary(since: float = 0.0) -> dict:
    with _lock:
        total = _q("SELECT COUNT(*) c FROM requests WHERE ts>=?", since)[0]["c"]
        by_status = {r["status"]: r["c"] for r in _q("SELECT status, COUNT(*) c FROM requests WHERE ts>=? GROUP BY status", since)}
        by_route = {r["route"]: r["c"] for r in _q("SELECT route, COUNT(*) c FROM requests WHERE ts>=? GROUP BY route", since)}
        by_industry: Counter = Counter()
        for r in _q("SELECT industries, COUNT(*) c FROM requests WHERE ts>=? GROUP BY industries", since):
            for name in r["industries"].split(",") if r["industries"] else ["(none)"]:
                by_industry[name] += r["c"]
        findings = [
            dict(r)
            for r in _q(
                "SELECT f.direction, f.label, f.action, SUM(f.count) count FROM findings f"
                " JOIN requests r ON r.id=f.request_id WHERE r.ts>=?"
                " GROUP BY f.direction, f.label, f.action ORDER BY count DESC",
                since,
            )
        ]
    return {
        "requests": total,
        "by_status": by_status,
        "by_route": by_route,
        "by_industry": dict(by_industry),
        "findings": findings,
        "redacted_items": sum(f["count"] for f in findings if f["direction"] == "request" and f["action"] == "redact"),
        "response_redacted_items": sum(f["count"] for f in findings if f["direction"] == "response" and f["action"] == "redact"),
    }


_BUCKETS = {"hour": "%Y-%m-%dT%H:00:00Z", "day": "%Y-%m-%dT00:00:00Z"}


def timeseries(bucket: str = "hour", since: float = 0.0) -> list[dict]:
    fmt = _BUCKETS[bucket]  # fixed set, safe to inline
    with _lock:
        reqs = _q(
            f"SELECT strftime('{fmt}', ts, 'unixepoch') b, COUNT(*) requests,"
            " SUM(status IN ('blocked','response_blocked')) blocked"
            " FROM requests WHERE ts>=? GROUP BY b ORDER BY b",
            since,
        )
        items = {
            r["b"]: r["n"]
            for r in _q(
                f"SELECT strftime('{fmt}', r.ts, 'unixepoch') b, SUM(f.count) n FROM findings f"
                " JOIN requests r ON r.id=f.request_id WHERE r.ts>=? AND f.action='redact' GROUP BY b",
                since,
            )
        }
    return [
        {"bucket": r["b"], "requests": r["requests"], "blocked": r["blocked"] or 0, "redacted_items": items.get(r["b"], 0)}
        for r in reqs
    ]


def events(limit: int = 50, offset: int = 0, label: str | None = None, status: str | None = None) -> list[dict]:
    where, args = [], []
    if status:
        where.append("status=?")
        args.append(status)
    if label:
        where.append("id IN (SELECT request_id FROM findings WHERE label=?)")
        args.append(label)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with _lock:
        rows = _q(f"SELECT * FROM requests {clause} ORDER BY id DESC LIMIT ? OFFSET ?", *args, min(limit, 500), offset)
        out = []
        for r in rows:
            e = dict(r)
            e["findings"] = [
                dict(f)
                for f in _q("SELECT direction, label, action, count FROM findings WHERE request_id=?", r["id"])
            ]
            out.append(e)
    return out
