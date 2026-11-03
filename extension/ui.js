// In-page screens (review window, block / connection dialogs, status chip, change pill + drawer, strips, toast).
// Everything lives in one shadow root so neither ChatGPT's CSS nor ours can change the other, and every string
// from the page or the gateway is set with textContent, never parsed as HTML.
(function (root) {
  "use strict";

  const SVG = {
    shield: '<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>',
    shieldAlert: '<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6zM12 8v4M12 16h.01"/>',
    ban: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8"/>',
    wifiOff: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    hourglass: '<path d="M6 2h12M6 22h12M7 2v4.5a5 5 0 0 0 2 4l1.5 1.5-1.5 1.5a5 5 0 0 0-2 4V22M17 2v4.5a5 5 0 0 1-2 4L13.5 12l1.5 1.5a5 5 0 0 1 2 4V22"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/>',
  };
  const icon = (name, size = 16) => {
    const span = document.createElement("span");
    span.className = "ic";
    span.setAttribute("aria-hidden", "true");
    // Static markup from the table above; no page or gateway text ever reaches innerHTML.
    span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${SVG[name]}</svg>`;
    return span;
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.layer{position:fixed;inset:0;pointer-events:none;font:13px/1.5 "IBM Plex Sans KR","Pretendard","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;color:#0F1A2B}
.layer *{font-family:inherit}
button{font:inherit;color:inherit}
.mono{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace}
.t2{color:#4A5568}.t3{color:#5F6B7D}
:focus-visible{outline:2px solid #2563EB;outline-offset:2px}
.ic{display:inline-flex;flex:0 0 auto}

/* dock above the composer */
.dock{position:fixed;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:min(420px,calc(100vw - 24px));pointer-events:none}
.dock>*{pointer-events:auto}
.glass{background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);border:1px solid #fff;box-shadow:0 10px 26px -14px rgba(15,26,43,.5)}
.chip,.strip{display:flex;align-items:center;gap:8px;border-radius:999px;padding:6px 12px 6px 8px;font-size:12px;font-weight:600;min-height:34px}
.chip .logo,.pill .logo{width:22px;height:22px;border-radius:7px;background:#0F1A2B;color:#fff;display:grid;place-items:center;flex:0 0 auto}
.tone-ok{color:#065F46}.tone-warn{color:#92400E}.tone-info{color:#1D4ED8}.tone-danger{color:#991B1B}.tone-off{color:#92400E}
.strip{border-radius:14px;padding:8px 8px 8px 12px;font-weight:500;line-height:1.5;flex-wrap:wrap;justify-content:space-between}
.strip.tone-info{background:rgba(239,246,255,.97)}.strip.tone-warn,.strip.tone-off{background:rgba(255,247,237,.97)}.strip.tone-danger{background:rgba(254,242,242,.97)}.strip.tone-ok{background:rgba(236,253,245,.97)}
.strip .txt{flex:1 1 180px;min-width:0}
.strip .note{display:block;margin-top:2px;font-weight:400;opacity:.85}
.sbtn{border:1px solid rgba(15,26,43,.14);background:#fff;border-radius:999px;padding:0 12px;min-height:30px;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap}
.sbtn:hover{border-color:rgba(15,26,43,.35)}
.xbtn{border:0;background:transparent;width:30px;height:30px;border-radius:50%;cursor:pointer;display:grid;place-items:center;color:#4A5568}
.xbtn:hover{background:rgba(15,26,43,.07)}
.bar{width:64px;height:5px;border-radius:3px;background:rgba(15,26,43,.12);overflow:hidden;position:relative}
.bar::after{content:"";position:absolute;inset:0;width:40%;background:#2563EB;border-radius:3px;animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}

.pill{display:flex;align-items:center;gap:8px;border-radius:999px;padding:5px 12px 5px 5px;min-height:38px;font-weight:600;font-size:12.5px;cursor:pointer}
.pill:hover{border-color:rgba(15,26,43,.25)}
.drawer{width:min(360px,calc(100vw - 24px));border-radius:20px;padding:14px;display:flex;flex-direction:column;gap:10px;background:rgba(255,255,255,.97);box-shadow:0 24px 50px -22px rgba(15,26,43,.5)}
.drawer .hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
.drawer .row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;font-size:12.5px;padding:7px 0;border-top:1px solid #F1F3F7}
.drawer .row small{display:block;font-size:11px;color:#5F6B7D}
.drawer a{font-size:12.5px;font-weight:600;color:#1D4ED8}
.ok-st{color:#047857;font-weight:600;font-size:11px}.warn-st{color:#B45309;font-weight:600;font-size:11px}

/* left of the prompt box: how long an approved exception still lasts (the status chip lives on the right) */
.dockL{position:fixed;display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:min(380px,calc(100vw - 24px));pointer-events:none}
.dockL>*{pointer-events:auto}
.gchip{display:flex;align-items:center;gap:8px;border:1px solid #fff;border-radius:999px;padding:6px 14px 6px 8px;min-height:36px;font-size:12.5px;font-weight:600;cursor:pointer;background:rgba(236,253,245,.96);color:#065F46;box-shadow:0 10px 26px -14px rgba(15,26,43,.5)}
.gchip:hover{border-color:rgba(15,26,43,.25)}
.gchip.warn{background:rgba(255,247,237,.98);color:#92400E}
.gchip .gi{width:22px;height:22px;border-radius:50%;background:rgba(4,120,87,.14);display:grid;place-items:center;flex:0 0 auto}
.gchip.warn .gi{background:rgba(180,83,9,.16)}
.gchip .gt{font-variant-numeric:tabular-nums}
.gcard{width:min(340px,calc(100vw - 24px));border-radius:20px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:rgba(255,255,255,.97);box-shadow:0 24px 50px -22px rgba(15,26,43,.5);animation:rise .18s cubic-bezier(.22,1,.36,1)}
.gcard h3{margin:0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}
.gcard h3 .cnt{font-size:11.5px;font-weight:700;color:#065F46;background:rgba(16,185,129,.14);border-radius:999px;padding:1px 8px}
.gcard h3 .xbtn{margin-left:auto}
.gcard .gl{display:flex;flex-direction:column;gap:8px;max-height:min(46vh,340px);overflow:auto;margin:0;padding:0;list-style:none}
.gcard .gitem{border:1px solid rgba(15,26,43,.1);border-radius:14px;padding:10px 12px;background:#fff}
.gcard .gh{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;font-weight:700}
.gcard .gh .gl-t{font-variant-numeric:tabular-nums;font-weight:700;color:#065F46;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.gcard .gh .gl-t.warn{color:#92400E}
.gcard dl{margin:6px 0 0;display:grid;grid-template-columns:72px minmax(0,1fr);gap:4px 10px;font-size:12.5px}
.gcard dt{color:#5F6B7D}.gcard dd{margin:0;overflow-wrap:anywhere}
.gcard .why{margin:0;font-size:12px;line-height:1.6;color:#4A5568;background:#F7F8FB;border-radius:12px;padding:8px 10px}

/* answers to exception requests: slide in at the top centre, stay a few seconds, fade out */
.notices{position:fixed;top:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:10px;width:min(400px,calc(100vw - 32px));pointer-events:none}
.notices>*{pointer-events:auto}
.ncard{position:relative;overflow:hidden;display:flex;gap:12px;align-items:flex-start;border-radius:18px;padding:14px 12px 16px 14px;background:rgba(255,255,255,.98);border:1px solid #fff;box-shadow:0 24px 50px -20px rgba(15,26,43,.6);animation:pop .28s cubic-bezier(.2,1.15,.4,1)}
.ncard.out{animation:pout .2s ease forwards}
.ncard .nbar{position:absolute;left:0;bottom:0;height:3px;width:100%;transform-origin:left;background:currentColor;opacity:.35;animation:drain var(--dur,7s) linear forwards}
.ncard:hover .nbar{animation-play-state:paused}
.ncard.tone-ok{color:#047857}.ncard.tone-warn{color:#B45309}.ncard.tone-info{color:#1D4ED8}
.ncard .ni{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto}
.ncard.tone-ok .ni{background:rgba(16,185,129,.14)}.ncard.tone-warn .ni{background:rgba(217,119,6,.14)}.ncard.tone-info .ni{background:rgba(37,99,235,.12)}
.ncard .nb{flex:1;min-width:0;color:#0F1A2B}.ncard b{display:block;font-size:14px;margin-bottom:2px}
.ncard p{margin:0;font-size:12.5px;line-height:1.6;color:#4A5568}.ncard .nn{margin-top:6px;padding:6px 10px;border-radius:10px;background:#F7F8FB;color:#0F1A2B}
@keyframes pop{from{opacity:0;transform:translateY(-16px) scale(.95)}to{opacity:1;transform:none}}
@keyframes pout{to{opacity:0;transform:translateY(-10px) scale(.97)}}
@keyframes drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
/* the in-page exception request form */
.fld{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.fld>label,.fld>.lb{font-size:12px;font-weight:600;color:#4A5568}
.fld input[type=text],.fld textarea{width:100%;border:1px solid rgba(15,26,43,.16);border-radius:12px;background:#fff;padding:9px 12px;font-size:13px;line-height:1.5;color:#0F1A2B;box-sizing:border-box}
.fld textarea{min-height:92px;resize:vertical}
.fld input:focus-visible,.fld textarea:focus-visible{outline:2px solid #2563EB;outline-offset:1px}
.fld .ro{font-size:13px;padding:9px 12px;border-radius:12px;background:#F2F4F8;color:#0F1A2B}
.fld .hint{font-size:11.5px;color:#5F6B7D;display:flex;justify-content:space-between}
.fld .hint.bad{color:#DC2626}
.segs{display:flex;gap:6px}
.segs label{flex:1;position:relative}
.segs input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.segs span{display:flex;align-items:center;justify-content:center;min-height:38px;border-radius:999px;border:1px solid rgba(15,26,43,.16);background:#fff;font-size:13px;font-weight:600;color:#4A5568}
.segs input:checked+span{background:#0F1A2B;border-color:#0F1A2B;color:#fff}
.segs input:focus-visible+span{outline:2px solid #2563EB;outline-offset:2px}
.ferr{margin:10px 0 0;font-size:12.5px;color:#B91C1C}
@media (prefers-reduced-motion:reduce){.gcard,.ncard,.ncard .nbar{animation:none}.ncard .nbar{display:none}}

/* chips inside text */
.ph{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-size:.92em;color:#1D4ED8;background:rgba(37,99,235,.09);border-radius:5px;padding:0 4px}
.al{color:#065F46;background:rgba(16,185,129,.12);border-radius:5px;padding:0 4px;font-weight:600}
.kp{background:rgba(217,119,6,.14);border-radius:5px;padding:0 4px}

/* dialogs */
.scrim{position:fixed;inset:0;background:rgba(40,30,20,.32);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);display:grid;place-items:center;padding:20px;pointer-events:auto;animation:fade .16s ease-out}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes rise{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.dlg{width:min(720px,100%);max-height:calc(100vh - 40px);overflow:auto;border-radius:22px;padding:22px 24px;background:rgba(255,255,255,.96);border:1px solid #fff;box-shadow:0 30px 60px -24px rgba(15,26,43,.55);display:flex;flex-direction:column;gap:16px;animation:rise .2s cubic-bezier(.22,1,.36,1)}
.dlg.sm{width:min(420px,100%)}
.dlg h2{margin:0;font-size:18px;line-height:1.35;font-weight:700;letter-spacing:-.01em}
.dlg p{margin:4px 0 0;font-size:13px;line-height:1.6;color:#4A5568}
.head{display:flex;gap:12px;align-items:flex-start}
.badge{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex:0 0 auto}
.badge.ok{background:rgba(16,185,129,.14);color:#047857}.badge.warn{background:rgba(217,119,6,.14);color:#B45309}.badge.danger{background:rgba(220,38,38,.12);color:#DC2626}.badge.neutral{background:rgba(15,26,43,.08);color:#0F1A2B}
.items{display:flex;flex-direction:column;gap:8px}
.item{display:grid;grid-template-columns:minmax(130px,1fr) minmax(0,2fr);gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:#F7F8FB}
@media (max-width:560px){.item{grid-template-columns:1fr}}
.item b{font-size:14px;word-break:break-all}
.item small{display:block;font-size:11.5px;color:#5F6B7D}
.opts{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:#fff;border:1px solid #E4E4E7;flex-wrap:wrap}
.opts button{border:0;background:transparent;border-radius:999px;padding:0 12px;min-height:32px;font-size:12px;font-weight:500;color:#4A5568;cursor:pointer}
.opts button[aria-pressed=true]{background:#0F1A2B;color:#fff;font-weight:600}
.opts button:disabled{opacity:.4;cursor:not-allowed}
.note{font-size:12px;color:#4A5568;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.link{border:0;background:none;color:#1D4ED8;font-weight:600;font-size:12px;cursor:pointer;padding:0;text-decoration:underline}
.preview{padding:12px 14px;border-radius:14px;background:#fff;border:1px solid #E4E4E7;font-size:14px;line-height:1.8;white-space:pre-wrap;word-break:break-word}
.lbl{font-size:11.5px;font-weight:600;color:#5F6B7D;margin-bottom:6px}
.foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.foot .hint{font-size:11.5px;color:#5F6B7D;flex:1 1 220px}
.btns{display:flex;gap:8px;flex-wrap:wrap}
.btn{border:1px solid rgba(15,26,43,.14);background:#fff;border-radius:999px;padding:0 18px;min-height:44px;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;color:#0F1A2B}
.btn:hover{border-color:rgba(15,26,43,.4)}
.btn.p{background:#0F1A2B;border-color:#0F1A2B;color:#fff}.btn.p:hover{background:#1E2A3F}
.toast{position:fixed;right:20px;bottom:20px;padding:12px 16px;border-radius:16px;background:rgba(15,26,43,.93);color:#fff;font-size:13px;box-shadow:0 18px 40px -16px rgba(15,26,43,.6);pointer-events:auto;max-width:min(360px,calc(100vw - 40px));animation:fade .16s ease-out}
@media (prefers-reduced-motion:reduce){.scrim,.dlg,.toast,.bar::after{animation:none}}
`;

  function create(opts) {
    const getAnchor = opts.getAnchor || (() => null);
    const host = document.createElement("div");
    host.id = "llm-gateway-guard";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(h("style", { text: CSS }));
    const layer = h("div", { class: "layer" });
    const dock = h("div", { class: "dock", "data-testid": "gw-dock" });
    const dockL = h("div", { class: "dockL", "data-testid": "gw-dock-left" });
    const notices = h("div", { class: "notices", "data-testid": "gw-notices", "aria-live": "polite" });
    layer.append(dock, dockL, notices);
    shadow.append(layer);
    // Keys typed inside our screens must not reach the page's own shortcuts.
    for (const ev of ["keydown", "keyup", "keypress"]) layer.addEventListener(ev, (e) => e.stopPropagation());
    const mount = () => {
      if (!host.isConnected) document.documentElement.append(host);
    };
    mount();

    const slots = { strips: new Map(), chip: null, pill: null, drawer: null };
    const timers = new Map();

    function place() {
      const r = getAnchor()?.getBoundingClientRect?.();
      const right = r ? Math.max(12, window.innerWidth - r.right + 4) : 20;
      const bottom = r ? Math.max(12, window.innerHeight - r.top + 10) : 96;
      dock.style.right = `${right}px`;
      dock.style.bottom = `${bottom}px`;
      dockL.style.left = `${r ? Math.max(12, r.left + 4) : 20}px`;
      dockL.style.bottom = `${bottom}px`;
    }
    place();
    const tick = setInterval(() => {
      mount();
      if (dock.childElementCount || dockL.childElementCount) place();
    }, 400);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    function rebuildDock() {
      const next = [slots.drawer, ...slots.strips.values(), slots.chip, slots.pill].filter(Boolean);
      const same = next.length === dock.childElementCount && next.every((el, i) => dock.children[i] === el);
      if (!same) dock.replaceChildren(...next); // re-attaching an unchanged node would swallow a click in progress
      place();
    }

    /* ---------- chip (status above the composer) ---------- */
    function chip(spec) {
      if (!spec && !slots.chip) return;
      if (!spec) slots.chip = null;
      else {
        slots.chip = h(
          "div",
          { class: `chip glass tone-${spec.tone || "info"}`, role: "status", "aria-live": "polite", "data-testid": "gw-chip" },
          h("span", { class: "logo" }, icon("shield", 12)),
          h("span", { text: spec.text }),
          spec.progress ? h("span", { class: "bar", "aria-hidden": "true" }) : null,
          spec.action ? h("button", { type: "button", class: "sbtn", text: spec.action.label, onclick: spec.action.onClick }) : null,
        );
      }
      rebuildDock();
    }

    /* ---------- strips (contextual notes, dismissable) ---------- */
    function strip(id, spec, ms) {
      clearTimeout(timers.get(id));
      if (!spec) {
        if (!slots.strips.has(id)) return;
        slots.strips.delete(id);
        timers.delete(id);
        return rebuildDock();
      }
      const el = h(
        "div",
        { class: `strip glass tone-${spec.tone || "info"}`, role: spec.tone === "danger" ? "alert" : "status", "data-testid": `gw-strip-${id}` },
        h("span", { class: "txt" }, h("span", { class: "main", text: spec.text }), spec.note ? h("span", { class: "note", text: `관리자 메모 · ${spec.note}` }) : null),
        spec.action ? h("button", { type: "button", class: "sbtn", text: spec.action.label, onclick: spec.action.onClick }) : null,
        spec.sticky ? null : h("button", { type: "button", class: "xbtn", "aria-label": "닫기", onclick: () => strip(id, null) }, icon("close", 14)),
      );
      slots.strips.set(id, el);
      if (ms) timers.set(id, setTimeout(() => strip(id, null), ms));
      rebuildDock();
    }

    /** Change the first line of a strip that is already showing (a countdown), without rebuilding it. */
    function stripText(id, text) {
      const main = slots.strips.get(id)?.querySelector(".main");
      if (main && main.textContent !== text) main.textContent = text;
      return !!main;
    }

    /* ---------- approved exceptions: one chip on the left (the one that ends first); open it to see all of them ---------- */
    let grants = [];
    let grantOpen = false;
    let grantTimer;
    let fmt = "clock";
    const WARN_MS = 5 * 60_000;
    const gsig = (list) => list.map((g) => `${g.id}:${g.end}`).join("|");
    const chipText = (g, now) => `${g.once ? "1회 · " : ""}${root.Gw.remaining(g.end - now, fmt)}`;
    function renderGrant() {
      if (!grants.length) {
        clearInterval(grantTimer);
        grantTimer = null;
        grantOpen = false;
        return dockL.replaceChildren();
      }
      const g = grants[0];
      const now = Date.now();
      const chip = h(
        "button",
        {
          type: "button",
          class: `gchip${g.end - now < WARN_MS ? " warn" : ""}`,
          "aria-expanded": String(grantOpen),
          "aria-label": `예외 승인 ${grants.length}건 · 가장 먼저 끝나는 것의 남은 시간 · 눌러서 자세히 보기`,
          "data-testid": "gw-grant-chip",
          onclick: () => ((grantOpen = !grantOpen), renderGrant()),
        },
        h("span", { class: "gi" }, icon("hourglass", 13)),
        h("span", { class: "gt", "data-testid": "gw-grant-time", text: chipText(g, now) }),
      );
      const nodes = [chip];
      if (grantOpen) {
        const row = (k, v) => [h("dt", { text: k }), h("dd", { text: v })];
        const item = (x) =>
          h(
            "li",
            { class: "gitem", "data-testid": "gw-grant-item" },
            h(
              "div",
              { class: "gh" },
              h("span", { text: x.entity || "항목 미지정" }),
              h("span", { class: `gl-t${x.end - now < WARN_MS ? " warn" : ""}`, "data-end": String(x.end), "data-once": x.once ? "1" : "" }, icon("hourglass", 12), h("span", { class: "v", text: root.Gw.remaining(x.end - now, fmt) })),
            ),
            h(
              "dl",
              {},
              row("적용 사이트", x.site || "모든 사이트"),
              row("허용 기간", x.once ? "1회만" : `${x.label} · ${root.Gw.clock(x.end, now)}까지`),
              x.once ? row("안 쓰면", `${root.Gw.clock(x.end, now)}에 끝나요`) : null,
              x.note ? row("관리자 메모", x.note) : null,
            ),
          );
        const onceAny = grants.some((x) => x.once);
        nodes.unshift(
          h(
            "section",
            { class: "gcard", role: "region", "aria-label": "예외 승인 자세히", "data-testid": "gw-grant-card" },
            h("h3", {}, "예외 승인 중", grants.length > 1 ? h("span", { class: "cnt", text: `${grants.length}건` }) : null, h("button", { type: "button", class: "xbtn", "aria-label": "닫기", onclick: () => ((grantOpen = false), renderGrant()) }, icon("close", 14))),
            h("ul", { class: "gl" }, ...grants.map(item)),
            h("p", { class: "why", text: `위 항목은 해당 사이트에서 가려지지 않고 그대로 보내져요. ${onceAny ? "1회 허용은 한 번 쓰면 바로 사라지고, " : ""}시간이 끝나면 자동으로 다시 보호돼요.` }),
          ),
        );
      }
      dockL.replaceChildren(...nodes);
      place();
    }
    /** Show the approvals that are running, the one ending first at the top (an empty list hides everything). `format`: "clock" | "text". */
    function grant(list, format) {
      const next = Array.isArray(list) ? list : list ? [list] : [];
      const f = format || fmt;
      const changed = gsig(next) !== gsig(grants) || f !== fmt;
      grants = next;
      fmt = f;
      if (!grants.length) return renderGrant();
      if (changed) renderGrant();
      grantTimer ??= setInterval(() => {
        const now = Date.now();
        if (grants.some((g) => g.end <= now)) return grant(grants.filter((g) => g.end > now));
        const t = dockL.querySelector("[data-testid=gw-grant-time]");
        if (t) t.textContent = chipText(grants[0], now);
        dockL.querySelector(".gchip")?.classList.toggle("warn", grants[0].end - now < WARN_MS);
        for (const el of dockL.querySelectorAll("[data-end]")) {
          const end = Number(el.dataset.end);
          el.querySelector(".v").textContent = root.Gw.remaining(end - now, fmt);
          el.classList.toggle("warn", end - now < WARN_MS);
        }
      }, 1000);
    }

    /* ---------- answer to an exception request: slides in, stays a few seconds, fades out (never blocks the page) ---------- */
    const noticeTimers = new Map();
    function hideNotice(id) {
      clearTimeout(noticeTimers.get(id));
      const el = notices.querySelector(`[data-nid="${id}"]`);
      if (!el || el.classList.contains("out")) return;
      el.classList.add("out");
      setTimeout(() => el.remove(), 200);
    }
    function notify(id, spec, ms = 7000) {
      clearTimeout(noticeTimers.get(id));
      notices.querySelector(`[data-nid="${id}"]`)?.remove();
      if (!spec) return;
      const card = h(
        "div",
        { class: `ncard tone-${spec.tone || "info"}`, role: spec.tone === "warn" ? "alert" : "status", "data-nid": id, "data-testid": `gw-notice-${id}`, style: `--dur:${ms}ms` },
        h("span", { class: "ni" }, icon(spec.tone === "ok" ? "check" : spec.tone === "warn" ? "shieldAlert" : "bell", 18)),
        h("div", { class: "nb" }, h("b", { text: spec.title }), h("p", { text: spec.text }), spec.note ? h("p", { class: "nn", text: `관리자 메모 · ${spec.note}` }) : null),
        h("button", { type: "button", class: "xbtn", "aria-label": "닫기", onclick: () => hideNotice(id) }, icon("close", 14)),
        ms ? h("span", { class: "nbar" }) : null,
      );
      notices.prepend(card);
      if (ms) {
        const arm = (t) => noticeTimers.set(id, setTimeout(() => hideNotice(id), t));
        arm(ms);
        card.addEventListener("mouseenter", () => clearTimeout(noticeTimers.get(id)));
        card.addEventListener("mouseleave", () => arm(2500)); // read it in peace; it goes a moment after the pointer leaves
      }
    }

    /* ---------- toast ---------- */
    let toastEl;
    function toast(text, ms = 2800) {
      toastEl?.remove();
      toastEl = h("div", { class: "toast", role: "status", "data-testid": "gw-toast", text });
      layer.append(toastEl);
      const el = toastEl;
      setTimeout(() => el.remove(), ms);
    }

    /* ---------- change pill + drawer (치환 내역) ---------- */
    let drawerOpen = false;
    let lastHistory = null;
    function history(entries, o = {}) {
      lastHistory = entries && entries.length ? { entries, o } : null;
      const changed = lastHistory ? entries.filter((e) => e.how !== "keep").length : 0;
      if (!lastHistory) {
        slots.pill = slots.drawer = null;
        drawerOpen = false;
        return rebuildDock();
      }
      const toggle = () => {
        drawerOpen = !drawerOpen;
        history(lastHistory.entries, lastHistory.o);
        if (drawerOpen) dock.querySelector('[data-testid="gw-drawer"] .xbtn')?.focus();
        else dock.querySelector('[data-testid="gw-pill"]')?.focus();
      };
      slots.pill = drawerOpen
        ? null
        : h(
            "button",
            { type: "button", class: "pill glass", "data-testid": "gw-pill", "aria-expanded": "false", "aria-label": "치환 내역 펼치기", onclick: toggle },
            h("span", { class: "logo" }, icon("shield", 13)),
            changed ? `${changed}개 바꿔서 보냄` : `원문 ${entries.length}개 그대로 보냄`,
            h("span", { "aria-hidden": "true", class: "t3", text: "▴" }),
          );
      slots.drawer = drawerOpen
        ? h(
            "div",
            { class: "drawer glass", role: "dialog", "aria-label": "치환 내역", "data-testid": "gw-drawer" },
            h("div", { class: "hd" }, h("b", { text: changed ? `이 메시지에서 바꾼 것 ${changed}` : "이 메시지는 원문으로 보냈어요" }), h("button", { type: "button", class: "xbtn", "aria-label": "접기", onclick: toggle }, "▾")),
            h(
              "div",
              {},
              entries.map((e) =>
                h(
                  "div",
                  { class: "row" },
                  h("span", {}, h("b", { text: e.masked }), " → ", h("span", { class: e.how === "alias" ? "al" : e.how === "keep" ? "kp" : "ph", text: e.to }), h("small", { text: e.meta })),
                  h("span", { class: e.st === "원문 전송" ? "warn-st" : "ok-st", text: e.st }),
                ),
              ),
            ),
            h("div", { class: "t3", style: "font-size:11.5px;line-height:1.6", text: "원래 단어는 홍*동처럼 일부만, 이 기기에 7일 보관돼요." }),
          )
        : null;
      rebuildDock();
    }

    /* ---------- modal plumbing ---------- */
    function modal(build, { onEscape }) {
      return new Promise((resolve) => {
        const returnTo = document.activeElement;
        const scrim = h("div", { class: "scrim" });
        const done = (value) => {
          document.removeEventListener("keydown", onKey, true);
          scrim.remove();
          if (returnTo && returnTo.focus) returnTo.focus();
          resolve(value);
        };
        const dlg = build(done);
        scrim.append(dlg);
        const onKey = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            done(onEscape);
          } else if (e.key === "Tab") {
            const f = [...dlg.querySelectorAll("button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled])")];
            if (!f.length) return;
            const first = f[0];
            const last = f[f.length - 1];
            const active = shadow.activeElement;
            if (e.shiftKey && (active === first || !dlg.contains(active))) (e.preventDefault(), last.focus());
            else if (!e.shiftKey && (active === last || !dlg.contains(active))) (e.preventDefault(), first.focus());
          }
        };
        // Capture phase on the page document: the page's own handlers must not see keys while a dialog is open.
        document.addEventListener("keydown", onKey, true);
        layer.append(scrim);
        (dlg.querySelector("[data-autofocus]") || dlg.querySelector("button"))?.focus();
      });
    }

    const parts = (list) => list.map((p) => (p.how ? h("span", { class: p.how === "alias" ? "al" : p.how === "keep" ? "kp" : "ph", text: p.t }) : p.t));

    /* ---------- U1 review window ---------- */
    function review({ items, buildPreview, canKeep, hasAlias, onReport }) {
      const choices = items.map(() => "ph");
      const reported = new Set();
      return modal(
        (done) => {
          const rows = h("div", { class: "items" });
          const previewBox = h("div", { class: "preview", "data-testid": "gw-preview" });
          const titleId = "gw-review-title";
          const redraw = () => {
            previewBox.replaceChildren(...parts(buildPreview(choices).parts));
            rows.replaceChildren(
              ...items.map((it, i) => {
                const keep = canKeep(it);
                const alias = hasAlias(it);
                const opt = (value, label, disabled) =>
                  h("button", {
                    type: "button",
                    "aria-pressed": String(choices[i] === value),
                    disabled,
                    title: disabled ? (value === "keep" ? "보안 정보와 영업기밀은 그대로 보낼 수 없어요" : "등록된 대체어가 없는 항목이에요") : null,
                    text: label,
                    onclick: () => {
                      choices[i] = value;
                      redraw();
                    },
                  });
                const noteText =
                  choices[i] === "alias" ? "관리자가 등록한 대체어 · 답변에서 원래대로 보여요" : choices[i] === "keep" ? "이번만 원문으로 보내요 · 기록에 남아요" : keep ? "" : "영업기밀은 그대로 둘 수 없어요";
                return h(
                  "div",
                  { class: "item", "data-testid": "gw-item" },
                  h("div", {}, h("b", { text: it.original }), h("small", { text: it.meta })),
                  h(
                    "div",
                    {},
                    h("div", { class: "opts", role: "group", "aria-label": `${it.original} 바꾸는 방법` }, opt("ph", "자리표시자", false), opt("alias", "등록된 대체어", !alias), opt("keep", "그대로 두기", !keep)),
                    h(
                      "div",
                      { class: "note" },
                      h("span", { text: noteText }),
                      keep && onReport
                        ? h("button", {
                            type: "button",
                            class: "link",
                            text: reported.has(i) ? "신고했어요" : "잘못 가려졌나요? 오탐 신고",
                            disabled: reported.has(i),
                            onclick: () => {
                              reported.add(i);
                              choices[i] = "keep";
                              onReport(it);
                              redraw();
                            },
                          })
                        : null,
                    ),
                  ),
                );
              }),
            );
          };
          redraw();
          return h(
            "section",
            { class: "dlg", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, "data-testid": "gw-review" },
            h(
              "div",
              { class: "head" },
              h("span", { class: "badge warn" }, icon("shieldAlert", 20)),
              h("div", {}, h("h2", { id: titleId, text: `유출이 의심되는 단어가 ${items.length}개 있어요` }), h("p", { text: "바꿀 값을 확인하고 적용하면, AI에게는 수정된 문장만 가요. 입력창 글은 그대로예요." })),
            ),
            rows,
            h("div", {}, h("div", { class: "lbl", text: "AI에게 보낼 문장 미리보기" }), previewBox),
            h(
              "div",
              { class: "foot" },
              h("span", { class: "hint", text: "적용하면 이 치환이 이 기기의 기록에 남아요 · 답변 속 바뀐 값은 화면에서 원래대로 보여요" }),
              h(
                "div",
                { class: "btns" },
                h("button", { type: "button", class: "btn", text: "입력창에서 직접 고치기", onclick: () => done(null) }),
                h("button", { type: "button", class: "btn p", "data-autofocus": "1", "data-testid": "gw-apply", text: "적용하고 보내기", onclick: () => done({ choices: [...choices], reported: [...reported] }) }),
              ),
            ),
          );
        },
        { onEscape: null },
      );
    }

    /* ---------- U2-A secret block ---------- */
    function blocked({ labels, canRequest, canSelect }) {
      return modal(
        (done) =>
          h(
            "section",
            { class: "dlg sm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "gw-block-title", "aria-describedby": "gw-block-desc", "data-testid": "gw-blocked" },
            h(
              "div",
              { class: "head" },
              h("span", { class: "badge danger" }, icon("ban", 20)),
              h("div", {}, h("h2", { id: "gw-block-title", text: "전송을 막았어요" }), h("p", { id: "gw-block-desc", text: `${labels.length ? `${labels.join("·")}은(는) ` : ""}가려서 보내도 위험해서 아예 보내지 않아요. 입력한 글은 그대로 남아 있어요.` })),
            ),
            h(
              "div",
              { class: "btns" },
              canSelect ? h("button", { type: "button", class: "btn p", "data-autofocus": "1", text: "해당 부분 선택하기", onclick: () => done("select") }) : null,
              canRequest ? h("button", { type: "button", class: "btn", "data-testid": "gw-request-open", text: "예외 요청", onclick: () => done("request") }) : null,
              h("button", { type: "button", class: "btn", text: "닫기", onclick: () => done("close") }),
            ),
          ),
        { onEscape: "close" },
      );
    }

    /* ---------- exception request, made right here (only the kinds of data and the site travel, never the prompt text) ---------- */
    const MIN_REASON = 20;
    function requestForm({ labels, site, send }) {
      return modal(
        (done) => {
          let scope = "1회";
          const entity = h("input", { type: "text", id: "gw-rq-entity", maxlength: "100", value: labels.join(", "), placeholder: "예: 이메일, 조성비" });
          const reason = h("textarea", { id: "gw-rq-reason", maxlength: "1000", "data-autofocus": "1", placeholder: "왜 이 정보를 그대로 보내야 하는지 업무 사유를 적어 주세요" });
          const count = h("span", { text: `0/${MIN_REASON}자 이상` });
          const err = h("p", { class: "ferr", role: "alert", hidden: true });
          const sendBtn = h("button", { type: "submit", class: "btn p", "data-testid": "gw-request-send", text: "요청 보내기" });
          reason.addEventListener("input", () => {
            const n = reason.value.trim().length;
            count.textContent = `${n}/${MIN_REASON}자 이상`;
            if (n >= MIN_REASON) {
              err.hidden = true; // fixed what the message complained about
              count.parentElement.classList.remove("bad");
            }
          });
          const seg = h(
            "div",
            { class: "segs", role: "radiogroup", "aria-label": "허용 기간" },
            ...["1회", "1시간", "24시간"].map((v) => h("label", {}, h("input", { type: "radio", name: "gw-rq-scope", value: v, checked: v === scope, onchange: () => (scope = v) }), h("span", { text: v }))),
          );
          const dlg = h(
            "section",
            { class: "dlg sm", role: "dialog", "aria-modal": "true", "aria-labelledby": "gw-rq-title", "data-testid": "gw-request" },
            h("div", { class: "head" }, h("span", { class: "badge neutral" }, icon("send", 20)), h("div", {}, h("h2", { id: "gw-rq-title", text: "예외 요청하기" }), h("p", { text: "관리자가 승인하면 정해진 기간 동안 이 항목을 가리지 않고 보낼 수 있어요. 결과는 이 화면에서 알려 드려요." }))),
          );
          const form = h(
            "form",
            { novalidate: true },
            h("div", { class: "fld" }, h("label", { for: "gw-rq-entity", text: "허용받을 항목" }), entity),
            h("div", { class: "fld" }, h("span", { class: "lb", text: "적용 사이트" }), h("div", { class: "ro", text: site || "—" })),
            h("div", { class: "fld" }, h("span", { class: "lb", text: "허용 기간" }), seg),
            h("div", { class: "fld" }, h("label", { for: "gw-rq-reason", text: "사유" }), reason, h("div", { class: "hint" }, count)),
            err,
            h("div", { class: "btns", style: "margin-top:14px" }, sendBtn, h("button", { type: "button", class: "btn", text: "취소", onclick: () => done("close") })),
          );
          form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const why = reason.value.trim();
            err.hidden = true;
            if (why.length < MIN_REASON) {
              count.parentElement.classList.add("bad");
              err.textContent = `사유를 ${MIN_REASON}자 이상 적어 주세요`;
              err.hidden = false;
              return reason.focus();
            }
            sendBtn.disabled = true;
            sendBtn.textContent = "보내는 중…";
            const r = await send({ entity: entity.value.trim(), site, scope, reason: why });
            if (r?.ok) {
              dlg.replaceChildren(
                h("div", { class: "head" }, h("span", { class: "badge ok" }, icon("check", 20)), h("div", {}, h("h2", { id: "gw-rq-title", text: "요청을 보냈어요" }), h("p", { text: "관리자가 확인하면 이 화면에 바로 알려 드려요. 그동안 입력한 글은 그대로 남아 있어요." }))),
                h("div", { class: "btns", style: "margin-top:14px" }, h("button", { type: "button", class: "btn p", "data-autofocus": "1", "data-testid": "gw-request-done", text: "확인", onclick: () => done("sent") })),
              );
              dlg.querySelector("[data-autofocus]").focus();
              return;
            }
            sendBtn.disabled = false;
            sendBtn.textContent = "다시 보내기";
            err.textContent = r?.message || "요청을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요";
            err.hidden = false;
          });
          dlg.append(form);
          // Typing in this form must not reach the chat page's own key handlers (shortcuts, its Enter-to-send).
          for (const ev of ["keydown", "keyup", "keypress"]) dlg.addEventListener(ev, (e) => e.stopPropagation());
          return dlg;
        },
        { onEscape: "close" },
      );
    }

    /* ---------- a card (mail draft, form) that shows restored values is about to send ---------- */
    function cardSend() {
      return modal(
        (done) =>
          h(
            "section",
            { class: "dlg sm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "gw-card-title", "aria-describedby": "gw-card-desc", "data-testid": "gw-cardsend" },
            h(
              "div",
              { class: "head" },
              h("span", { class: "badge warn" }, icon("shieldAlert", 20)),
              h("div", {}, h("h2", { id: "gw-card-title", text: "보내기 전에 한 번만 확인해 주세요" }), h("p", { id: "gw-card-desc", text: "이 카드에는 가려 둔 값을 원래대로 보여 주고 있어요. 서비스에 따라 실제로는 [이메일_1] 같은 가려진 값이 그대로 나갈 수 있어요. 받는 사람과 내용을 확인해 주세요." })),
            ),
            h(
              "div",
              { class: "btns" },
              h("button", { type: "button", class: "btn p", "data-autofocus": "1", text: "확인했어요, 보내기", onclick: () => done("go") }),
              h("button", { type: "button", class: "btn", text: "취소", onclick: () => done("cancel") }),
            ),
          ),
        { onEscape: "cancel" },
      );
    }

    /* ---------- U2-B gateway unreachable (fail closed) ---------- */
    function connection({ detail }) {
      return modal(
        (done) =>
          h(
            "section",
            { class: "dlg sm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "gw-conn-title", "aria-describedby": "gw-conn-desc", "data-testid": "gw-conn" },
            h(
              "div",
              { class: "head" },
              h("span", { class: "badge neutral" }, icon("wifiOff", 20)),
              h("div", {}, h("h2", { id: "gw-conn-title", text: "검사 서버에 연결할 수 없어요" }), h("p", { id: "gw-conn-desc", text: "검사 없이 보내지 않도록 전송을 보류했어요. 서버가 돌아오면 다시 시도할 수 있어요." })),
            ),
            h("div", { class: "t3 mono", style: "font-size:11px", text: detail }),
            h(
              "div",
              { class: "btns" },
              h("button", { type: "button", class: "btn p", "data-autofocus": "1", text: "다시 시도", onclick: () => done("retry") }),
              h("button", { type: "button", class: "btn", text: "닫기", onclick: () => done("cancel") }),
            ),
          ),
        { onEscape: "cancel" },
      );
    }

    function destroy() {
      clearInterval(tick);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      host.remove();
    }

    return { chip, strip, stripText, grant, notify, toast, history, review, blocked, requestForm, cardSend, connection, place, destroy, host, shadow, h, icon, modal };
  }

  root.GwUI = { create, h, icon };
})(self);
