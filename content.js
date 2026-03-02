(function () {
  let ctx = null;
  let storedCtx = null;
  let onKey = null;
  let selectionOverlay = null;
  let selectionTimeout = null;
  let previewPosition = null;
  let lastAvailabilityLink = null;
  let panelShownAt = 0;
  let lastPromptWasReply = false;
  let toastEl = null;
  let toastTimer = null;

  function modal() { return document.getElementById("ai-replacer-preview"); }

  function showToast(message) {
    if (!message || !document.body) return;
    if (toastTimer) clearTimeout(toastTimer);
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "ai-replacer-toast";
      toastEl.className = "ai-replacer-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add("ai-replacer-toast--visible");
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("ai-replacer-toast--visible");
      toastTimer = null;
    }, 3000);
  }

  function clampToViewport(el, margin) {
    margin = margin ?? 24;
    const rect = el.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    let left = rect.left;
    let top = rect.top;
    left = Math.max(margin, Math.min(left, w - rect.width - margin));
    top = Math.max(margin, Math.min(top, h - rect.height - margin));
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.bottom = "auto";
    el.style.right = "auto";
  }

  function getSelectionOverlay() {
    if (selectionOverlay) return selectionOverlay;
    selectionOverlay = document.createElement("div");
    selectionOverlay.id = "ai-replacer-selection-overlay";
    selectionOverlay.className = "ai-replacer-selection-overlay ai-replacer-selection-overlay--anim-in";
    selectionOverlay.setAttribute("aria-label", "IMPROV");
    let logoImg = "";
    try {
      const logoUrl = chrome.runtime.getURL("assets/logo.png");
      logoImg = '<img src="' + logoUrl + '" class="improv-logo-o" alt="" />';
    } catch (e) {}
    selectionOverlay.innerHTML = [
      '<div class="ai-replacer-panel">',
      '  <div class="ai-replacer-panel__header"><span class="ai-replacer-panel__header-title">IMPR' + logoImg + 'V</span><button type="button" class="ai-replacer-panel__dismiss" aria-label="Close">×</button></div>',
      '  <div class="ai-replacer-panel__scroll">',
      '    <div class="ai-replacer-panel__presets" id="ai-replacer-presets-container"></div>',
      '    <div class="ai-replacer-panel__section">',
      '      <span class="ai-replacer-panel__label">Reply</span>',
      '      <button type="button" class="ai-replacer-panel__preset ai-replacer-panel__preset--reply" data-prompt="reply">Reply</button>',
      '    </div>',
      '    <div class="ai-replacer-panel__custom">',
      '      <textarea class="ai-replacer-panel__input" placeholder="Or type your own prompt..." rows="2"></textarea>',
      '      <button type="button" class="ai-replacer-panel__send">Send</button>',
      '    </div>',
      '    <a href="#" class="ai-replacer-panel__dashboard-link">Dashboard</a>',
      '  </div>',
      '  <div class="ai-replacer-panel__loading" id="ai-replacer-panel-loading" aria-hidden="true"><span class="ai-replacer-panel__loading-spinner"></span><span class="ai-replacer-panel__loading-text">Preview loading</span></div>',
      '</div>'
    ].join("");

    const replyBtn = selectionOverlay.querySelector(".ai-replacer-panel__preset--reply");
    if (replyBtn) {
      replyBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      replyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendWithPrompt("reply", null);
      });
    }
    const sendBtn = selectionOverlay.querySelector(".ai-replacer-panel__send");
    const inputEl = selectionOverlay.querySelector(".ai-replacer-panel__input");
    if (sendBtn) {
      sendBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      sendBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = selectionOverlay.querySelector(".ai-replacer-panel__input");
        const custom = input ? input.value.trim() : "";
        sendWithPrompt(custom ? null : "email", custom || null);
      });
    }
    if (inputEl) {
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendBtn?.click();
        }
      });
    }

    selectionOverlay.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ai-replacer-panel__input")) return;
      if (e.target.closest("button") || e.target.closest("a")) return;
      e.preventDefault();
    }, true);

    selectionOverlay.querySelector(".ai-replacer-panel__dashboard-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: "OPEN_OPTIONS" });
    });

    selectionOverlay.querySelector(".ai-replacer-panel__dismiss")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const overlay = document.getElementById("ai-replacer-selection-overlay");
      if (overlay) overlay.classList.add("ai-replacer-selection-overlay--hidden");
    });
    const header = selectionOverlay.querySelector(".ai-replacer-panel__header");
    header?.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ai-replacer-panel__dismiss")) return;
      e.preventDefault();
      e.stopPropagation();
      const overlay = selectionOverlay;
      const rect = overlay.getBoundingClientRect();
      overlay.style.left = rect.left + "px";
      overlay.style.top = rect.top + "px";
      overlay.style.bottom = "auto";
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;
      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        overlay.style.left = (startLeft + dx) + "px";
        overlay.style.top = (startTop + dy) + "px";
        clampToViewport(overlay);
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    if (!document.body.contains(selectionOverlay)) {
      document.body.appendChild(selectionOverlay);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { selectionOverlay.classList.remove("ai-replacer-selection-overlay--anim-in"); });
      });
    }
    ensureModal();
    refreshPresets();
    return selectionOverlay;
  }

  const DEFAULT_PRESETS = [
    { id: "email", name: "Formal", builtIn: true },
    { id: "simplify", name: "Simplify", builtIn: true },
    { id: "professional", name: "Improve", builtIn: true }
  ];

  function refreshPresets() {
    const container = document.getElementById("ai-replacer-presets-container");
    if (!container) return;
    chrome.storage.local.get(["presets"], (result) => {
      const presets = result.presets !== undefined ? (result.presets || []) : DEFAULT_PRESETS;
      container.innerHTML = "";
      presets.forEach((preset) => {
        if (!(preset.name && preset.name.trim())) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-replacer-panel__preset" + (preset.builtIn ? "" : " ai-replacer-panel__preset--custom");
        btn.textContent = preset.name.trim();
        btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (preset.builtIn) sendWithPrompt(preset.id, null);
          else sendWithPrompt(null, (preset.prompt || "").trim() || null);
        });
        container.appendChild(btn);
      });
    });
  }

  function updateSelectionOverlayVisibility() {
    try {
      if (!document.body) return;
      const el = document.getElementById("ai-replacer-selection-overlay");
      const focusInsidePanel = el && el.contains(document.activeElement);
      if (focusInsidePanel) return;

      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      const previewOpen = modal() && !modal().classList.contains("ai-replacer-preview--hidden");
      const recentlyShown = Date.now() - panelShownAt < 400;
      if (!text || previewOpen) {
        if (el && (!recentlyShown || previewOpen)) el.classList.add("ai-replacer-selection-overlay--hidden");
        return;
      }
      storedCtx = capture();
      if (!storedCtx) {
        storedCtx = { type: "text", text: text };
      }
      const overlayEl = getSelectionOverlay();
      overlayEl.classList.remove("ai-replacer-selection-overlay--hidden");
      panelShownAt = Date.now();
      refreshPresets();
      const input = overlayEl.querySelector(".ai-replacer-panel__input");
      if (input) input.value = "";
    } catch (err) {}
  }

  function sendWithPrompt(promptId, customPrompt) {
    const ctxToUse = storedCtx || capture();
    if (!ctxToUse) return;
    ctx = ctxToUse;
    let selectedText = "";
    if (ctx.type === "field") selectedText = ctx.el.value.slice(ctx.start, ctx.end);
    else if (ctx.type === "text") selectedText = ctx.text || "";
    else if (ctx.range) selectedText = ctx.range.toString();
    if (!selectedText.trim()) return;
    const overlay = document.getElementById("ai-replacer-selection-overlay");
    const loadingEl = document.getElementById("ai-replacer-panel-loading");
    if (overlay) previewPosition = overlay.getBoundingClientRect();
    if (loadingEl) {
      loadingEl.classList.add("ai-replacer-panel__loading--visible");
      loadingEl.setAttribute("aria-hidden", "false");
    }
    const previewAlreadyOpen = modal() && !modal().classList.contains("ai-replacer-preview--hidden");
    if (previewAlreadyOpen) return;
    lastPromptWasReply = (promptId === "reply");
    try {
      chrome.runtime.sendMessage({
        action: "PROCESS_TEXT",
        selectedText,
        promptId: promptId || undefined,
        customPrompt: (typeof customPrompt === "string" && customPrompt.trim()) ? customPrompt.trim() : undefined
      }, () => {
        if (chrome.runtime.lastError) {
          if (loadingEl) {
            loadingEl.classList.remove("ai-replacer-panel__loading--visible");
            loadingEl.setAttribute("aria-hidden", "true");
          }
          showToast("Extension error. Reload the page and try again.");
        }
      });
    } catch (e) {
      if (loadingEl) {
        loadingEl.classList.remove("ai-replacer-panel__loading--visible");
        loadingEl.setAttribute("aria-hidden", "true");
      }
      showToast("Extension error. Reload the page and try again.");
    }
  }

  function runFromSelection() {
    sendWithPrompt("email", null);
  }

  document.addEventListener("selectionchange", () => {
    if (selectionTimeout) clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(updateSelectionOverlayVisibility, 25);
  });
  document.addEventListener("mouseup", (e) => {
    if (selectionTimeout) clearTimeout(selectionTimeout);
    selectionTimeout = null;
    updateSelectionOverlayVisibility();
  });

  function ensureModal() {
    if (modal()) return modal();
    const el = document.createElement("div");
    el.id = "ai-replacer-preview";
    el.className = "ai-replacer-preview";
    el.tabIndex = -1;
    el.innerHTML = [
      '<div class="ai-replacer-preview__header">',
      '  <span class="ai-replacer-preview__title">Preview</span>',
      '  <button type="button" class="ai-replacer-preview__dismiss" aria-label="Dismiss">×</button>',
      '</div>',
      '<div class="ai-replacer-preview__body"></div>',
      '<div class="ai-replacer-preview__footer">',
      '  <button type="button" class="ai-replacer-preview__copy" title="Copy to paste in draft">Copy</button>',
      '  <button type="button" class="ai-replacer-preview__replace">Replace</button>',
      '</div>'
    ].join("");
    el.querySelector(".ai-replacer-preview__dismiss")?.addEventListener("click", (e) => { e.preventDefault(); close(); });
    el.querySelector(".ai-replacer-preview__replace")?.addEventListener("click", (e) => { e.preventDefault(); replace(); close(); });
    el.querySelector(".ai-replacer-preview__copy")?.addEventListener("click", (e) => {
      e.preventDefault();
      const body = el.querySelector(".ai-replacer-preview__body");
      if (body && !body.classList.contains("ai-replacer-preview__body--error")) {
        const text = (body.textContent || "").trim();
        if (!text) return;
        const availabilityLink = lastAvailabilityLink || null;
        const plainText = text;
        let htmlForClipboard = escapeHtml(plainText).replace(/\n/g, "<br>");
        if (availabilityLink && /Here'?s?\s+my\s+availability:\s*Link/i.test(text)) {
          htmlForClipboard = htmlForClipboard.replace(
            /Here's my availability: Link/gi,
            'Here\'s my availability: <a href="' + escapeHtml(availabilityLink) + '" target="_blank" rel="noopener">Link</a>'
          );
        }
        const copyHtml = "<div style=\"white-space: pre-wrap;\">" + htmlForClipboard + "</div>";
        const done = () => {
          const btn = el.querySelector(".ai-replacer-preview__copy");
          if (btn) { const prev = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = prev; }, 1500); }
        };
        if (navigator.clipboard.write) {
          navigator.clipboard.write([
            new ClipboardItem({ "text/plain": new Blob([plainText], { type: "text/plain" }), "text/html": new Blob([copyHtml], { type: "text/html" }) })
          ]).then(done).catch(() => navigator.clipboard.writeText(plainText).then(done));
        } else {
          navigator.clipboard.writeText(plainText).then(done);
        }
      }
    });
    el.addEventListener("click", (e) => { e.target.closest(".ai-replacer-preview") && el.focus(); });
    el.classList.add("ai-replacer-preview--hidden");
    document.body.appendChild(el);
    return el;
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function show(text, error, availabilityLink) {
    const raw = (error || text || "").trim();
    if (!raw) {
      const m = modal();
      if (m) m.classList.add("ai-replacer-preview--hidden");
      setTimeout(updateSelectionOverlayVisibility, 0);
      return;
    }
    const overlay = document.getElementById("ai-replacer-selection-overlay");
    if (overlay) overlay.classList.add("ai-replacer-selection-overlay--hidden");
    const m = ensureModal();
    if (previewPosition) {
      m.style.left = previewPosition.left + "px";
      m.style.top = previewPosition.top + "px";
      m.style.right = "auto";
      m.style.bottom = "auto";
    } else {
      m.style.left = "24px";
      m.style.bottom = "24px";
      m.style.top = "auto";
      m.style.right = "auto";
    }
    const body = m.querySelector(".ai-replacer-preview__body");
    const footer = m.querySelector(".ai-replacer-preview__footer");
    body.classList.toggle("ai-replacer-preview__body--error", !!error);
    if (footer) {
      footer.classList.toggle("ai-replacer-preview__footer--hidden", !!error);
      footer.classList.toggle("ai-replacer-preview__footer--reply", !error && lastPromptWasReply);
    }
    const displayText = error || text || "";
    if (availabilityLink && !error) {
      const availabilityPhrase = /Here'?s?\s+my\s+availability:\s*Link/gi;
      if (availabilityPhrase.test(displayText)) {
        const escaped = escapeHtml(displayText);
        const linkHtml = 'Here\'s my availability: <a href="' + escapeHtml(availabilityLink) + '" target="_blank" rel="noopener" class="ai-replacer-preview__availability-link">Link</a>';
        body.innerHTML = escaped.replace(/Here'?s?\s+my\s+availability:\s*Link/gi, linkHtml);
      } else {
        body.textContent = displayText;
      }
    } else {
      body.textContent = displayText;
    }
    m.classList.add("ai-replacer-preview--anim-in");
    m.classList.remove("ai-replacer-preview--hidden");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { m.classList.remove("ai-replacer-preview--anim-in"); });
    });
    m.focus();
    if (body) body.scrollTop = 0;
    requestAnimationFrame(() => { clampToViewport(m); });
    if (onKey) document.removeEventListener("keydown", onKey, { capture: true });
    onKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (lastPromptWasReply) {
          const b = m.querySelector(".ai-replacer-preview__body");
          const t = b && (b.textContent || "").trim();
          if (t) {
            const plainWithUrl = lastAvailabilityLink ? t.replace(/Here'?s?\s+my\s+availability:\s*Link/gi, "Here's my availability: " + lastAvailabilityLink) : t;
            navigator.clipboard.writeText(plainWithUrl).then(() => close());
          } else close();
        } else {
          replace();
          close();
        }
      } else if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    document.addEventListener("keydown", onKey, { capture: true });
  }

  function close() {
    if (onKey) { document.removeEventListener("keydown", onKey, { capture: true }); onKey = null; }
    if (modal()) modal().classList.add("ai-replacer-preview--hidden");
    ctx = null;
    setTimeout(updateSelectionOverlayVisibility, 0);
  }

  function replace() {
    if (!ctx) return;
    if (ctx.type === "text") {
      showToast("Replace not available for this selection. Use Copy instead.");
      return;
    }
    const m = modal();
    const body = m?.querySelector(".ai-replacer-preview__body");
    if (!body) return;
    if (body.classList.contains("ai-replacer-preview__body--error")) return;
    let newText = (body.textContent || "").trim();
    if (!newText) return;
    if (!applyReplace(newText)) showToast("Replace failed. Selection may have changed.");
    close();
  }

  function applyReplace(newText) {
    if (!ctx || !newText) return false;
    if (ctx.type === "text") return false;
    const availabilityLink = lastAvailabilityLink || null;
    let text = String(newText).trim();
    if (ctx.type === "field" && availabilityLink) {
      text = text.replace(/Here'?s?\s+my\s+availability:\s*Link/gi, "Here's my availability: " + availabilityLink);
    }
    try {
      if (ctx.type === "field") {
        if (!document.contains(ctx.el)) return false;
        const { el, start, end } = ctx;
        el.value = el.value.slice(0, start) + text + el.value.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      const range = ctx.range;
      if (!range.startContainer || !document.contains(range.startContainer)) return false;
      try {
        range.deleteContents();
        const fragment = document.createDocumentFragment();
        const availabilityRe = /Here'?s?\s+my\s+availability:\s*Link/gi;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          availabilityRe.lastIndex = 0;
          const match = availabilityRe.exec(line);
          if (availabilityLink && match) {
            const before = line.slice(0, match.index);
            const after = line.slice(match.index + match[0].length);
            if (before) fragment.appendChild(document.createTextNode(before));
            const a = document.createElement("a");
            a.href = availabilityLink;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = "Link";
            fragment.appendChild(a);
            if (after) fragment.appendChild(document.createTextNode(after));
          } else {
            fragment.appendChild(document.createTextNode(line));
          }
          if (i < lines.length - 1) fragment.appendChild(document.createElement("br"));
        }
        range.insertNode(fragment);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        return true;
      } catch (err) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          sel.removeAllRanges();
          sel.addRange(ctx.range);
          if (document.execCommand("insertText", false, text)) return true;
        }
        throw err;
      }
    } catch (e) {
      return false;
    }
  }

  function capture() {
    try {
      const sel = window.getSelection();
      if (!sel) return null;
      const text = sel.toString().trim();
      if (!text) return null;
      const active = document.activeElement;
      if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.selectionStart != null) {
        return { type: "field", el: active, start: active.selectionStart, end: active.selectionEnd };
      }
      if (sel.rangeCount) return { type: "range", range: sel.getRangeAt(0).cloneRange() };
    } catch (e) {}
    return null;
  }

  chrome.runtime.onMessage.addListener((req) => {
    if (req.action === "GET_SELECTION") {
      runFromSelection();
    } else if (req.action === "SHOW_PREVIEW") {
      const loadingEl = document.getElementById("ai-replacer-panel-loading");
      if (loadingEl) {
        loadingEl.classList.remove("ai-replacer-panel__loading--visible");
        loadingEl.setAttribute("aria-hidden", "true");
      }
      const overlay = document.getElementById("ai-replacer-selection-overlay");
      if (overlay) overlay.classList.add("ai-replacer-selection-overlay--hidden");
      lastAvailabilityLink = req.availabilityLink || null;
      const hasContent = req.error || (req.newText != null && String(req.newText).trim() !== "");
      if (hasContent) {
        show(req.newText != null ? req.newText : "", req.error, lastAvailabilityLink);
      } else {
        show(null, "No response from AI.");
      }
    }
  });
})();
