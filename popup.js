(function () {
  const clipboardPreview = document.getElementById("clipboard-preview");
  const presets = document.getElementById("presets");
  const useSelectionBtn = document.getElementById("use-selection");
  const resultWrap = document.getElementById("result-wrap");
  const resultBody = document.getElementById("result-body");
  const copyBtn = document.getElementById("copy-result");
  const statusEl = document.getElementById("status");
  const dashboardLink = document.getElementById("open-dashboard");

  let clipboardText = "";
  let lastResult = "";

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("popup-status--hidden", !msg);
    statusEl.classList.toggle("popup-status--error", !!isError);
  }

  function setPresetsEnabled(enabled) {
    presets.querySelectorAll(".popup-preset").forEach((b) => { b.disabled = !enabled; });
  }

  function showResult(text, isError) {
    lastResult = text || "";
    resultBody.textContent = text || "";
    resultBody.classList.toggle("popup-result-body--error", !!isError);
    resultWrap.classList.remove("popup-result-wrap--hidden");
  }

  function hideResult() {
    resultWrap.classList.add("popup-result-wrap--hidden");
    lastResult = "";
  }

  function readClipboard() {
    return navigator.clipboard.readText().then((t) => {
      clipboardText = (t || "").trim();
      const preview = clipboardText ? (clipboardText.slice(0, 120) + (clipboardText.length > 120 ? "…" : "")) : "";
      clipboardPreview.textContent = preview;
      return clipboardText;
    }).catch(() => {
      clipboardText = "";
      clipboardPreview.textContent = "Could not read clipboard.";
      return "";
    });
  }

  function runPrompt(promptId) {
    const text = clipboardText;
    if (!text) {
      setStatus("Copy some text first.", true);
      return;
    }
    hideResult();
    setStatus("Loading…");
    setPresetsEnabled(false);
    chrome.runtime.sendMessage(
      { action: "PROCESS_CLIPBOARD", selectedText: text, promptId: promptId || "email" },
      (response) => {
        setPresetsEnabled(true);
        setStatus("");
        if (chrome.runtime.lastError) {
          setStatus("Extension error.", true);
          showResult("Extension error. Try again.", true);
          return;
        }
        if (response && response.error) {
          showResult(response.error, true);
          return;
        }
        if (response && response.newText != null) {
          showResult(response.newText, false);
        } else {
          showResult("No response from AI.", true);
        }
      }
    );
  }

  presets.addEventListener("click", (e) => {
    const btn = e.target.closest(".popup-preset");
    if (!btn || btn.disabled) return;
    runPrompt(btn.getAttribute("data-prompt"));
  });

  copyBtn.addEventListener("click", () => {
    if (!lastResult) return;
    navigator.clipboard.writeText(lastResult).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy to clipboard"; }, 1500);
    });
  });

  useSelectionBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab || !tab.id) return;
      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) {
        setStatus("Can't use selection on this page.", true);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: "GET_SELECTION" }).then(() => {
        window.close();
      }).catch(() => {
        setStatus("Reload the page and try again.", true);
      });
    });
  });

  dashboardLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "OPEN_OPTIONS" });
    window.close();
  });

  readClipboard();
})();
