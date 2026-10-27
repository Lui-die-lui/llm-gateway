// Run (repo root): node --test extension/test/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Gw = require("../lib.js");

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

const ORIGINAL = "😀 고객 홍길동 메일 kim@corp.co.kr 정제수 72.4% 배합";
// Python code point offsets (the emoji counts as one)
const cp = (needle) => {
  const before = ORIGINAL.slice(0, ORIGINAL.indexOf(needle));
  const start = Array.from(before).length;
  return [start, start + Array.from(needle).length];
};
const spans = [
  { start: cp("홍길동")[0], end: cp("홍길동")[1], label: "사람", action: "redact" },
  { start: cp("kim@corp.co.kr")[0], end: cp("kim@corp.co.kr")[1], label: "이메일", action: "redact" },
  { start: cp("정제수 72.4%")[0], end: cp("정제수 72.4%")[1], label: "조성비", action: "redact" },
];
const SANITIZED = "😀 고객 [사람_1] 메일 [이메일_1] [조성비_1] 배합";

test("pairSpans matches placeholders to spans using code point offsets", () => {
  const items = Gw.pairSpans(ORIGINAL, spans, SANITIZED);
  assert.deepEqual(items.map((i) => [i.original, i.placeholder]), [["홍길동", "[사람_1]"], ["kim@corp.co.kr", "[이메일_1]"], ["정제수 72.4%", "[조성비_1]"]]);
});

test("pairSpans gives up when the counts disagree", () => {
  assert.equal(Gw.pairSpans(ORIGINAL, spans, "😀 고객 [사람_1] 메일 x"), null);
});

test("buildOutgoing mixes placeholder, alias and keep", () => {
  const items = Gw.pairSpans(ORIGINAL, spans, SANITIZED);
  const r = Gw.buildOutgoing(ORIGINAL, items, ["ph", "alias", "keep"]);
  assert.equal(r.text, "😀 고객 [사람_1] 메일 customer@example.com 정제수 72.4% 배합");
  assert.equal(r.changed, 2);
  assert.deepEqual(r.aliasMap, { "customer@example.com": "kim@corp.co.kr" });
  assert.equal(Gw.restoreAliases("회신은 customer@example.com 로", r.aliasMap), "회신은 kim@corp.co.kr 로");
});

test("aliases are distinct within a message and 'alias' falls back to the original for unknown labels", () => {
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

test("canKeep refuses secrets and industry labels", () => {
  assert.equal(Gw.canKeep("시크릿", new Set()), false);
  assert.equal(Gw.canKeep("조성비", new Set(["조성비"])), false);
  assert.equal(Gw.canKeep("이름", new Set(["조성비"])), true);
});
