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

/**
 * Climbs to the outermost contenteditable ancestor (the editing root). Rich
 * editors (LinkedIn/Quill, Reddit/Lexical) rebuild the inner block/inline nodes
 * on every render, but this root element stays attached — so it is the only
 * stable anchor for relocating a selection between capture and replace.
 */
function editingRoot(el: HTMLElement): HTMLElement {
  let root = el;
  let parent = el.parentElement;
  while (parent && parent.isContentEditable) {
    root = parent;
    parent = parent.parentElement;
  }
  return root;
}

// Length-preserving whitespace normalisation (e.g. nbsp -> space) so a
// selection still matches after an editor swaps spaces for &nbsp; on render.
const NORMALISE_WS_RE = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;
function normaliseWs(s: string): string {
  return s.replace(NORMALISE_WS_RE, " ");
}

/** Concatenated text-node data of `host` (same basis as Range.toString()). */
function rawText(host: Node): string {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let out = "";
  let node = walker.nextNode();
  while (node) {
    out += (node as Text).data;
    node = walker.nextNode();
  }
  return out;
}

/**
 * Character offset of a boundary point (container, offset) measured from the
 * start of `host`'s text content. Using Range.toString().length handles both
 * text-node and element containers uniformly.
 */
function offsetOfPoint(
  host: Node,
  container: Node,
  offset: number,
): number | null {
  try {
    const r = document.createRange();
    r.selectNodeContents(host);
    r.setEnd(container, offset);
    return r.toString().length;
  } catch {
    return null;
  }
}

/** Resolves an absolute text offset within `host` back to a (textNode, offset). */
function pointFromOffset(
  host: Node,
  target: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let remaining = target;
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    last = node;
    const len = node.data.length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  // Allow a position at the very end of the last text node.
  if (last && remaining === 0) return { node: last, offset: last.data.length };
  return null;
}

/** Rebuilds a Range from absolute character offsets against the live DOM. */
function rangeFromOffsets(
  host: Node,
  start: number,
  end: number,
): Range | null {
  const s = pointFromOffset(host, start);
  const e = pointFromOffset(host, end);
  if (!s || !e) return null;
  try {
    const r = document.createRange();
    r.setStart(s.node, s.offset);
    r.setEnd(e.node, e.offset);
    return r;
  } catch {
    return null;
  }
}

