// Runs on chatgpt.com and claude.ai. The selectors depend on each site's current DOM and will need upkeep:
// when a site changes its page, only this table has to be edited.
const SITES = {
  "chatgpt.com": {
    // #prompt-textarea is a contenteditable on the logged-in page; other layouts use a <textarea> (read .value, not innerText).
    composer: ["#prompt-textarea", 'textarea[name="prompt-textarea"]', 'div.ProseMirror[contenteditable="true"]'],
    send: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="프롬프트 보내기"]',
      'button[aria-label="Send message"]',
    ],
    reply: ['[data-message-author-role="assistant"]'],
  },
  "claude.ai": {
    composer: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
    send: ['button[aria-label="Send message"]', 'button[aria-label="메시지 보내기"]'],
    reply: [".font-claude-message", "[data-is-streaming]"],
  },
};
SITES["chat.openai.com"] = SITES["chatgpt.com"];
const site = SITES[location.hostname] ?? SITES["chatgpt.com"];

// Without a note the model reads "[사람_1]" as a blank someone forgot to fill in ("what is the recipient?") instead of a name.
// Appended only to messages where something was masked, and only if the popup setting is on. It contains no real placeholder.
const HINT = "\n\n(안내: 이 글의 [종류_번호] 모양 표시는 개인정보를 가려 둔 자리표시자입니다. 실제 값을 묻거나 추측하지 말고, 그대로 사용해서 답해 주세요.)";

const PLACEHOLDER = /\[[^\[\]\s]+_\d+\]/;
let bypass = false; // lets our own re-send through the interceptor
let busy = false;

const find = (selectors) => {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
};
const toGateway = (type, text) => chrome.runtime.sendMessage({ type, text });
const composerSelector = site.composer.join(",");
const sendSelector = site.send.join(",");

