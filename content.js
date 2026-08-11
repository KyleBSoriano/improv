(function () {
  const DEFAULT_PRESETS = [
    { id: "authentic", name: "Rewrite", builtIn: true, mode: "authentic" },
    { id: "simplify",  name: "Simplify",          builtIn: true, mode: "simplify"  }
  ];

  let ctx = null;
  let storedCtx = null;
  let onKey = null;
  let selectionOverlay = null;
  let selectionTimeout = null;
  let previewPosition = null;
  let lastAvailabilityLink = null;
  let panelShownAt = 0;
  let lastModeWasReply = false;
  let showOnHighlight = true;
  let toastEl = null;
  let toastTimer = null;

  chrome.storage.local.get(["showOnHighlight"], (r) => {
    if (typeof r.showOnHighlight === "boolean") showOnHighlight = r.showOnHighlight;
  });

  function modal() { return document.getElementById("ai-replacer-preview"); }

  let dashboardEl = null;
  function openDashboardModal() {
    if (dashboardEl && document.body.contains(dashboardEl)) {
      dashboardEl.classList.remove("improv-dashboard-modal--hidden");
      return;
    }
    dashboardEl = document.createElement("div");
    dashboardEl.id = "improv-dashboard-modal";
    dashboardEl.className = "improv-dashboard-modal";
    dashboardEl.innerHTML = [
      '<div class="improv-dashboard-modal__backdrop"></div>',
      '<div class="improv-dashboard-modal__sheet">',
      '  <button type="button" class="improv-dashboard-modal__close" aria-label="Close">×</button>',
      '  <iframe class="improv-dashboard-modal__iframe" src="' + chrome.runtime.getURL("options.html") + '"></iframe>',
      '</div>'
    ].join("");
    document.body.appendChild(dashboardEl);
    const close = () => {
      if (dashboardEl) dashboardEl.classList.add("improv-dashboard-modal--hidden");
    };
    dashboardEl.querySelector(".improv-dashboard-modal__backdrop").addEventListener("click", close);
    dashboardEl.querySelector(".improv-dashboard-modal__close").addEventListener("click", close);
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && dashboardEl && !dashboardEl.classList.contains("improv-dashboard-modal--hidden")) {
        close();
      }
    });
  }

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
    }, 3500);
  }

  function showLoading(on) {
    const loadingEl = document.getElementById("ai-replacer-panel-loading");
    if (!loadingEl) return;
    loadingEl.classList.toggle("ai-replacer-panel__loading--visible", !!on);
    loadingEl.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function clampToViewport(el, margin) {
    margin = margin ?? 24;
    const rect = el.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    let left = Math.max(margin, Math.min(rect.left, w - rect.width - margin));
    let top  = Math.max(margin, Math.min(rect.top,  h - rect.height - margin));
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.bottom = "auto";
    el.style.right = "auto";
  }

  function isUnsupportedEditor() {
    const host = location.hostname || "";
    if (host.endsWith("docs.google.com")) return true;
    return false;
  }

  const EDITABLE_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "number", ""]);
  // Gmail's read-message containers, so highlighting a received email can offer "Reply".
  const GMAIL_MESSAGE_SELECTOR = ".a3s, .adn, .ii";
  const IMPROV_UI_SELECTOR = "#ai-replacer-selection-overlay, #ai-replacer-preview, #improv-dashboard-modal";

  function isGmailHost() {
    return /(^|\.)mail\.google\.com$/.test(location.hostname || "");
  }

  // window.getSelection() is empty for <input>/<textarea>; their selection lives on the
  // element itself. Returns the selected text of a focused, text-bearing field, else "".
  function fieldSelectionText() {
    const a = document.activeElement;
    if ((a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) &&
        a.selectionStart != null && a.selectionEnd > a.selectionStart) {
      if (a instanceof HTMLInputElement && !EDITABLE_INPUT_TYPES.has((a.type || "text").toLowerCase())) return "";
      return a.value.slice(a.selectionStart, a.selectionEnd);
    }
    return "";
  }

  // Is this highlight somewhere we'd actually want to improve copy? True for an editable
  // field / compose box / draft, or a Gmail message you might reply to. False for stray
  // read-only page text, so the panel stays out of the way.
  function isImprovableSelection(sel) {
    // A focused, editable text field: Gmail subject, textareas, text inputs on any page.
    if (fieldSelectionText().trim()) return true;

    if (!sel || !sel.rangeCount) return false;
    const anchor = sel.anchorNode;
    const el = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (!el) return false;

    // Never react to a selection inside our own UI.
    if (el.closest(IMPROV_UI_SELECTOR)) return false;

    // A contenteditable region: Gmail compose/reply body, or any rich-text draft.
    if (el.isContentEditable) return true;

    // A Gmail message you're reading — highlight it to draft a reply.
    if (isGmailHost() && el.closest(GMAIL_MESSAGE_SELECTOR)) return true;

    return false;
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
      '  <div class="ai-replacer-panel__header">',
      '    <span class="ai-replacer-panel__header-title">IMPR' + logoImg + 'V</span>',
      '    <button type="button" class="ai-replacer-panel__dismiss" aria-label="Close">×</button>',
      '  </div>',
      '  <div class="ai-replacer-panel__scroll">',
      '    <div class="ai-replacer-panel__group">',
      '      <span class="ai-replacer-panel__label">Email</span>',
      '      <div class="ai-replacer-panel__presets" id="ai-replacer-presets-builtin"></div>',
      '    </div>',
      '    <div class="ai-replacer-panel__group" id="ai-replacer-custom-group">',
      '      <span class="ai-replacer-panel__label">Custom</span>',
      '      <div class="ai-replacer-panel__presets" id="ai-replacer-presets-custom"></div>',
      '    </div>',
      '    <div class="ai-replacer-panel__group">',
      '      <span class="ai-replacer-panel__label">Reply</span>',
      '      <button type="button" class="ai-replacer-panel__preset ai-replacer-panel__preset--reply" data-mode="reply">Reply</button>',
      '    </div>',
      '    <div class="ai-replacer-panel__custom">',
      '      <textarea class="ai-replacer-panel__input" placeholder="Or type your own prompt..." rows="2"></textarea>',
      '      <button type="button" class="ai-replacer-panel__send" aria-label="Send">↑</button>',
      '    </div>',
      '  </div>',
      '  <div class="ai-replacer-panel__footer">',
      '    <label class="ai-replacer-toggle">',
      '      <input type="checkbox" class="ai-replacer-toggle__input" />',
      '      <span class="ai-replacer-toggle__track"><span class="ai-replacer-toggle__thumb"></span></span>',
      '      <span class="ai-replacer-toggle__label">Show on highlight</span>',
      '    </label>',
      '    <a href="#" class="ai-replacer-panel__dashboard-link">Dashboard</a>',
      '  </div>',
      '  <div class="ai-replacer-panel__loading" id="ai-replacer-panel-loading" aria-hidden="true">',
      '    <span class="ai-replacer-panel__loading-spinner"></span>',
      '    <span class="ai-replacer-panel__loading-text">Thinking…</span>',
      '  </div>',
      '</div>'
    ].join("");

    selectionOverlay.querySelector(".ai-replacer-panel__preset--reply").addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    selectionOverlay.querySelector(".ai-replacer-panel__preset--reply").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      send({ mode: "reply" });
    });

    const sendBtn = selectionOverlay.querySelector(".ai-replacer-panel__send");
    const inputEl = selectionOverlay.querySelector(".ai-replacer-panel__input");
    sendBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    sendBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const custom = inputEl.value.trim();
      if (custom) send({ mode: "custom", customInstruction: custom });
      else send({ mode: "authentic" });
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    const toggle = selectionOverlay.querySelector(".ai-replacer-toggle__input");
    toggle.checked = showOnHighlight;
    toggle.addEventListener("change", () => {
      showOnHighlight = toggle.checked;
      chrome.storage.local.set({ showOnHighlight });
    });

    selectionOverlay.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ai-replacer-panel__input")) return;
      if (e.target.closest("button") || e.target.closest("a") || e.target.closest(".ai-replacer-toggle")) return;
      e.preventDefault();
    }, true);

    selectionOverlay.querySelector(".ai-replacer-panel__dashboard-link").addEventListener("click", (e) => {
      e.preventDefault();
      openDashboardModal();
    });

    selectionOverlay.querySelector(".ai-replacer-panel__dismiss").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      selectionOverlay.classList.add("ai-replacer-selection-overlay--hidden");
    });

    const header = selectionOverlay.querySelector(".ai-replacer-panel__header");
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ai-replacer-panel__dismiss")) return;
      e.preventDefault(); e.stopPropagation();
      const rect = selectionOverlay.getBoundingClientRect();
      selectionOverlay.style.left = rect.left + "px";
      selectionOverlay.style.top = rect.top + "px";
      selectionOverlay.style.bottom = "auto";
      const startX = e.clientX, startY = e.clientY;
      const startLeft = rect.left, startTop = rect.top;
      function onMove(ev) {
        selectionOverlay.style.left = (startLeft + ev.clientX - startX) + "px";
        selectionOverlay.style.top  = (startTop  + ev.clientY - startY) + "px";
        clampToViewport(selectionOverlay);
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    document.body.appendChild(selectionOverlay);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => selectionOverlay.classList.remove("ai-replacer-selection-overlay--anim-in"));
    });

    ensureModal();
    refreshPresets();
    return selectionOverlay;
  }

  function refreshPresets() {
    const builtinContainer = document.getElementById("ai-replacer-presets-builtin");
    const customContainer  = document.getElementById("ai-replacer-presets-custom");
    const customGroup      = document.getElementById("ai-replacer-custom-group");
    if (!builtinContainer || !customContainer) return;

    chrome.storage.local.get(["presets"], (result) => {
      const presets = ((result.presets && result.presets.length) ? result.presets : DEFAULT_PRESETS).map((p) => {
        if (p && p.builtIn && p.id === "authentic" && p.name === "Authentic Rewrite") return { ...p, name: "Rewrite" };
        return p;
      });

      builtinContainer.innerHTML = "";
      customContainer.innerHTML = "";

      let hasCustom = false;
      presets.forEach((preset) => {
        const name = (preset.name || "").trim();
        if (!name) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-replacer-panel__preset" + (preset.builtIn ? "" : " ai-replacer-panel__preset--custom");
        btn.textContent = name;
        btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        btn.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          if (preset.builtIn) {
            send({ mode: preset.mode || preset.id || "authentic" });
          } else {
            const instruction = (preset.prompt || "").trim();
            if (!instruction) return;
            send({ mode: "custom", customInstruction: instruction });
          }
        });
        if (preset.builtIn) {
          builtinContainer.appendChild(btn);
        } else {
          customContainer.appendChild(btn);
          hasCustom = true;
        }
      });

      if (customGroup) customGroup.style.display = hasCustom ? "" : "none";
    });
  }

  function updateSelectionOverlayVisibility() {
    try {
      if (!document.body) return;
      const el = document.getElementById("ai-replacer-selection-overlay");
      const focusInsidePanel = el && el.contains(document.activeElement);
      if (focusInsidePanel) return;

      const sel = window.getSelection();
      const text = (sel ? sel.toString().trim() : "") || fieldSelectionText().trim();
      const previewOpen = modal() && !modal().classList.contains("ai-replacer-preview--hidden");
      const recentlyShown = Date.now() - panelShownAt < 400;

      if (!text || previewOpen) {
        if (el && (!recentlyShown || previewOpen)) el.classList.add("ai-replacer-selection-overlay--hidden");
        return;
      }

      if (!showOnHighlight) return;

      // Only open where improving copy is the point — an editable field/draft, or a Gmail
      // message you might reply to. Ignore stray highlights of read-only page text.
      if (!isImprovableSelection(sel)) {
        if (el && !recentlyShown) el.classList.add("ai-replacer-selection-overlay--hidden");
        return;
      }

      storedCtx = capture() || { type: "text", text };

      const overlayEl = getSelectionOverlay();
      overlayEl.classList.remove("ai-replacer-selection-overlay--hidden");
      panelShownAt = Date.now();
      refreshPresets();
      const input = overlayEl.querySelector(".ai-replacer-panel__input");
      if (input) input.value = "";
    } catch (err) {}
  }

  function send({ mode, customInstruction }) {
    const ctxToUse = storedCtx || capture();
    if (!ctxToUse) {
      showToast("Highlight some text first.");
      return;
    }
    ctx = ctxToUse;

    let selectedText = "";
    if (ctx.type === "field") selectedText = ctx.el.value.slice(ctx.start, ctx.end);
    else if (ctx.type === "text") selectedText = ctx.text || "";
    else if (ctx.range) selectedText = ctx.range.toString();
    if (!selectedText.trim()) {
      showToast("Highlight some text first.");
      return;
    }

    const overlay = document.getElementById("ai-replacer-selection-overlay");
    if (overlay) previewPosition = overlay.getBoundingClientRect();
    showLoading(true);
    lastModeWasReply = (mode === "reply");

    // The only genuine "needs a refresh" case left is the extension being reloaded/
    // updated while this Gmail tab stayed open (context invalidated). Everything else
    // now comes back as a normal result on this same channel.
    const STALE = "IMPROV was updated. Refresh this Gmail tab once to keep using it.";
    let settled = false;
    const finishError = (msg) => {
      if (settled) return;
      settled = true;
      showLoading(false);
      show(null, msg);
    };

    try {
      chrome.runtime.sendMessage(
        { action: "PROCESS_TEXT", selectedText, mode, customInstruction: customInstruction || undefined },
        (resp) => {
          if (settled) return;
          if (chrome.runtime.lastError) { finishError(STALE); return; }
          settled = true;
          showLoading(false);
          lastAvailabilityLink = (resp && resp.availabilityLink) || null;
          const hasContent = resp && (resp.error || (resp.newText != null && String(resp.newText).trim() !== ""));
          if (hasContent) show(resp.newText || "", resp.error, lastAvailabilityLink);
          else show(null, "No response from the AI. Try again.");
        }
      );
    } catch (e) {
      finishError(STALE);
    }
  }

  document.addEventListener("selectionchange", () => {
    if (selectionTimeout) clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(() => updateSelectionOverlayVisibility(), 25);
  });
  document.addEventListener("mouseup", () => {
    if (selectionTimeout) clearTimeout(selectionTimeout);
    selectionTimeout = null;
    updateSelectionOverlayVisibility();
  });

  function ensureModal() {
    if (modal()) return modal();
    const el = document.createElement("div");
    el.id = "ai-replacer-preview";
    el.className = "ai-replacer-preview ai-replacer-preview--hidden";
    el.tabIndex = -1;
    el.innerHTML = [
      '<div class="ai-replacer-preview__header">',
      '  <span class="ai-replacer-preview__title">Preview</span>',
      '  <button type="button" class="ai-replacer-preview__dismiss" aria-label="Dismiss">×</button>',
      '</div>',
      '<div class="ai-replacer-preview__body"></div>',
      '<div class="ai-replacer-preview__footer">',
      '  <button type="button" class="ai-replacer-preview__replace">Replace</button>',
      '</div>'
    ].join("");
    el.querySelector(".ai-replacer-preview__dismiss").addEventListener("click", (e) => { e.preventDefault(); close(); });
    el.querySelector(".ai-replacer-preview__replace").addEventListener("click", (e) => { e.preventDefault(); confirmAction(); });
    document.body.appendChild(el);
    return el;
  }

  function confirmAction() {
    if (lastModeWasReply) copyResult();
    else replace();
  }

  function copyResult() {
    const m = modal();
    const body = m && m.querySelector(".ai-replacer-preview__body");
    if (!body || body.classList.contains("ai-replacer-preview__body--error")) return;
    let text = (body.textContent || "").trim();
    if (!text) return;
    if (lastAvailabilityLink) {
      text = text.replace(/Here'?s?\s+my\s+availability:\s*Link/gi, "Here's my availability: " + lastAvailabilityLink);
    }
    const done = () => { showToast("Reply copied. Paste into the Gmail reply box."); close(); };
    const fail = () => { showToast("Copy failed. Select the text and copy manually."); };
    try {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } catch (e) {
      fail();
    }
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
      setTimeout(() => updateSelectionOverlayVisibility(), 0);
      return;
    }
    const overlay = document.getElementById("ai-replacer-selection-overlay");
    if (overlay) overlay.classList.add("ai-replacer-selection-overlay--hidden");

    const m = ensureModal();
    if (previewPosition) {
      m.style.left = previewPosition.left + "px";
      m.style.top  = previewPosition.top + "px";
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
    const actionBtn = m.querySelector(".ai-replacer-preview__replace");
    body.classList.toggle("ai-replacer-preview__body--error", !!error);
    footer.classList.toggle("ai-replacer-preview__footer--hidden", !!error);
    if (actionBtn) {
      actionBtn.textContent = lastModeWasReply ? "Copy" : "Replace";
      actionBtn.classList.toggle("ai-replacer-preview__replace--copy", lastModeWasReply);
    }

    const displayText = error || text || "";
    if (availabilityLink && !error) {
      const re = /Here'?s?\s+my\s+availability:\s*Link/gi;
      if (re.test(displayText)) {
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
      requestAnimationFrame(() => m.classList.remove("ai-replacer-preview--anim-in"));
    });
    m.focus();
    body.scrollTop = 0;
    requestAnimationFrame(() => clampToViewport(m));

    if (onKey) document.removeEventListener("keydown", onKey, { capture: true });
    onKey = (e) => {
      if (e.key === "Enter" && !error) { e.preventDefault(); confirmAction(); }
      else if (e.key === "Escape")     { e.preventDefault(); close(); }
    };
    document.addEventListener("keydown", onKey, { capture: true });
  }

  function close() {
    if (onKey) { document.removeEventListener("keydown", onKey, { capture: true }); onKey = null; }
    if (modal()) modal().classList.add("ai-replacer-preview--hidden");
    ctx = null;
    setTimeout(() => updateSelectionOverlayVisibility(), 0);
  }

  function replace() {
    const m = modal();
    const body = m?.querySelector(".ai-replacer-preview__body");
    if (!body) return;
    if (body.classList.contains("ai-replacer-preview__body--error")) return;
    const newText = (body.textContent || "").trim();
    if (!newText) return;

    if (!ctx || ctx.type === "text") {
      showToast("This page doesn't support inline replace. Select the text in a Gmail compose, Notes, or a regular text field.");
      return;
    }
    if (isUnsupportedEditor()) {
      showToast("Inline replace isn't supported in Google Docs. Use this in Gmail or another standard editor.");
      return;
    }
    if (!applyReplace(newText)) {
      showToast("Couldn't replace the selection. The text may have moved or this editor doesn't support inline edits.");
      return;
    }
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
            const after  = line.slice(match.index + match[0].length);
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
      // Fields first: their selection lives on the element, not window.getSelection().
      const active = document.activeElement;
      if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
          active.selectionStart != null && active.selectionEnd > active.selectionStart) {
        const okInput = !(active instanceof HTMLInputElement) ||
          EDITABLE_INPUT_TYPES.has((active.type || "text").toLowerCase());
        if (okInput) {
          return { type: "field", el: active, start: active.selectionStart, end: active.selectionEnd };
        }
      }
      const sel = window.getSelection();
      if (!sel) return null;
      const text = sel.toString().trim();
      if (!text) return null;
      if (sel.rangeCount) return { type: "range", range: sel.getRangeAt(0).cloneRange() };
    } catch (e) {}
    return null;
  }

  // Manual open (keyboard shortcut → background → here). Always brings the panel back,
  // even if it was hidden or a preview is currently showing.
  function openPanelManually() {
    try {
      if (!document.body) return;
      const m = modal();
      if (m && !m.classList.contains("ai-replacer-preview--hidden")) close();
      const cap = capture();
      if (cap) storedCtx = cap;
      const overlayEl = getSelectionOverlay();
      overlayEl.classList.remove("ai-replacer-selection-overlay--hidden");
      panelShownAt = Date.now();
      refreshPresets();
      const input = overlayEl.querySelector(".ai-replacer-panel__input");
      if (input && !cap) {
        input.value = "";
        setTimeout(() => { try { input.focus(); } catch (e) {} }, 0);
      }
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener((req) => {
    if (req && req.action === "TOGGLE_PANEL") openPanelManually();
  });
})();
