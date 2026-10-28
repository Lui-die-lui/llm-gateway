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
