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
.badge.warn{background:rgba(217,119,6,.14);color:#B45309}.badge.danger{background:rgba(220,38,38,.12);color:#DC2626}.badge.neutral{background:rgba(15,26,43,.08);color:#0F1A2B}
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
    layer.append(dock);
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
    }
    place();
    const tick = setInterval(() => {
      mount();
      if (dock.childElementCount) place();
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
        h("span", { class: "txt" }, spec.text),
        spec.action ? h("button", { type: "button", class: "sbtn", text: spec.action.label, onclick: spec.action.onClick }) : null,
        h("button", { type: "button", class: "xbtn", "aria-label": "닫기", onclick: () => strip(id, null) }, icon("close", 14)),
      );
      slots.strips.set(id, el);
      if (ms) timers.set(id, setTimeout(() => strip(id, null), ms));
      rebuildDock();
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
            o.portalUrl ? h("a", { href: o.portalUrl, target: "_blank", rel: "noopener", text: "전체 보기 →" }) : null,
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
            const f = [...dlg.querySelectorAll("button:not([disabled]),a[href]")];
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
    function blocked({ labels, requestUrl, canSelect }) {
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
              requestUrl ? h("a", { class: "btn", href: requestUrl, target: "_blank", rel: "noopener", text: "예외 요청" }) : null,
              h("button", { type: "button", class: "btn", text: "닫기", onclick: () => done("close") }),
            ),
          ),
        { onEscape: "close" },
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

    return { chip, strip, toast, history, review, blocked, connection, place, destroy, host, shadow, h, icon, modal };
  }

  root.GwUI = { create, h, icon };
})(self);
