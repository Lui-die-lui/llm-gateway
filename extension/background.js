// Content scripts are bound by the page's CORS rules, so calls to the local gateway go through here.
const GATEWAY = "http://localhost:8000";
const INDUSTRIES = ["cosmetics"]; // TODO(frontend): make this selectable in a popup

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const path = msg.type === "sanitize" ? "/v1/sanitize" : "/v1/restore";
  const body =
    msg.type === "sanitize"
      ? { text: msg.text, vault_id: msg.vaultId, industries: INDUSTRIES }
      : { text: msg.text, vault_id: msg.vaultId };
  fetch(GATEWAY + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (r) => reply({ ok: r.ok, status: r.status, data: await r.json() }))
    .catch((e) => reply({ ok: false, status: 0, data: { error: String(e) } }));
  return true; // keep the channel open for the async reply
});
