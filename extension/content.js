// Runs on chatgpt.com and claude.ai. The selectors depend on each site's current DOM and will need upkeep:
// when a site changes its page, only this table has to be edited.
const SITES = {
  "chatgpt.com": {
    composer: ["#prompt-textarea"],
    send: ['button[data-testid="send-button"]'],
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

function resend() {
  setTimeout(() => {
    bypass = true;
    const button = find(site.send);
    if (button) button.click();
    else find(site.composer)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    bypass = false;
  }, 100);
}

async function guardedSend(event) {
  if (bypass) return;
  const box = find(site.composer);
  const text = box?.innerText.trim();
  if (!text) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (busy) return;
  busy = true;
  try {
    const res = await toGateway("sanitize", text);
    if (res.passthrough) return resend(); // guard switched off in the popup
    if (!res.ok) {
      // Fail closed: if the gateway is down or says block, nothing is sent.
      alert(
        res.status === 403
          ? "게이트웨이가 이 프롬프트를 차단했습니다 (민감정보 포함)."
          : "게이트웨이에 연결할 수 없어 전송을 막았습니다."
      );
      return;
    }
    if (res.data.text !== text) {
      box.focus();
      document.execCommand("selectAll");
      document.execCommand("insertText", false, res.data.text);
    }
    resend();
  } finally {
    busy = false;
  }
}

document.addEventListener(
  "keydown",
  (e) => {
    // isComposing: Korean IME fires Enter to commit a syllable; that must not count as send.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.closest?.(site.composer.join(","))) guardedSend(e);
  },
  true
);
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest?.(site.send.join(","))) guardedSend(e);
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
