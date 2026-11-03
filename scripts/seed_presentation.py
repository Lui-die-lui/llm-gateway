"""Fill the gateway with presentation data: python scripts/seed_presentation.py [options]

Two ways, same data:

  (default)  in-process, on this machine's database files (AUDIT_DB / EXCEPTIONS_DB, default data/*.db).
             Stop the gateway first. Records are spread over the last 7 days so the charts have a shape.
  --api URL  against a running gateway (a deployment included). Everything lands at "now", because the server stamps the time.
             Needs --admin-token when the server has GATEWAY_ADMIN_TOKEN, and --key when it has GATEWAY_API_KEYS.

Nothing is written unless you add --yes. Every value below is fake, and the text of a prompt is never stored: the audit log keeps
what kind of information was found and what the gateway did, exactly as for real traffic (the requests go through the real
pipeline: /v1/sanitize and /v1/exceptions).

  --reset                empty the audit log and the exception requests first (admin only; no undo)
  --client-id b-xxxx...  the browser id the exception requests belong to: use the id of the browser that will present
                         (the popup's "자세히 보기" link ends with ?cid=<id>), so their answers and countdown show up there
  --with-anomaly         also add three blocked secrets within the last minutes, so the console shows a HIGH anomaly right away

Also makes a small company: 6 members and 2 sign-up requests waiting for approval (fake names, example.com addresses). They go
through the real join and approve endpoints; --reset empties them first.
"""
import argparse
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SITES = ["chatgpt.com", "chatgpt.com", "chatgpt.com", "claude.ai"]
CLIENT = "extension/0.7.0"
DEMO_CLIENT_ID = "b-demo0000000000000000000000000001"
KEY = "sk-abcdefghijklmnopqrstuvwx1234"  # fake: shaped like a key, opens nothing

# (text, industries). Fake names, numbers and addresses only.
CLEAN = [
    ("이번 주 회의록을 세 줄로 요약해줘", []),
    ("파이썬에서 리스트를 날짜순으로 정렬하는 방법 알려줘", []),
    ("고객 문의 답변을 더 부드러운 톤으로 바꿔줘", []),
    ("영문 이메일 첫 인사말 예시 다섯 개만", []),
    ("신제품 출시 보도자료 제목 후보 10개", []),
    ("엑셀에서 중복 행을 지우는 가장 빠른 방법", []),
    ("다음 주 워크숍 진행 순서를 표로 만들어줘", []),
]
REDACT = [
    ("고객 김민수님께 보낼 사과 메일 초안 써줘. 연락처는 010-2345-6789", []),
    ("담당자 박지은 대리 메일 jieun.park@example.com 으로 회신 문구 만들어줘", []),
    ("배합표 검토: 정제수 72.4%, 글리세린 5% 비율로 안정성 시험 설계해줘", ["cosmetics"]),
    ("원료 공급사: 코스맥스 에서 납품한 LOT240315A 출하 일정 정리해줘", ["cosmetics"]),
    ("환자번호 20240115 내원 기록 요약해줘", ["medical"]),
    ("서버 db01.fake.internal 접속 장애 원인 정리, 내부 IP 10.1.2.3 확인 필요", ["it_dev"]),
    ("연봉: 5천만원, 성과급 1,200만원 지급 검토 문서 요약", ["hr"]),
    ("사건번호 2024가합12345 손해배상 쟁점 정리해줘", ["legal"]),
    ("컨테이너 MSCU1234567 선적 지연 안내문 작성", ["logistics"]),
    ("신한은행 110-123-456789 계좌로 송금 안내문 써줘", ["finance"]),
    ("주문번호 20240315-0001234 취소 요청 응대 문구", ["ecommerce"]),
    ("3월 라인 수율 92.4%, 불량률 1.8% 보고서 문장 다듬어줘", ["manufacturing"]),
]
BLOCKED = [(f"이 코드의 API 키 {KEY} 가 왜 거절되는지 봐줘", [])]

