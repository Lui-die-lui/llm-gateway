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

// What the popup shows when asked "does the extension see this page?" (see the probe listener below).
const seen = { intercepted: 0, last: "아직 가로챈 전송이 없어요" };

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
  const box = event.target.closest?.(composerSelector) ?? find(site.composer);
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
  event.preventDefault();
  event.stopImmediatePropagation();
  if (busy) return;
  busy = true;
  seen.intercepted++;
  try {
    const res = await toGateway("sanitize", text);
    if (res.passthrough) {
      seen.last = "가림막이 꺼져 있어서 그대로 보냈어요";
      return resend(); // guard switched off in the popup
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
    resend();
  } finally {
    busy = false;
  }
}

document.addEventListener(
  "keydown",
  (e) => {
    // isComposing: Korean IME fires Enter to commit a syllable; that must not count as send.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.closest?.(composerSelector)) guardedSend(e);
  },
  true
);
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest?.(sendSelector)) guardedSend(e);
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
    composer: !!find(site.composer),
    send: !!find(site.send),
    reply: !!find(site.reply),
    intercepted: seen.intercepted,
    last: seen.last,
  });
  return false;
});
