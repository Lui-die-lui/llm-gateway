// Content scripts are bound by the page's CORS rules, so every gateway call goes through here.
// The vault id (the key to the original values) lives only in this worker's session storage, per tab:
// it survives page reloads but is never handed to the web page.
// The gateway address is a popup setting (storage.local.gatewayUrl); the popup asks Chrome for permission to that origin.
if (typeof importScripts === "function") importScripts("lib.js"); // the dev page loads lib.js with a <script> tag instead

const DEFAULT_GATEWAY = "http://localhost:8000";
const DEFAULTS = { enabled: true, industries: [], hint: true, timeFormat: "clock" };

async function gatewayUrl() {
  const { gatewayUrl: url } = await chrome.storage.local.get({ gatewayUrl: DEFAULT_GATEWAY });
  return String(url).replace(/\/+$/, "");
}

let gatewayDown = false; // last call could not reach the gateway (drives the toolbar badge)

// The access key the company gave out for the extension (popup setting). Only ever sent to the gateway address, never to the sites.
async function keyHeaders() {
  const { gatewayKey } = await chrome.storage.local.get({ gatewayKey: "" });
  return gatewayKey ? { "X-Gateway-Key": gatewayKey } : {};
}

async function call(path, body) {
  try {
    const r = await fetch((await gatewayUrl()) + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(await keyHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const res = { ok: r.ok, status: r.status, data: await r.json() };
    if (gatewayDown) {
      gatewayDown = false;
      paintBadge();
    }
    return res;
  } catch (e) {
    if (!gatewayDown) {
      gatewayDown = true;
      paintBadge();
    }
    return { ok: false, status: 0, data: { error: String(e) } };
  }
}

// Audit labels only (which site, which extension build); the gateway never sees page content beyond the typed text.
const CLIENT = `extension/${chrome.runtime.getManifest().version}`;
const siteOf = (url) => {
  try { return new URL(url).hostname; } catch { return undefined; }
};

const vaultKey = (tabId) => `vault:${tabId}`;
const countKey = (tabId) => `count:${tabId}`;
const aliasKey = (tabId) => `alias:${tabId}`;
const origKey = (tabId) => `orig:${tabId}`;
const ORIG_TTL = 60 * 60 * 1000; // the originals of what this tab sent are kept for an hour (session storage: memory only)

/* ---------- toolbar badge: count when connected, "!" when the gateway is down, "OFF" when switched off ---------- */
async function paintBadge(tabId) {
  const { enabled } = await chrome.storage.local.get(DEFAULTS);
  let text = "";
  let color = "#2563EB";
  if (!enabled) (text = "OFF"), (color = "#B45309");
  else if (gatewayDown) (text = "!"), (color = "#DC2626");
  else if (tabId != null) {
    const n = (await chrome.storage.session.get(countKey(tabId)))[countKey(tabId)] || 0;
    text = n ? String(n) : "";
  }
  chrome.action.setBadgeBackgroundColor({ ...(tabId != null ? { tabId } : {}), color });
  chrome.action.setBadgeText({ ...(tabId != null ? { tabId } : {}), text });
}

/* ---------- today's numbers for the popup (counts only) ---------- */
async function bumpStats(delta) {
  const today = Gw.dayKey();
  const { stats } = await chrome.storage.local.get({ stats: null });
  const cur = stats && stats.day === today ? stats : { day: today, checked: 0, redacted: 0, blocked: 0 };
  for (const [k, v] of Object.entries(delta)) cur[k] = (cur[k] || 0) + v;
  await chrome.storage.local.set({ stats: cur });
}
async function getStats() {
  const { stats } = await chrome.storage.local.get({ stats: null });
  return stats && stats.day === Gw.dayKey() ? stats : { day: Gw.dayKey(), checked: 0, redacted: 0, blocked: 0 };
}

/* ---------- on-device change history: masked values only, 7 days ---------- */
const WEEK = 7 * 24 * 3600 * 1000;
async function addHistory(entry) {
  const { history } = await chrome.storage.local.get({ history: [] });
  const now = Date.now();
  const next = [{ ts: now, ...entry }, ...history].filter((h) => now - h.ts < WEEK).slice(0, 300);
  await chrome.storage.local.set({ history: next });
}

/* ---------- exception requests ---------- */
// One id per browser. It rides along in the portal links (?cid=) so the request form and this extension talk about the same person,
// and it is how "my requests" are found again. It is not a login.
let idPromise;
function clientId() {
  idPromise ??= chrome.storage.local.get({ clientId: "" }).then(async ({ clientId: have }) => {
    if (have) return have;
    const id = Gw.makeClientId();
    await chrome.storage.local.set({ clientId: id });
    return id;
  });
  return idPromise;
}
const mineUrl = async () => `/v1/exceptions/mine?client_id=${encodeURIComponent(await clientId())}`;

// Decisions the person has not been told about yet. Announcing is serialised and remembered in storage, so two open tabs (or a
// reload) never show the same decision twice.
let newsQueue = Promise.resolve();
async function exceptionNewsNow() {
  const res = await call(await mineUrl());
  if (!res.ok) return { ok: false, news: [], active: [] };
  const { exAnnounced } = await chrome.storage.local.get({ exAnnounced: {} });
  const { news, active, used, told } = Gw.exceptionNews(res.data, exAnnounced);
  if (news.length || Object.keys(told).length !== Object.keys(exAnnounced).length) {
    await chrome.storage.local.set({ exAnnounced: Object.fromEntries(Object.entries(told).slice(-100)) });
  }
  return { ok: true, news, active, used };
}
function exceptionNews() {
  const run = newsQueue.then(exceptionNewsNow);
  newsQueue = run.catch(() => {});
  return run;
}

// A chat page that is in front checks for answers every few seconds and shows them as a popup in the page. When none is (the
// person is in another tab or window), the same answers arrive as a system notification instead, so they are never missed.
let lastPagePoll = 0;
const NOTE_TITLE = { approved: "예외 요청이 승인됐어요", rejected: "예외 요청이 반려됐어요", revoked: "예외 승인이 회수됐어요" };
async function notifyInBackground() {
  if (Date.now() - lastPagePoll < 45_000) return; // a visible page will show it
  const r = await exceptionNews();
  for (const n of r.news ?? []) {
    chrome.notifications?.create(`exc-${n.id}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: NOTE_TITLE[n.kind] || "예외 요청 결과",
      message: n.note ? `${n.text}\n관리자 메모: ${n.note}` : n.text,
    });
  }
}
chrome.alarms?.create("exception-answers", { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener((a) => a.name === "exception-answers" && notifyInBackground().catch(() => {}));

async function settings(tabId) {
  const s = await chrome.storage.local.get(DEFAULTS);
  const gw = await gatewayUrl();
  const base = Gw.portalBase(gw);
  const cid = encodeURIComponent(await clientId());
  return { enabled: s.enabled, industries: s.industries, gatewayUrl: gw, portalUrl: `${base}/me?cid=${cid}`, requestUrl: `${base}/me/request?cid=${cid}`, hint: s.hint !== false, timeFormat: Gw.timeFormat(s.timeFormat), tabId };
}

/** An exception request sent from the in-page form: same record the console's request page makes. */
async function requestException(r, site) {
  const body = {
    client_id: await clientId(),
    requester: "",
    entity: String(r.entity || "").slice(0, 100),
    site: String(r.site || site || "").slice(0, 100),
    reason: String(r.reason || "").trim(),
    scope: ["1회", "1시간", "24시간"].includes(r.scope) ? r.scope : "1시간",
  };
  const res = await call("/v1/exceptions", body);
  if (res.status === 401) return { ...res, message: "접속 키가 없거나 맞지 않아요 · 확장 팝업의 연결 설정에서 키를 확인해 주세요" };
  return res;
}

async function analyze(text, site) {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (!s.enabled) return { ok: true, passthrough: true };
  // client_id lets the gateway apply this browser's approved exception requests to the preview too
  return call("/v1/analyze", { text, industries: s.industries, site, client_id: await clientId() });
}

async function sanitize(text, tabId, site) {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (!s.enabled) return { ok: true, passthrough: true };
  let vaultId = (await chrome.storage.session.get(vaultKey(tabId)))[vaultKey(tabId)];
  const body = { text, industries: s.industries, site, client: CLIENT, client_id: await clientId() };
  let res = await call("/v1/sanitize", { ...body, vault_id: vaultId });
  if (res.status === 404 && vaultId) {
    // The gateway forgot this vault (30 min idle or restart): start a new one.
    res = await call("/v1/sanitize", body);
  }
  if (res.ok) {
    const stored = await chrome.storage.session.get(countKey(tabId));
    const total = (stored[countKey(tabId)] || 0) + Object.values(res.data.findings).reduce((a, b) => a + b, 0);
    await chrome.storage.session.set({ [vaultKey(tabId)]: res.data.vault_id, [countKey(tabId)]: total });
    await bumpStats({ checked: 1 });
    paintBadge(tabId);
  } else if (res.status === 403) {
    await bumpStats({ checked: 1, blocked: 1 });
  }
  return res;
}

// Registered replacement words are swapped back here first, then the gateway restores the [유형_n] placeholders.
async function restore(text, tabId) {
  const aliasMap = (await chrome.storage.session.get(aliasKey(tabId)))[aliasKey(tabId)] || {};
  // 1) what this tab remembers (works without the gateway), 2) registered replacement words, 3) the gateway's vault for the rest
  const known = await originals(tabId);
  const local = Gw.restoreVariants(Gw.restorePlaceholders(Gw.restoreAliases(text, aliasMap), known), known);
  if (!Gw.PLACEHOLDER.test(local)) return local !== text ? { ok: true, status: 200, data: { text: local } } : { ok: false, status: 404, data: {} };
  const vaultId = (await chrome.storage.session.get(vaultKey(tabId)))[vaultKey(tabId)];
  if (!vaultId) return local !== text ? { ok: true, status: 200, data: { text: local } } : { ok: false, status: 404, data: {} };
  const res = await call("/v1/restore", { vault_id: vaultId, text: local });
  if (res.status === 404) return local !== text ? { ok: true, status: 200, data: { text: local } } : { ok: false, status: 404, data: {} }; // vault gone
  return res;
}

// What this tab replaced, so the answer can be restored even when the gateway has forgotten the vault (restart, 30 min idle).
// Memory only (chrome.storage.session): never written to disk, gone when the browser closes, never handed to the web page.
async function rememberOriginals(map, tabId) {
  const now = Date.now();
  const cur = (await chrome.storage.session.get(origKey(tabId)))[origKey(tabId)] || {};
  const fresh = Object.fromEntries(Object.entries(cur).filter(([, v]) => now - v.t < ORIG_TTL));
  for (const [ph, original] of Object.entries(map)) fresh[ph] = { o: original, t: now };
  await chrome.storage.session.set({ [origKey(tabId)]: fresh });
  return { ok: true };
}
async function originals(tabId) {
  const now = Date.now();
  const cur = (await chrome.storage.session.get(origKey(tabId)))[origKey(tabId)] || {};
  return Object.fromEntries(Object.entries(cur).filter(([, v]) => now - v.t < ORIG_TTL).map(([ph, v]) => [ph, v.o]));
}

async function rememberAliases(map, tabId) {
  const cur = (await chrome.storage.session.get(aliasKey(tabId)))[aliasKey(tabId)] || {};
  await chrome.storage.session.set({ [aliasKey(tabId)]: { ...cur, ...map } });
  return { ok: true };
}

// Reachable? Does it want a key, and is ours accepted? (/v1/restore with an unknown vault answers 404 once the key is fine.)
async function status() {
  const health = await call("/health");
  if (!health.ok) return health;
  const cfg = await call("/v1/config");
  if (!cfg.ok || !cfg.data.caller_auth) return { ...health, keyRequired: false };
  const probe = await call("/v1/restore", { vault_id: "probe", text: "" });
  return { ...health, keyRequired: true, keyOk: probe.status !== 401 };
}

async function handle(msg, tabId, site) {
  switch (msg.type) {
    case "settings": return settings(tabId);
    case "analyze": return analyze(msg.text, site);
    case "sanitize": return sanitize(msg.text, tabId, site);
    case "restore": return restore(msg.text, tabId);
    case "rememberAliases": return rememberAliases(msg.map || {}, tabId);
    case "rememberOriginals": return rememberOriginals(msg.map || {}, tabId);
    case "industries": return call("/v1/industries");
    case "rules": return call("/v1/rules/builtin");
    case "status": return status();
    case "clientId": return { id: await clientId() };
    case "exceptions": return call(await mineUrl());
    case "requestException": return requestException(msg.request || {}, site);
    case "exceptionNews": lastPagePoll = Date.now(); return exceptionNews();
    case "stats": return getStats();
    case "statsAdd": await bumpStats(msg.delta || {}); return { ok: true };
    case "historyAdd": await addHistory({ site, ...msg.entry }); return { ok: true };
    case "historyClear": await chrome.storage.local.set({ history: [] }); return { ok: true };
    case "setEnabled": await chrome.storage.local.set({ enabled: !!msg.enabled }); return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender.tab?.id, siteOf(sender.tab?.url)).then(reply);
  return true; // async reply
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([vaultKey(tabId), countKey(tabId), aliasKey(tabId), origKey(tabId)]);
});

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.enabled) paintBadge();
});
paintBadge();
