"""Audit log (SQLite). Metadata only: type, count, action, route, time. Never prompt text, never values."""
import math
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
  latency_ms INTEGER NOT NULL,
  site TEXT,                   -- hostname the client reported (chatgpt.com), if any
  client TEXT                  -- client name/version the client reported (extension 0.3.0), if any
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
        # Databases created before site/client existed.
        have = {r["name"] for r in _db.execute("PRAGMA table_info(requests)")}
        for col in ("site", "client"):
            if col not in have:
                _db.execute(f"ALTER TABLE requests ADD COLUMN {col} TEXT")
        _db.commit()


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
    site: str | None = None,
    client: str | None = None,
    request_matches: list[Match] = (),
    response_matches: list[Match] = (),
) -> None:
    with _lock:
        cur = _db.execute(
            "INSERT INTO requests(ts,endpoint,provider,route,status,industries,use_case,stream,latency_ms,site,client)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                time.time(), endpoint, provider, route, status, ",".join(industries), use_case, int(stream), latency_ms,
                _tag(site), _tag(client),
            ),
        )
        rows = [
            (cur.lastrowid, direction, label, action, n)
            for direction, matches in (("request", request_matches), ("response", response_matches))
            for (label, action), n in Counter((m.label, m.action) for m in matches).items()
        ]
        _db.executemany("INSERT INTO findings VALUES (?,?,?,?,?)", rows)
        _db.commit()


def _tag(value: str | None) -> str | None:
    """Client-reported labels are stored as given but capped, so a caller cannot bloat the log."""
    value = (value or "").strip()[:100]
    return value or None


# A request "had redactions" when it has at least one request-side finding that was masked (not blocked).
_HAS_REDACTION = (
    "EXISTS (SELECT 1 FROM findings f WHERE f.request_id=r.id AND f.direction='request' AND f.action='redact')"
)


def _q(sql: str, *args) -> list[sqlite3.Row]:
    return _db.execute(sql, args).fetchall()


def summary(since: float = 0.0) -> dict:
    with _lock:
        total = _q("SELECT COUNT(*) c FROM requests WHERE ts>=?", since)[0]["c"]
        redacted_requests = _q(f"SELECT COUNT(*) c FROM requests r WHERE r.ts>=? AND {_HAS_REDACTION}", since)[0]["c"]
        # Nearest-rank p95 over every request (blocked ones are fast, so they pull it down; that is the real experience).
        p95 = None
        if total:
            p95 = _q(
                "SELECT latency_ms FROM requests WHERE ts>=? ORDER BY latency_ms LIMIT 1 OFFSET ?",
                since,
                math.ceil(0.95 * total) - 1,
            )[0]["latency_ms"]
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
        "redacted_requests": redacted_requests,
        "latency_p95_ms": p95,
        "by_status": by_status,
        "by_route": by_route,
        "by_industry": dict(by_industry),
        "findings": findings,
        "redacted_items": sum(f["count"] for f in findings if f["direction"] == "request" and f["action"] == "redact"),
        "response_redacted_items": sum(f["count"] for f in findings if f["direction"] == "response" and f["action"] == "redact"),
    }


_BUCKETS = {"minute": "%Y-%m-%dT%H:%M:00", "hour": "%Y-%m-%dT%H:00:00", "day": "%Y-%m-%dT00:00:00"}


def _offset_suffix(tz_offset: int) -> str:
    if tz_offset == 0:
        return "Z"
    sign = "+" if tz_offset > 0 else "-"
    h, m = divmod(abs(tz_offset), 60)
    return f"{sign}{h:02d}:{m:02d}"


def timeseries(bucket: str = "hour", since: float = 0.0, tz_offset: int = 0) -> list[dict]:
    """Buckets are labelled in the caller's clock: `tz_offset` is minutes east of UTC (Seoul = 540), fixed for the whole range."""
    fmt = _BUCKETS[bucket]  # fixed set, safe to inline
    shift = tz_offset * 60
    suffix = _offset_suffix(tz_offset)
    with _lock:
        reqs = _q(
            f"SELECT strftime('{fmt}', r.ts + ?, 'unixepoch') b, COUNT(*) requests,"
            " SUM(r.status IN ('blocked','response_blocked')) blocked,"
            f" SUM({_HAS_REDACTION}) redacted_requests"
            " FROM requests r WHERE r.ts>=? GROUP BY b ORDER BY b",
            shift,
            since,
        )
        items = {
            r["b"]: r["n"]
            for r in _q(
                f"SELECT strftime('{fmt}', r.ts + ?, 'unixepoch') b, SUM(f.count) n FROM findings f"
                " JOIN requests r ON r.id=f.request_id WHERE r.ts>=? AND f.action='redact' GROUP BY b",
                shift,
                since,
            )
        }
    return [
        {
            "bucket": r["b"] + suffix,
            "requests": r["requests"],
            "blocked": r["blocked"] or 0,
            "redacted_requests": r["redacted_requests"] or 0,
            "redacted_items": items.get(r["b"], 0),
        }
        for r in reqs
    ]


def events(
    limit: int = 50,
    offset: int = 0,
    label: str | None = None,
    status: str | None = None,
    since: float | None = None,
    until: float | None = None,
    site: str | None = None,
    client: str | None = None,
) -> tuple[list[dict], int]:
    """-> (one page newest first, total rows matching the filters)."""
    where, args = [], []
    for column, value in (("status", status), ("site", site), ("client", client)):
        if value:
            where.append(f"{column}=?")
            args.append(value)
    if since is not None:
        where.append("ts>=?")
        args.append(since)
    if until is not None:
        where.append("ts<?")
        args.append(until)
    if label:
        where.append("id IN (SELECT request_id FROM findings WHERE label=?)")
        args.append(label)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with _lock:
        total = _q(f"SELECT COUNT(*) c FROM requests {clause}", *args)[0]["c"]
        rows = _q(
            f"SELECT * FROM requests {clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            *args,
            max(0, min(limit, 500)),
            max(0, offset),
        )
        out = []
        for r in rows:
            e = dict(r)
            e["findings"] = [
                dict(f)
                for f in _q("SELECT direction, label, action, count FROM findings WHERE request_id=?", r["id"])
            ]
            out.append(e)
    return out, total
