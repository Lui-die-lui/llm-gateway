// DEMO ONLY. File inspection (design U4 / U5) has no server behind it yet, so everything below is canned.
// It never attaches anything: the dropped file is held back from the site and a dialog says so, in plain words.
// Size and file type are checked for real (that needs no scanning); the findings for readable files are made up.
// Switch on with storage.local demoFiles=true (popup: 연결 설정 > 파일 검사 데모). Delete this folder when the
// gateway gets a file endpoint and wire the same dialogs to its answer.
(function (root) {
  "use strict";

  const MAX = 25 * 1024 * 1024;

  const CSS = `
.demo{display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:12px;background:rgba(217,119,6,.12);color:#92400E;font-size:12px;font-weight:600}
.frow{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;background:#F7F8FB}
.fhead{display:flex;gap:10px;align-items:center;min-width:0}
.ext{width:34px;height:34px;border-radius:9px;color:#fff;display:grid;place-items:center;font-size:10.5px;font-weight:700;flex:0 0 auto}
.fname{font-size:13.5px;font-weight:600;word-break:break-all}
.fmeta{font-size:11.5px;color:#5F6B7D}
.vd{margin-left:auto;font-size:11px;font-weight:700;border-radius:999px;padding:2px 10px;white-space:nowrap}
.vd.block{background:rgba(220,38,38,.1);color:#B91C1C}.vd.redact,.vd.hold,.vd.ask{background:rgba(217,119,6,.12);color:#B45309}.vd.clean,.vd.pass{background:rgba(16,185,129,.12);color:#047857}
.finds{display:flex;gap:6px;flex-wrap:wrap}
.find{font-size:11.5px;border-radius:999px;padding:1px 10px;background:#fff;border:1px solid #E4E4E7}
.msg{font-size:13px;line-height:1.6;color:#4A5568;margin:0}
.res{font-size:12.5px;font-weight:600;color:#047857}
.frow .opts{align-self:flex-start}
.dlg .foot{position:sticky;bottom:-22px;margin:0 -24px -22px;padding:12px 24px 22px;background:rgba(255,255,255,.97);border-top:1px solid #F1F3F7}
`;

  const cases = [
    { id: "encrypted", cat: "format", title: "암호가 걸린 파일", kind: "block", ext: "XLS", color: "#047857", name: "원가표_2026_대외비.xlsx", meta: "암호 보호 · 412KB", msg: "내용을 열 수 없어서 검사하지 못했어요. 검사 없이 올리지 않아요.", a: "비밀번호 넣고 검사", b: "첨부 안 함", result: "비밀번호는 검사에만 쓰고 저장하지 않아요 · 검사 완료: 조성비 31건" },
    { id: "toolarge", cat: "format", title: "용량이 너무 큼", kind: "block", ext: "PDF", color: "#DC2626", name: "안정성시험_원본스캔.pdf", meta: "312쪽 · 78MB", msg: "25MB를 넘는 파일은 검사할 수 없어요. 필요한 쪽만 저장해서 다시 올려 주세요.", a: "내부 모델로 분석", b: "쪽 나누는 방법 보기", result: "내부 모델(사내 서버)로 보냈어요 · 외부 전송 없음" },
    { id: "hwp", cat: "format", title: "검사하지 못하는 형식 (HWP)", kind: "block", ext: "HWP", color: "#1D4ED8", name: "고객응대_매뉴얼.hwp", meta: "한글 문서 · 2.1MB", msg: "한글(HWP) 파일은 아직 내용을 읽지 못해요. PDF나 DOCX로 저장해서 올리면 바로 검사할 수 있어요.", a: "PDF로 저장하는 법", b: "관리자에게 지원 요청", result: "지원 요청을 보냈어요 · HWP 지원은 다음 버전 후보예요" },
    { id: "zip", cat: "format", title: "압축 파일", kind: "block", ext: "ZIP", color: "#5F6B7D", name: "제출자료_모음.zip", meta: "파일 14개 · 9.8MB", msg: "압축 파일은 안을 하나씩 확인할 수 없어 막았어요. 필요한 파일만 풀어서 올려 주세요.", a: "안에 든 파일 목록 보기", b: "", result: "목록: PDF 6 · XLSX 4 · JPG 4 · 풀어서 올리면 각각 검사돼요" },
    { id: "scan", cat: "content", title: "스캔본이라 글자를 확실히 못 읽음", kind: "ask", ext: "PDF", color: "#DC2626", name: "계약서_서명본_스캔.pdf", meta: "이미지 PDF · 8쪽 · 인식 신뢰도 62%", msg: "글자를 확실히 읽지 못한 곳이 4군데 있어요. 그 부분에 이름이나 번호가 있을 수 있어요.", a: "불확실한 부분까지 가리기", b: "쪽별로 직접 확인", result: "4군데를 검은 박스로 가린 사본을 만들었어요" },
    { id: "apikey", cat: "content", title: "스크린샷 속 API 키", kind: "block", ext: "PNG", color: "#4A5568", name: "터미널_에러.png", meta: "붙여넣은 이미지 · 1.4MB", msg: "이미지 속 글자에서 sk-로 시작하는 키를 찾았어요. 시크릿은 가려도 올리지 않아요.", a: "키 부분 흐린 사본 만들기", b: "첨부 안 함", result: "키 영역을 흐리게 처리한 사본을 만들었어요 · 다시 검사 통과" },
    { id: "filename", cat: "content", title: "파일 이름에 개인정보", kind: "redact", ext: "PDF", color: "#DC2626", name: "홍길동_진단서_20261020.pdf", meta: "파일 이름 · 본문 모두 검사", msg: "파일 이름도 사이트에 그대로 보여요. 이름 부분을 자리표시자로 바꿔 올릴게요 → [사람_1]_진단서_20261020.pdf", a: "이름 바꿔서 올리기", b: "", result: "[사람_1]_진단서_20261020.pdf 로 첨부했어요" },
    { id: "hidden", cat: "content", title: "숨김 시트 · 메모 · 변경 기록", kind: "redact", ext: "DOC", color: "#1D4ED8", name: "제안서_v7.docx", meta: "변경 내용 추적 42건 · 메모 9개", msg: "보이는 본문은 깨끗하지만, 지운 문장 기록과 메모에 공급처 이름이 남아 있어요.", a: "기록·메모 지운 사본", b: "무엇이 남았는지 보기", result: "변경 기록과 메모를 모두 정리한 사본을 만들었어요" },
    { id: "multi", cat: "path", title: "여러 개 중 하나만 문제", kind: "pass", ext: "PDF", color: "#DC2626", name: "파일 4개 첨부", meta: "3개 통과 · 1개 차단(계좌번호)", msg: "통과한 3개는 그대로 첨부할 수 있어요. 문제 있는 1개만 빼거나 가린 사본으로 바꿔 주세요.", a: "3개만 먼저 첨부", b: "1개 가린 사본으로", result: "3개를 첨부했어요 · 남은 1개는 대기 중" },
    { id: "cloud", cat: "path", title: "클라우드 연동으로 첨부", kind: "block", ext: "LNK", color: "#5F6B7D", name: "Google Drive에서 가져오기", meta: "사이트가 서버끼리 가져가는 방식", msg: "이 방식은 파일이 내 컴퓨터를 거치지 않아 확장이 검사할 수 없어요. 회사 정책으로 막혀 있어요.", a: "내 컴퓨터에서 올리기", b: "", result: "파일 선택 창을 열었어요 · 올리면 검사돼요" },
    { id: "redactfail", cat: "fail", title: "가린 사본을 만들다 실패", kind: "hold", ext: "PPT", color: "#B45309", name: "IR_발표자료.pptx", meta: "슬라이드 38장 · 도형 속 글자 많음", msg: "가린 사본을 만드는 중 서식이 깨져 멈췄어요. 원본은 올리지 않았어요.", a: "글자만 뽑아서 붙여넣기", b: "다시 시도", result: "글자만 추출해 가림 처리 후 입력창에 넣었어요" },
    { id: "down", cat: "fail", title: "검사 서버 연결 끊김", kind: "hold", ext: "PDF", color: "#DC2626", name: "주간보고.pdf", meta: "검사 대기 · 게이트웨이 응답 없음", msg: "서버에 연결할 수 없어 첨부를 보류했어요. 파일은 이 화면에 남아 있어요.", a: "다시 시도", b: "", result: "다시 연결됐어요 · 검사 통과 후 첨부했어요" },
  ];
  const TAG = { block: "BLOCK", hold: "HOLD", ask: "ASK USER", redact: "REDACT", pass: "PARTIAL" };

  // U4 sample results for files that really are readable types; the findings are invented.
  const SAMPLES = {
    pdf: { ext: "PDF", color: "#DC2626", verdict: "block", finds: ["계좌번호 1", "고객명 3", "이메일 2"], change: "가린 사본: 계좌번호 칸을 검은 박스로 덮고, 이름·이메일은 [사람_1] 같은 자리표시자로 바꾼 PDF. 원본은 계좌번호 때문에 보낼 수 없어요.", allowOrig: false },
    xlsx: { ext: "XLS", color: "#047857", verdict: "redact", finds: ["조성비 48", "공급처 6", "숨김 시트 1"], change: "가린 사본: 함량 칸을 [조성비_1…48]로 바꾸고, 숨김 시트·메모·작성자 정보를 지운 XLSX.", allowOrig: false },
    docx: { ext: "DOC", color: "#1D4ED8", verdict: "redact", finds: ["이름 4", "변경 기록 42"], change: "가린 사본: 이름을 자리표시자로 바꾸고 변경 기록·메모를 지운 DOCX.", allowOrig: false },
    pptx: { ext: "PPT", color: "#B45309", verdict: "redact", finds: ["고객명 2", "공급처 1"], change: "가린 사본: 이름·공급처를 자리표시자로 바꾼 PPTX.", allowOrig: false },
    txt: { ext: "TXT", color: "#5F6B7D", verdict: "clean", finds: ["찾은 것 없음"], change: "민감정보가 없어 원본 그대로 올려도 돼요.", allowOrig: true },
    csv: { ext: "CSV", color: "#047857", verdict: "redact", finds: ["이메일 12", "전화번호 12"], change: "가린 사본: 이메일·전화번호 칸을 자리표시자로 바꾼 CSV.", allowOrig: false },
    png: { ext: "PNG", color: "#4A5568", verdict: "clean", finds: ["인식된 글자 없음", "위치정보(EXIF) 있음"], change: "민감정보가 없어 원본 그대로 올려도 돼요. 사진의 위치정보는 기본으로 지워요.", allowOrig: true },
    jpg: { ext: "JPG", color: "#4A5568", verdict: "clean", finds: ["인식된 글자 없음", "위치정보(EXIF) 있음"], change: "민감정보가 없어 원본 그대로 올려도 돼요. 사진의 위치정보는 기본으로 지워요.", allowOrig: true },
  };
  SAMPLES.jpeg = SAMPLES.jpg;
  const VERDICT = { block: "원본 차단", redact: "가림 필요", clean: "통과" };
  const OPTS = [["redact", "가린 사본 첨부"], ["internal", "내부 모델로"], ["skip", "첨부 안 함"], ["orig", "원본 첨부"]];

  const extOf = (name) => (String(name).split(".").pop() || "").toLowerCase();
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

  // Decided from the real file: size and type only. Everything else about it is invented below.
  function triage(file) {
    const ext = extOf(file.name);
    if (file.size > MAX) return { kind: "case", id: "toolarge", file };
    if (ext === "hwp" || ext === "hwpx") return { kind: "case", id: "hwp", file };
    if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return { kind: "case", id: "zip", file };
    if (SAMPLES[ext]) return { kind: "sample", sample: SAMPLES[ext], file };
    return { kind: "case", id: "hwp", file, unknown: true };
  }

  function install(ui) {
    const { h, icon } = ui;
    if (!ui.shadow.querySelector("style[data-mock]")) ui.shadow.append(h("style", { "data-mock": "1", text: CSS }));
    const banner = () => h("div", { class: "demo", role: "note", "data-testid": "gw-demo" }, "데모 · 실제 검사가 아니에요. 파일은 사이트에 올라가지 않았어요.");

    // U5 - one edge case
    function showCase(id, file) {
      const c = cases.find((x) => x.id === id);
      return ui.modal(
        (done) => {
          const res = h("div", { class: "res", role: "status", "data-testid": "gw-case-result" });
          const pick = (text) => () => {
            res.textContent = text;
          };
          return h(
            "section",
            { class: "dlg sm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "gw-case-title", "data-testid": "gw-case" },
            banner(),
            h(
              "div",
              { class: "head" },
              h("span", { class: `badge ${c.kind === "block" ? "danger" : "warn"}` }, icon(c.kind === "block" ? "ban" : "shieldAlert", 20)),
              h("div", {}, h("h2", { id: "gw-case-title", text: c.title }), h("span", { class: "mono t3", style: "font-size:10.5px", text: TAG[c.kind] })),
            ),
            h(
              "div",
              { class: "frow" },
              h("div", { class: "fhead" }, h("span", { class: "ext", style: `background:${c.color}`, text: c.ext }), h("div", { style: "min-width:0" }, h("div", { class: "fname", text: file ? file.name : c.name }), h("div", { class: "fmeta", text: file ? fmtSize(file.size) : c.meta }))),
              h("p", { class: "msg", text: c.msg }),
            ),
            res,
            h(
              "div",
              { class: "btns" },
              h("button", { type: "button", class: "btn p", "data-autofocus": "1", text: c.a, onclick: pick(c.result) }),
              c.b ? h("button", { type: "button", class: "btn", text: c.b, onclick: pick("선택했어요 · 안내를 열었어요") }) : null,
              h("button", { type: "button", class: "btn", text: "닫기", onclick: () => done("close") }),
            ),
          );
        },
        { onEscape: "close" },
      );
    }

    // U4 - review window for the files that were dropped
    function showReview(results) {
      return ui.modal(
        (done) => {
          const act = results.map((r) => (r.sample.allowOrig ? "orig" : "redact"));
          const rows = h("div", { class: "items" });
          const commit = h("button", { type: "button", class: "btn p", "data-autofocus": "1", "data-testid": "gw-files-apply" });
          const draw = () => {
            rows.replaceChildren(
              ...results.map((r, i) =>
                h(
                  "div",
                  { class: "frow", "data-testid": "gw-file" },
                  h("div", { class: "fhead" }, h("span", { class: "ext", style: `background:${r.sample.color}`, text: r.sample.ext }), h("div", { style: "min-width:0" }, h("div", { class: "fname", text: r.file.name }), h("div", { class: "fmeta", text: fmtSize(r.file.size) })), h("span", { class: `vd ${r.sample.verdict}`, text: VERDICT[r.sample.verdict] })),
                  h("div", { class: "finds" }, r.sample.finds.map((t) => h("span", { class: "find", text: t }))),
                  h("p", { class: "msg", text: r.sample.change }),
                  h(
                    "div",
                    { class: "opts", role: "group", "aria-label": `${r.file.name} 처리 방법` },
                    OPTS.map(([v, l]) => h("button", { type: "button", "aria-pressed": String(act[i] === v), disabled: v === "orig" && !r.sample.allowOrig, text: l, onclick: () => ((act[i] = v), draw()) })),
                  ),
                ),
              ),
            );
            const n = act.filter((a) => a === "redact").length;
            commit.textContent = `적용하고 첨부 · 가린 사본 ${n}개`;
          };
          draw();
          commit.onclick = () => done({ act: [...act] });
          return h(
            "section",
            { class: "dlg", role: "dialog", "aria-modal": "true", "aria-labelledby": "gw-files-title", "data-testid": "gw-files" },
            banner(),
            h("div", { class: "head" }, h("span", { class: "badge warn" }, icon("shieldAlert", 20)), h("div", {}, h("h2", { id: "gw-files-title", text: "첨부 파일 검토" }), h("p", { text: `${results.length}개 파일이 있어요. 파일마다 어떻게 보낼지 골라 주세요.` }))),
            rows,
            h("div", { class: "foot" }, h("span", { class: "hint", text: "실제 서비스에서는 원본 파일이 회사 검사 서버까지만 가고, 사이트에는 가린 사본만 올라가요." }), h("div", { class: "btns" }, commit, h("button", { type: "button", class: "btn", text: "취소", onclick: () => done(null) }))),
          );
        },
        { onEscape: null },
      );
    }

    // Entry point for dropped / picked files.
    async function inspect(files) {
      const results = files.map(triage);
      const readable = results.filter((r) => r.kind === "sample");
      for (const r of results.filter((x) => x.kind === "case")) await showCase(r.id, r.file);
      if (!readable.length) return;
      const out = await showReview(readable);
      if (out) {
        const n = out.act.filter((a) => a === "redact").length;
        ui.toast(`데모: 가린 사본 ${n}개를 만든 것처럼 보여드렸어요. 실제로 첨부되지 않았어요.`, 4200);
      }
    }
    return { inspect, showCase, showReview, cases };
  }

  const api = { install, cases, triage, MAX };
  root.GwMockFiles = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : this);
