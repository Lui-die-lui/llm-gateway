// Run (repo root): node --test extension/test/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Gw = require("../lib.js");

const ORIGINAL = "😀 고객 홍길동 메일 kim@corp.co.kr 정제수 72.4% 배합";
// Python code point offsets (the emoji counts as one)
const cp = (needle) => {
  const start = Array.from(ORIGINAL.slice(0, ORIGINAL.indexOf(needle))).length;
  return [start, start + Array.from(needle).length];
};
const span = (needle, label) => ({ start: cp(needle)[0], end: cp(needle)[1], label, action: "redact" });
const SPANS = [span("홍길동", "사람"), span("kim@corp.co.kr", "이메일"), span("정제수 72.4%", "조성비")];
const SANITIZED = "😀 고객 [사람_1] 메일 [이메일_1] [조성비_1] 배합";

test("maskValue keeps the 홍*동 shape and never returns the full original", () => {
  assert.equal(Gw.maskValue("홍길동", "사람"), "홍*동");
  assert.equal(Gw.maskValue("김철", "이름"), "김*");
  assert.equal(Gw.maskValue("kim@corp.co.kr", "이메일"), "kim@c•••.co.kr");
  assert.equal(Gw.maskValue("010-1234-5678", "전화번호"), "010-••••-5678");
  assert.equal(Gw.maskValue("정제수 72.4%", "조성비"), "정•• 7•.•%");
  for (const [v, l] of [["홍길동", "사람"], ["kim@corp.co.kr", "이메일"], ["정제수 72.4%", "조성비"], ["프로젝트 블루문", "회사 단어"]]) {
    assert.notEqual(Gw.maskValue(v, l), v);
  }
});

test("pairSpans matches placeholders to spans using code point offsets", () => {
  const items = Gw.pairSpans(ORIGINAL, SPANS, SANITIZED);
  assert.deepEqual(items.map((i) => [i.original, i.placeholder]), [["홍길동", "[사람_1]"], ["kim@corp.co.kr", "[이메일_1]"], ["정제수 72.4%", "[조성비_1]"]]);
});

test("pairSpans ignores block/log spans and gives up when the counts disagree", () => {
  assert.equal(Gw.pairSpans(ORIGINAL, SPANS, "😀 고객 [사람_1] 메일 x"), null);
  const withLog = [...SPANS, { start: 0, end: 1, label: "x", action: "log" }];
  assert.equal(Gw.pairSpans(ORIGINAL, withLog, SANITIZED).length, 3);
});

test("buildOutgoing mixes placeholder, alias and keep and reports the parts", () => {
  const items = Gw.pairSpans(ORIGINAL, SPANS, SANITIZED);
  const r = Gw.buildOutgoing(ORIGINAL, items, ["ph", "alias", "keep"]);
  assert.equal(r.text, "😀 고객 [사람_1] 메일 customer@example.com 정제수 72.4% 배합");
  assert.equal(r.changed, 2);
  assert.deepEqual(r.aliasMap, { "customer@example.com": "kim@corp.co.kr" });
  assert.deepEqual(r.parts.filter((p) => p.how).map((p) => p.how), ["ph", "alias", "keep"]);
  assert.equal(Gw.restoreAliases("회신은 customer@example.com 로", r.aliasMap), "회신은 kim@corp.co.kr 로");
});

test("aliases are distinct within a message; unknown labels fall back to the original", () => {
  const two = [
    { start: 0, end: 3, label: "사람", original: "홍길동", placeholder: "[사람_1]" },
    { start: 4, end: 7, label: "사람", original: "김철수", placeholder: "[사람_2]" },
    { start: 8, end: 10, label: "프로젝트", original: "블루", placeholder: "[프로젝트_1]" },
  ];
  const r = Gw.buildOutgoing("홍길동 김철수 블루", two, ["alias", "alias", "alias"]);
  assert.equal(r.text, "고객A 고객B 블루");
  assert.equal(r.changed, 2);
});

test("findFuzzy only reports re-spelled placeholders", () => {
  assert.deepEqual(Gw.findFuzzy("회신은 [이메일 1] 로, 이름은 [사람_1], 또 [이메일 1]"), [{ raw: "[이메일 1]", fixed: "[이메일_1]" }]);
});

test("keepableLabels / canKeep: personal info only, never critical or industry labels", () => {
  const groups = [
    { id: "basic", rules: [{ labels: ["사람"] }, { labels: ["이메일"] }, { labels: ["주민번호"] }] },
    { id: "secret", rules: [{ labels: ["시크릿"] }] },
  ];
  const keepable = Gw.keepableLabels(groups);
  assert.deepEqual([...keepable].sort(), ["사람", "이메일"]);
  assert.equal(Gw.canKeep("사람", keepable), true);
  assert.equal(Gw.canKeep("주민번호", keepable), false);
  assert.equal(Gw.canKeep("시크릿", keepable), false);
  assert.equal(Gw.canKeep("조성비", keepable), false); // industry label
  assert.equal(Gw.canKeep("사람", new Set()), false); // rules list unavailable: refuse
});

test("portalBase uses the dev console for a local gateway and the gateway origin otherwise", () => {
  assert.equal(Gw.portalBase("http://localhost:8000"), "http://localhost:3000");
  assert.equal(Gw.portalBase("https://gw.example.com/"), "https://gw.example.com");
  assert.equal(Gw.portalBase("https://gw.example.com", "https://console.example.com/"), "https://console.example.com");
});

