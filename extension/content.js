// Runs on chatgpt.com. Selectors below depend on ChatGPT's current DOM and will need upkeep.
const COMPOSER = "#prompt-textarea";
const SEND_BUTTON = 'button[data-testid="send-button"]';
const REPLY = '[data-message-author-role="assistant"]';
const PLACEHOLDER = /\[[^\[\]\s]+_\d+\]/;

let vaultId = null; // one gateway vault per page load; reload loses the mapping
let bypass = false; // lets our own re-click through the interceptor
let busy = false;

const gateway = (type, text) => chrome.runtime.sendMessage({ type, text, vaultId });

async function guardedSend(event) {
  if (bypass) return;
  const box = document.querySelector(COMPOSER);
  const text = box?.innerText.trim();
  if (!text) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (busy) return;
  busy = true;
  try {
    const res = await gateway("sanitize", text);
    if (!res.ok) {
      // Fail closed: if the gateway is down or says block, nothing is sent.
      alert(
        res.status === 403
          ? "게이트웨이가 이 프롬프트를 차단했습니다 (민감정보 포함)."
          : "게이트웨이에 연결할 수 없어 전송을 막았습니다."
      );
      return;
    }
    vaultId = res.data.vault_id;
    if (res.data.text !== text) {
      box.focus();
      document.execCommand("selectAll");
      document.execCommand("insertText", false, res.data.text);
    }
    setTimeout(() => {
      bypass = true;
      document.querySelector(SEND_BUTTON)?.click();
      bypass = false;
    }, 100);
  } finally {
    busy = false;
  }
}

document.addEventListener(
  "keydown",
  (e) => {
    // isComposing: Korean IME fires Enter to commit a syllable; that must not count as send.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.closest?.(COMPOSER)) guardedSend(e);
  },
  true
);
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest?.(SEND_BUTTON)) guardedSend(e);
  },
  true
);

// Put the original values back into ChatGPT's reply, in the DOM only.
async function restoreReplies() {
  if (!vaultId) return;
  for (const root of document.querySelectorAll(REPLY)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (PLACEHOLDER.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const res = await gateway("restore", node.nodeValue);
      if (res.ok && res.data.text !== node.nodeValue) node.nodeValue = res.data.text;
    }
  }
}

let timer;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(restoreReplies, 300);
}).observe(document.body, { childList: true, subtree: true, characterData: true });