export class ContentEditableAdapter implements InputAdapter {
  private host: HTMLElement | null = null;
  private range: Range | null = null;
  private originalText = "";
  private startOffset: number | null = null;
  private endOffset: number | null = null;
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
    // Anchor to the editing root, not the clicked descendant — rich editors
    // replace inner nodes on render, but the root stays attached.
    const root = editingRoot(target);
    this.host = root;
    this.range = range.cloneRange();
    this.originalText = range.toString();
    // Remember the selection as character offsets within the root so we can
    // relocate it even after the editor rebuilds its inner nodes.
    this.startOffset = offsetOfPoint(
      root,
      range.startContainer,
      range.startOffset,
    );
    this.endOffset = offsetOfPoint(root, range.endContainer, range.endOffset);
    return this.originalText.length > 0;
  }

  getSelectedText(): string | null {
    return this.originalText || null;
  }

  /**
   * Returns a usable Range that still spans the originally selected text.
   * Tries, in order: the live cloned range, the stored character offsets
   * (tolerating whitespace normalisation), and an unambiguous text search.
   * This survives rich editors (LinkedIn/Quill, Reddit/Lexical, Gmail) that
   * swap their underlying nodes — or whitespace — between capture and replace.
   */
  private resolveRange(): Range | null {
    const host = this.host;
    // Never operate on a detached root: that would silently edit nothing.
    if (!host || !host.isConnected) return null;

    // 1. The original cloned range, if still attached and exact.
    if (
      this.range &&
      host.contains(this.range.startContainer) &&
      host.contains(this.range.endContainer) &&
      this.range.toString() === this.originalText
    ) {
      return this.range;
    }

    const raw = rawText(host);
    const target = this.originalText;

    // 2. Same character offsets, tolerating whitespace normalisation (nbsp etc.).
    if (this.startOffset != null && this.endOffset != null) {
      const slice = raw.slice(this.startOffset, this.endOffset);
      if (slice === target || normaliseWs(slice) === normaliseWs(target)) {
        const r = rangeFromOffsets(host, this.startOffset, this.endOffset);
        if (r) return r;
      }
    }

    // 3. Unambiguous text search. normaliseWs is length-preserving, so indices
    //    map 1:1 onto the raw text used by rangeFromOffsets.
    const nRaw = normaliseWs(raw);
    const nTarget = normaliseWs(target);
    if (nTarget.length > 0) {
      const idx = nRaw.indexOf(nTarget);
      if (idx !== -1 && idx === nRaw.lastIndexOf(nTarget)) {
        const r = rangeFromOffsets(host, idx, idx + nTarget.length);
        if (r) return r;
      }
    }

    return null;
  }

  replaceSelectedText(newText: string): boolean {
    if (!this.host) return false;
    const range = this.resolveRange();
    if (!range) return false;
    const selection = getActiveSelection(this.host);
    if (!selection) return false;

    this.host.focus();
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = tryExecInsert(newText);
    if (!inserted) {
      range.deleteContents();
      const node = document.createTextNode(newText);
      range.insertNode(node);
      // Move caret to the end of the inserted node.
      const after = document.createRange();
      after.setStartAfter(node);
      after.collapse(true);
      selection.removeAllRanges();
      selection.addRange(after);
    }
    dispatchInput(this.host, newText);

    // Record an undo range covering the inserted text. The original clone is
    // now stale, so drop it to avoid reusing detached nodes.
    const current = selection.getRangeAt(0).cloneRange();
    this.undoRange = current;
    this.undoText = this.originalText;
    this.range = null;
    this.startOffset = null;
    this.endOffset = null;
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
  private range: Range | null = null;

  canHandle(_target: EventTarget | null): boolean {
    const sel = window.getSelection();
    return Boolean(sel && sel.toString().trim().length > 0);
  }

  capture(_target: EventTarget | null): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    this.text = sel.toString();
    this.range = sel.getRangeAt(0).cloneRange();
    return this.text.trim().length > 0;
  }

  getSelectedText(): string | null {
    return this.text || null;
  }

  replaceSelectedText(newText: string): boolean {
    const sel = window.getSelection();
    if (!sel) return false;

    // Re-assert our captured range if the live selection drifted.
    if (sel.toString() !== this.text && this.range) {
      try {
        sel.removeAllRanges();
        sel.addRange(this.range);
      } catch {
        /* range may reference detached nodes; ignore */
      }
    }
    if (sel.toString() !== this.text) return false;

    // Best-effort: focus the deepest editable so execCommand targets it. Many
    // sites (e.g. LinkedIn) keep the editor focused while our overlay is open
    // because the overlay buttons aren't focusable.
    const active = getDeepActiveElement();
    if (active instanceof HTMLElement && active.isContentEditable) {
      active.focus();
    }

    // execCommand inserts into the focused editing host and works through shadow
    // DOM and rich editors (Quill/Lexical). Its return value is itself the
    // editability check, so we no longer need a brittle isContentEditable gate.
    return tryExecInsert(newText);
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

type CapturingAdapter = InputAdapter & {
  capture(t: EventTarget | null): boolean;
};

/**
 * Picks the best adapter for the selection. The clicked target may not itself
 * be the editable element — e.g. on sites that host their editor in a shadow
 * tree, a right-click retargets to the shadow host. So we try the strict
 * editable adapters across several candidate targets (clicked element, deepest
 * focused element) before falling back to the selection-only adapter.
 */
export function createAdapterForTarget(
  target: EventTarget | null,
  extraCandidates: (EventTarget | null)[] = [],
): CapturingAdapter | null {
  const seen = new Set<EventTarget>();
  const candidates = [target, ...extraCandidates].filter((c): c is EventTarget => {
    if (!c || seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  // 1. Strict editable adapters (textarea/input, contenteditable) first, across
  //    every candidate. These give precise, reversible replacement.
  for (const candidate of candidates) {
    for (const adapter of [
      new TextareaAdapter(),
      new ContentEditableAdapter(),
    ] as CapturingAdapter[]) {
      if (adapter.canHandle(candidate) && adapter.capture(candidate)) {
        return adapter;
      }
    }
  }

  // 2. Selection-only fallback: handles editors we couldn't pin to an element
  //    (e.g. closed shadow roots) but whose live selection we can still edit.
  const fallback = new FallbackSelectionAdapter();
  const fbTarget = candidates[0] ?? target;
  if (fallback.canHandle(fbTarget) && fallback.capture(fbTarget)) {
    return fallback;
  }
  return null;
}
