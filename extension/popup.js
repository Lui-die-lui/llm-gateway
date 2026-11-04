(() => {
"use strict";
const DEFAULT_GATEWAY = "http://localhost:8000";
const DEFAULTS = { enabled: true, industries: [], hint: true, timeFormat: "clock" };
const INDUSTRY_KO = { cosmetics: "화장품", medical: "의료", manufacturing: "제조", finance: "금융", hr: "인사", legal: "법무", it_dev: "IT 개발", ecommerce: "이커머스", logistics: "물류" };
const $ = (id) => document.getElementById(id);

// Asks the content script in the active tab what it can see, so "nothing happened" can be told apart from "the page is not recognised".
async function showPage() {
  const el = $("page");
  let probe = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    probe = await chrome.tabs.sendMessage(tab.id, { type: "probe" });
  } catch {}
  if (!probe) {
    el.textContent = "이 탭에는 확장이 적용되어 있지 않아요. chatgpt.com 또는 claude.ai 탭에서 열어 주세요. 확장을 새로 로드했다면 탭을 새로고침해야 해요.";
    return;
  }
  const kind = { known: "✓ 찾았어요", guess: "△ 표에는 없지만 입력 중인 칸으로 동작해요", none: "✗ 못 찾았어요" };
  const lines = [probe.host, `입력창: ${kind[probe.composer]}`, `보내기 버튼: ${kind[probe.send]} (글을 쓰기 전에는 안 보일 수 있어요)`, `답변 영역: ${probe.reply ? "✓ 찾았어요" : "✗ 아직 없어요 (답변이 있어야 보여요)"}`, `가로챈 전송 ${probe.intercepted}번`];
  if (probe.composer !== "known") lines.push(`입력창 후보: ${probe.boxes.join(" / ") || "없음"}`);
  if (probe.send !== "known") lines.push(`보내기 후보: ${probe.buttons.join(" / ") || "없음"}`);
  el.replaceChildren(...lines.map((t) => Object.assign(document.createElement("div"), { textContent: t })));
}

// Called from the submit click, so Chrome lets us ask for access to the new origin.
async function saveGateway(e) {
  e.preventDefault();
  const msg = $("gw-msg");
  let url;
  try {
    url = new URL($("gw-url").value.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
  } catch {
    msg.textContent = "http:// 또는 https://로 시작하는 주소를 넣어 주세요";
    return;
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol === "http:" && !local) {
    msg.textContent = "내 PC 밖의 서버는 https 주소만 쓸 수 있어요 (프롬프트가 평문으로 나가면 가리는 의미가 없어요)";
    return;
  }
  if (!local && !(await chrome.permissions.request({ origins: [`${url.origin}/*`] }))) {
    msg.textContent = "이 주소로 연결하는 권한을 허용해야 저장돼요";
    return;
  }
  await chrome.storage.local.set({ gatewayUrl: url.origin, gatewayKey: $("gw-key").value.trim() });
  msg.textContent = "저장했어요";
  location.reload();
}

/** One of three states, as designed: connected, gateway unreachable, protection switched off. */
function paintStatus(enabled, ok, gatewayUrl, keyBad = false) {
  const box = $("status");
  const [cls, title, sub] = !enabled
    ? ["off", "보호 꺼짐", "지금 보내는 글은 검사되지 않아요"]
    : !ok
      ? ["down", "게이트웨이에 연결할 수 없음", `전송은 보류돼요 · ${gatewayUrl} 응답 없음`]
      : keyBad
        ? ["down", "접속 키가 없거나 맞지 않아요", "연결은 되지만 전송이 막혀요 · 연결 설정에서 키를 넣어 주세요"]
        : ["ok", "게이트웨이 연결됨", `${gatewayUrl} · 입력창 감시 중`];
  box.className = `status ${cls}`;
  $("status-title").textContent = title;
  $("status-sub").textContent = sub;
}

// Which member this browser belongs to (so the admin's log says who sent what). Self-declared by the company mail; it grants nothing.
async function showMe() {
  const state = $("me-state");
  const r = await chrome.runtime.sendMessage({ type: "memberMe" });
  if (!r?.ok) {
    state.textContent = "서버에 연결되면 내 계정을 연결할 수 있어요";
    $("me-form").hidden = true;
    $("me-unlink").hidden = true;
    return;
  }
  const linked = r.data.linked === true;
  state.textContent = linked ? `${r.data.name} 님${r.data.dept ? ` · ${r.data.dept}` : ""}으로 연결돼 있어요` : "아직 연결 안 됨";
  $("me-form").hidden = linked;
  $("me-unlink").hidden = !linked;
}

async function linkMe(e) {
  e.preventDefault();
  const state = $("me-state");
  const email = $("me-mail").value.trim();
  if (!email) return;
  const r = await chrome.runtime.sendMessage({ type: "memberLink", email });
  if (r?.ok) {
    $("me-mail").value = "";
    return showMe();
  }
  const why = r?.status === 404 ? "승인된 구성원의 회사 메일이 아니에요" : r?.status === 0 ? "서버에 연결하지 못했어요" : "연결하지 못했어요";
  state.textContent = why;
}

async function unlinkMe() {
  await chrome.runtime.sendMessage({ type: "memberUnlink" });
  showMe();
}

// The latest requests and where each one stands, with the time an approval lasts until.
async function showExceptions() {
  const el = $("exceptions");
  const r = await chrome.runtime.sendMessage({ type: "exceptions" });
  if (!r?.ok) return void (el.textContent = "서버에 연결되면 보낸 요청이 보여요");
  if (!r.data.length) return void (el.textContent = "보낸 요청이 없어요");
  const mark = { pending: "대기", approved: "승인", used: "사용 완료", revoked: "회수", rejected: "반려", expired: "만료" };
  let fmt = Gw.timeFormat((await chrome.storage.local.get(DEFAULTS)).timeFormat);
  chrome.storage.onChanged.addListener((c) => c.timeFormat && ((fmt = Gw.timeFormat(c.timeFormat.newValue)), draw()));
  const draw = () => {
    const now = Date.now();
    el.replaceChildren(
      ...r.data.slice(0, 3).map((req) => {
        const d = Gw.describeDecision(req, now);
        const row = document.createElement("div");
        row.className = `ex ${d.kind}`;
        row.append(Object.assign(document.createElement("b"), { textContent: mark[d.kind] }), ` ${d.text}`);
        if (d.kind === "approved" && d.end) row.append(Object.assign(document.createElement("div"), { className: "left", textContent: Gw.remaining(d.end - now, fmt) }));
        if (d.note) row.append(Object.assign(document.createElement("div"), { className: "memo", textContent: `관리자 메모 · ${d.note}` }));
        return row;
      }),
    );
  };
  draw();
  if (r.data.slice(0, 3).some((q) => Gw.approvalEnd(q))) setInterval(draw, 1000); // counts down while the popup is open
}

async function init() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const { gatewayUrl } = await chrome.storage.local.get({ gatewayUrl: DEFAULT_GATEWAY });
  $("ver").textContent = `v${chrome.runtime.getManifest().version}`;

  const tog = $("enabled");
  const setTog = (on) => tog.setAttribute("aria-checked", String(on));
  setTog(settings.enabled);
  $("gw-url").value = gatewayUrl;
  $("gw-key").value = (await chrome.storage.local.get({ gatewayKey: "" })).gatewayKey;
  $("gw").addEventListener("submit", saveGateway);
  $("me-form").addEventListener("submit", linkMe);
  $("me-unlink").addEventListener("click", unlinkMe);
  showMe();
  showPage();
  const fmtNow = Gw.timeFormat(settings.timeFormat);
  for (const r of document.querySelectorAll('input[name="timeFormat"]')) {
    r.checked = r.value === fmtNow;
    r.addEventListener("change", () => {
      settings.timeFormat = r.value;
      chrome.storage.local.set({ timeFormat: r.value });
    });
  }
  $("hint").checked = settings.hint !== false;
  $("hint").addEventListener("change", (e) => chrome.storage.local.set({ hint: e.target.checked }));

  const base = Gw.portalBase(gatewayUrl);
  const { id: cid } = await chrome.runtime.sendMessage({ type: "clientId" });
  $("open-portal").href = `${base}/me?cid=${encodeURIComponent(cid)}`;
  showExceptions();
  $("open-console").href = `${base}/login`;

  let ok = false;
  let keyBad = false;
  const repaint = () => paintStatus(tog.getAttribute("aria-checked") === "true", ok, gatewayUrl, keyBad);
  tog.addEventListener("click", async () => {
    const on = tog.getAttribute("aria-checked") !== "true";
    setTog(on);
    await chrome.storage.local.set({ enabled: on });
    repaint();
  });

  const [health, stats] = await Promise.all([chrome.runtime.sendMessage({ type: "status" }), chrome.runtime.sendMessage({ type: "stats" })]);
  ok = !!health.ok;
  keyBad = ok && !!health.keyRequired && !health.keyOk;
  if (keyBad) document.querySelector(".adv").open = true; // the key field is the thing to fix
  repaint();
  $("n-checked").textContent = stats.checked;
  $("n-redacted").textContent = stats.redacted;
  $("n-blocked").textContent = stats.blocked;

  const box = $("industries");
  box.textContent = "";
  const list = await chrome.runtime.sendMessage({ type: "industries" });
  if (!list.ok) {
    box.textContent = "서버에 연결되면 산업 목록이 보여요";
    if (!ok) document.querySelector(".adv").open = true; // the address is the thing to check when the gateway is down
    return;
  }
  for (const { industry } of list.data) {
    const label = document.createElement("label");
    label.className = "chk";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = settings.industries.includes(industry);
    input.addEventListener("change", async () => {
      const current = (await chrome.storage.local.get(DEFAULTS)).industries;
      const next = input.checked ? [...new Set([...current, industry])] : current.filter((n) => n !== industry);
      chrome.storage.local.set({ industries: next });
    });
    const name = document.createElement("span");
    name.textContent = INDUSTRY_KO[industry] ?? industry; // textContent: names from the gateway are never parsed as HTML
    const code = document.createElement("code");
    code.textContent = industry;
    label.title = industry; // the code name stays available as a tooltip
    label.append(input, name, code);
    box.append(label);
  }
}

init();
})();
