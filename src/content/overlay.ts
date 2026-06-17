// Preview overlay rendered inside a Shadow DOM so page styles cannot affect it
// and it cannot leak styles into the page. The overlay is the ONLY place a
// replacement can be triggered, and only via the explicit Replace button.

import { APP_NAME, type ActionMeta } from "@/shared/constants";
import { computeWordDiff } from "./diff";

export interface OverlayCallbacks {
  onReplace: () => void;
  onCopy: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
  onFollowUp: (instruction: string) => void;
  onUndo: () => void;
  onOpenSettings: () => void;
}

interface Tweak {
  label: string;
  instruction: string;
}

const OUTGOING_TWEAKS: Tweak[] = [
  { label: "Shorter", instruction: "Make it shorter and more concise" },
  { label: "Warmer", instruction: "Make it warmer and friendlier" },
  { label: "More formal", instruction: "Make it more formal" },
  { label: "More casual", instruction: "Make it more casual" },
  { label: "Simpler", instruction: "Make it simpler and easier to understand" },
];

const INCOMING_TWEAKS: Tweak[] = [
  { label: "Simpler", instruction: "Explain it more simply" },
  { label: "Shorter", instruction: "Make it shorter" },
  { label: "More direct", instruction: "Be more direct and literal" },
];

const DEFAULT_META: ActionMeta = {
  action: "polish",
  title: "Polish",
  subtitle: "For text you wrote",
  selectedLabel: "Selected text",
  resultLabel: "Suggestion",
  incoming: false,
  canReplace: true,
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

export class Overlay {
  private hostEl: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private callbacks: OverlayCallbacks;
  private meta: ActionMeta = DEFAULT_META;
  private originalText = "";
  private suggestion = "";
  private showDiff = false;
  private hasPreview = false;
  private outsideClickHandler = (e: MouseEvent) => {
    if (this.hostEl && !e.composedPath().includes(this.hostEl)) {
      this.callbacks.onCancel();
    }
  };
  private keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.callbacks.onCancel();
      return;
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === "Enter" &&
      this.hasPreview &&
      this.meta.canReplace &&
      this.suggestion
    ) {
      e.preventDefault();
      this.callbacks.onReplace();
    }
  };
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
  }

  isOpen(): boolean {
    return this.hostEl !== null;
  }

  /** Sets the task metadata that drives the title, subtitle, and labels. */
  setActionMeta(meta: ActionMeta): void {
    this.meta = meta;
  }

  show(anchorRect: DOMRect | null, originalText: string): void {
    this.destroy();
    this.originalText = originalText;
    this.suggestion = "";
    this.showDiff = false;
    this.hasPreview = false;

    const host = document.createElement("div");
    host.setAttribute("data-iaa-overlay", "");
    // Closed shadow root: the host page cannot reach into it via host.shadowRoot,
    // so the page cannot scrape the AI result or the user's selected text.
    this.root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    this.root.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    this.root.appendChild(wrap);

    // Keep interactions inside the overlay from reaching the host page's global
    // handlers. Without this, sites like LinkedIn/Reddit treat keystrokes typed
    // in our follow-up box as page shortcuts (swallowing letters, scrolling the
    // page on Space) and may steal focus back to their own editor. Bubble-phase
    // only, so our own inputs, buttons, and the document-level Esc/Cmd+Enter
    // handler (capture phase) all keep working.
    const stopProp = (e: Event) => e.stopPropagation();
    for (const type of [
      "keydown",
      "keypress",
      "keyup",
      "mousedown",
      "mouseup",
      "pointerdown",
      "pointerup",
      "click",
    ]) {
      wrap.addEventListener(type, stopProp);
    }

    (document.body ?? document.documentElement).appendChild(host);
    this.hostEl = host;

    this.position(anchorRect);
    this.renderLoading();

    setTimeout(() => {
      document.addEventListener("mousedown", this.outsideClickHandler, true);
      document.addEventListener("keydown", this.keyHandler, true);
    }, 0);
  }

  private wrap(): HTMLElement | null {
    return this.root?.querySelector(".wrap") ?? null;
  }

  private position(anchorRect: DOMRect | null): void {
    const host = this.hostEl;
    if (!host) return;
    const wrap = this.wrap();
    if (!wrap) return;
    const margin = 8;
    const width = 560;
    let top: number;
    let left: number;
    if (anchorRect) {
      left = Math.min(
        Math.max(margin, anchorRect.left),
        window.innerWidth - width - margin,
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

  private headerHtml(): string {
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

  private selectedHtml(): string {
    return `
      <p class="label">${escapeHtml(this.meta.selectedLabel)}</p>
      <div class="surface surface-selected">${escapeHtml(this.originalText)}</div>`;
  }

  private loadingCardHtml(note: string): string {
    return `
      <p class="label">${escapeHtml(this.meta.resultLabel)}</p>
      <div class="loading-note"><span class="spin"></span><span class="loading-text">${escapeHtml(
        note,
      )}</span></div>
      <div class="surface surface-result" data-role="result">
        <div class="sk" aria-hidden="true">
          <span class="sk-line"></span>
          <span class="sk-line mid"></span>
          <span class="sk-line short"></span>
        </div>
      </div>`;
  }

  private trustHtml(): string {
    return `
      <p class="trust">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        ${escapeHtml(TRUST_NOTE)}
      </p>`;
  }

  private renderLoading(note = "Generating…"): void {
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

  setSlow(): void {
    const text = this.wrap()?.querySelector(".loading-text");
    if (text) text.textContent = "Still working… this is taking longer than usual.";
    const right = this.wrap()?.querySelector(".footer-right");
    if (right && !right.querySelector('[data-act="regenerate"]')) {
      right.insertAdjacentHTML(
        "afterbegin",
        `<button class="btn ghost" data-act="regenerate">Retry</button>`,
      );
      this.bind();
    }
  }

  /** Localized loading for refine/regenerate: only the result card changes. */
  setFollowUpLoading(): void {
    const card = this.wrap()?.querySelector<HTMLElement>('[data-role="result"]');
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

  private setControlsDisabled(disabled: boolean): void {
    this.wrap()
      ?.querySelectorAll<HTMLButtonElement>(
        '[data-act="chip"],[data-act="followup"],[data-act="copy"],[data-act="regenerate"],[data-act="replace"]',
      )
      .forEach((b) => {
        b.disabled = disabled;
      });
  }

  setPreview(suggestion: string): void {
    this.suggestion = suggestion;
    this.hasPreview = true;
    const wrap = this.wrap();
    if (!wrap) return;
    const tweaks = this.meta.incoming ? INCOMING_TWEAKS : OUTGOING_TWEAKS;
    const resultBody = this.showDiff
      ? renderDiff(this.originalText, this.suggestion)
      : escapeHtml(this.suggestion);
    wrap.innerHTML = `
      ${this.headerHtml()}
      <div class="body">
        ${this.selectedHtml()}
        <p class="label">${escapeHtml(this.meta.resultLabel)}</p>
        <div class="surface surface-result ${this.showDiff ? "diff" : ""}" data-role="result">${resultBody}</div>
        ${
          this.meta.incoming
            ? ""
            : `<button class="changes-btn" data-act="toggle-diff">${
                this.showDiff ? "Hide changes" : "Show changes"
              }</button>${this.showDiff ? this.diffLegendHtml() : ""}`
        }
        <p class="label">Refine</p>
        <div class="chips">
          ${tweaks
            .map(
              (t) =>
                `<button class="chip" data-act="chip" data-chip="${escapeAttr(
                  t.instruction,
                )}">${escapeHtml(t.label)}</button>`,
            )
            .join("")}
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

  private diffLegendHtml(): string {
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
  setCustomPrompt(prefill = ""): void {
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
            prefill,
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
    const input = this.wrap()?.querySelector<HTMLInputElement>(
      'input[data-role="followup"]',
    );
    input?.focus();
    if (input && prefill) input.setSelectionRange(prefill.length, prefill.length);
  }

  setError(
    message: string,
    opts: { canRetry?: boolean; canOpenSettings?: boolean } = {},
  ): void {
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

  setReplaced(): void {
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
    this.autoDismissTimer = setTimeout(() => this.callbacks.onCancel(), 5000);
  }

  copyFeedback(): void {
    const btn = this.wrap()?.querySelector('[data-act="copy"]');
    if (btn) {
      const original = btn.textContent ?? "Copy";
      btn.textContent = "Copied!";
      setTimeout(() => {
        if (btn) btn.textContent = original;
      }, 1200);
    }
  }

  getFollowUpValue(): string {
    const input = this.wrap()?.querySelector<HTMLInputElement>(
      'input[data-role="followup"]',
    );
    return input?.value.trim() ?? "";
  }

  private bind(): void {
    const wrap = this.wrap();
    if (!wrap) return;
    wrap.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
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
    const input = wrap.querySelector<HTMLInputElement>(
      'input[data-role="followup"]',
    );
    const sendBtn = wrap.querySelector<HTMLButtonElement>('[data-act="followup"]');
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

  private clampIntoView(): void {
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

  destroy(): void {
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

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderDiff(a: string, b: string): string {
  const parts = computeWordDiff(a, b);
  return parts
    .map((p) => {
      const safe = escapeHtml(p.text);
      if (p.type === "add") return `<ins>${safe}</ins>`;
      if (p.type === "del") return `<del>${safe}</del>`;
      return safe;
    })
    .join("");
}

/** Counts changed word-segments for the diff legend summary. */
function diffCounts(a: string, b: string): { added: number; removed: number } {
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
