const DEFAULT_GATEWAY = "http://localhost:8000";
const DEFAULTS = { enabled: true, industries: [] };
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

async function init() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $("enabled").checked = settings.enabled;
  $("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));

  const { gatewayUrl } = await chrome.storage.local.get({ gatewayUrl: DEFAULT_GATEWAY });
  $("gw-url").value = gatewayUrl;
  $("gw").addEventListener("submit", saveGateway);

  const health = await chrome.runtime.sendMessage({ type: "status" });
  const status = $("status");
  status.textContent = health.ok ? "게이트웨이 연결됨" : `게이트웨이에 연결할 수 없음 (${gatewayUrl})`;
  status.className = health.ok ? "ok" : "bad";

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
