// Runs on chatgpt.com and claude.ai. The selectors depend on each site's current DOM and will need upkeep:
// when a site changes its page, only this table has to be edited.
// Flow on send: analyze (dry run) -> review window if something would be replaced -> sanitize (keeps the vault) -> send.
// Principle: if the text cannot be checked, nothing is sent; text the user typed is never deleted.
(() => {
  "use strict";
  const SITES = {
    "chatgpt.com": {
      composer: ["#prompt-textarea"],
      send: ['button[data-testid="send-button"]'],
      reply: ['[data-message-author-role="assistant"]'],
      mine: ['[data-message-author-role="user"]'], // my own bubbles: shown with the original values again
    },
    "claude.ai": {
      composer: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label="메시지 보내기"]'],
      reply: [".font-claude-message", "[data-is-streaming]"],
      mine: [], // no verified selector for claude.ai yet (see extension/README.md)
    },
  };
  SITES["chat.openai.com"] = SITES["chatgpt.com"];
  const site = SITES[location.hostname] ?? SITES["chatgpt.com"];
  const GUESS_SEND = 'button[type="submit"],button[aria-label*="Send" i],button[aria-label*="보내"]';

  const PLACEHOLDER = Gw.PLACEHOLDER;
  const LONG_TEXT = 4000; // characters; beyond this the live check waits for the send
  let bypass = false; // lets our own re-send through the interceptor
  let busy = false;
  let cfg = { enabled: true, gatewayUrl: "", portalUrl: "", requestUrl: "" };

  const bg = (type, fields) => chrome.runtime.sendMessage({ type, ...fields });
  const find = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  /* ---------- composer access (contenteditable and textarea) ---------- */
  const isEditable = (el) => !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text", "search", ""].includes(el.type)));
  const inOurUi = (el) => !!el && (el.id === "llm-gateway-guard" || !!el.closest?.("#llm-gateway-guard"));
  // Safe mode: the site's composer selector matches nothing on this page (the site changed its layout), so any
  // editable field is treated as the composer and both Enter and the send button are checked.
  const safeMode = () => !find(site.composer);
  function findComposer() {
    const c = find(site.composer);
    if (c) return c;
    const a = document.activeElement;
    return isEditable(a) && !inOurUi(a) ? a : null;
  }
  const readText = (el) => (el.value ?? el.innerText ?? "").trim();
  function writeText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("selectAll");
      document.execCommand("insertText", false, text);
    }
  }
  /** Select code points [start, end) of the trimmed composer text. Best effort for multi-block editors. */
  function selectRange(el, start, end) {
    el.focus();
    const raw = el.value ?? el.innerText ?? "";
    const lead = raw.length - raw.trimStart().length;
    const cps = Gw.cps(raw.trim());
    const a = cps.slice(0, start).join("").length + lead;
    const b = cps.slice(0, end).join("").length + lead;
    if (el.setSelectionRange) return el.setSelectionRange(a, b);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let seen = 0;
    const range = document.createRange();
    let set = false;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.nodeValue.length;
      if (!set && a <= seen + len) (range.setStart(n, Math.max(0, a - seen)), (set = true));
      if (set && b <= seen + len) {
        range.setEnd(n, Math.max(0, b - seen));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      seen += len;
    }
  }

  /* ---------- UI ---------- */
  const ui = GwUI.create({ getAnchor: findComposer });
  const toast = (t) => ui.toast(t);

  /* ---------- state of the last sent message (for the change pill and the reply notes) ---------- */
  let lastSent = null; // { entries, expect, noted, replies }
  let keepableCache = { at: 0, set: new Set() };
  async function getKeepable() {
    if (Date.now() - keepableCache.at < 60_000) return keepableCache.set;
    const r = await bg("rules");
    keepableCache = { at: Date.now(), set: r.ok ? Gw.keepableLabels(r.data.groups) : new Set() };
    return keepableCache.set;
  }

  /** Gateway call that never silently continues: when it cannot be reached the user decides (retry / cancel). */
  async function checked(type, fields) {
    for (;;) {
      const r = await bg(type, fields);
      if (r.status !== 0) return r;
      const a = await ui.connection({ detail: `${cfg.gatewayUrl}/health · 응답 없음` });
      if (a !== "retry") return null;
    }
  }

  function resend() {
    ui.chip(null);
    setTimeout(() => {
      bypass = true;
      const button = find(site.send) || (safeMode() ? document.querySelector(GUESS_SEND) : null);
      if (button) button.click();
      else findComposer()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      bypass = false;
    }, 100);
  }

  const kindOf = (label, keepable) => (keepable.has(label) ? "공통 개인정보" : Gw.CRITICAL.has(label) ? "보안 정보" : "영업기밀");
  const HOW_KO = { ph: "자리표시자", alias: "등록 대체어", keep: "그대로 둠" };

  async function runSend(box, text) {
    cfg = await bg("settings");
    if (!cfg.enabled) return resend(); // switched off in the popup: pass through (the strip tells the user)

    if (text.length > LONG_TEXT) ui.chip({ text: "긴 글을 검사하는 중 · 끝날 때까지 전송이 잠겨요", tone: "info", progress: true });
    const a = await checked("analyze", { text });
    ui.chip(null);
    if (!a) return;
    if (a.passthrough) return resend();
    if (!a.ok) return toast(`검사에 실패해서 전송을 보류했어요 (${a.status})`);

    const spans = a.data.spans;
    const stop = spans.filter((s) => s.action === "block" || s.action === "internal_only");
    if (stop.length || a.data.route === "block") {
      await bg("sanitize", { text }); // records the block in the audit log
      const first = stop.find((s) => s.action === "block") || stop[0];
      const choice = await ui.blocked({ labels: [...new Set(stop.map((s) => s.label))], requestUrl: cfg.requestUrl, canSelect: !!first });
      if (choice === "select" && first) selectRange(box, first.start, first.end);
      else box.focus();
      return;
    }

    const redact = spans.filter((s) => s.action === "redact");
    if (!redact.length) {
      const s = await checked("sanitize", { text }); // nothing to replace: still counted and audited
      if (!s) return;
      if (!s.ok) return toast(`검사에 실패해서 전송을 보류했어요 (${s.status})`);
      return resend();
    }

    const keepable = await getKeepable();
    const preview = Gw.pairSpans(text, spans, a.data.sanitized);
    let choices = null;
    if (preview) {
      const items = preview.map((it) => ({ ...it, meta: `${it.label} · ${kindOf(it.label, keepable)}` }));
      const answer = await ui.review({
        items,
        buildPreview: (ch) => Gw.buildOutgoing(text, items, ch),
        canKeep: (it) => Gw.canKeep(it.label, keepable),
        hasAlias: (it) => Gw.hasAlias(it.label),
        onReport: () => toast("오탐으로 신고했어요 · 이번에는 가리지 않고 보내요"),
      });
      if (!answer) return box.focus(); // "입력창에서 직접 고치기": the text stays as typed
      choices = answer.choices;
    }

    const s = await checked("sanitize", { text });
    if (!s) return;
    if (!s.ok) return toast(s.status === 403 ? "검사 결과가 달라져 전송을 막았어요. 다시 확인해 주세요" : `검사에 실패해서 전송을 보류했어요 (${s.status})`);

    const paired = Gw.pairSpans(text, spans, s.data.text);
    let outText = s.data.text; // fallback: replace everything
    let entries = [];
    let changed = redact.length;
    if (paired && choices && paired.length === choices.length) {
      const out = Gw.buildOutgoing(text, paired, choices);
      outText = out.text;
      changed = out.changed;
      if (Object.keys(out.aliasMap).length) await bg("rememberAliases", { map: out.aliasMap });
      const shown = out.parts.filter((p) => p.how);
      entries = paired.map((it, i) => ({
        masked: Gw.maskValue(it.original, it.label),
        to: shown[i].how === "keep" ? Gw.maskValue(it.original, it.label) : shown[i].t,
        how: shown[i].how,
        meta: `${it.label} · ${HOW_KO[shown[i].how]}`,
        st: shown[i].how === "keep" ? "원문 전송" : "전송됨",
      }));
    } else if (paired) {
      entries = paired.map((it) => ({ masked: Gw.maskValue(it.original, it.label), to: it.placeholder, how: "ph", meta: `${it.label} · 자리표시자`, st: "전송됨" }));
    }

    if (outText !== text) writeText(box, outText);
    if (entries.length) {
      await bg("historyAdd", { entry: { kind: "텍스트", entries } });
      lastSent = { entries, expect: entries.filter((e) => e.how !== "keep").length, noted: false, replies: document.querySelectorAll(site.reply.join(",")).length };
      ui.history(entries, { portalUrl: cfg.portalUrl });
    }
    await bg("statsAdd", { delta: { redacted: changed } });
    resend();
  }

  async function guardedSend(event) {
    if (bypass) return;
    const box = findComposer();
    const text = box && readText(box);
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    try {
      await runSend(box, text);
    } catch (e) {
      toast("검사 중 문제가 생겨서 전송을 보류했어요"); // fail closed
      console.warn("llm-gateway-guard:", e);
    } finally {
      busy = false;
    }
  }

  /* ---------- interceptors ---------- */
  const isComposerTarget = (t) => !!t?.closest && !inOurUi(t) && (!!t.closest(site.composer.join(",")) || (safeMode() && isEditable(t)));
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || !isComposerTarget(e.target)) return;
      // Korean IME fires Enter to commit a syllable; that must not count as send.
      if (e.isComposing || e.keyCode === 229) return ui.strip("ime", { tone: "info", text: "한글 조합 중이에요 · Enter는 글자 확정으로만 처리돼요" }, 2200);
      guardedSend(e);
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (inOurUi(e.target)) return;
      if (e.target.closest?.(site.send.join(",")) || (safeMode() && e.target.closest?.(GUESS_SEND))) guardedSend(e);
    },
    true,
  );

  /* ---------- live check while typing (chip above the composer) ---------- */
  let scanTimer;
  let scanSeq = 0;
  async function liveScan() {
    const box = find(site.composer);
    const text = box ? readText(box) : "";
    const seq = ++scanSeq;
    if (!text) return ui.chip(null);
    cfg = await bg("settings");
    if (!cfg.enabled) return ui.chip(null);
    if (text.length > LONG_TEXT) return ui.chip({ text: "긴 글이에요 · 보낼 때 검사해요", tone: "info" });
    const a = await bg("analyze", { text });
    if (seq !== scanSeq) return;
    if (a.status === 0) return ui.chip({ text: "검사 서버에 연결할 수 없어요 · 보내기는 보류돼요", tone: "danger" });
    if (!a.ok || a.passthrough) return ui.chip(null);
    const spans = a.data.spans;
    const n = spans.filter((s) => s.action === "redact").length;
    if (spans.some((s) => s.action === "block" || s.action === "internal_only") || a.data.route === "block") return ui.chip({ text: "보낼 수 없는 정보가 있어요 · 보내면 막혀요", tone: "danger" });
    if (n) return ui.chip({ text: `보내기 전에 확인할 단어 ${n}개가 있어요`, tone: "warn" });
    ui.chip({ text: "확인할 것 없음 · 보내면 바로 전송돼요", tone: "ok" });
  }
  document.addEventListener(
    "input",
    (e) => {
      if (inOurUi(e.target) || !e.target.closest?.(site.composer.join(","))) return;
      clearTimeout(scanTimer);
      scanTimer = setTimeout(liveScan, 600);
    },
    true,
  );

  /* ---------- protection switched off / safe mode notes ---------- */
  function offStrip(enabled) {
    if (enabled) return ui.strip("off", null);
    ui.strip("off", {
      tone: "off",
      text: "보호가 꺼져 있어요 · 지금 보내는 글은 검사되지 않아요",
      action: { label: "다시 켜기", onClick: async () => (await bg("setEnabled", { enabled: true }), ui.strip("off", { tone: "ok", text: "보호를 다시 켰어요" }, 2500)) },
    });
  }
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.enabled) offStrip(changes.enabled.newValue !== false);
  });
  bg("settings").then((s) => {
    cfg = s;
    offStrip(s.enabled);
    if (s.demoFiles) startFileDemo();
  });

  // DEMO ONLY (mock/files.js): with the flag on, files are held back from the site and a made-up inspection is shown.
  // Without the flag none of this runs and files go to the site as before.
  function startFileDemo() {
    if (!self.GwMockFiles) return;
    const demo = self.GwMockFiles.install(ui);
    const take = (files) => {
      const list = [...files];
      if (list.length) demo.inspect(list);
    };
    const stop = (e) => (e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation());
    document.addEventListener("dragover", (e) => e.dataTransfer?.types?.includes("Files") && e.preventDefault(), true);
    document.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.files?.length) return;
      stop(e);
      take(e.dataTransfer.files);
    }, true);
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "file" || !t.files.length) return;
      stop(e);
      const files = [...t.files];
      t.value = "";
      take(files);
    }, true);
    document.addEventListener("paste", (e) => {
      if (!e.clipboardData?.files?.length) return;
      stop(e);
      take(e.clipboardData.files);
    }, true);
  }
  document.addEventListener(
    "focusin",
    (e) => {
      if (safeMode() && isEditable(e.target) && !inOurUi(e.target))
        ui.strip("safe", { tone: "danger", text: "이 사이트의 입력창을 확실히 찾지 못했어요 · 보내기 전에 꼭 확인 창을 띄울게요" });
      else ui.strip("safe", null);
    },
    true,
  );

  /* ---------- replies: restore originals on screen, and say what could not be restored ---------- */
  const asked = new WeakMap(); // text node -> the text we already tried to restore (avoids hammering the gateway)
  const wrote = new WeakSet(); // text nodes holding restored originals: never scanned again
  const masked = new Map(); // text node -> original text, for the "확인하기" button
  const scanned = new Map(); // text node text -> true
  let noteTimer;

  async function restoreReplies() {
    let restored = 0;
    let expired = false;
    const fuzzy = [];
    const replySel = site.reply.join(",");
    for (const root of document.querySelectorAll([...site.reply, ...(site.mine || [])].join(","))) {
      const isReply = root.matches(replySel);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const value = node.nodeValue;
        if (PLACEHOLDER.test(value) && asked.get(node) !== value) {
          asked.set(node, value);
          const res = await bg("restore", { text: value });
          if (res.ok && res.data.text !== value) {
            node.nodeValue = res.data.text;
            asked.set(node, node.nodeValue);
            wrote.add(node);
            if (isReply) restored++;
          } else if (res.status === 404 && isReply) expired = true;
        } else if (isReply && !PLACEHOLDER.test(value)) {
          for (const f of Gw.findFuzzy(value)) fuzzy.push({ node, ...f });
        }
      }
    }
    if (restored && lastSent) {
      lastSent.restored = true;
      lastSent.entries = lastSent.entries.map((e) => (e.how === "keep" ? e : { ...e, st: "복원됨" }));
      ui.history(lastSent.entries, { portalUrl: cfg.portalUrl });
      ui.strip("expired", null);
    }
    if (expired)
      ui.strip("expired", { tone: "info", text: "30분이 지났거나 탭을 새로 열어서 원래 값을 지웠어요 · 자리표시자로 보여요" });
    if (fuzzy.length) offerFuzzy(fuzzy);
    else ui.strip("fuzzy", null);
    await reverseScan();
  }

  function offerFuzzy(list) {
    const first = list[0];
    ui.strip("fuzzy", {
      tone: "warn",
      text: `모양이 바뀐 자리표시자 ${new Set(list.map((f) => f.raw)).size}개 · ${first.raw}을 ${first.fixed}로 보고 복원할까요?`,
      action: {
        label: "복원하기",
        onClick: () => {
          for (const f of list) f.node.nodeValue = f.node.nodeValue.split(f.raw).join(f.fixed);
          ui.strip("fuzzy", null);
          restoreReplies();
        },
      },
    });
  }

  // The model's answer can contain sensitive-looking values we never sent. Dry-run them through the gateway.
  const LOOKS_SENSITIVE = /\d{6}[- ]?\d|@\w|sk-|\d{2,4}-\d{3,4}-\d{4}/;
  async function reverseScan() {
    const found = [];
    for (const root of document.querySelectorAll(site.reply.join(","))) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = n.nodeValue;
        if (wrote.has(n) || masked.has(n) || v.includes("▇") || !LOOKS_SENSITIVE.test(v) || scanned.get(v)) continue;
        scanned.set(v, true);
        const a = await bg("analyze", { text: v });
        if (!a.ok || a.passthrough) continue;
        const hits = a.data.spans.filter((s) => s.action === "redact" || s.action === "block");
        if (!hits.length) continue;
        const cps = Gw.cps(v);
        let out = "";
        let at = 0;
        for (const s of [...hits].sort((x, y) => x.start - y.start)) {
          out += cps.slice(at, s.start).join("") + "▇".repeat(s.end - s.start);
          at = s.end;
        }
        out += cps.slice(at).join("");
        masked.set(n, v);
        n.nodeValue = out;
        found.push({ node: n, label: hits[0].label });
      }
    }
    if (!found.length) return;
    const label = found[0].label;
    let shown = false;
    const render = () =>
      ui.strip("reverse", {
        tone: "danger",
        text: shown ? `${label} 형식의 값을 보여 주고 있어요` : `모델 답변에 ${label} 형식이 있어 가렸어요`,
        action: {
          label: shown ? "다시 가리기" : "확인하기 (기록됨)",
          onClick: async () => {
            shown = !shown;
            if (shown) {
              for (const [node, original] of masked) node.nodeValue = original;
              // Looking at it is recorded on this device (counts and labels only, never the value).
              await bg("historyAdd", { entry: { kind: "답변 확인", entries: [{ masked: `${label} 형식`, to: "화면에 표시", how: "keep", meta: `${label} · 답변에서 확인`, st: "확인함" }] } });
            } else await reverseRemask();
            render();
          },
        },
      });
    render();
  }
  async function reverseRemask() {
    for (const [node, original] of masked) {
      const a = await bg("analyze", { text: original });
      if (!a.ok || a.passthrough) continue;
      const cps = Gw.cps(original);
      let out = "";
      let at = 0;
      for (const s of a.data.spans.filter((x) => x.action !== "log").sort((x, y) => x.start - y.start)) {
        out += cps.slice(at, s.start).join("") + "▇".repeat(s.end - s.start);
        at = s.end;
      }
      node.nodeValue = out + cps.slice(at).join("");
    }
  }

  // The model did not use the placeholders we sent, so there is nothing to restore.
  function noteNoPlaceholder() {
    if (!lastSent || lastSent.noted || lastSent.restored || !lastSent.expect) return;
    const roots = [...document.querySelectorAll(site.reply.join(","))];
    if (roots.length <= lastSent.replies) return;
    const newest = roots[roots.length - 1];
    const body = newest.textContent || "";
    if (body.length < 20 || PLACEHOLDER.test(body)) return;
    lastSent.noted = true;
    ui.strip("noph", {
      tone: "info",
      text: "모델이 자리표시자를 쓰지 않아서 복원할 값이 없어요",
      action: {
        label: "“자리표시자를 그대로 써서” 다시 요청",
        onClick: () => {
          const box = findComposer();
          if (box) writeText(box, `${readText(box)}${readText(box) ? "\n" : ""}답변에는 [사람_1] 같은 자리표시자를 그대로 써서 알려줘.`.trim());
          toast("입력창에 넣었어요");
          ui.strip("noph", null);
        },
      },
    });
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(restoreReplies, 300);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(noteNoPlaceholder, 1800);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
