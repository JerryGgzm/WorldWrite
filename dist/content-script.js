(function () {
  'use strict';

  const MSG = {
    REWRITE_REQUEST: "REWRITE_REQUEST",
    CANCEL_REQUEST: "CANCEL_REQUEST",
    TEST_CONNECTION: "TEST_CONNECTION",
    CONTEXT_MENU_ACTION: "CONTEXT_MENU_ACTION",
    OPEN_OPTIONS: "OPEN_OPTIONS",
    PING_CONTENT: "PING_CONTENT",
    GET_LAST_INSTRUCTION: "GET_LAST_INSTRUCTION",
    SET_LAST_INSTRUCTION: "SET_LAST_INSTRUCTION"
  };

  const ERROR_CODES = {
    NO_TEXT_SELECTED: "NO_TEXT_SELECTED",
    EMPTY_SELECTION: "EMPTY_SELECTION",
    UNSUPPORTED_INPUT: "UNSUPPORTED_INPUT",
    NO_API_KEY: "NO_API_KEY",
    NO_PROVIDER: "NO_PROVIDER",
    SELECTION_CHANGED: "SELECTION_CHANGED",
    CONTENT_SCRIPT_UNAVAILABLE: "CONTENT_SCRIPT_UNAVAILABLE"};
  const USER_MESSAGES = {
    NO_TEXT_SELECTED: "No text selected. Highlight some text first.",
    EMPTY_SELECTION: "The selected text is empty.",
    UNSUPPORTED_INPUT: "This input field is not supported.",
    NO_API_KEY: "No API key configured. Add one in the extension settings.",
    NO_PROVIDER: "No AI provider configured. Open the extension settings.",
    INVALID_API_KEY: "Invalid API key. Check your key in the settings.",
    PROVIDER_REQUEST_FAILED: "Provider request failed. Please try again.",
    MODEL_NOT_FOUND: "Model not found. Check the model name in settings.",
    RATE_LIMITED: "Rate limited by the provider. Wait a moment and retry.",
    REQUEST_TIMEOUT: "Request timed out.",
    REQUEST_CANCELLED: "Request cancelled.",
    EMPTY_RESPONSE: "The AI returned an empty response. Try regenerating.",
    SELECTION_CHANGED: "The selected text changed before replacement. Please re-select.",
    CONTENT_SCRIPT_UNAVAILABLE: "This page does not allow the assistant to run here.",
    UNKNOWN: "Something went wrong. Please try again."
  };
  function userMessageFor(code) {
    return USER_MESSAGES[code] ?? USER_MESSAGES.UNKNOWN;
  }

  const APP_NAME = "WorldWrite";
  const SUB_OUTGOING = "For text you wrote";
  const SUB_INCOMING = "For a message you received";
  function getActionMeta(action, langs) {
    const target = langs.targetLanguage || "the target language";
    const native = langs.nativeLanguage || "your language";
    switch (action) {
      case "translate":
        return outgoing(action, `Translate to ${target}`, "Translation");
      case "polish":
        return outgoing(action, `Polish ${target}`, "Suggestion");
      case "make_professional":
        return outgoing(action, `Make ${target} more professional`, "Suggestion");
      case "explain":
        return incoming(action, "Understand this message", "Meaning");
      case "translate_to_native":
        return incoming(action, `Translate to ${native}`, "Translation");
      case "custom":
      default:
        return outgoing(action, "Custom rewrite", "Suggestion");
    }
  }
  function outgoing(action, title, resultLabel) {
    return {
      action,
      title,
      subtitle: SUB_OUTGOING,
      selectedLabel: "Selected text",
      resultLabel,
      incoming: false,
      canReplace: true
    };
  }
  function incoming(action, title, resultLabel) {
    return {
      action,
      title,
      subtitle: SUB_INCOMING,
      selectedLabel: "Selected message",
      resultLabel,
      incoming: true,
      canReplace: false
    };
  }
  const SITE_HOST_MAP = [
    { match: /mail\.google\.com|outlook\.(live|office)\.com|mail\.proton\.me/, site: "email" },
    { match: /linkedin\.com/, site: "linkedin" },
    { match: /slack\.com/, site: "slack" },
    { match: /github\.com/, site: "github" },
    { match: /(twitter|x)\.com/, site: "twitter" }
  ];
  const REQUEST_TIMEOUT_MS = 15e3;
  const MAX_SELECTION_LENGTH = 12e3;

  const SUPPORTED_INPUT_TYPES = /* @__PURE__ */ new Set([
    "text",
    "search",
    "url",
    "email",
    "tel",
    ""
  ]);
  function isTextField(el) {
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) {
      return SUPPORTED_INPUT_TYPES.has(el.type.toLowerCase());
    }
    return false;
  }
  function isContentEditable(el) {
    return el instanceof HTMLElement && el.isContentEditable;
  }
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }
  function dispatchInput(el, data) {
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "insertText",
        data
      })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  class TextareaAdapter {
    el = null;
    start = 0;
    end = 0;
    originalText = "";
    replacedRange = null;
    canHandle(target) {
      return isTextField(target);
    }
    capture(target) {
      if (!isTextField(target)) return false;
      this.el = target;
      this.start = target.selectionStart ?? 0;
      this.end = target.selectionEnd ?? 0;
      this.originalText = target.value.slice(this.start, this.end);
      return this.originalText.length > 0;
    }
    getSelectedText() {
      return this.originalText || null;
    }
    /** True only if the captured slice still matches the live value. */
    stillValid() {
      if (!this.el) return false;
      return this.el.value.slice(this.start, this.end) === this.originalText;
    }
    replaceSelectedText(newText) {
      if (!this.el || !this.stillValid()) return false;
      const el = this.el;
      const before = el.value.slice(0, this.start);
      const after = el.value.slice(this.end);
      el.focus();
      try {
        el.setSelectionRange(this.start, this.end);
      } catch {
      }
      const inserted = tryExecInsert(newText);
      if (!inserted) {
        setNativeValue(el, before + newText + after);
        dispatchInput(el, newText);
      }
      const caret = this.start + newText.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
      }
      this.replacedRange = {
        start: this.start,
        end: this.start + newText.length,
        text: this.originalText
      };
      return true;
    }
    restoreOriginalText() {
      if (!this.el || !this.replacedRange) return false;
      const el = this.el;
      const { start, end, text } = this.replacedRange;
      if (el.value.slice(start, end) === void 0) return false;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      setNativeValue(el, before + text + after);
      dispatchInput(el, text);
      return true;
    }
  }
  function tryExecInsert(text) {
    try {
      return document.execCommand("insertText", false, text);
    } catch {
      return false;
    }
  }
  class ContentEditableAdapter {
    host = null;
    range = null;
    originalText = "";
    undoRange = null;
    undoText = "";
    canHandle(target) {
      return isContentEditable(target);
    }
    capture(target) {
      if (!isContentEditable(target)) return false;
      const selection = getActiveSelection(target);
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      if (range.collapsed) return false;
      this.host = target;
      this.range = range.cloneRange();
      this.originalText = range.toString();
      return this.originalText.length > 0;
    }
    getSelectedText() {
      return this.originalText || null;
    }
    stillValid() {
      if (!this.range || !this.host) return false;
      if (!this.host.contains(this.range.startContainer) || !this.host.contains(this.range.endContainer)) {
        return false;
      }
      return this.range.toString() === this.originalText;
    }
    replaceSelectedText(newText) {
      if (!this.range || !this.host || !this.stillValid()) return false;
      const selection = getActiveSelection(this.host);
      if (!selection) return false;
      this.host.focus();
      selection.removeAllRanges();
      selection.addRange(this.range);
      const inserted = tryExecInsert(newText);
      if (!inserted) {
        this.range.deleteContents();
        const node = document.createTextNode(newText);
        this.range.insertNode(node);
        const after = document.createRange();
        after.setStartAfter(node);
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
      }
      dispatchInput(this.host, newText);
      const current = selection.getRangeAt(0).cloneRange();
      this.undoRange = current;
      this.undoText = this.originalText;
      return true;
    }
    restoreOriginalText() {
      if (!this.host) return false;
      const selection = getActiveSelection(this.host);
      if (!selection || !this.undoRange) return false;
      this.host.focus();
      selection.removeAllRanges();
      selection.addRange(this.undoRange);
      const inserted = tryExecInsert(this.undoText);
      if (!inserted) {
        this.undoRange.deleteContents();
        this.undoRange.insertNode(document.createTextNode(this.undoText));
      }
      dispatchInput(this.host, this.undoText);
      return true;
    }
  }
  class FallbackSelectionAdapter {
    text = "";
    editable = false;
    range = null;
    canHandle(_target) {
      const sel = window.getSelection();
      return Boolean(sel && sel.toString().trim().length > 0);
    }
    capture(target) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      this.text = sel.toString();
      this.range = sel.getRangeAt(0).cloneRange();
      const node = target instanceof Node ? target : sel.anchorNode ?? null;
      const host = node instanceof HTMLElement ? node : node?.parentElement ?? null;
      this.editable = Boolean(host && host.isContentEditable);
      return this.text.trim().length > 0;
    }
    getSelectedText() {
      return this.text || null;
    }
    replaceSelectedText(newText) {
      if (!this.editable || !this.range) return false;
      const sel = window.getSelection();
      if (!sel) return false;
      if (sel.toString() !== this.text) return false;
      const ok = tryExecInsert(newText);
      return ok;
    }
  }
  function getDeepActiveElement(root = document) {
    let active = root.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }
  function getActiveSelection(el) {
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) {
      const shadowGetSelection = root.getSelection;
      if (typeof shadowGetSelection === "function") {
        const sel = shadowGetSelection.call(root);
        if (sel) return sel;
      }
    }
    return window.getSelection();
  }
  function createAdapterForTarget(target) {
    const candidates = [
      new TextareaAdapter(),
      new ContentEditableAdapter(),
      new FallbackSelectionAdapter()
    ];
    for (const adapter of candidates) {
      if (adapter.canHandle(target) && adapter.capture(target)) {
        return adapter;
      }
    }
    return null;
  }

  class SelectionManager {
    lastTarget = null;
    /** Call from a `contextmenu` listener to remember what was right-clicked. */
    rememberTarget(target) {
      this.lastTarget = target ?? getDeepActiveElement() ?? document.activeElement;
    }
    /**
     * Builds an adapter bound to the remembered target and validates that there
     * is non-empty, in-bounds selected text.
     */
    capture() {
      const target = this.lastTarget ?? getDeepActiveElement() ?? document.activeElement;
      const adapter = createAdapterForTarget(target);
      if (!adapter) {
        const sel = window.getSelection();
        if (!sel || sel.toString().trim().length === 0) {
          return { ok: false, code: ERROR_CODES.NO_TEXT_SELECTED };
        }
        return { ok: false, code: ERROR_CODES.UNSUPPORTED_INPUT };
      }
      const text = adapter.getSelectedText();
      if (text === null) {
        return { ok: false, code: ERROR_CODES.NO_TEXT_SELECTED };
      }
      if (text.trim().length === 0) {
        return { ok: false, code: ERROR_CODES.EMPTY_SELECTION };
      }
      if (text.length > MAX_SELECTION_LENGTH) {
        return { ok: false, code: ERROR_CODES.UNSUPPORTED_INPUT };
      }
      return { ok: true, capture: { adapter, text, target } };
    }
  }

  function tokenize(text) {
    return text.match(/\s+|\S+/g) ?? [];
  }
  function computeWordDiff(a, b) {
    const aTokens = tokenize(a);
    const bTokens = tokenize(b);
    const n = aTokens.length;
    const m = bTokens.length;
    const lcs = Array.from(
      { length: n + 1 },
      () => new Array(m + 1).fill(0)
    );
    for (let i2 = n - 1; i2 >= 0; i2--) {
      for (let j2 = m - 1; j2 >= 0; j2--) {
        lcs[i2][j2] = aTokens[i2] === bTokens[j2] ? lcs[i2 + 1][j2 + 1] + 1 : Math.max(lcs[i2 + 1][j2], lcs[i2][j2 + 1]);
      }
    }
    const parts = [];
    let i = 0;
    let j = 0;
    const push = (type, text) => {
      const last = parts[parts.length - 1];
      if (last && last.type === type) last.text += text;
      else parts.push({ type, text });
    };
    while (i < n && j < m) {
      if (aTokens[i] === bTokens[j]) {
        push("eq", aTokens[i]);
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        push("del", aTokens[i]);
        i++;
      } else {
        push("add", bTokens[j]);
        j++;
      }
    }
    while (i < n) push("del", aTokens[i++]);
    while (j < m) push("add", bTokens[j++]);
    return parts;
  }

  const OUTGOING_TWEAKS = [
    { label: "Shorter", instruction: "Make it shorter and more concise" },
    { label: "Warmer", instruction: "Make it warmer and friendlier" },
    { label: "More formal", instruction: "Make it more formal" },
    { label: "More casual", instruction: "Make it more casual" },
    { label: "Simpler", instruction: "Make it simpler and easier to understand" }
  ];
  const INCOMING_TWEAKS = [
    { label: "Simpler", instruction: "Explain it more simply" },
    { label: "Shorter", instruction: "Make it shorter" },
    { label: "More direct", instruction: "Be more direct and literal" }
  ];
  const DEFAULT_META = {
    action: "polish",
    title: "Polish",
    subtitle: "For text you wrote",
    selectedLabel: "Selected text",
    resultLabel: "Suggestion",
    incoming: false,
    canReplace: true
  };
  const TRUST_NOTE = "Only selected text is sent. Nothing is stored.";
  const OVERLAY_CSS = `
:host { all: initial; }
.wrap {
  position: fixed;
  z-index: 2147483647;
  width: 560px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #e5e7eb;
  background: linear-gradient(180deg, #111827 0%, #0f172a 100%);
  border: 1px solid rgba(148,163,184,0.16);
  border-radius: 20px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.45), 0 4px 16px rgba(0,0,0,0.3);
  overflow: hidden;
  animation: ww-in .17s cubic-bezier(.2,.7,.3,1);
}
@keyframes ww-in {
  from { opacity: 0; transform: translateY(8px) scale(.985); }
  to { opacity: 1; transform: none; }
}
@keyframes ww-fade { from { opacity: .25; } to { opacity: 1; } }
.header, .footer { flex: none; }
.header { padding: 18px 20px 14px; }
.brand-row { display: flex; align-items: center; justify-content: space-between; }
.brand {
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: #a5b4fc; text-transform: none;
}
.close {
  cursor: pointer; border: none; background: transparent; font-size: 18px;
  line-height: 1; color: #64748b; padding: 2px 6px; border-radius: 8px;
}
.close:hover { color: #e5e7eb; background: rgba(255,255,255,0.06); }
.title { font-size: 21px; font-weight: 600; margin-top: 8px; color: #f8fafc; }
.subtitle { font-size: 13px; color: #94a3b8; margin-top: 2px; }
.body { padding: 4px 20px 8px; overflow: auto; flex: 1 1 auto; }
.label {
  font-size: 12px; font-weight: 600; color: #94a3b8;
  margin: 16px 0 6px; letter-spacing: .01em;
}
.surface { border-radius: 14px; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; }
.surface-selected {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  color: #cbd5e1; font-size: 13px;
}
.surface-result {
  background: rgba(129,140,248,0.12);
  border: 1px solid rgba(129,140,248,0.22);
  color: #f1f5f9; font-size: 17px; line-height: 1.55;
  min-height: 24px;
  animation: ww-fade .18s ease;
  transition: background .2s ease, border-color .2s ease;
}
.surface-result.diff ins {
  background: rgba(34,197,94,0.22); color: #bbf7d0; text-decoration: none;
  border-radius: 4px; padding: 0 2px; box-shadow: inset 0 -1px 0 rgba(34,197,94,0.55);
}
.surface-result.diff del {
  background: rgba(239,68,68,0.2); color: #fecaca; text-decoration: line-through;
  border-radius: 4px; padding: 0 2px; opacity: .85;
}
.diff-legend {
  display: flex; gap: 14px; align-items: center; margin-top: 8px;
  font-size: 12px; color: #94a3b8;
}
.diff-legend .add::before { content: ""; display: inline-block; width: 9px; height: 9px;
  border-radius: 3px; background: rgba(34,197,94,0.6); margin-right: 6px; vertical-align: -1px; }
.diff-legend .del::before { content: ""; display: inline-block; width: 9px; height: 9px;
  border-radius: 3px; background: rgba(239,68,68,0.6); margin-right: 6px; vertical-align: -1px; }
/* Localized loading inside the result card */
.sk { display: flex; flex-direction: column; gap: 9px; padding: 3px 0; }
.sk-line {
  height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.14) 37%, rgba(255,255,255,0.06) 63%);
  background-size: 400% 100%; animation: shimmer 1.4s ease infinite;
}
.sk-line.mid { width: 82%; }
.sk-line.short { width: 56%; }
@keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
.loading-note { display: flex; align-items: center; gap: 8px; color: #a5b4fc; font-size: 13px; margin-bottom: 10px; }
.spin {
  width: 13px; height: 13px; border-radius: 50%; flex: none;
  border: 2px solid rgba(165,180,252,0.3); border-top-color: #a5b4fc;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .sk-line, .spin, .wrap, .surface-result { animation-duration: 0s; }
  .btn, .chip { transition-duration: 0s; }
}
.changes-btn {
  margin-top: 8px; background: none; border: none; padding: 0; cursor: pointer;
  color: #94a3b8; font-size: 12px; font-weight: 600;
}
.changes-btn:hover { color: #c7d2fe; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  cursor: pointer; border: none; background: rgba(255,255,255,0.06); color: #e2e8f0;
  height: 32px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
}
.chip:hover { background: rgba(129,140,248,0.22); color: #e0e7ff; }
.chip:disabled { opacity: .45; cursor: default; }
.composer { display: flex; gap: 8px; margin-top: 10px; }
.composer input {
  flex: 1; height: 38px; padding: 0 13px; font-size: 14px; color: #f1f5f9;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; outline: none;
}
.composer input::placeholder { color: #64748b; }
.composer input:focus { border-color: rgba(129,140,248,0.6); }
.trust { font-size: 12px; color: #64748b; margin: 16px 0 4px; display: flex; align-items: center; gap: 6px; }
.trust svg { flex: none; opacity: .8; }
.footer {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 14px 20px 18px; border-top: 1px solid rgba(255,255,255,0.06);
}
.footer-left, .footer-right { display: flex; gap: 8px; }
.btn {
  cursor: pointer; border: 1px solid transparent; font-size: 14px; font-weight: 600;
  padding: 9px 15px; border-radius: 12px;
}
.btn.primary { background: #6366f1; color: #fff; }
.btn.primary:hover { background: #5457e5; }
.btn.ghost { background: rgba(255,255,255,0.06); color: #e2e8f0; }
.btn.ghost:hover { background: rgba(255,255,255,0.12); }
.btn.subtle { background: transparent; color: #94a3b8; }
.btn.subtle:hover { color: #e5e7eb; background: rgba(255,255,255,0.06); }
.btn.send { background: #6366f1; color: #fff; height: 38px; padding: 0 16px; }
.btn.send:hover { background: #5457e5; }
.btn { transition: background .14s ease, transform .08s ease; }
.btn:active:not(:disabled) { transform: translateY(1px); }
.chip { transition: background .14s ease, color .14s ease, transform .08s ease; }
.chip:active:not(:disabled) { transform: scale(.95); }
.close { transition: background .14s ease, color .14s ease; }
.changes-btn { transition: color .14s ease; }
.btn:disabled { opacity: .45; cursor: default; }
.error {
  color: #fecaca; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3);
  border-radius: 12px; padding: 12px 14px; margin-top: 8px; font-size: 14px;
}
.replaced { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
.replaced .ok { color: #86efac; font-weight: 600; }
.hint { font-size: 11px; color: #475569; margin-top: 10px; }
`;
  class Overlay {
    hostEl = null;
    root = null;
    callbacks;
    meta = DEFAULT_META;
    originalText = "";
    suggestion = "";
    showDiff = false;
    hasPreview = false;
    outsideClickHandler = (e) => {
      if (this.hostEl && !e.composedPath().includes(this.hostEl)) {
        this.callbacks.onCancel();
      }
    };
    keyHandler = (e) => {
      if (e.key === "Escape") {
        this.callbacks.onCancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && this.hasPreview && this.meta.canReplace && this.suggestion) {
        e.preventDefault();
        this.callbacks.onReplace();
      }
    };
    autoDismissTimer = null;
    constructor(callbacks) {
      this.callbacks = callbacks;
    }
    isOpen() {
      return this.hostEl !== null;
    }
    /** Sets the task metadata that drives the title, subtitle, and labels. */
    setActionMeta(meta) {
      this.meta = meta;
    }
    show(anchorRect, originalText) {
      this.destroy();
      this.originalText = originalText;
      this.suggestion = "";
      this.showDiff = false;
      this.hasPreview = false;
      const host = document.createElement("div");
      host.setAttribute("data-iaa-overlay", "");
      this.root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = OVERLAY_CSS;
      this.root.appendChild(style);
      const wrap = document.createElement("div");
      wrap.className = "wrap";
      this.root.appendChild(wrap);
      (document.body ?? document.documentElement).appendChild(host);
      this.hostEl = host;
      this.position(anchorRect);
      this.renderLoading();
      setTimeout(() => {
        document.addEventListener("mousedown", this.outsideClickHandler, true);
        document.addEventListener("keydown", this.keyHandler, true);
      }, 0);
    }
    wrap() {
      return this.root?.querySelector(".wrap") ?? null;
    }
    position(anchorRect) {
      const host = this.hostEl;
      if (!host) return;
      const wrap = this.wrap();
      if (!wrap) return;
      const margin = 8;
      const width = 560;
      let top;
      let left;
      if (anchorRect) {
        left = Math.min(
          Math.max(margin, anchorRect.left),
          window.innerWidth - width - margin
        );
        const belowTop = anchorRect.bottom + margin;
        if (belowTop + 260 > window.innerHeight && anchorRect.top > 280) {
          top = Math.max(margin, anchorRect.top - 260 - margin);
        } else {
          top = belowTop;
        }
      } else {
        left = (window.innerWidth - width) / 2;
        top = 80;
      }
      wrap.style.left = `${Math.max(margin, left)}px`;
      wrap.style.top = `${top}px`;
    }
    headerHtml() {
      return `
      <div class="header">
        <div class="brand-row">
          <span class="brand">✦ ${escapeHtml(APP_NAME)}</span>
          <button class="close" data-act="cancel" title="Close">×</button>
        </div>
        <div class="title">${escapeHtml(this.meta.title)}</div>
        <div class="subtitle">${escapeHtml(this.meta.subtitle)}</div>
      </div>`;
    }
    selectedHtml() {
      return `
      <p class="label">${escapeHtml(this.meta.selectedLabel)}</p>
      <div class="surface surface-selected">${escapeHtml(this.originalText)}</div>`;
    }
    loadingCardHtml(note) {
      return `
      <p class="label">${escapeHtml(this.meta.resultLabel)}</p>
      <div class="loading-note"><span class="spin"></span><span class="loading-text">${escapeHtml(
      note
    )}</span></div>
      <div class="surface surface-result" data-role="result">
        <div class="sk" aria-hidden="true">
          <span class="sk-line"></span>
          <span class="sk-line mid"></span>
          <span class="sk-line short"></span>
        </div>
      </div>`;
    }
    trustHtml() {
      return `
      <p class="trust">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        ${escapeHtml(TRUST_NOTE)}
      </p>`;
    }
    renderLoading(note = "Generating…") {
      const wrap = this.wrap();
      if (!wrap) return;
      this.hasPreview = false;
      wrap.innerHTML = `
      ${this.headerHtml()}
      <div class="body">
        ${this.selectedHtml()}
        ${this.loadingCardHtml(note)}
        ${this.trustHtml()}
      </div>
      <div class="footer">
        <div class="footer-left"></div>
        <div class="footer-right">
          <button class="btn subtle" data-act="cancel">Cancel</button>
        </div>
      </div>`;
      this.bind();
    }
    setSlow() {
      const text = this.wrap()?.querySelector(".loading-text");
      if (text) text.textContent = "Still working… this is taking longer than usual.";
      const right = this.wrap()?.querySelector(".footer-right");
      if (right && !right.querySelector('[data-act="regenerate"]')) {
        right.insertAdjacentHTML(
          "afterbegin",
          `<button class="btn ghost" data-act="regenerate">Retry</button>`
        );
        this.bind();
      }
    }
    /** Localized loading for refine/regenerate: only the result card changes. */
    setFollowUpLoading() {
      const card = this.wrap()?.querySelector('[data-role="result"]');
      if (!card) {
        this.renderLoading("Refining…");
        return;
      }
      card.classList.remove("diff");
      card.innerHTML = `<div class="sk" aria-hidden="true"><span class="sk-line"></span><span class="sk-line mid"></span><span class="sk-line short"></span></div>`;
      this.setControlsDisabled(true);
      const note = this.wrap()?.querySelector(".loading-text");
      if (note) note.textContent = "Refining…";
    }
    setControlsDisabled(disabled) {
      this.wrap()?.querySelectorAll(
        '[data-act="chip"],[data-act="followup"],[data-act="copy"],[data-act="regenerate"],[data-act="replace"]'
      ).forEach((b) => {
        b.disabled = disabled;
      });
    }
    setPreview(suggestion) {
      this.suggestion = suggestion;
      this.hasPreview = true;
      const wrap = this.wrap();
      if (!wrap) return;
      const tweaks = this.meta.incoming ? INCOMING_TWEAKS : OUTGOING_TWEAKS;
      const resultBody = this.showDiff ? renderDiff(this.originalText, this.suggestion) : escapeHtml(this.suggestion);
      wrap.innerHTML = `
      ${this.headerHtml()}
      <div class="body">
        ${this.selectedHtml()}
        <p class="label">${escapeHtml(this.meta.resultLabel)}</p>
        <div class="surface surface-result ${this.showDiff ? "diff" : ""}" data-role="result">${resultBody}</div>
        ${this.meta.incoming ? "" : `<button class="changes-btn" data-act="toggle-diff">${this.showDiff ? "Hide changes" : "Show changes"}</button>${this.showDiff ? this.diffLegendHtml() : ""}`}
        <p class="label">Refine</p>
        <div class="chips">
          ${tweaks.map(
      (t) => `<button class="chip" data-act="chip" data-chip="${escapeAttr(
        t.instruction
      )}">${escapeHtml(t.label)}</button>`
    ).join("")}
        </div>
        <div class="composer">
          <input type="text" data-role="followup" placeholder="Add a follow-up instruction…" />
          <button class="btn send" data-act="followup" disabled>Send</button>
        </div>
        ${this.trustHtml()}
      </div>
      <div class="footer">
        <div class="footer-left">
          <button class="btn ghost" data-act="copy">Copy</button>
          <button class="btn ghost" data-act="regenerate">Regenerate</button>
        </div>
        <div class="footer-right">
          ${this.meta.canReplace ? `<button class="btn primary" data-act="replace">Replace</button>` : ""}
          <button class="btn subtle" data-act="cancel">Cancel</button>
        </div>
      </div>`;
      this.bind();
    }
    diffLegendHtml() {
      const { added, removed } = diffCounts(this.originalText, this.suggestion);
      if (added === 0 && removed === 0) {
        return `<div class="diff-legend"><span>No wording changes</span></div>`;
      }
      return `<div class="diff-legend">
      <span class="add">${added} added</span>
      <span class="del">${removed} removed</span>
    </div>`;
    }
    /** Asks the user for a custom instruction before the first generation. */
    setCustomPrompt(prefill = "") {
      const wrap = this.wrap();
      if (!wrap) return;
      this.hasPreview = false;
      wrap.innerHTML = `
      ${this.headerHtml()}
      <div class="body">
        ${this.selectedHtml()}
        <p class="label">Your instruction</p>
        <div class="composer">
          <input type="text" data-role="followup" placeholder="e.g. make it warmer and shorter" value="${escapeAttr(
      prefill
    )}" />
          <button class="btn send" data-act="followup" ${prefill ? "" : "disabled"}>Generate</button>
        </div>
        ${this.trustHtml()}
      </div>
      <div class="footer">
        <div class="footer-left"></div>
        <div class="footer-right">
          <button class="btn subtle" data-act="cancel">Cancel</button>
        </div>
      </div>`;
      this.bind();
      const input = this.wrap()?.querySelector(
        'input[data-role="followup"]'
      );
      input?.focus();
      if (input && prefill) input.setSelectionRange(prefill.length, prefill.length);
    }
    setError(message, opts = {}) {
      const wrap = this.wrap();
      if (!wrap) return;
      this.hasPreview = false;
      wrap.innerHTML = `
      ${this.headerHtml()}
      <div class="body">
        <div class="error">${escapeHtml(message)}</div>
      </div>
      <div class="footer">
        <div class="footer-left"></div>
        <div class="footer-right">
          ${opts.canOpenSettings ? `<button class="btn primary" data-act="open-settings">Open settings</button>` : ""}
          ${opts.canRetry ? `<button class="btn ghost" data-act="regenerate">Retry</button>` : ""}
          <button class="btn subtle" data-act="cancel">Close</button>
        </div>
      </div>`;
      this.bind();
    }
    setReplaced() {
      const wrap = this.wrap();
      if (!wrap) return;
      this.hasPreview = false;
      wrap.innerHTML = `
      ${this.headerHtml()}
      <div class="body">
        <div class="replaced">
          <span class="ok">Replaced</span>
          <span>
            <button class="btn ghost" data-act="undo">Undo</button>
            <button class="btn subtle" data-act="cancel">Dismiss</button>
          </span>
        </div>
      </div>`;
      this.bind();
      this.autoDismissTimer = setTimeout(() => this.callbacks.onCancel(), 5e3);
    }
    copyFeedback() {
      const btn = this.wrap()?.querySelector('[data-act="copy"]');
      if (btn) {
        const original = btn.textContent ?? "Copy";
        btn.textContent = "Copied!";
        setTimeout(() => {
          if (btn) btn.textContent = original;
        }, 1200);
      }
    }
    getFollowUpValue() {
      const input = this.wrap()?.querySelector(
        'input[data-role="followup"]'
      );
      return input?.value.trim() ?? "";
    }
    bind() {
      const wrap = this.wrap();
      if (!wrap) return;
      wrap.querySelectorAll("[data-act]").forEach((el) => {
        el.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (el.hasAttribute("disabled")) return;
          const act = el.getAttribute("data-act");
          switch (act) {
            case "replace":
              this.callbacks.onReplace();
              break;
            case "copy":
              this.callbacks.onCopy();
              break;
            case "cancel":
              this.callbacks.onCancel();
              break;
            case "regenerate":
              this.callbacks.onRegenerate();
              break;
            case "undo":
              this.callbacks.onUndo();
              break;
            case "open-settings":
              this.callbacks.onOpenSettings();
              break;
            case "chip": {
              const instruction = el.getAttribute("data-chip");
              if (instruction) this.callbacks.onFollowUp(instruction);
              break;
            }
            case "followup": {
              const value = this.getFollowUpValue();
              if (value) this.callbacks.onFollowUp(value);
              break;
            }
            case "toggle-diff":
              this.showDiff = !this.showDiff;
              this.setPreview(this.suggestion);
              break;
          }
        };
      });
      const input = wrap.querySelector(
        'input[data-role="followup"]'
      );
      const sendBtn = wrap.querySelector('[data-act="followup"]');
      if (input) {
        const sync = () => {
          if (sendBtn) sendBtn.disabled = input.value.trim().length === 0;
        };
        input.oninput = sync;
        input.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const value = this.getFollowUpValue();
            if (value) this.callbacks.onFollowUp(value);
          }
        };
      }
      this.clampIntoView();
    }
    clampIntoView() {
      const wrap = this.wrap();
      if (!wrap) return;
      const margin = 8;
      const rect = wrap.getBoundingClientRect();
      let top = rect.top;
      const maxTop = window.innerHeight - rect.height - margin;
      if (top > maxTop) top = maxTop;
      if (top < margin) top = margin;
      if (Math.abs(top - rect.top) > 0.5) wrap.style.top = `${top}px`;
    }
    destroy() {
      if (this.autoDismissTimer) {
        clearTimeout(this.autoDismissTimer);
        this.autoDismissTimer = null;
      }
      document.removeEventListener("mousedown", this.outsideClickHandler, true);
      document.removeEventListener("keydown", this.keyHandler, true);
      if (this.hostEl?.parentNode) {
        this.hostEl.parentNode.removeChild(this.hostEl);
      }
      this.hostEl = null;
      this.root = null;
    }
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  function escapeAttr(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function renderDiff(a, b) {
    const parts = computeWordDiff(a, b);
    return parts.map((p) => {
      const safe = escapeHtml(p.text);
      if (p.type === "add") return `<ins>${safe}</ins>`;
      if (p.type === "del") return `<del>${safe}</del>`;
      return safe;
    }).join("");
  }
  function diffCounts(a, b) {
    let added = 0;
    let removed = 0;
    for (const p of computeWordDiff(a, b)) {
      const words = p.text.trim();
      if (!words) continue;
      const n = words.split(/\s+/).length;
      if (p.type === "add") added += n;
      else if (p.type === "del") removed += n;
    }
    return { added, removed };
  }

  const selectionManager = new SelectionManager();
  function detectSiteType() {
    const host = location.hostname;
    for (const { match, site } of SITE_HOST_MAP) {
      if (match.test(host)) return site;
    }
    return "generic";
  }
  function uuid() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function anchorRectFor(capture) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) return rect;
    }
    const target = capture?.target;
    if (target instanceof HTMLElement) return target.getBoundingClientRect();
    const active = document.activeElement;
    if (active instanceof HTMLElement) return active.getBoundingClientRect();
    return null;
  }
  class RewriteController {
    overlay;
    capture = null;
    action = "polish";
    meta = getActionMeta("polish", {
      targetLanguage: "",
      nativeLanguage: ""
    });
    customInstruction;
    currentRequestId = null;
    suggestion = "";
    slowTimer = null;
    awaitingCustomInput = false;
    /**
     * Last custom instruction used for prefilling. Held in memory, and mirrored to
     * local storage via the background worker only when privacy mode is off.
     */
    lastCustomInstruction = "";
    constructor() {
      this.overlay = new Overlay({
        onReplace: () => this.handleReplace(),
        onCopy: () => this.handleCopy(),
        onCancel: () => this.handleCancel(),
        onRegenerate: () => this.handleRegenerate(),
        onFollowUp: (instruction) => this.handleFollowUp(instruction),
        onUndo: () => this.handleUndo(),
        onOpenSettings: () => this.handleOpenSettings()
      });
      void this.primeLastInstruction();
    }
    /** Pulls the persisted instruction (if any) once at startup. */
    async primeLastInstruction() {
      try {
        const resp = await chrome.runtime.sendMessage({
          type: MSG.GET_LAST_INSTRUCTION
        });
        if (resp?.value && !this.lastCustomInstruction) {
          this.lastCustomInstruction = resp.value;
        }
      } catch {
      }
    }
    async start(action, langs) {
      this.abortInFlight();
      this.action = action;
      this.meta = getActionMeta(action, langs);
      this.overlay.setActionMeta(this.meta);
      const result = selectionManager.capture();
      if (!result.ok) {
        const rect2 = anchorRectFor(null);
        this.overlay.show(rect2, "");
        this.overlay.setError(userMessageFor(result.code));
        return;
      }
      this.capture = result.capture;
      this.customInstruction = void 0;
      this.suggestion = "";
      const rect = anchorRectFor(this.capture);
      if (action === "custom") {
        this.awaitingCustomInput = true;
        this.overlay.show(rect, result.capture.text);
        this.overlay.setCustomPrompt(this.lastCustomInstruction);
        return;
      }
      this.awaitingCustomInput = false;
      this.overlay.show(rect, result.capture.text);
      await this.runRewrite(result.capture.text, action, void 0, false);
    }
    async runRewrite(text, action, customInstruction, isFollowUp) {
      const requestId = uuid();
      this.currentRequestId = requestId;
      if (isFollowUp) this.overlay.setFollowUpLoading();
      else if (!this.overlay.isOpen())
        this.overlay.show(anchorRectFor(this.capture), text);
      this.startSlowTimer();
      const payload = {
        selectedText: text,
        action,
        customInstruction,
        siteType: detectSiteType()
      };
      let resp;
      try {
        resp = await chrome.runtime.sendMessage({
          type: MSG.REWRITE_REQUEST,
          requestId,
          payload
        });
      } catch {
        this.clearSlowTimer();
        if (this.currentRequestId === requestId) {
          this.overlay.setError(
            userMessageFor(ERROR_CODES.CONTENT_SCRIPT_UNAVAILABLE),
            { canRetry: true }
          );
        }
        return;
      }
      this.clearSlowTimer();
      if (this.currentRequestId !== requestId) return;
      this.currentRequestId = null;
      if (resp.ok) {
        this.suggestion = resp.text;
        this.overlay.setPreview(resp.text);
      } else {
        const notConfigured = resp.errorCode === ERROR_CODES.NO_API_KEY || resp.errorCode === ERROR_CODES.NO_PROVIDER;
        this.overlay.setError(resp.message || userMessageFor(resp.errorCode), {
          canRetry: !notConfigured,
          canOpenSettings: notConfigured
        });
      }
    }
    startSlowTimer() {
      this.clearSlowTimer();
      this.slowTimer = setTimeout(() => {
        this.overlay.setSlow();
      }, REQUEST_TIMEOUT_MS);
    }
    clearSlowTimer() {
      if (this.slowTimer) {
        clearTimeout(this.slowTimer);
        this.slowTimer = null;
      }
    }
    abortInFlight() {
      this.clearSlowTimer();
      if (this.currentRequestId) {
        void chrome.runtime.sendMessage({
          type: MSG.CANCEL_REQUEST,
          requestId: this.currentRequestId
        }).catch(() => {
        });
        this.currentRequestId = null;
      }
    }
    handleReplace() {
      if (!this.capture || !this.suggestion) return;
      const ok = this.capture.adapter.replaceSelectedText(this.suggestion);
      if (!ok) {
        this.overlay.setError(userMessageFor(ERROR_CODES.SELECTION_CHANGED));
        return;
      }
      this.overlay.setReplaced();
    }
    async handleCopy() {
      if (!this.suggestion) return;
      try {
        await navigator.clipboard.writeText(this.suggestion);
        this.overlay.copyFeedback();
      } catch {
      }
    }
    handleCancel() {
      this.abortInFlight();
      this.overlay.destroy();
      this.capture = null;
      this.suggestion = "";
      this.awaitingCustomInput = false;
    }
    async handleRegenerate() {
      if (!this.capture) return;
      await this.runRewrite(
        this.capture.text,
        this.action,
        this.customInstruction,
        false
      );
    }
    async handleFollowUp(instruction) {
      if (this.awaitingCustomInput) {
        this.awaitingCustomInput = false;
        this.customInstruction = instruction;
        this.lastCustomInstruction = instruction;
        void chrome.runtime.sendMessage({ type: MSG.SET_LAST_INSTRUCTION, instruction }).catch(() => {
        });
        if (!this.capture) return;
        await this.runRewrite(this.capture.text, "custom", instruction, true);
        return;
      }
      if (this.meta.incoming) {
        if (!this.capture) return;
        this.customInstruction = instruction;
        await this.runRewrite(this.capture.text, this.action, instruction, true);
        return;
      }
      if (!this.suggestion) return;
      await this.runRewrite(this.suggestion, "custom", instruction, true);
    }
    handleUndo() {
      if (this.capture?.adapter.restoreOriginalText) {
        this.capture.adapter.restoreOriginalText();
      }
      this.handleCancel();
    }
    handleOpenSettings() {
      void chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }).catch(() => {
      });
      this.handleCancel();
    }
  }
  const controller = new RewriteController();
  document.addEventListener(
    "contextmenu",
    (e) => {
      selectionManager.rememberTarget(e.target);
    },
    true
  );
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MSG.CONTEXT_MENU_ACTION) {
      const msg = message;
      if (msg.viaShortcut && !document.hasFocus()) return void 0;
      void controller.start(msg.action, {
        targetLanguage: msg.targetLanguage ?? "",
        nativeLanguage: msg.nativeLanguage ?? ""
      });
    }
    if (message.type === MSG.PING_CONTENT) {
      return;
    }
    return void 0;
  });

})();
