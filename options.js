const DEFAULT_PRESETS = [
  { id: "email", name: "Formal", builtIn: true },
  { id: "simplify", name: "Simplify", builtIn: true },
  { id: "professional", name: "Improve", builtIn: true }
];

const saveBtn = document.getElementById("save-btn");
const apiKeyEl = document.getElementById("api-key");
const profileNameEl = document.getElementById("profile-name");
const profileSignoffEl = document.getElementById("profile-signoff");
const availabilityLinkEl = document.getElementById("availability-link");
const profileBioEl = document.getElementById("profile-bio");
const statusEl = document.getElementById("status");
const presetsListEl = document.getElementById("presets-list");
const addPresetBtn = document.getElementById("add-preset-btn");
const apiKeySectionEl = document.getElementById("api-key-section");

function makePresetRow(preset) {
  const id = preset.id || "custom-" + Date.now();
  const builtIn = !!preset.builtIn;
  const row = document.createElement("div");
  row.className = "custom-preset-row";
  row.dataset.id = id;
  row.dataset.builtIn = builtIn ? "true" : "false";
  const top = document.createElement("div");
  top.className = "custom-preset-row__top";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "dashboard-field__input custom-preset-name";
  nameInput.placeholder = "Button label";
  nameInput.value = preset.name || "";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "custom-preset-row__remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => row.remove());
  top.appendChild(nameInput);
  top.appendChild(removeBtn);
  row.appendChild(top);
  if (builtIn) {
    const builtInNote = document.createElement("p");
    builtInNote.className = "custom-preset-row__builtin";
    builtInNote.textContent = "Uses built-in prompt";
    row.appendChild(builtInNote);
  } else {
    const promptArea = document.createElement("textarea");
    promptArea.className = "dashboard-field__input dashboard-field__textarea custom-preset-prompt";
    promptArea.placeholder = "Prompt sent to the AI every time (e.g. Improve for Clocked: focus on time management...)";
    promptArea.value = preset.prompt || "";
    row.appendChild(promptArea);
  }
  return row;
}

function renderPresets(presets) {
  presetsListEl.innerHTML = "";
  (presets || []).forEach((p) => presetsListEl.appendChild(makePresetRow(p)));
}

function collectPresets() {
  const rows = presetsListEl.querySelectorAll(".custom-preset-row");
  return Array.from(rows).map((row) => {
    const builtIn = row.dataset.builtIn === "true";
    const name = (row.querySelector(".custom-preset-name")?.value || "").trim();
    const out = { id: row.dataset.id, name, builtIn };
    if (!builtIn) out.prompt = (row.querySelector(".custom-preset-prompt")?.value || "").trim();
    return out;
  }).filter((p) => (p.name && p.name.trim()) || (!p.builtIn && (p.prompt || "").trim()));
}

document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get(["apiKey", "profile", "presets", "customPresets"]);
  apiKeyEl.value = data.apiKey || "";
  profileNameEl.value = data.profile?.name || "";
  profileSignoffEl.value = data.profile?.signOff || "Best";
  availabilityLinkEl.value = data.profile?.availabilityLink || "";
  profileBioEl.value = data.profile?.bio || "";

  if (apiKeySectionEl && data.apiKey && data.apiKey.trim()) {
    apiKeySectionEl.style.display = "none";
  }

  let presets = data.presets;
  if (!presets || presets.length === 0) {
    presets = [...DEFAULT_PRESETS];
    if (data.customPresets?.length) {
      presets = presets.concat(data.customPresets.map((p) => ({ ...p, builtIn: false })));
    }
  }
  renderPresets(presets);
});

addPresetBtn.addEventListener("click", () => {
  presetsListEl.appendChild(makePresetRow({ id: "custom-" + Date.now(), name: "", prompt: "", builtIn: false }));
});

saveBtn.addEventListener("click", async () => {
  const presets = collectPresets();
  await chrome.storage.local.set({
    apiKey: apiKeyEl.value.trim(),
    profile: {
      name: profileNameEl.value.trim(),
      signOff: profileSignoffEl.value.trim(),
      availabilityLink: availabilityLinkEl.value.trim(),
      bio: profileBioEl.value.trim()
    },
    presets
  });
  statusEl.textContent = "Saved.";
  statusEl.style.color = "#0a7";
  setTimeout(() => { statusEl.textContent = ""; }, 2000);
});
