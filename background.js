const VOICE = `Voice rules (apply to every output):
- Direct, authentic, intelligent, slightly bold. Not salesy. No fluff.
- No em-dashes. Short paragraphs (2-4 sentences).
- THE SOURCE MESSAGE IS THE PRIMARY CONTEXT. Everything specific the writer included must survive into the output.
- PRESERVE EVERY CONCRETE DETAIL. Specific nouns, named items, places, foods, products, times, dates, numbers, people, projects, brands. Do NOT generalize. If the source says "hot dogs," the output says "hot dogs," not "food." If the source says "Tuesday at 3pm," the output says "Tuesday at 3pm," not "this week." If the source names "Clocked," the output names "Clocked," not "my startup." If the source says "the 2pm demo," the output says "the 2pm demo," not "the meeting."
- Preserve the writer's actual ideas, claims, and word choices. Tighten sentence structure, clarity, and flow only. Never remove content. Never substitute a general word for a specific one.
- "Tighten" and "remove filler" mean: cut weak transitions, hedging, and throat-clearing. NEVER cut concrete nouns or named entities.
- Do not invent facts, names, dates, links, or commitments that are not in the source.
- Match the casual/formal register already present in the source.`;

const EMAIL_FORMAT = (signOff, name) => `Email format (strict):
- No subject line.
- Line 1: greeting on its own line (e.g. "Hi [Name],").
- Line 2: blank.
- Line 3: one short warm line on its own (e.g. "Hope you've been well.").
- Line 4: blank.
- Body paragraphs, blank line between each.
- Blank line before sign-off.
- Sign-off: "${signOff}," then a single newline then "${name}" (no blank line between them).
- Use real newline characters so spacing is preserved when pasted.`;

function buildProfileBlock(profile) {
  const name = (profile.name || "").trim() || "Kyle";
  const signOff = (profile.signOff || "").trim() || "Best";
  const bio = (profile.bio || "").trim();
  const availabilityLink = (profile.availabilityLink || "").trim();

  const lines = [
    `Writer name: ${name}`,
    `Sign-off word: ${signOff}`
  ];
  if (bio) {
    lines.push(`About the writer (use naturally for context; do NOT list this back in the email): ${bio}`);
  }
  if (availabilityLink) {
    lines.push(`Availability: when offering to meet, write exactly the line "Here's my availability: Link" (use the literal word Link — the app turns it into a clickable hyperlink). Never paste the URL itself.`);
  }
  return { name, signOff, profileText: lines.join("\n") };
}

function buildSystemPrompt({ mode, profile, customInstruction }) {
  const { name, signOff, profileText } = buildProfileBlock(profile);

  let taskHeader;
  let isEmail = true;

  if (mode === "reply") {
    taskHeader = `Task: Write a short, direct reply email FROM ${name} TO the sender of the input message. Address each main point in the incoming message. Do not rewrite or quote the incoming message back — write a fresh reply. The incoming message is your context: reference the specific things the sender mentioned (their specific request, the specific items, dates, places they named).`;
  } else if (mode === "simplify") {
    taskHeader = `Task: Rewrite the input to be simpler and easier to read. Simplification means shorter sentences and clearer phrasing — NOT removing or generalizing specifics. Every concrete detail in the source must appear in the output. Keep the same meaning, voice, register, intent, and every named entity. Cut hedging and throat-clearing only.`;
    isEmail = false;
  } else if (mode === "custom") {
    taskHeader = `Task: Follow this instruction from the writer exactly:\n"${customInstruction || ""}"\n\nIf the instruction conflicts with the voice rules, follow the writer's instruction. Always fix grammar and spelling. Always preserve every concrete detail from the source — the source message is the primary context.`;
    isEmail = false;
  } else {
    // "authentic" (default)
    taskHeader = `Task: Rewrite the input email keeping the writer's voice, meaning, and every concrete detail. The source message is the primary context — every specific noun, named item, time, place, and detail must appear in your output. Tighten sentence structure if long. Clarify wording if vague. Never generalize specifics ("hot dogs" stays as "hot dogs," not "food").`;
  }

  const planStep = `Before writing the final output, silently work through these steps (do NOT include this analysis in the final output):
1. INVENTORY the source. List every concrete detail in the source message: every proper noun, food item, place, time, date, number, project/product/brand name, person, and any specific noun. Every single one of these MUST appear verbatim in your output.
2. Identify the writer's GOAL: what specific outcome or action do they want from the recipient?
3. Identify the recipient and the appropriate tone.
4. Identify the single clearest call to action.
5. Confirm you are preserving the writer's voice, not replacing it with a generic professional tone.
6. After drafting, re-read your output and check: is every concrete detail from step 1 present? If any was dropped or generalized, restore it before finalizing.`;

  const formatBlock = isEmail ? EMAIL_FORMAT(signOff, name) : "";

  const outputContract = `Output contract — return EXACTLY this XML structure and NOTHING else:
<goal>One short sentence: the writer's goal and the action they want from the recipient.</goal>
<output>
[The final ${isEmail ? "email body" : "rewritten text"} here. Plain text. Real newlines. No markdown. No subject line. No commentary.]
</output>`;

  return [
    `You are a writing assistant for ${name}. You always fix grammar and spelling.`,
    profileText,
    VOICE,
    formatBlock,
    taskHeader,
    planStep,
    outputContract
  ].filter(Boolean).join("\n\n");
}

