function text(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseHeadline(raw) {
  const h = (raw || "").trim();
  if (!h) return { headline: "", company: "" };
  const at = h.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at) return { headline: at[1].trim(), company: at[2].trim() };
  const pipe = h.split("|").map((s) => s.trim()).filter(Boolean);
  if (pipe.length >= 2) return { headline: pipe[0], company: pipe[1] };
  return { headline: h, company: "" };
}

function scoreThread(thread) {
  let score = 1;
  const blob = `${thread.lastMessage} ${thread.headline} ${thread.company}`.toLowerCase();
  if (/meet(ing)?|schedule|calendar|zoom|teams|call|coffee|sync|book a time/.test(blob)) score += 4;
  if (/follow up|get back|let me know|interested|proposal|demo|pricing|opportunity/.test(blob)) score += 2;
  if (thread.unread) score += 1;
  if (thread.needsMeeting) score += 3;
  return score;
}

function scrapeConversations() {
  const selectors = [
    ".msg-conversation-listitem",
    "li.msg-conversation-card",
    ".msg-conversations-container__convo-item",
    "[class*='conversation-list-item']",
  ];
  let nodes = [];
  for (const sel of selectors) {
    nodes = [...document.querySelectorAll(sel)];
    if (nodes.length) break;
  }

  const threads = [];
  for (const node of nodes) {
    const nameEl = node.querySelector(
      ".msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names, [class*='participant-names']"
    );
    const snippetEl = node.querySelector(
      ".msg-conversation-card__message-snippet, .msg-conversation-listitem__message-snippet, [class*='message-snippet']"
    );
    const headlineEl = node.querySelector(
      ".msg-conversation-listitem__participant-headline, [class*='participant-headline']"
    );
    const linkEl = node.querySelector("a[href*='/in/']");

    const name = text(nameEl);
    const lastMessage = text(snippetEl);
    if (!name || !lastMessage) continue;

    const fromYou = /^you:/i.test(lastMessage);
    if (fromYou) continue;

    const cleanMessage = lastMessage.replace(/^you:\s*/i, "").trim();
    const { headline, company } = parseHeadline(text(headlineEl));
    const needsMeeting = /meet(ing)?|schedule|calendar|zoom|teams|call|coffee|sync|book a time/i.test(cleanMessage);
    const importance = scoreThread({ lastMessage: cleanMessage, headline, company, needsMeeting, unread: !!node.querySelector(".msg-conversation-card__unread-count, [class*='unread']") }) >= 5
      ? "high"
      : scoreThread({ lastMessage: cleanMessage, headline, company, needsMeeting }) >= 3
        ? "medium"
        : "low";

    threads.push({
      id: linkEl?.href || name,
      name,
      headline,
      company,
      profileUrl: linkEl?.href || "",
      lastMessage: cleanMessage,
      needsMeeting,
      needsResponse: true,
      unread: !!node.querySelector(".msg-conversation-card__unread-count, [class*='unread']"),
      importance,
      score: scoreThread({ lastMessage: cleanMessage, headline, company, needsMeeting, unread: true }),
    });
  }

  threads.sort((a, b) => b.score - a.score);
  return threads;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_INBOX") {
    try {
      sendResponse({ ok: true, threads: scrapeConversations() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  }
  return true;
});