// ---- exception requests -------------------------------------------------------------
const NOW = new Date(2026, 9, 30, 15, 0, 0).getTime(); // 2026-10-30 15:00 in whatever time zone the test runs in
const req = (over) => ({ id: "REQ-0001", status: "approved", entity: "조성비", ttl: "24h", memo: "", decided: NOW / 1000 - 60, ...over });

test("clock says today / tomorrow / a date, in local time", () => {
  assert.equal(Gw.clock(new Date(2026, 9, 30, 17, 32).getTime(), NOW), "오늘 17:32");
  assert.equal(Gw.clock(new Date(2026, 9, 31, 9, 5).getTime(), NOW), "내일 09:05");
  assert.equal(Gw.clock(new Date(2026, 10, 2, 0, 0).getTime(), NOW), "11월 2일 00:00");
});

test("an approval ends at decided + ttl, and has no clock for one use or for anything not approved", () => {
  assert.equal(Gw.approvalEnd(req({ ttl: "1h" })), (NOW / 1000 - 60 + 3600) * 1000);
  assert.equal(Gw.approvalEnd(req({ ttl: "7d" })), (NOW / 1000 - 60 + 7 * 86400) * 1000);
  assert.equal(Gw.approvalEnd(req({ ttl: "1x" })), null);
  assert.equal(Gw.approvalEnd(req({ status: "rejected", ttl: null })), null);
  assert.equal(Gw.approvalEnd(req({ status: "pending", decided: null })), null);
});

test("describeDecision: approved with a deadline names the time and the length", () => {
  const d = Gw.describeDecision(req({ ttl: "1h" }), NOW);
  assert.equal(d.kind, "approved");
  assert.equal(d.text, `조성비 요청이 승인됐어요 · ${Gw.clock((NOW / 1000 - 60 + 3600) * 1000, NOW)}까지 (1시간)`);
});

test("describeDecision: one use, rejected with the admin's note, pending, and already over", () => {
  assert.equal(Gw.describeDecision(req({ ttl: "1x" }), NOW).text, "조성비 요청이 승인됐어요 · 1회만 허용돼요");
  assert.deepEqual(Gw.describeDecision(req({ status: "rejected", ttl: null, memo: "내부 모델로 먼저 해 보세요" }), NOW), {
    kind: "rejected",
    text: "조성비 요청이 반려됐어요",
    note: "내부 모델로 먼저 해 보세요", // the admin's words come on their own line
    end: null,
  });
  assert.equal(Gw.describeDecision(req({ status: "pending", ttl: null, decided: null }), NOW).kind, "pending");
  assert.equal(Gw.describeDecision(req({ ttl: "1h", decided: NOW / 1000 - 7200 }), NOW).kind, "expired");
  assert.match(Gw.describeDecision(req({ entity: "", ttl: "24h" }), NOW).text, /^요청이 승인됐어요/);
});

test("makeClientId looks like the portal's ids and differs every time", () => {
  const a = Gw.makeClientId((arr) => arr.fill(171));
  assert.equal(a, "b-" + "ab".repeat(16));
  assert.match(Gw.makeClientId(), /^b-[0-9a-f]{32}$/);
  assert.notEqual(Gw.makeClientId(), Gw.makeClientId());
});

test("the admin's note travels with an approval, apart from the sentence", () => {
  const d = Gw.describeDecision(req({ ttl: "1h", memo: "이번 한 번만 허용합니다" }), NOW);
  assert.equal(d.note, "이번 한 번만 허용합니다");
  assert.ok(!d.text.includes("이번 한 번만"));
  assert.equal(d.end, (NOW / 1000 - 60 + 3600) * 1000);
});

test("remaining counts down in the unit that matters", () => {
  const s = 1000;
  assert.equal(Gw.remaining(45 * s), "45초");
  assert.equal(Gw.remaining(12 * 60 * s + 5 * s), "12분 05초");
  assert.equal(Gw.remaining(3600 * s + 9 * 60 * s), "1시간 09분");
  assert.equal(Gw.remaining(23 * 3600 * s + 12 * 60 * s), "23시간 12분");
  assert.equal(Gw.remaining(86400 * s + 5 * 3600 * s), "1일 5시간");
  assert.equal(Gw.remaining(-5 * s), "0초");
});

test("exceptionNews tells each decision once, skips pending and already-over ones, and lists running approvals", () => {
  const list = [
    req({ id: "REQ-0003", status: "pending", ttl: null, decided: null }),
    req({ id: "REQ-0002", ttl: "1h", decided: NOW / 1000 - 7200 }), // over before anyone looked
    req({ id: "REQ-0001", ttl: "24h", memo: "수고하세요" }),
    req({ id: "REQ-0000", status: "rejected", ttl: null, memo: "안 돼요" }),
  ];
  const first = Gw.exceptionNews(list, {}, NOW);
  assert.deepEqual(first.news.map((n) => [n.id, n.kind, n.note]), [["REQ-0001", "approved", "수고하세요"], ["REQ-0000", "rejected", "안 돼요"]]);
  assert.deepEqual(first.active.map((a) => a.id), ["REQ-0001"]);
  assert.equal(first.told["REQ-0002"], "approved"); // remembered, so it is not announced later either
  assert.equal(first.told["REQ-0003"], undefined); // pending: still to come
  const again = Gw.exceptionNews(list, first.told, NOW + 1000);
  assert.deepEqual(again.news, []); // nothing is shown twice
  assert.deepEqual(again.active.map((a) => a.id), ["REQ-0001"]); // but the countdown keeps going
  const decided = Gw.exceptionNews([req({ id: "REQ-0003", ttl: "1x" })], again.told, NOW);
  assert.equal(decided.news[0].id, "REQ-0003"); // the pending one is announced when it gets its answer
});