// A page layout the table above does not know (ChatGPT has more than one and changes them) falls back to guessing:
// the biggest visible text box is the composer, a button labelled send / 보내기 / 전송 is the send button.
const GUESS_COMPOSER = 'textarea, div[role="textbox"], [contenteditable="true"]';
const SEND_WORDS = /send|submit|보내기|전송/i;
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const labelOf = (el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("data-testid") ?? ""}`;
const area = (el) => el.offsetWidth * el.offsetHeight;
const describe = (el) =>
  `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} ${el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.getAttribute("data-testid") ?? ""}`.trim();

const knownComposer = () => find(site.composer);
const guessComposer = () => [...document.querySelectorAll(GUESS_COMPOSER)].filter(visible).sort((a, b) => area(b) - area(a))[0] ?? null;
const composerEl = () => knownComposer() ?? guessComposer();
const composerOf = (target) => {
  const own = target.closest?.(composerSelector);
  if (own) return own;
  if (knownComposer()) return null; // the page has its known input; this target is something else
  const guess = guessComposer();
  return guess && guess.contains(target) ? guess : null;
};
const sendButton = () =>
  find(site.send) ?? [...document.querySelectorAll("button")].find((b) => visible(b) && !b.disabled && SEND_WORDS.test(labelOf(b))) ?? null;
const isSend = (target) => {
  const b = target.closest?.("button");
  return !!b && (b.matches(sendSelector) || (!find(site.send) && SEND_WORDS.test(labelOf(b))));
};

// What the popup shows when asked "does the extension see this page?" (see the probe listener below).
const seen = { intercepted: 0, last: "아직 가로챈 전송이 없어요" };
let armed = null; // text already checked and left in the box because there was no button to click: the next Enter passes untouched

// <textarea>/<input> keep their text in .value; a contenteditable keeps it in the DOM.
const readComposer = (box) => (("value" in box ? box.value : box.innerText) ?? "").trim();

function writeComposer(box, text) {
  box.focus();
  if ("value" in box) {
    // Frameworks track <textarea> through the native setter and an input event, not through a plain assignment.
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value").set.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    document.execCommand("selectAll");
    document.execCommand("insertText", false, text);
  }
}

function submitMessage(box) {
  const button = sendButton();
  if (!button) {
    armed = readComposer(box);
    seen.last = "보내기 버튼을 못 찾았어요. 확인한 글을 입력창에 넣어 뒀어요 (Enter를 한 번 더)";
    alert("보내기 버튼을 찾지 못했습니다. 확인을 마친 글을 입력창에 넣어 두었으니 Enter를 한 번 더 눌러 주세요.");
    return;
  }
  setTimeout(() => {
    bypass = true;
    button.click();
    bypass = false;
  }, 100);
}

async function guardedSend(event, box) {
  if (bypass) return;
  if (!box) {
    // The send button was pressed but we cannot read what is being sent: stop it rather than let it through unchecked.
    event.preventDefault();
    event.stopImmediatePropagation();
    seen.last = "보내기를 막았어요: 입력창을 찾지 못함 (선택자 점검 필요)";
    alert("입력창을 찾지 못해 전송을 막았습니다. 확장의 사이트 선택자를 점검해야 합니다.");
    return;
  }
  const text = readComposer(box);
  if (!text) return;
  if (armed !== null && text === armed) {
    armed = null;
    return; // checked a moment ago; let the person's own Enter send it
  }
  armed = null;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (busy) return;
  busy = true;
  seen.intercepted++;
  try {
    const res = await toGateway("sanitize", text);
    if (res.passthrough) {
      seen.last = "가림막이 꺼져 있어서 그대로 보냈어요";
      return submitMessage(box); // guard switched off in the popup
    }
    if (!res.ok) {
      // Fail closed: if the gateway is down or says block, nothing is sent.
      seen.last = res.status === 403 ? "차단했어요 (민감정보 포함)" : "게이트웨이에 연결할 수 없어 막았어요";
      alert(
        res.status === 403
          ? "게이트웨이가 이 프롬프트를 차단했습니다 (민감정보 포함)."
          : "게이트웨이에 연결할 수 없어 전송을 막았습니다."
      );
      return;
    }
    seen.last = res.data.text !== text ? "가려서 보냈어요" : "찾은 게 없어 그대로 보냈어요";
    if (res.data.text !== text) {
      const masked = Object.keys(res.data.findings ?? {}).length > 0;
      writeComposer(box, res.hint && masked ? res.data.text + HINT : res.data.text);
    }
    submitMessage(box);
  } finally {
    busy = false;
  }
}

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return; // isComposing: Korean IME fires Enter to commit a syllable
    const box = composerOf(e.target);
    if (box) guardedSend(e, box);
  },
  true
);
document.addEventListener(
  "click",
  (e) => {
    if (isSend(e.target)) guardedSend(e, composerEl());
  },
  true
);

// Put the original values back into the reply, in the DOM only.
const asked = new WeakMap(); // text node -> the text we already tried to restore (avoids hammering the gateway)
async function restoreReplies() {
  for (const root of document.querySelectorAll(site.reply.join(","))) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (PLACEHOLDER.test(n.nodeValue) && asked.get(n) !== n.nodeValue) nodes.push(n);
    }
    for (const node of nodes) {
      asked.set(node, node.nodeValue);
      const res = await toGateway("restore", node.nodeValue);
      if (res.ok && res.data.text !== node.nodeValue) {
        node.nodeValue = res.data.text;
        asked.set(node, node.nodeValue);
      }
    }
  }
}

let timer;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(restoreReplies, 300);
}).observe(document.body, { childList: true, subtree: true, characterData: true });

// The popup asks this tab whether the extension is alive and recognises the page (no page content is returned).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "probe") return false;
  reply({
    host: location.hostname,
    composer: knownComposer() ? "known" : guessComposer() ? "guess" : "none",
    send: find(site.send) ? "known" : sendButton() ? "guess" : "none",
    reply: !!find(site.reply),
    intercepted: seen.intercepted,
    last: seen.last,
    // What is on the page that looks like a text box / send button, so a wrong selector can be fixed from one screenshot.
    boxes: [...document.querySelectorAll(GUESS_COMPOSER)].filter(visible).slice(0, 4).map(describe),
    buttons: [...document.querySelectorAll("button")].filter((b) => visible(b) && SEND_WORDS.test(labelOf(b))).slice(0, 4).map(describe),
  });
  return false;
});
