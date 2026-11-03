// Pure helpers shared by the content script, the background worker and the tests (no DOM, no chrome.*).
// Loaded as a classic script (self.Gw) and as a CommonJS module for `node --test extension/test/*.test.js`.
(function (root) {
  "use strict";

  const PLACEHOLDER = /\[[^\[\]\s]+_\d+\]/;
  const PLACEHOLDER_ALL = /\[[^\[\]\s]+_\d+\]/g;
  // "[이메일 1]" / "[이메일-1]": a model that changed the separator of a placeholder.
  const FUZZY_ALL = /\[([^\[\]\s_\d]+)[ \-]+(\d+)\]/g;

  // The gateway's span offsets are Python string indices (code points), so slice Array.from(text), not text.
  const cps = (text) => Array.from(text);

  /**
   * Partly hidden value for the on-device history: "홍*동", "kim@c•••.co.kr", "010-••••-5678", "정•• 7•.•%".
   * The full original is never stored; this is all that is kept.
   */
  function maskValue(value, label) {
    const v = String(value);
    const chars = cps(v);
    if (/^(사람|이름)$/.test(label || "") && !/\s|\d/.test(v)) {
      if (chars.length <= 1) return "•";
      if (chars.length === 2) return chars[0] + "*";
      return chars[0] + "*".repeat(chars.length - 2) + chars[chars.length - 1];
    }
    const at = v.indexOf("@");
    if (at > 0 && /이메일|email/i.test(label || "")) {
      const local = cps(v.slice(0, at));
      const labels = v.slice(at + 1).split(".");
      const head = cps(labels[0] || "");
      const maskedLocal = local.slice(0, 3).join("") + (local.length > 3 ? "•".repeat(local.length - 3) : "");
      const maskedHead = (head[0] || "") + "•".repeat(Math.max(0, head.length - 1));
      return `${maskedLocal}@${[maskedHead, ...labels.slice(1)].join(".")}`;
    }
    if (/전화/.test(label || "")) {
      const parts = v.split(/[-\s]/);
      if (parts.length === 3) return `${parts[0]}-${"•".repeat(parts[1].length)}-${parts[2]}`;
    }
    // Generic: keep the first character of each word, hide the rest.
    return v
      .split(/(\s+)/)
      .map((tok) => {
        if (tok === "" || /^\s+$/.test(tok)) return tok;
        const t = cps(tok);
        return t[0] + t.slice(1).map((c) => (/[\p{L}\p{N}]/u.test(c) ? "•" : c)).join("");
      })
      .join("");
  }

  /**
   * Match each redacted span with the placeholder the gateway put in its place. The k-th placeholder of the
   * sanitized text belongs to the k-th redact span. Returns null when the counts disagree (for example the user
   * typed something that looks like a placeholder), so callers can fall back to "replace everything".
   */
  function pairSpans(original, spans, sanitized) {
    const text = cps(original);
    const redact = [...spans].filter((s) => s.action === "redact").sort((a, b) => a.start - b.start);
    const placeholders = sanitized.match(PLACEHOLDER_ALL) || [];
    if (placeholders.length !== redact.length) return null;
    return redact.map((s, i) => ({
      start: s.start,
      end: s.end,
      label: s.label,
      action: s.action,
      original: text.slice(s.start, s.end).join(""),
      placeholder: placeholders[i],
    }));
  }

  // Registered replacement words. Mock until the gateway has an admin-managed list (see extension/README.md).
  // Distinct per message so the reply can be mapped back.
  const letter = (n) => String.fromCharCode(64 + (((n - 1) % 26) + 1));
  const ALIASES = {
    사람: (n) => `고객${letter(n)}`,
    이름: (n) => `고객${letter(n)}`,
    이메일: (n) => (n === 1 ? "customer@example.com" : `customer${n}@example.com`),
    전화번호: (n) => `010-0000-${String(n - 1).padStart(4, "0")}`,
    조성비: (n) => `원료 ${String.fromCharCode(87 + ((n - 1) % 4))}%`,
    "원료 공급처": (n) => `공급사${letter(n)}`,
    공급처: (n) => `공급사${letter(n)}`,
  };
  const hasAlias = (label) => Object.prototype.hasOwnProperty.call(ALIASES, label);

  /**
   * Build the text that leaves the browser. choices[i] is 'ph' | 'alias' | 'keep' for items[i].
   * Returns { text, parts (for the preview), aliasMap (alias value -> original), changed }.
   */
  function buildOutgoing(original, items, choices) {
    const text = cps(original);
    const used = {};
    const aliasMap = {};
    const parts = [];
    let at = 0;
    let changed = 0;
    items.forEach((it, i) => {
      if (it.start > at) parts.push({ t: text.slice(at, it.start).join("") });
      let piece = it.original;
      let how = "keep";
      const c = choices[i] || "ph";
      if (c === "ph") {
        piece = it.placeholder;
        how = "ph";
        changed++;
      } else if (c === "alias" && hasAlias(it.label)) {
        used[it.label] = (used[it.label] || 0) + 1;
        piece = ALIASES[it.label](used[it.label]);
        aliasMap[piece] = it.original;
        how = "alias";
        changed++;
      }
      parts.push({ t: piece, how });
      at = it.end;
    });
    if (at < text.length) parts.push({ t: text.slice(at).join("") });
    return { text: parts.map((p) => p.t).join(""), parts, aliasMap, changed };
  }

  /** Put originals back for registered replacement words (longest first so "고객AB" never loses to "고객A"). */
  function restoreAliases(text, aliasMap) {
    let out = text;
    for (const key of Object.keys(aliasMap).sort((a, b) => b.length - a.length)) out = out.split(key).join(aliasMap[key]);
    return out;
  }

  /** Put originals back for the placeholders this tab sent ([사람_1] -> 홍길동). Unknown placeholders stay as they are. */
  function restorePlaceholders(text, map) {
    return text.replace(PLACEHOLDER_ALL, (m) => (Object.prototype.hasOwnProperty.call(map, m) ? map[m] : m));
  }

  /**
   * Placeholders the model wrote with other brackets or spacing ("『사람_1』", "「사람 1」", "(사람_1)", a bare "사람_1"), restored only
   * for the ones this tab really sent, so nothing unrelated is ever rewritten.
   */
  function restoreVariants(text, map) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let out = text;
    for (const key of Object.keys(map)) {
      const m = /^\[([^\[\]\s]+)_(\d+)\]$/.exec(key);
      if (!m) continue;
      const core = `${esc(m[1])}\\s*[_＿ \\-]\\s*${m[2]}(?!\\d)`;
      const bracketed = new RegExp(`[\\[『「【〈<(（]\\s*${core}\\s*[\\]』」】〉>)）]`, "g");
      const bare = new RegExp(`(?<![\\p{L}\\p{N}_])${esc(m[1])}[_＿]${m[2]}(?!\\d)`, "gu");
      out = out.replace(bracketed, () => map[key]).replace(bare, () => map[key]);
    }
    return out;
  }

  /** Placeholders a model re-spelled: [{ raw: "[이메일 1]", fixed: "[이메일_1]" }]. */
  function findFuzzy(text) {
    const seen = new Set();
    const out = [];
    for (const m of text.matchAll(FUZZY_ALL)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ raw: m[0], fixed: `[${m[1]}_${m[2]}]` });
    }
    return out;
  }

  // Never offered as "그대로 두기", whatever the company policy says: secrets and national ID numbers.
  const CRITICAL = new Set(["시크릿", "주민번호", "외국인등록번호"]);

  /** Labels the user may send as-is: personal-info labels of the gateway's built-in rules, minus the critical ones.
   *  Anything else (industry or company rules, unknown labels) is a trade secret and cannot be kept. */
  function keepableLabels(builtinGroups) {
    const out = new Set();
    for (const g of builtinGroups || []) {
      if (g.id !== "basic") continue;
      for (const r of g.rules || []) for (const l of r.labels || []) if (!CRITICAL.has(l)) out.add(l);
    }
    return out;
  }
  const canKeep = (label, keepable) => !CRITICAL.has(label) && !!keepable && keepable.has(label);

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /** Where "전체 보기" opens: the dev console on :3000 for a local gateway, otherwise the gateway itself (one-service deployment). */
  function portalBase(gatewayUrl, override) {
    if (override) return String(override).replace(/\/+$/, "");
    try {
      const u = new URL(gatewayUrl);
      if (["localhost", "127.0.0.1"].includes(u.hostname)) return `${u.protocol}//${u.hostname}:3000`;
      return u.origin;
    } catch {
      return "http://localhost:3000";
    }
  }

  /* ---------- exception requests: the person asks, an admin decides in the console, the answer comes back to the page ---------- */
  const ONCE_SECONDS = 86400;
  const TTL_SECONDS = { "1h": 3600, "24h": 86400, "7d": 604800 };
  const TTL_LABEL = { "1x": "1회", "1h": "1시간", "24h": "24시간", "7d": "7일" };

  /** A random id this browser keeps so "my requests" can be found again. It is not a login. */
  function makeClientId(fill = (a) => crypto.getRandomValues(a)) {
    return "b-" + Array.from(fill(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** When an approval ends, in ms since 1970. null when it has no clock: not approved, or "1회" (one use). */
  function approvalEnd(req) {
    const seconds = TTL_SECONDS[req.ttl];
    return req.status === "approved" && !req.revoked && req.decided && seconds ? Math.round((req.decided + seconds) * 1000) : null;
  }

  /** "오늘 17:32", "내일 09:00", "11월 2일 17:32" in the viewer's own time zone. */
  function clock(ms, now = Date.now()) {
    const d = new Date(ms);
    const n = new Date(now);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(n)) / 86400000);
    if (diff === 0) return `오늘 ${hm}`;
    if (diff === 1) return `내일 ${hm}`;
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
  }

  /** "23시간 12분", "12분 05초", "45초": how long is left, counting down. */
  function remaining(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}일 ${h}시간`;
    if (h) return `${h}시간 ${String(m).padStart(2, "0")}분`;
    if (m) return `${m}분 ${String(s % 60).padStart(2, "0")}초`;
    return `${s}초`;
  }

  /**
   * What to tell the person about one request. kind: pending | approved | used | revoked | rejected | expired.
   * `note` is what the admin wrote (shown on its own line), `end` the time an approval stops (ms), null when it has no clock.
   */
  function describeDecision(req, now = Date.now()) {
    const what = req.entity ? `${req.entity} ` : "";
    const note = req.memo || "";
    if (req.status === "pending") return { kind: "pending", text: `${what}요청은 관리자 결정을 기다리고 있어요`, note: "", end: null };
    if (req.status === "rejected") return { kind: "rejected", text: `${what}요청이 반려됐어요`, note, end: null };
    const label = TTL_LABEL[req.ttl] ?? "";
    const end = approvalEnd(req);
    if (req.revoked) return { kind: "revoked", text: `${what}요청의 허용을 관리자가 회수했어요`, note, end: null };
    if (req.used) return { kind: "used", text: `${what}요청의 ${label || "1회"} 허용은 사용을 마쳤어요`, note, end: null };
    if (end === null) {
      // one use, and a day to use it: after that it lapses (same as ONCE_VALID_SECONDS on the gateway)
      const lapses = req.decided ? Math.round((req.decided + ONCE_SECONDS) * 1000) : null;
      if (lapses !== null && lapses <= now) return { kind: "expired", text: `${what}요청은 승인됐지만 쓰지 않아 ${clock(lapses, now)}에 끝났어요`, note, end: lapses };
      return { kind: "approved", text: `${what}요청이 승인됐어요 · ${label || "1회"}만 허용돼요${lapses ? ` (${clock(lapses, now)}까지 안 쓰면 끝)` : ""}`, note, end: null };
    }
    if (end <= now) return { kind: "expired", text: `${what}요청은 승인됐지만 ${clock(end, now)}에 끝났어요`, note, end };
    return { kind: "approved", text: `${what}요청이 승인됐어요 · ${clock(end, now)}까지 (${label})`, note, end };
  }

  /**
   * An approval that is letting something through right now, or null. A timed one ends at its deadline; a one-use one ends when it
   * is used or, unused, a day after it was approved. Used, taken back and over ones are not active.
   */
  function activeGrant(req, now = Date.now()) {
    if (req.status !== "approved" || req.revoked || req.used || !req.decided) return null;
    const timed = approvalEnd(req);
    const end = timed ?? Math.round((req.decided + ONCE_SECONDS) * 1000);
    if (end <= now) return null;
    return { id: req.id, entity: req.entity || "", site: req.site || "", end, once: timed === null, label: TTL_LABEL[req.ttl] ?? "1회", note: req.memo || "", decided: req.decided };
  }

  /** The one approval to show: of all that are running, the one that ends first. */
  function nearestGrant(active, now = Date.now()) {
    const live = (active || []).filter((a) => a.end > now).sort((a, b) => a.end - b.end);
    return live.length ? { ...live[0], others: live.length - 1 } : null;
  }

  /**
   * From the list of my requests: what has not been told yet (`news`), the approvals still running (`active`), and the
   * updated record of what has been told (`told`: id -> status). Pure, so the background worker and the tests share it.
   */
  function exceptionNews(list, announced, now = Date.now()) {
    const told = { ...announced };
    const news = [];
    for (const r of list) {
      const state = r.status + (r.revoked ? ":revoked" : "");
      if (r.status === "pending" || told[r.id] === state) continue;
      told[r.id] = state;
      const d = describeDecision(r, now);
      if (d.kind !== "expired" && d.kind !== "used") news.push({ id: r.id, kind: d.kind, text: d.text, note: d.note }); // over before it was seen: nothing to say
    }
    const active = list.map((r) => activeGrant(r, now)).filter(Boolean);
    const used = list.filter((r) => r.used || r.revoked).map((r) => r.id); // spent one-use approvals: the "1회만 허용돼요" line must go
    return { news, active, used, told };
  }

  const api = { exceptionNews, activeGrant, nearestGrant, makeClientId, approvalEnd, clock, remaining, describeDecision, TTL_LABEL, PLACEHOLDER, PLACEHOLDER_ALL, cps, maskValue, pairSpans, ALIASES, hasAlias, buildOutgoing, restoreAliases, restorePlaceholders, restoreVariants, findFuzzy, CRITICAL, keepableLabels, canKeep, dayKey, portalBase };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Gw = api;
})(typeof self !== "undefined" ? self : this);
