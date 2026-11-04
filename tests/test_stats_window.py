"""Stats over a window [since, until) so the console can compare like with like, and latency kept with its decimals."""
import time

from fastapi.testclient import TestClient

from app import audit
from app.main import app

client = TestClient(app)


def _make(n: int, ago_hours: float) -> None:
    for _ in range(n):
        client.post("/v1/sanitize", json={"text": "010-2345-6789"})
    with audit._lock:
        audit._db.execute("UPDATE requests SET ts=? WHERE id IN (SELECT id FROM requests ORDER BY id DESC LIMIT ?)", (time.time() - ago_hours * 3600, n))
        audit._db.commit()


def test_summary_counts_only_inside_the_window():
    _make(3, 30)  # yesterday, earlier than now - 24 h
    _make(2, 20)  # yesterday, but later in the day
    _make(4, 1)   # today
    now = time.time()
    assert client.get("/v1/stats/summary").json()["requests"] == 9
    assert client.get("/v1/stats/summary", params={"since": now - 48 * 3600, "until": now - 24 * 3600}).json()["requests"] == 3
    assert client.get("/v1/stats/summary", params={"since": now - 48 * 3600, "until": now - 12 * 3600}).json()["requests"] == 5
    assert client.get("/v1/stats/summary", params={"since": now - 3 * 3600}).json()["requests"] == 4  # no `until`: up to now, as before
    w = client.get("/v1/stats/summary", params={"since": now - 48 * 3600, "until": now - 24 * 3600}).json()
    assert w["redacted_requests"] == 3 and sum(f["count"] for f in w["findings"]) == 3  # the other tables follow the same window


def test_latency_keeps_its_decimals_so_a_fast_request_is_not_zero():
    for _ in range(5):
        client.post("/v1/sanitize", json={"text": "hello"})
    vals = [e["latency_ms"] for e in client.get("/v1/audit/events", params={"limit": 10}).json()]
    assert vals and all(isinstance(v, (int, float)) and v >= 0 for v in vals)
    assert any(isinstance(v, float) and 0 < v < 50 for v in vals), vals  # a masking call takes well under a millisecond or a few: not rounded to 0
    p95 = client.get("/v1/stats/summary").json()["latency_p95_ms"]
    assert p95 is not None and p95 > 0