# (entity, site, scope, reason, decision, ttl, memo, how long ago it was decided in hours)
EXCEPTIONS = [
    ("조성비", "chatgpt.com", "1시간", "해외 OEM 파트너에게 보낼 배합 변경 요청서를 번역해야 합니다 수치가 그대로 필요해요", None, None, "", None),
    ("사람", "chatgpt.com", "24시간", "고객 응대 이메일 번역 업무라 고객 이름이 그대로 필요합니다 확인 부탁드립니다", "approved", "24h", "고객 응대 번역 업무 확인했어요", 2),
    ("이메일", "claude.ai", "1회", "협력사 담당자에게 보낼 메일 주소를 그대로 넣어 초안을 받아야 합니다 한 번만 부탁드려요", "approved", "1x", "한 번만 허용", 1),
    ("계좌번호", "chatgpt.com", "24시간", "거래처 정산 안내문을 작성하는데 계좌번호가 그대로 필요해서 요청드립니다 확인 부탁", "rejected", None, "계좌번호는 가린 채로 작성하고 사본에서 직접 채워 주세요", 5),
    ("조성비", "chatgpt.com", "1시간", "안정성 시험 결과를 영문으로 요약해야 해서 수치를 그대로 보내야 합니다 부탁드려요", "approved", "1h", "시험 요약 건 확인", 30),
]

# (name, mail, department, days ago they joined, or None = still waiting for approval). Fake people, example.com addresses.
MEMBERS = [
    ("김서연", "seoyeon.kim@example.com", "마케팅", 41),
    ("이도윤", "doyoon.lee@example.com", "개발", 38),
    ("박지민", "jimin.park@example.com", "영업", 29),
    ("최하은", "haeun.choi@example.com", "인사", 17),
    ("정우진", "woojin.jung@example.com", "디자인", 9),
    ("한소율", "soyul.han@example.com", "재무", 3),
    ("오준서", "junseo.oh@example.com", "개발", None),
    ("윤지아", "jia.yoon@example.com", "마케팅", None),
]


class Gateway:
    """The same calls either way: in-process (can backdate) or against a running gateway."""

    def __init__(self, api: str | None, admin_token: str | None, key: str | None):
        self.api = api
        self.headers = {}
        if admin_token:
            self.headers["X-Admin-Token"] = admin_token
        if key:
            self.headers["X-Gateway-Key"] = key
        if api:
            import httpx

            self.http = httpx.Client(base_url=api.rstrip("/"), headers=self.headers, timeout=30)
        else:
            from fastapi.testclient import TestClient

            from app import audit, exception_requests  # noqa: F401  (configured by app.main from AUDIT_DB / EXCEPTIONS_DB)
            from app.main import app

            self.http = TestClient(app, headers=self.headers)
            self.audit, self.exc = audit, exception_requests

    def post(self, path, body):
        r = self.http.post(path, json=body)
        return r

    def delete(self, path):
        return self.http.delete(path)

    # --- direct mode only: give the record the time it should have had ---
    def backdate_request(self, ts: float):
        if self.api:
            return
        with self.audit._lock:
            self.audit._db.execute("UPDATE requests SET ts=? WHERE id=(SELECT MAX(id) FROM requests)", (ts,))
            self.audit._db.commit()

    def backdate_member(self, public_id: str, created: float, decided: float | None):
        if self.api:
            return
        from app import members

        members.backdate(public_id, created, decided)

    def backdate_exception(self, public_id: str, created: float, decided: float | None):
        if self.api:
            return
        n = int(public_id.split("-")[1])
        with self.exc._lock:
            self.exc._db.execute("UPDATE exception_requests SET created=?, decided=? WHERE id=?", (created, decided, n))
            self.exc._db.commit()


