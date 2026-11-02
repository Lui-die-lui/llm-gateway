// DEMO ONLY. Extension sign-up / login screens (design P1) with no account system behind them yet.
// Nothing is sent anywhere or stored: the state lives in this page and is gone on reload, and signing in here does
// not switch protection on or off (the popup toggle and the gateway decide that). Replace with real calls later.
(() => {
  "use strict";
  const $view = document.getElementById("view");
  const $badge = document.getElementById("badge");
  const COMPANY = "한빛코스메틱";
  const CODE = "HANBIT-7Q2K";
  const state = { v: "start", err: "", admin: false, codeOk: true, perm: false, copied: false };

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  let render;
  const to = (v, extra) => () => (Object.assign(state, { v, err: "" }, extra || {}), render());
  const brand = () => h("div", { class: "brand" }, h("span", { class: "logo", "aria-hidden": "true" }, svg()), "Gateway");
  function svg() {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("width", "20"); s.setAttribute("height", "20"); s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "#fff"); s.setAttribute("stroke-width", "2.2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6zM9 12l2 2 4-4");
    s.append(p);
    return s;
  }
  const back = () => h("button", { type: "button", class: "link", text: "← 처음으로", onclick: to("start") });
  const field = (id, label, o = {}) => h("label", { class: "field", for: id }, label, h("input", { id, type: o.type || "text", autocomplete: o.ac || "off", placeholder: o.ph || "", required: true, value: o.value || "", "aria-describedby": o.hint ? `${id}-h` : null }), o.hint ? h("small", { id: `${id}-h`, text: o.hint }) : null);
  const val = (id) => document.getElementById(id).value.trim();
  const choice = (mark, t, s, fn, testid) => h("button", { type: "button", class: "choice", onclick: fn, "data-testid": testid }, h("span", { class: "ic", "aria-hidden": "true", text: mark }), h("span", {}, h("b", { text: t }), h("span", { text: s })));

  const screens = {
    start: () => [
      brand(),
      h("div", {}, h("h1", { text: "회사 계정으로 시작해요" }), h("p", { class: "t2 sm", text: "회사마다 따로 관리돼요. 같은 회사 사람만 같은 정책과 기록을 써요." })),
      h("button", { type: "button", class: "btn p", text: "로그인", onclick: to("login"), "data-testid": "go-login" }),
      h("div", { class: "t3 sm", text: "처음이에요" }),
      choice("#", "회사 코드로 가입", "관리자에게 받은 코드가 있어요 · 대부분 여기예요", to("emp"), "go-emp"),
      choice("+", "우리 회사 처음 등록 (관리자)", "보안 담당자가 한 번만 해요 · 회사 코드가 만들어져요", to("admin"), "go-admin"),
    ],
    admin: () => [
      back(),
      h("h1", { text: "회사 등록 · 관리자 가입" }),
      h("form", { style: "display:flex;flex-direction:column;gap:14px", onsubmit: (e) => (e.preventDefault(), to("adminDone")()) },
        field("a-co", "회사 이름", { ph: "한빛코스메틱" }),
        h("label", { class: "field", for: "a-ind" }, "업종", h("select", { id: "a-ind" }, ["화장품", "의료", "제조", "금융", "그 밖의 업종 (공통 규칙만)"].map((t) => h("option", { text: t }))), h("small", { text: "업종에 맞는 기본 규칙이 켜져요. 나중에 바꿀 수 있어요." })),
        field("a-nm", "관리자 이름"),
        field("a-em", "회사 이메일 (로그인 아이디)", { type: "email", ac: "off", hint: "@ 뒤 주소(example.com)가 회사 메일 주소로 등록돼요." }),
        field("a-pw", "비밀번호", { type: "password", ac: "new-password", hint: "10자 이상 · 숫자 포함" }),
        h("label", { class: "chk" }, h("input", { type: "checkbox", required: true }), "프롬프트 원문은 저장하지 않고 탐지 종류·개수만 기록하는 것에 동의해요"),
        h("button", { type: "submit", class: "btn p", text: "회사 만들기", "data-testid": "admin-submit" })),
    ],
    adminDone: () => [
      h("div", { class: "notice ok" }, h("b", { text: `${COMPANY} 이 만들어졌어요` })),
      h("div", {}, h("div", { class: "t3 sm", text: "회사 코드 · 직원에게 알려 주세요" }), h("div", { class: "code", "data-testid": "company-code", text: CODE })),
      h("button", { type: "button", class: "btn", text: state.copied ? "복사됨" : "복사", onclick: () => ((state.copied = true), navigator.clipboard?.writeText(CODE)?.catch(() => {}), render()) }),
      h("p", { class: "t2 sm", text: "코드만으로는 들어올 수 없어요. 직원이 가입하면 관리자 콘솔에 요청이 쌓이고, 관리자가 승인해야 사용할 수 있어요." }),
      h("div", { class: "notice ok" }, "이 브라우저도 관리자 계정으로 보호가 켜졌어요"),
      h("div", { class: "row" }, h("a", { class: "btn p", href: "http://localhost:3000/login", target: "_blank", rel: "noopener", text: "관리자 콘솔 열기" })),
    ],
    emp: () => [
      back(),
      h("h1", { text: "회사 코드로 가입" }),
      h("form", { style: "display:flex;flex-direction:column;gap:14px", onsubmit: (e) => (e.preventDefault(), to("pending")()) },
        h("label", { class: "field", for: "e-code" }, "회사 코드", h("input", { id: "e-code", value: state.codeOk ? CODE : "WRONG-0000", "aria-invalid": String(!state.codeOk), "aria-describedby": "e-code-h", required: true, autocomplete: "off" }),
          h("small", { id: "e-code-h", role: "status", text: state.codeOk ? `✓ ${COMPANY} · 회사 메일 @example.com` : "없는 회사 코드예요. 대소문자와 - 까지 그대로 넣어 주세요." })),
        h("button", { type: "button", class: "link", text: state.codeOk ? "코드가 틀렸을 때 보기" : "맞는 코드로 되돌리기", onclick: () => ((state.codeOk = !state.codeOk), render()) }),
        field("e-nm", "이름"),
        field("e-dp", "부서", { hint: "관리자가 승인할 때 확인용으로 써요." }),
        field("e-em", "회사 이메일", { type: "email" }),
        field("e-pw", "비밀번호", { type: "password", ac: "new-password" }),
        h("button", { type: "submit", class: "btn p", text: "가입 요청 보내기", disabled: !state.codeOk, "data-testid": "emp-submit" })),
    ],
    pending: () => [
      h("h1", { text: "관리자 승인을 기다리고 있어요" }),
      h("p", { class: "t2 sm", text: `${COMPANY} 관리자에게 가입 요청을 보냈어요. 승인되면 이 탭과 메일로 알려 드려요. 그전에는 보호가 꺼져 있어서, 회사 정보를 AI에 보내지 않는 게 좋아요.` }),
      h("div", { class: "req" }, h("span", { text: "김민지 · 연구소 · minji.kim@example.com" }), h("span", { class: "pill", text: "대기" })),
      h("div", { class: "t3 sm", text: "시험해 보기" }),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn", text: "(데모) 관리자가 승인함", onclick: to("login", { prefill: "minji.kim@example.com" }), "data-testid": "demo-approve" }), h("button", { type: "button", class: "btn", text: "(데모) 관리자가 거절함", onclick: to("rejected") })),
    ],
    rejected: () => [
      h("h1", { text: "가입 요청이 거절됐어요" }),
      h("div", { class: "notice bad" }, h("b", { text: "관리자 메모" }), "회사 메일이 아닌 주소로 신청했어요. @example.com 메일로 다시 신청해 주세요."),
      h("button", { type: "button", class: "btn p", text: "다시 신청", onclick: to("emp") }),
      back(),
    ],
    login: () => {
      const E = {
        wrong: ["이메일 또는 비밀번호가 맞지 않아요", "5번 틀리면 15분 동안 잠겨요.", "bad"],
        wait: ["아직 관리자 승인 전이에요", "승인되면 메일로 알려 드려요. 오래 걸리면 회사 보안 담당자에게 문의하세요.", "warn"],
      }[state.err];
      return [
        back(),
        h("h1", { text: "로그인" }),
        E ? h("div", { class: `notice ${E[2]}`, role: "alert", "data-testid": "login-err" }, h("b", { text: E[0] }), E[1]) : null,
        h("form", { style: "display:flex;flex-direction:column;gap:14px", onsubmit: (e) => {
          e.preventDefault();
          const m = val("l-em").toLowerCase();
          const pw = document.getElementById("l-pw").value;
          if (m === "wait@example.com") state.err = "wait";
          else if ((m === "minji.kim@example.com" || m === "admin@example.com") && pw === "test1234") return to("ready", { admin: m === "admin@example.com" })();
          else state.err = "wrong";
          state.prefill = m;
          render();
        } },
          field("l-em", "회사 이메일", { type: "email", ac: "username", value: state.prefill || "" }),
          field("l-pw", "비밀번호", { type: "password", ac: "current-password" }),
          h("button", { type: "submit", class: "btn p", text: "로그인", "data-testid": "login-submit" })),
        h("button", { type: "button", class: "link", text: "비밀번호를 잊었어요 → 관리자에게 재설정 요청", onclick: () => alert("데모: 재설정 요청을 보냈다고 가정해요.") }),
        h("p", { class: "t3 sm", text: "시험해 보기 · minji.kim@example.com 또는 admin@example.com / 비밀번호 test1234 · wait@example.com 은 승인 대기" }),
      ];
    },
    ready: () => [
      h("div", { class: "notice ok" }, h("b", { text: `로그인됐어요 · ${state.admin ? "보안관리자" : "김민지"}` })),
      state.perm ? h("div", { class: "notice ok" }, "✓ 사이트 권한을 허용했어요") : h("div", { class: "notice warn" }, h("b", { text: "사이트 권한이 필요해요" }), "chatgpt.com · claude.ai 에서 보내는 글을 읽고 바꿀 권한", h("div", { style: "margin-top:10px" }, h("button", { type: "button", class: "btn", text: "허용", onclick: () => ((state.perm = true), render()), "data-testid": "perm" }))),
      h("div", { class: "notice ok" }, "✓ 검사 서버 연결 · 회사 정책 받음 (화장품 + 공통)"),
      h("p", { class: "t2 sm", text: "이제 평소처럼 쓰면 돼요. 의심되는 단어가 있을 때만 보내기 전에 검토 창이 떠요." }),
      h("div", { class: "row" }, h("a", { class: "btn p", href: "https://chatgpt.com", target: "_blank", rel: "noopener", text: "ChatGPT 열기" }), state.admin ? h("a", { class: "btn", href: "http://localhost:3000/login", target: "_blank", rel: "noopener", text: "관리자 콘솔 ↗" }) : null),
    ],
  };
  const JUMPS = [["start", "처음"], ["admin", "관리자 가입"], ["adminDone", "회사 코드"], ["emp", "직원 가입"], ["pending", "승인 대기"], ["rejected", "거절됨"], ["login", "로그인"], ["ready", "로그인 후"]];

  render = function () {
    const on = state.v === "ready" || state.v === "adminDone";
    $badge.textContent = on ? "보호 켜짐 (데모 표시)" : "로그인 전 · 보호 꺼짐";
    $badge.parentElement.classList.toggle("on", on);
    $view.replaceChildren(...screens[state.v](), h("nav", { class: "steps", "aria-label": "화면 바로가기" }, JUMPS.map(([v, l]) => h("button", { type: "button", "aria-current": String(state.v === v), text: l, onclick: to(v, v === "ready" ? { admin: false } : null) }))));
    const first = $view.querySelector("h1, .notice");
    first?.setAttribute("tabindex", "-1");
    first?.focus({ preventScroll: true });
  };
  render();
})();
