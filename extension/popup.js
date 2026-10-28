(() => {
"use strict";
const DEFAULT_GATEWAY = "http://localhost:8000";
const DEFAULTS = { enabled: true, industries: [], portalUrl: "" };
const INDUSTRY_KO = { cosmetics: "화장품", medical: "의료", manufacturing: "제조", finance: "금융", hr: "인사", legal: "법무", it_dev: "IT 개발", ecommerce: "이커머스", logistics: "물류" };
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
  const portal = $("portal-url").value.trim();
  await chrome.storage.local.set({ gatewayUrl: url.origin, portalUrl: portal ? new URL(portal).origin : "" });
  msg.textContent = "저장했어요";
  location.reload();
}

/** One of three states, as designed: connected, gateway unreachable, protection switched off. */
function paintStatus(enabled, ok, gatewayUrl) {
  const box = $("status");
  const [cls, title, sub] = !enabled
    ? ["off", "보호 꺼짐", "지금 보내는 글은 검사되지 않아요"]
    : !ok
      ? ["down", "게이트웨이에 연결할 수 없음", `전송은 보류돼요 · ${gatewayUrl} 응답 없음`]
      : ["ok", "게이트웨이 연결됨", `${gatewayUrl} · 입력창 감시 중`];
  box.className = `status ${cls}`;
  $("status-title").textContent = title;
  $("status-sub").textContent = sub;
}

async function init() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const { gatewayUrl } = await chrome.storage.local.get({ gatewayUrl: DEFAULT_GATEWAY });
  $("ver").textContent = `v${chrome.runtime.getManifest().version}`;

  const tog = $("enabled");
  const setTog = (on) => tog.setAttribute("aria-checked", String(on));
  setTog(settings.enabled);
  $("gw-url").value = gatewayUrl;
  $("portal-url").value = settings.portalUrl || "";
  $("gw").addEventListener("submit", saveGateway);

  const base = Gw.portalBase(gatewayUrl, settings.portalUrl);
  $("open-portal").href = `${base}/me`;
  $("open-console").href = `${base}/login`;

  let ok = false;
  const repaint = () => paintStatus(tog.getAttribute("aria-checked") === "true", ok, gatewayUrl);
  tog.addEventListener("click", async () => {
    const on = tog.getAttribute("aria-checked") !== "true";
    setTog(on);
    await chrome.storage.local.set({ enabled: on });
    repaint();
  });

  const [health, stats] = await Promise.all([chrome.runtime.sendMessage({ type: "status" }), chrome.runtime.sendMessage({ type: "stats" })]);
  ok = !!health.ok;
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