def plan_events(rng: random.Random, now: float, days: int = 7) -> list[tuple[float, str, list[str], str]]:
    """(time, text, industries, kind). Weekdays busy in office hours, weekends quiet."""
    out = []
    for d in range(days - 1, -1, -1):
        day = time.localtime(now - d * 86400)
        weekend = day.tm_wday >= 5
        n = rng.randint(6, 12) if weekend else rng.randint(34, 56)
        midnight = time.mktime((day.tm_year, day.tm_mon, day.tm_mday, 0, 0, 0, 0, 0, -1))
        for _ in range(n):
            hour = min(23, max(0, int(rng.gauss(14, 3.2))))
            ts = midnight + hour * 3600 + rng.randint(0, 3599)
            if ts > now - 120:
                continue
            roll = rng.random()
            text, inds = rng.choice(CLEAN if roll < 0.55 else REDACT if roll < 0.94 else BLOCKED)
            out.append((ts, text, inds, "clean" if roll < 0.55 else "redact" if roll < 0.94 else "blocked"))
    return sorted(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="really write (without it: only show the plan)")
    ap.add_argument("--reset", action="store_true", help="empty the audit log and exception requests first")
    ap.add_argument("--api", help="URL of a running gateway (default: in-process, on the local database files)")
    ap.add_argument("--admin-token", help="X-Admin-Token (reset and deciding exception requests need it when the server has one)")
    ap.add_argument("--key", help="X-Gateway-Key (when the server has GATEWAY_API_KEYS)")
    ap.add_argument("--client-id", default=DEMO_CLIENT_ID, help="browser id the exception requests belong to")
    ap.add_argument("--with-anomaly", action="store_true", help="add three blocked secrets within the last minutes")
    args = ap.parse_args()

    rng = random.Random(20261103)
    now = time.time()
    events = plan_events(rng, now) if not args.api else [(now, *rng.choice([(t, i, "clean") for t, i in CLEAN] + [(t, i, "redact") for t, i in REDACT])) for _ in range(40)]
    kinds = {k: sum(1 for e in events if e[3] == k) for k in ("clean", "redact", "blocked")}
    print(f"where:        {args.api or 'this machine (in-process)'}")
    print(f"reset first:  {'yes' if args.reset else 'no'}")
    print(f"prompts:      {len(events)} ({kinds['clean']} clean, {kinds['redact']} masked, {kinds['blocked']} blocked) over {'the last 7 days' if not args.api else 'now'}")
    waiting = sum(1 for m in MEMBERS if m[3] is None)
    print(f"members:      {len(MEMBERS) - waiting} members + {waiting} sign-up requests waiting")
    print(f"exceptions:   {len(EXCEPTIONS)} requests (1 waiting, 3 approved, 1 rejected) for browser {args.client_id}")
    print(f"anomaly:      {'3 blocked secrets in the last minutes' if args.with_anomaly else 'none (type a key into a prompt three times to make one live)'}")
    if not args.yes:
        print("\nNothing was written. Add --yes to do it" + ("" if args.api else " (stop the gateway first)") + ".")
        return 0

    gw = Gateway(args.api, args.admin_token, args.key)
    if args.reset:
        for path in ("/v1/audit/events", "/v1/exceptions", "/v1/members"):
            r = gw.delete(path)
            print(f"reset {path}: {r.status_code} {r.text[:80]}")
            if r.status_code >= 400:
                print("reset failed: nothing else was written")
                return 1

    sent = 0
    for ts, text, inds, _kind in events:
        r = gw.post("/v1/sanitize", {"text": text, "industries": inds, "site": rng.choice(SITES), "client": CLIENT, "client_id": f"b-seed{rng.randint(0, 6):029d}"})
        if r.status_code == 401:
            print("401: the server wants --key")
            return 1
        gw.backdate_request(ts)
        sent += 1
    print(f"prompts written: {sent}")

    if args.with_anomaly:
        for i in range(3):
            gw.post("/v1/sanitize", {"text": f"키 {KEY} 로 호출했는데 안 돼요", "site": "chatgpt.com", "client": CLIENT, "client_id": f"b-seed{i:029d}"})
        print("anomaly: 3 blocked secrets written")

    for name, mail, dept, days in MEMBERS:
        r = gw.post("/v1/members/join", {"name": name, "email": mail, "dept": dept})
        if r.status_code >= 400:
            print("member failed:", name, r.status_code, r.text[:100]); return 1
        mid = r.json()["id"]
        if days is not None:
            d = gw.post(f"/v1/members/{mid}/approve", {})
            if d.status_code >= 400:
                print("approve failed:", d.status_code, d.text[:100]); return 1
        gw.backdate_member(mid, now - (days if days is not None else 0) * 86400 - 3600 if days is not None else now - 7200, now - (days or 0) * 86400 if days is not None else None)
        print(f"member {mid}: {name} · {dept} · {'가입 완료' if days is not None else '승인 대기'}")

    for entity, site, scope, reason, decision, ttl, memo, hours_ago in EXCEPTIONS:
        r = gw.post("/v1/exceptions", {"client_id": args.client_id, "requester": "시연 계정", "entity": entity, "site": site, "reason": reason, "scope": scope})
        if r.status_code >= 400:
            print("exception request failed:", r.status_code, r.text[:100]); return 1
        rid = r.json()["id"]
        decided = None
        if decision:
            d = gw.post(f"/v1/exceptions/{rid}/decide", {"decision": decision, "ttl": ttl or "1x", "memo": memo})
            if d.status_code >= 400:
                print("decide failed:", d.status_code, d.text[:100]); return 1
            decided = now - hours_ago * 3600
        gw.backdate_exception(rid, (decided or now) - 1800 if decision else now - 600, decided)
        print(f"exception {rid}: {entity} · {scope} · {decision or 'waiting'}")
    print("\ndone. Open the console: 개요, 기록, 실시간, 분석 리포트 and 예외 요청 now have data.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
