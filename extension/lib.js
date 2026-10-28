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

  const api = { PLACEHOLDER, PLACEHOLDER_ALL, cps, maskValue, pairSpans, ALIASES, hasAlias, buildOutgoing, restoreAliases, findFuzzy, CRITICAL, keepableLabels, canKeep, dayKey, portalBase };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Gw = api;
})(typeof self !== "undefined" ? self : this);
