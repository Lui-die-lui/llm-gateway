// Stands in for the Chrome extension APIs on the dev page so the REAL background.js and content scripts run unchanged.
// Query: ?industries=cosmetics,medical  &enabled=0  &gateway=http://localhost:8000
(() => {
  const q = new URLSearchParams(location.search);
  const mem = (initial) => {
    const data = { ...initial };
    return {
      async get(keys) {
        if (keys == null) return { ...data };
        if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
        return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? data[k] : d]));
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: data[k], newValue: v };
          data[k] = v;
        }
        listeners.forEach((fn) => fn(changes, this.area));
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete data[k];
      },
    };
  };
  const listeners = [];
  const local = mem({
    enabled: q.get("enabled") !== "0",
    industries: (q.get("industries") || "").split(",").filter(Boolean),
    gatewayUrl: q.get("gateway") || "http://localhost:8000",
  });
  local.area = "local";
  const session = mem({});
  session.area = "session";
  const onMessage = [];

  window.chrome = {
    runtime: {
      id: "dev-extension-id", // real Chrome drops this when the extension is reloaded under a page
      getManifest: () => ({ version: "dev" }),
      onMessage: { addListener: (fn) => onMessage.push(fn) },
      sendMessage(msg) {
        return new Promise((resolve) => {
          const sender = { tab: { id: 1, url: location.href } };
          for (const fn of onMessage) if (fn(msg, sender, resolve)) return;
        });
      },
    },
    storage: { local, session, onChanged: { addListener: (fn) => listeners.push(fn) } },
    action: { setBadgeText: ({ text }) => (window.__badge = text), setBadgeBackgroundColor: () => {} },
    tabs: { onRemoved: { addListener: () => {} } },
  };
})();
