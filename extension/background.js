// Content scripts are bound by the page's CORS rules, so every gateway call goes through here.
// The vault id (the key to the original values) lives only in this worker's session storage, per tab:
// it survives page reloads but is never handed to the web page.
// The gateway address is a popup setting (storage.local.gatewayUrl); the popup asks Chrome for permission to that origin.
if (typeof importScripts === "function") importScripts("lib.js"); // the dev page loads lib.js with a <script> tag instead

const DEFAULT_GATEWAY = "http://localhost:8000";
const DEFAULTS = { enabled: true, industries: [], portalUrl: "", demoFiles: false, hint: true };

async function gatewayUrl() {
  const { gatewayUrl: url } = await chrome.storage.local.get({ gatewayUrl: DEFAULT_GATEWAY });
  return String(url).replace(/\/+$/, "");
}

let gatewayDown = false; // last call could not reach the gateway (drives the toolbar badge)

async function call(path, body) {
  try {
    const r = await fetch((await gatewayUrl()) + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
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

async function settings(tabId) {
  const s = await chrome.storage.local.get(DEFAULTS);
  const gw = await gatewayUrl();
  const base = Gw.portalBase(gw, s.portalUrl);
  return { enabled: s.enabled, industries: s.industries, gatewayUrl: gw, portalUrl: `${base}/me`, requestUrl: `${base}/me/request`, demoFiles: !!s.demoFiles, hint: s.hint !== false, tabId };
}

async function analyze(text) {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (!s.enabled) return { ok: true, passthrough: true };
  return call("/v1/analyze", { text, industries: s.industries });
}

async function sanitize(text, tabId, site) {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (!s.enabled) return { ok: true, passthrough: true };
  let vaultId = (await chrome.storage.session.get(vaultKey(tabId)))[vaultKey(tabId)];
  const body = { text, industries: s.industries, site, client: CLIENT };
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
  const withAliases = Gw.restoreAliases(text, aliasMap);
  const vaultId = (await chrome.storage.session.get(vaultKey(tabId)))[vaultKey(tabId)];
  if (!vaultId) return withAliases !== text ? { ok: true, status: 200, data: { text: withAliases } } : { ok: false, status: 404, data: {} };
  const res = await call("/v1/restore", { vault_id: vaultId, text: withAliases });
  if (res.status === 404) return { ok: false, status: 404, data: { text: withAliases } }; // 30 minutes passed
  return res;
}

async function rememberAliases(map, tabId) {
  const cur = (await chrome.storage.session.get(aliasKey(tabId)))[aliasKey(tabId)] || {};
  await chrome.storage.session.set({ [aliasKey(tabId)]: { ...cur, ...map } });
  return { ok: true };
}

async function handle(msg, tabId, site) {
  switch (msg.type) {
    case "settings": return settings(tabId);
    case "analyze": return analyze(msg.text);
    case "sanitize": return sanitize(msg.text, tabId, site);
    case "restore": return restore(msg.text, tabId);
    case "rememberAliases": return rememberAliases(msg.map || {}, tabId);
    case "industries": return call("/v1/industries");
    case "rules": return call("/v1/rules/builtin");
    case "status": return call("/health");
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
  chrome.storage.session.remove([vaultKey(tabId), countKey(tabId), aliasKey(tabId)]);
});

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.enabled) paintBadge();
});
paintBadge();
