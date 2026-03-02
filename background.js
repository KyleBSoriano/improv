function buildEmailPrompt(profile) {
  const name = profile?.name?.trim() || "Kyle";
  const signOff = profile?.signOff?.trim() || "Best";
  const bio = profile?.bio?.trim();
  const availabilityLink = profile?.availabilityLink?.trim();
  let authorContext = "";
  if (bio) authorContext = `\nAuthor context (use when relevant): ${bio}`;
  let availabilityLine = "";
  if (availabilityLink) availabilityLine = `\nWhen offering to meet or schedule, include exactly this line: "Here's my availability: Link" (write the word Link only; the extension will turn it into a clickable link). Do not output the URL.`;

  return `Rewrite this email to be clear, confident, and concise.${authorContext}${availabilityLine}

Keep my voice: Direct, Authentic, Intelligent, Slightly bold. Not overly salesy. No em-dashes.
Optimize for: Higher reply rate, natural tone, one clear call to action, short paragraphs, no fluff.
If long, tighten. If vague, clarify.

CRITICAL - Email structure and spacing (follow exactly):
- Do NOT include a subject line. Output only the email body.
- Line 1: Greeting only (e.g. "Hi [Name],").
- Line 2: Empty (blank line).
- Line 3: A short warm line on its own (e.g. "I hope you've been well." or "Hope all is well.").
- Line 4: Empty (blank line).
- Next: Main paragraph(s). Put a blank line between each paragraph. Keep paragraphs short (2–4 sentences).
- Before sign-off: One blank line.
- Sign-off: "${signOff}," on its own line, then exactly one line break (no blank line between), then "${name}" on the next line.
- Use real newline characters so the email displays with proper spacing when pasted.
- Keep paragraphs visually distinct (blank lines between them); do not output one solid block of text.

Return only the final email body. No subject. No commentary.`;
}

function buildReplyPrompt(profile) {
  const name = profile?.name?.trim() || "Kyle";
  const signOff = profile?.signOff?.trim() || "Best";
  const bio = profile?.bio?.trim();
  const availabilityLink = profile?.availabilityLink?.trim();
  let authorContext = "";
  if (bio) authorContext = ` Author context: ${bio}.`;
  let availabilityLine = "";
  if (availabilityLink) availabilityLine = ` When offering to meet, include: "Here's my availability: Link" (write the word Link only; the extension will hyperlink it). Do not output the URL.`;

  return `Write a short, professional reply to this message. Keep it direct and friendly.${authorContext}${availabilityLine} Same email format: greeting, blank line, brief warm line, blank line, body (use blank lines between paragraphs), blank line, then sign-off with "${signOff}," followed by a single line break then "${name}" (no blank line between ${signOff} and ${name}). Use real newlines so spacing is preserved. Return only the reply body. No subject. No commentary.`;
}

function runReplace() {
  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    if (!tab?.id) return;
    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://") || tab.url?.startsWith("chrome-extension://")) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "GET_SELECTION" });
    } catch (e) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
      await chrome.tabs.sendMessage(tab.id, { action: "GET_SELECTION" });
    }
  });
}


chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "OPEN_OPTIONS") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    return;
  }
  if (req.action === "PROCESS_CLIPBOARD") {
    (async () => {
      let newText = null, err = null;
      try {
        if (!req.selectedText?.trim()) err = "Clipboard is empty. Copy some text first.";
        else {
          const { apiKey } = await chrome.storage.local.get(["apiKey"]);
          if (!apiKey) err = "Set API key in extension options.";
          else newText = await callAI(apiKey, req.selectedText, { promptId: req.promptId || "email", customPrompt: req.customPrompt || null });
        }
      } catch (e) { err = e.message || String(e); }
      sendResponse({ newText, error: err });
    })();
    return true;
  }
  if (req.action !== "PROCESS_TEXT") return;
  const tabId = sender.tab?.id;
  const targetTabId = tabId || null;
  (async () => {
    let resolvedTabId = targetTabId;
    if (!resolvedTabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      resolvedTabId = tab?.id;
    }
    if (!resolvedTabId) return;
    let text = null, err = null;
    try {
      if (!req.selectedText?.trim()) { err = "No text selected."; }
      else {
        const { apiKey } = await chrome.storage.local.get(["apiKey"]);
        if (!apiKey) err = "Set API key in extension options.";
        else text = await callAI(apiKey, req.selectedText, { promptId: req.promptId, customPrompt: req.customPrompt });
      }
    } catch (e) { err = e.message || String(e); }
    const { profile = {} } = await chrome.storage.local.get(["profile"]);
    const availabilityLink = profile?.availabilityLink?.trim() || null;
    chrome.tabs.sendMessage(resolvedTabId, { action: "SHOW_PREVIEW", newText: text, error: err, availabilityLink }).catch(() => {});
  })();
  return true;
});

const FORMATTING = "Format the output with proper spacing: use a blank line between paragraphs. Do not return a single run-on paragraph. Structure like a short email where appropriate: greeting on its own line, blank line, then body in separate paragraphs (blank line between each), then sign-off. Use real newline characters so the text displays with proper spacing when pasted. No indentation of first lines needed; blank lines between blocks are enough.";

const PROMPTS_STATIC = {
  simplify: "Rewrite the following text to be simpler and easier to read. Keep the meaning. " + FORMATTING + " Return only the rewritten text, no commentary.",
  professional: "Rewrite the following text in a professional, polished tone. Keep the meaning. " + FORMATTING + " Return only the rewritten text, no commentary."
};

const GRAMMAR_SPELLING = "Always correct grammar and spelling in the output, no matter what the request is.";

async function callAI(apiKey, text, opts = {}) {
  let systemContent, userContent;
  const { profile = {} } = await chrome.storage.local.get(["profile"]);

  if (opts.customPrompt) {
    systemContent = "You are a helpful writing assistant. Follow the user's instructions. " + GRAMMAR_SPELLING + " Return only the rewritten text, no commentary.";
    userContent = opts.customPrompt + "\n\n---\n\n" + text;
  } else {
    const promptId = opts.promptId || "email";
    if (promptId === "email") systemContent = buildEmailPrompt(profile);
    else if (promptId === "reply") systemContent = buildReplyPrompt(profile);
    else systemContent = PROMPTS_STATIC[promptId] || buildEmailPrompt(profile);
    systemContent = systemContent + "\n\n" + GRAMMAR_SPELLING;
    userContent = text;
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [{ role: "system", content: systemContent }, { role: "user", content: userContent }]
    })
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "API error");
  let out = data.choices?.[0]?.message?.content;
  if (out == null) throw new Error("Empty response");
  out = out.trim();
  if (/^Subject:\s*/i.test(out)) out = out.replace(/^Subject:\s*[^\n]*\n?/i, "").trim();
  return out;
}
