// Stands in for the extension's background worker on the dev page: same message protocol, same gateway calls.
// Query: ?industries=cosmetics,medical  &enabled=0
(() => {
  const q = new URLSearchParams(location.search);
  const industries = (q.get("industries") || "").split(",").filter(Boolean);
  const enabled = q.get("enabled") !== "0";
  let vaultId = sessionStorage.getItem("dev-vault");
  const post = (path, body) =>
    fetch("http://localhost:8000" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json() }))
      .catch((e) => ({ ok: false, status: 0, data: { error: String(e) } }));

  window.chrome = {
    runtime: {
      onMessage: { addListener() {} }, // the popup probe does not exist on this page
      async sendMessage(msg) {
        if (msg.type === "sanitize") {
          if (!enabled) return { ok: true, passthrough: true };
          const res = await post("/v1/sanitize", { text: msg.text, industries, vault_id: vaultId });
          if (res.ok) {
            sessionStorage.setItem("dev-vault", (vaultId = res.data.vault_id));
            res.hint = q.get("hint") !== "0";
          }
          return res;
        }
        if (msg.type === "restore") {
          return vaultId ? post("/v1/restore", { vault_id: vaultId, text: msg.text }) : { ok: false, status: 404, data: {} };
        }
      },
    },
  };
})();