function parseOutput(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  const outputMatch = s.match(/<output>([\s\S]*?)<\/output>/i);
  if (outputMatch) {
    s = outputMatch[1].trim();
  } else {
    s = s.replace(/<goal>[\s\S]*?<\/goal>/gi, "").trim();
    s = s.replace(/^<output>\s*/i, "").replace(/\s*<\/output>\s*$/i, "").trim();
  }
  s = s.replace(/^Subject:\s*[^\n]*\n?/i, "").trim();
  return s;
}

// Prefer the strong model for ChatGPT-grade quality; fall back to mini only if the
// key can't access it, so a quality upgrade never turns into a hard failure.
const PRIMARY_MODEL = "gpt-4o";
const FALLBACK_MODEL = "gpt-4o-mini";

async function oneCall(apiKey, model, systemContent, inputText) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: inputText }
      ]
    })
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && !data.error, status: r.status, data };
}

async function callAI({ apiKey, mode, customInstruction, inputText, profile }) {
  const systemContent = buildSystemPrompt({ mode, profile, customInstruction });

  let res = await oneCall(apiKey, PRIMARY_MODEL, systemContent, inputText);
  if (!res.ok) {
    const err = res.data.error || {};
    const blob = `${err.message || ""} ${err.code || ""} ${err.type || ""}`;
    const modelUnavailable = /model/i.test(blob) && /(not|exist|access|permission|deprecat)/i.test(blob);
    if (modelUnavailable) res = await oneCall(apiKey, FALLBACK_MODEL, systemContent, inputText);
  }
  if (!res.ok) {
    throw new Error((res.data.error && res.data.error.message) || `OpenAI request failed (${res.status}).`);
  }

  const out = res.data.choices?.[0]?.message?.content;
  if (out == null) throw new Error("Empty response from the AI.");
  const parsed = parseOutput(out);
  if (!parsed) throw new Error("The AI returned no usable text. Try again.");
  return parsed;
}

// Turn raw API/network errors into short, actionable messages for the panel.
function friendlyError(e) {
  const msg = (e && e.message) ? String(e.message) : String(e || "Something went wrong.");
  const low = msg.toLowerCase();
  if (low.includes("failed to fetch") || low.includes("networkerror") || low.includes("network error")) {
    return "Couldn't reach OpenAI. Check your internet connection and try again.";
  }
  if (low.includes("401") || low.includes("unauthorized") || low.includes("incorrect api key") || (low.includes("api key") && low.includes("invalid"))) {
    return "Your OpenAI API key looks invalid. Update it in the IMPROV dashboard.";
  }
  if (low.includes("quota") || low.includes("insufficient_quota") || low.includes("billing")) {
    return "Your OpenAI account is out of quota. Check billing at platform.openai.com.";
  }
  if (low.includes("429") || low.includes("rate limit")) {
    return "OpenAI is rate-limiting. Wait a few seconds and try again.";
  }
  return msg;
}

self.addEventListener("unhandledrejection", (event) => {
  console.warn("IMPROV: unhandled rejection in background", event?.reason);
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action !== "PROCESS_TEXT") return;
  // Reply on THIS channel (sendResponse). Returning true keeps the port open until
  // we respond, which also keeps the service worker alive through the fetch. This is
  // what prevents the "message port closed" error the old two-channel design caused.
  (async () => {
    let newText = null;
    let error = null;
    let availabilityLink = null;
    try {
      if (!req.selectedText?.trim()) {
        error = "Highlight some text first.";
      } else {
        const { apiKey, profile = {} } = await chrome.storage.local.get(["apiKey", "profile"]);
        availabilityLink = (profile.availabilityLink || "").trim() || null;
        if (!apiKey) {
          error = "Add your OpenAI API key in the IMPROV dashboard to start.";
        } else {
          newText = await callAI({
            apiKey,
            mode: req.mode || "authentic",
            customInstruction: req.customInstruction || null,
            inputText: req.selectedText,
            profile
          });
        }
      }
    } catch (e) {
      error = friendlyError(e);
    }
    try {
      sendResponse({ newText, error, availabilityLink });
    } catch (_) { /* tab navigated away before we could respond; nothing to do */ }
  })();
  return true;
});

// Keyboard shortcut: bring the panel back on the active tab (works even after it's
// been hidden or a preview is open). Gives a reliable "just open it" affordance.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-panel") return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_PANEL" }).catch(() => {});
      }
    } catch (_) {}
  });
}
