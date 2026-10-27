const DEFAULTS = { enabled: true, industries: [] };
const $ = (id) => document.getElementById(id);

async function init() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $("enabled").checked = settings.enabled;
  $("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));

  const health = await chrome.runtime.sendMessage({ type: "status" });
  const status = $("status");
  status.textContent = health.ok ? "게이트웨이 연결됨" : "게이트웨이에 연결할 수 없음 (localhost:8000)";
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
