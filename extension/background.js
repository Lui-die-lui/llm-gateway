// Content scripts are bound by the page's CORS rules, so every gateway call goes through here.
// The vault id (the key to the original values) lives only in this worker's session storage, per tab:
// it survives page reloads but is never handed to the web page.
// The gateway address is a popup setting (storage.local.gatewayUrl); the popup asks Chrome for permission to that origin.
const DEFAULT_GATEWAY = "http://localhost:8000";
const DEFAULTS = { enabled: true, industries: [], hint: true };

async function gatewayUrl() {
  const { gatewayUrl: url } = await chrome.storage.local.get({ gatewayUrl: DEFAULT_GATEWAY });
  return String(url).replace(/\/+$/, "");
}

// The access key the company gave out for the extension (popup setting). Only sent to the gateway address, never to the sites.
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
    return { ok: r.ok, status: r.status, data: await r.json() };
  } catch (e) {
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

async function sanitize(text, tabId, site) {
  const settings = await chrome.storage.local.get(DEFAULTS);
  if (!settings.enabled) return { ok: true, passthrough: true };
  let vaultId = (await chrome.storage.session.get(vaultKey(tabId)))[vaultKey(tabId)];
  const body = { text, industries: settings.industries, site, client: CLIENT };
  let res = await call("/v1/sanitize", { ...body, vault_id: vaultId });
  if (res.status === 404 && vaultId) {
    // The gateway forgot this vault (30 min idle or restart): start a new one.
    res = await call("/v1/sanitize", body);
  }
  if (res.ok) {
    res.hint = settings.hint !== false; // content.js appends the placeholder note when something was masked
    const stored = await chrome.storage.session.get(countKey(tabId));
    const total = (stored[countKey(tabId)] || 0) + Object.values(res.data.findings).reduce((a, b) => a + b, 0);
    await chrome.storage.session.set({ [vaultKey(tabId)]: res.data.vault_id, [countKey(tabId)]: total });
    chrome.action.setBadgeText({ tabId, text: total ? String(total) : "" });
  }
  return res;
}

async function restore(text, tabId) {
  const vaultId = (await chrome.storage.session.get(vaultKey(tabId)))[vaultKey(tabId)];
  if (!vaultId) return { ok: false, status: 404, data: {} };
  return call("/v1/restore", { vault_id: vaultId, text });
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
    case "sanitize": return sanitize(msg.text, tabId, site);
    case "restore": return restore(msg.text, tabId);
    case "industries": return call("/v1/industries");
    case "status": return status();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender.tab?.id, siteOf(sender.tab?.url)).then(reply);
  return true; // async reply
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([vaultKey(tabId), countKey(tabId)]);
});
