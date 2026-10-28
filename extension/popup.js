const DEFAULT_GATEWAY = "http://localhost:8000";
const DEFAULTS = { enabled: true, industries: [], hint: true };
const $ = (id) => document.getElementById(id);

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
  await chrome.storage.local.set({ gatewayUrl: url.origin });
  msg.textContent = "저장했어요";
  location.reload();
}

// Asks the content script in the active tab what it can see, so "it did nothing" can be told apart from "it does not see this page".
async function showPage() {
  const el = $("page");
  const mark = (ok) => (ok ? "✓" : "✗");
  let probe;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    probe = await chrome.tabs.sendMessage(tab.id, { type: "probe" });
  } catch {
    probe = null;
  }
  if (!probe) {
    el.textContent = "이 탭에는 확장이 적용되어 있지 않아요. chatgpt.com 또는 claude.ai 탭에서 열어 주세요. 확장을 새로 로드했다면 그 탭을 새로고침해야 해요.";
    return;
  }
  el.textContent = "";
  for (const line of [
    `${probe.host}`,
    `${mark(probe.composer)} 입력창을 찾았어요`,
    `${mark(probe.send)} 보내기 버튼 (글을 쓰기 전에는 안 보일 수 있어요)`,
    `${mark(probe.reply)} 답변 영역 (답변이 있어야 보여요)`,
    `가로챈 전송 ${probe.intercepted}번 · ${probe.last}`,
  ]) {
    const row = document.createElement("div");
    row.textContent = line;
    el.append(row);
  }
}

async function init() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $("enabled").checked = settings.enabled;
  $("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));
  $("hint").checked = settings.hint;
  $("hint").addEventListener("change", (e) => chrome.storage.local.set({ hint: e.target.checked }));

  const { gatewayUrl } = await chrome.storage.local.get({ gatewayUrl: DEFAULT_GATEWAY });
  $("gw-url").value = gatewayUrl;
  $("gw").addEventListener("submit", saveGateway);

  const health = await chrome.runtime.sendMessage({ type: "status" });
  const status = $("status");
  status.textContent = health.ok ? "게이트웨이 연결됨" : `게이트웨이에 연결할 수 없음 (${gatewayUrl})`;
  status.className = health.ok ? "ok" : "bad";

  showPage();

  const box = $("industries");
  box.textContent = "";
  const list = await chrome.runtime.sendMessage({ type: "industries" });
  if (!list.ok) {
    box.textContent = "목록을 불러오지 못했습니다";
    return;
  }
  for (const { industry } of list.data) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = settings.industries.includes(industry);
    input.addEventListener("change", async () => {
      const current = (await chrome.storage.local.get(DEFAULTS)).industries;
      const next = input.checked ? [...new Set([...current, industry])] : current.filter((n) => n !== industry);
      chrome.storage.local.set({ industries: next });
    });
    label.append(input, industry); // textContent semantics: names from the gateway are never parsed as HTML
    box.append(label);
  }
}

init();
