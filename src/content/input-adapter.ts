// Unified abstraction over the many ways a web page exposes editable text.
// Each adapter captures a selection snapshot at creation time and validates it
// is still intact before performing a replacement, so a stale request can never
// overwrite text the user has since changed.

export interface InputAdapter {
  /** Whether this adapter can operate on the given event target. */
  canHandle(target: EventTarget | null): boolean;
  /** The text the user currently has selected, or null if none. */
  getSelectedText(): string | null;
  /**
   * Replaces ONLY the originally selected text. Returns false if the selection
   * is no longer valid (e.g. the user edited the field), in which case the
   * caller must not modify the page.
   */
  replaceSelectedText(newText: string): boolean;
  /** Restores the originally selected text after a replacement (undo). */
  restoreOriginalText?(): boolean;
}

const SUPPORTED_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "email",
  "tel",
  "",
]);

function isTextField(
  el: EventTarget | null,
): el is HTMLTextAreaElement | HTMLInputElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return SUPPORTED_INPUT_TYPES.has(el.type.toLowerCase());
  }
  return false;
}

function isContentEditable(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Sets a value on an input/textarea through the native setter so frameworks
 * like React (which patch the value setter) still observe the change.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatchInput(el: HTMLElement, data: string): void {
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: false,
      inputType: "insertText",
      data,
    }),
  );
  // Some frameworks also listen for change on blur-less updates.
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---- Textarea / input ----------------------------------------------------

export class TextareaAdapter implements InputAdapter {
  private el: HTMLTextAreaElement | HTMLInputElement | null = null;
  private start = 0;
  private end = 0;
  private originalText = "";
  private replacedRange: { start: number; end: number; text: string } | null =
    null;

  canHandle(target: EventTarget | null): boolean {
    return isTextField(target);
  }

  capture(target: EventTarget | null): boolean {
    if (!isTextField(target)) return false;
    this.el = target;
    this.start = target.selectionStart ?? 0;
    this.end = target.selectionEnd ?? 0;
    this.originalText = target.value.slice(this.start, this.end);
    return this.originalText.length > 0;
  }

  getSelectedText(): string | null {
    return this.originalText || null;
  }

  /** True only if the captured slice still matches the live value. */
  private stillValid(): boolean {
    if (!this.el) return false;
    return this.el.value.slice(this.start, this.end) === this.originalText;
  }

  replaceSelectedText(newText: string): boolean {
    if (!this.el || !this.stillValid()) return false;
    const el = this.el;
    const before = el.value.slice(0, this.start);
    const after = el.value.slice(this.end);

    el.focus();
    try {
      el.setSelectionRange(this.start, this.end);
    } catch {
      /* setSelectionRange can throw on some hidden inputs; ignore */
    }

    // Prefer execCommand so the page's framework receives a real edit event.
    const inserted = tryExecInsert(newText);
    if (!inserted) {
      setNativeValue(el, before + newText + after);
      dispatchInput(el, newText);
    }
    const caret = this.start + newText.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* ignore */
    }
    this.replacedRange = {
      start: this.start,
      end: this.start + newText.length,
      text: this.originalText,
    };
    return true;
  }

  restoreOriginalText(): boolean {
    if (!this.el || !this.replacedRange) return false;
    const el = this.el;
    const { start, end, text } = this.replacedRange;
    if (el.value.slice(start, end) === undefined) return false;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    setNativeValue(el, before + text + after);
    dispatchInput(el, text);
    return true;
  }
}

function tryExecInsert(text: string): boolean {
  try {
    // execCommand is deprecated but remains the most framework-compatible way
    // to insert text at the caret. We treat failure as a soft fallback.
    return document.execCommand("insertText", false, text);
  } catch {
    return false;
  }
}

// ---- contenteditable -----------------------------------------------------

export class ContentEditableAdapter implements InputAdapter {
  private host: HTMLElement | null = null;
  private range: Range | null = null;
  private originalText = "";
  private undoRange: Range | null = null;
  private undoText = "";

  canHandle(target: EventTarget | null): boolean {
    return isContentEditable(target);
  }

  capture(target: EventTarget | null): boolean {
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

  getSelectedText(): string | null {
    return this.originalText || null;
  }

  private stillValid(): boolean {
    if (!this.range || !this.host) return false;
    // The cloned range becomes invalid if its boundary nodes left the DOM.
    if (
      !this.host.contains(this.range.startContainer) ||
      !this.host.contains(this.range.endContainer)
    ) {
      return false;
    }
    return this.range.toString() === this.originalText;
  }

  replaceSelectedText(newText: string): boolean {
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
      // Move caret to the end of the inserted node.
      const after = document.createRange();
      after.setStartAfter(node);
      after.collapse(true);
      selection.removeAllRanges();
      selection.addRange(after);
    }
    dispatchInput(this.host, newText);

    // Record an undo range covering the inserted text.
    const current = selection.getRangeAt(0).cloneRange();
    this.undoRange = current;
    this.undoText = this.originalText;
    return true;
  }

  restoreOriginalText(): boolean {
    if (!this.host) return false;
    // Best-effort: re-insert original at the caret. Only safe immediately
    // after a replace while focus/selection is intact.
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

// ---- fallback ------------------------------------------------------------

/**
 * Handles selections that don't map to a known editable element. It can read
 * the selected text (for copy) and attempt an execCommand-based replace if the
 * selection happens to be editable; otherwise replace fails cleanly so the
 * caller surfaces an "unsupported input" error instead of corrupting the page.
 */
export class FallbackSelectionAdapter implements InputAdapter {
  private text = "";
  private editable = false;
  private range: Range | null = null;

  canHandle(_target: EventTarget | null): boolean {
    const sel = window.getSelection();
    return Boolean(sel && sel.toString().trim().length > 0);
  }

  capture(target: EventTarget | null): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    this.text = sel.toString();
    this.range = sel.getRangeAt(0).cloneRange();
    const node =
      target instanceof Node ? target : sel.anchorNode ?? null;
    const host =
      node instanceof HTMLElement ? node : node?.parentElement ?? null;
    this.editable = Boolean(host && host.isContentEditable);
    return this.text.trim().length > 0;
  }

  getSelectedText(): string | null {
    return this.text || null;
  }

  replaceSelectedText(newText: string): boolean {
    if (!this.editable || !this.range) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    if (sel.toString() !== this.text) return false;
    const ok = tryExecInsert(newText);
    return ok;
  }
}

// ---- selection / shadow helpers -----------------------------------------

/** Resolves the deepest active element, piercing open shadow roots. */
export function getDeepActiveElement(
  root: Document | ShadowRoot = document,
): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/**
 * Returns the relevant Selection, preferring a shadow root's selection when the
 * editable host lives inside an open shadow tree.
 */
export function getActiveSelection(el: HTMLElement): Selection | null {
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const shadowGetSelection = (
      root as unknown as { getSelection?: () => Selection | null }
    ).getSelection;
    if (typeof shadowGetSelection === "function") {
      const sel = shadowGetSelection.call(root);
      if (sel) return sel;
    }
  }
  return window.getSelection();
}

/**
 * Picks the best adapter for the given target and captures the current
 * selection. Returns null when nothing can be captured.
 */
export function createAdapterForTarget(
  target: EventTarget | null,
): (InputAdapter & { capture(t: EventTarget | null): boolean }) | null {
  const candidates = [
    new TextareaAdapter(),
    new ContentEditableAdapter(),
    new FallbackSelectionAdapter(),
  ];
  for (const adapter of candidates) {
    if (adapter.canHandle(target) && adapter.capture(target)) {
      return adapter;
    }
  }
  return null;
}
