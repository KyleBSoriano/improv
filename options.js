const DEFAULT_PRESETS = [
  { id: "authentic", name: "Rewrite", builtIn: true, mode: "authentic" },
  { id: "simplify",  name: "Simplify",          builtIn: true, mode: "simplify"  }
];

const $ = (id) => document.getElementById(id);

const apiKeyEl        = $("api-key");
const apiKeySection   = $("api-key-section");
const profileNameEl   = $("profile-name");
const profileSignoff  = $("profile-signoff");
const availabilityEl  = $("availability-link");
const profileBioEl    = $("profile-bio");
const showHighlightEl = $("show-on-highlight");
const statusEl        = $("status");
const presetsListEl   = $("presets-list");
const addPresetBtn    = $("add-preset-btn");

let saveTimer = null;
let statusTimer = null;
let suppressSave = true; // don't autosave during initial load

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.classList.remove("dash-status--saving", "dash-status--saved", "dash-status--error");
  if (kind) statusEl.classList.add("dash-status--" + kind);
  if (statusTimer) clearTimeout(statusTimer);
  if (kind === "saved") {
    statusTimer = setTimeout(() => { statusEl.textContent = ""; statusEl.classList.remove("dash-status--saved"); }, 1600);
  }
}

function scheduleSave() {
  if (suppressSave) return;
  setStatus("Saving…", "saving");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 350);
}

async function saveNow() {
  try {
    const presets = collectPresets();
    await chrome.storage.local.set({
      // Strip non-ASCII (zero-width spaces, smart quotes) that break the auth header.
      apiKey: apiKeyEl.value.replace(/[^\x21-\x7E]/g, ""),
      profile: {
        name: profileNameEl.value.trim(),
        signOff: profileSignoff.value.trim(),
        availabilityLink: availabilityEl.value.trim(),
        bio: profileBioEl.value.trim()
      },
      presets,
      showOnHighlight: showHighlightEl.checked
    });
    setStatus("Saved", "saved");
    if (apiKeyEl.value.trim()) apiKeySection.classList.add("dash-card--collapsed");
    else apiKeySection.classList.remove("dash-card--collapsed");
  } catch (e) {
    setStatus("Save failed", "error");
    console.warn("IMPROV save failed", e);
  }
}

function wireInput(el) {
  el.addEventListener("input", scheduleSave);
  el.addEventListener("change", scheduleSave);
}

function makePresetRow(preset) {
  const id = preset.id || "custom-" + Date.now();
  const builtIn = !!preset.builtIn;

  const row = document.createElement("div");
  row.className = "dash-preset" + (builtIn ? " dash-preset--builtin" : "");
  row.dataset.id = id;
  row.dataset.builtIn = builtIn ? "true" : "false";
  if (builtIn && preset.mode) row.dataset.mode = preset.mode;

  const top = document.createElement("div");
  top.className = "dash-preset__top";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "dash-input dash-preset__name";
  nameInput.placeholder = "Button label";
  nameInput.value = preset.name || "";
  wireInput(nameInput);
  top.appendChild(nameInput);

  if (!builtIn) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "dash-preset__remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => { row.remove(); scheduleSave(); });
    top.appendChild(removeBtn);
  } else {
    const tag = document.createElement("span");
    tag.className = "dash-preset__tag";
    tag.textContent = "Built-in";
    top.appendChild(tag);
  }
  row.appendChild(top);

  if (builtIn) {
    const note = document.createElement("p");
    note.className = "dash-preset__note";
    note.textContent = `Uses the built-in "${preset.mode || preset.id}" prompt.`;
    row.appendChild(note);
  } else {
    const promptArea = document.createElement("textarea");
    promptArea.className = "dash-input dash-textarea dash-preset__prompt";
    promptArea.placeholder = "Prompt sent to the AI every time. e.g. 'Make this more concise but keep my exact tone.'";
    promptArea.value = preset.prompt || "";
    promptArea.rows = 3;
    wireInput(promptArea);
    row.appendChild(promptArea);
  }

  return row;
}

function renderPresets(presets) {
  presetsListEl.innerHTML = "";
  (presets || []).forEach((p) => presetsListEl.appendChild(makePresetRow(p)));
}

function collectPresets() {
  const rows = presetsListEl.querySelectorAll(".dash-preset");
  return Array.from(rows).map((row) => {
    const builtIn = row.dataset.builtIn === "true";
    const name = (row.querySelector(".dash-preset__name")?.value || "").trim();
    const out = { id: row.dataset.id, name, builtIn };
    if (builtIn) {
      out.mode = row.dataset.mode || row.dataset.id;
    } else {
      out.prompt = (row.querySelector(".dash-preset__prompt")?.value || "").trim();
    }
    return out;
  }).filter((p) => p.name && (p.builtIn || (p.prompt && p.prompt.length)));
}

addPresetBtn.addEventListener("click", () => {
  presetsListEl.appendChild(makePresetRow({ id: "custom-" + Date.now(), name: "", prompt: "", builtIn: false }));
  scheduleSave();
});

[apiKeyEl, profileNameEl, profileSignoff, availabilityEl, profileBioEl, showHighlightEl].forEach(wireInput);

// Flush save when popup is about to close
window.addEventListener("blur", () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } });
window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } });

async function load() {
  try {
    const data = await chrome.storage.local.get(["apiKey", "profile", "presets", "showOnHighlight"]);
    apiKeyEl.value        = data.apiKey || "";
    showHighlightEl.checked = data.showOnHighlight !== false;
    profileNameEl.value   = data.profile?.name || "";
    profileSignoff.value  = data.profile?.signOff || "Best";
    availabilityEl.value  = data.profile?.availabilityLink || "";
    profileBioEl.value    = data.profile?.bio || "";

    if (data.apiKey && data.apiKey.trim()) {
      apiKeySection.classList.add("dash-card--collapsed");
    }

    const presets = ((data.presets && data.presets.length) ? data.presets : DEFAULT_PRESETS).map((p) => {
      if (p && p.builtIn && p.id === "authentic" && p.name === "Authentic Rewrite") return { ...p, name: "Rewrite" };
      return p;
    });
    renderPresets(presets);
  } catch (e) {
    renderPresets(DEFAULT_PRESETS);
    setStatus("Load failed", "error");
    console.warn("IMPROV load failed", e);
  } finally {
    // Enable autosave after initial values are populated
    suppressSave = false;
  }
}

// Keep the dashboard in sync if the in-Gmail panel toggles this while the popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.showOnHighlight) {
    showHighlightEl.checked = changes.showOnHighlight.newValue !== false;
  }
});

document.addEventListener("DOMContentLoaded", load);
