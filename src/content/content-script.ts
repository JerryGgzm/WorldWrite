import { MSG } from "@/shared/types";
import type {
  ContextMenuActionMessage,
  RewriteAction,
  RewritePayload,
  RewriteResponse,
  RuntimeMessage,
  SiteType,
} from "@/shared/types";
import { ERROR_CODES, userMessageFor } from "@/shared/errors";
import {
  getActionMeta,
  type ActionMeta,
  REQUEST_TIMEOUT_MS,
  SITE_HOST_MAP,
} from "@/shared/constants";
import { SelectionManager, type Capture } from "./selection-manager";
import { Overlay } from "./overlay";

const selectionManager = new SelectionManager();

function detectSiteType(): SiteType {
  const host = location.hostname;
  for (const { match, site } of SITE_HOST_MAP) {
    if (match.test(host)) return site;
  }
  return "generic";
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function anchorRectFor(capture: Capture | null): DOMRect | null {
  // Prefer the live selection rect, fall back to the editable element.
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

/**
 * Controls the full rewrite lifecycle for the current page/frame. Enforces the
 * preview-first contract: nothing is ever replaced without an explicit Replace
 * click, and stale responses can never overwrite a newer selection.
 */
class RewriteController {
  private overlay: Overlay;
  private capture: Capture | null = null;
  private action: RewriteAction = "polish";
  private meta: ActionMeta = getActionMeta("polish", {
    targetLanguage: "",
    nativeLanguage: "",
  });
  private customInstruction: string | undefined;
  private currentRequestId: string | null = null;
  private suggestion = "";
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingCustomInput = false;
  /**
   * Last custom instruction used for prefilling. Held in memory, and mirrored to
   * local storage via the background worker only when privacy mode is off.
   */
  private lastCustomInstruction = "";

  constructor() {
    this.overlay = new Overlay({
      onReplace: () => this.handleReplace(),
      onCopy: () => this.handleCopy(),
      onCancel: () => this.handleCancel(),
      onRegenerate: () => this.handleRegenerate(),
      onFollowUp: (instruction) => this.handleFollowUp(instruction),
      onUndo: () => this.handleUndo(),
      onOpenSettings: () => this.handleOpenSettings(),
    });
    void this.primeLastInstruction();
  }

  /** Pulls the persisted instruction (if any) once at startup. */
  private async primeLastInstruction(): Promise<void> {
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: MSG.GET_LAST_INSTRUCTION,
      })) as { value?: string } | undefined;
      if (resp?.value && !this.lastCustomInstruction) {
        this.lastCustomInstruction = resp.value;
      }
    } catch {
      // Background unavailable; in-memory prefill still works this session.
    }
  }

  async start(
    action: RewriteAction,
    langs: { targetLanguage: string; nativeLanguage: string },
  ): Promise<void> {
    // Starting a new action cancels anything already in flight.
    this.abortInFlight();

    this.action = action;
    this.meta = getActionMeta(action, langs);
    this.overlay.setActionMeta(this.meta);

    const result = selectionManager.capture();
    if (!result.ok) {
      const rect = anchorRectFor(null);
      this.overlay.show(rect, "");
      this.overlay.setError(userMessageFor(result.code));
      return;
    }

    this.capture = result.capture;
    this.customInstruction = undefined;
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
    await this.runRewrite(result.capture.text, action, undefined, false);
  }

  private async runRewrite(
    text: string,
    action: RewriteAction,
    customInstruction: string | undefined,
    isFollowUp: boolean,
  ): Promise<void> {
    const requestId = uuid();
    this.currentRequestId = requestId;

    if (isFollowUp) this.overlay.setFollowUpLoading();
    else if (!this.overlay.isOpen())
      this.overlay.show(anchorRectFor(this.capture), text);

    this.startSlowTimer();

    const payload: RewritePayload = {
      selectedText: text,
      action,
      customInstruction,
      siteType: detectSiteType(),
    };

    let resp: RewriteResponse;
    try {
      resp = (await chrome.runtime.sendMessage({
        type: MSG.REWRITE_REQUEST,
        requestId,
        payload,
      })) as RewriteResponse;
    } catch {
      this.clearSlowTimer();
      if (this.currentRequestId === requestId) {
        this.overlay.setError(
          userMessageFor(ERROR_CODES.CONTENT_SCRIPT_UNAVAILABLE),
          { canRetry: true },
        );
      }
      return;
    }

    this.clearSlowTimer();

    // Stale-response guard: ignore anything that isn't the active request.
    if (this.currentRequestId !== requestId) return;
    this.currentRequestId = null;

    if (resp.ok) {
      this.suggestion = resp.text;
      this.overlay.setPreview(resp.text);
    } else {
      const notConfigured =
        resp.errorCode === ERROR_CODES.NO_API_KEY ||
        resp.errorCode === ERROR_CODES.NO_PROVIDER;
      this.overlay.setError(resp.message || userMessageFor(resp.errorCode), {
        canRetry: !notConfigured,
        canOpenSettings: notConfigured,
      });
    }
  }

  private startSlowTimer(): void {
    this.clearSlowTimer();
    this.slowTimer = setTimeout(() => {
      this.overlay.setSlow();
    }, REQUEST_TIMEOUT_MS);
  }

  private clearSlowTimer(): void {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }

  private abortInFlight(): void {
    this.clearSlowTimer();
    if (this.currentRequestId) {
      void chrome.runtime
        .sendMessage({
          type: MSG.CANCEL_REQUEST,
          requestId: this.currentRequestId,
        })
        .catch(() => {});
      this.currentRequestId = null;
    }
  }

  private handleReplace(): void {
    if (!this.capture || !this.suggestion) return;
    const ok = this.capture.adapter.replaceSelectedText(this.suggestion);
    if (!ok) {
      this.overlay.setError(userMessageFor(ERROR_CODES.SELECTION_CHANGED));
      return;
    }
    this.overlay.setReplaced();
  }

  private async handleCopy(): Promise<void> {
    if (!this.suggestion) return;
    try {
      await navigator.clipboard.writeText(this.suggestion);
      this.overlay.copyFeedback();
    } catch {
      // Clipboard may be blocked; fail quietly without altering the page.
    }
  }

  private handleCancel(): void {
    this.abortInFlight();
    this.overlay.destroy();
    this.capture = null;
    this.suggestion = "";
    this.awaitingCustomInput = false;
  }

  private async handleRegenerate(): Promise<void> {
    if (!this.capture) return;
    await this.runRewrite(
      this.capture.text,
      this.action,
      this.customInstruction,
      false,
    );
  }

  private async handleFollowUp(instruction: string): Promise<void> {
    if (this.awaitingCustomInput) {
      // First generation for a custom action.
      this.awaitingCustomInput = false;
      this.customInstruction = instruction;
      this.lastCustomInstruction = instruction;
      void chrome.runtime
        .sendMessage({ type: MSG.SET_LAST_INSTRUCTION, instruction })
        .catch(() => {});
      if (!this.capture) return;
      await this.runRewrite(this.capture.text, "custom", instruction, true);
      return;
    }
    // Incoming messages: re-run on the ORIGINAL message with the extra
    // instruction; the result is never treated as new source text.
    if (this.meta.incoming) {
      if (!this.capture) return;
      this.customInstruction = instruction;
      await this.runRewrite(this.capture.text, this.action, instruction, true);
      return;
    }
    // Follow-up: use the current suggestion as the new base text.
    if (!this.suggestion) return;
    await this.runRewrite(this.suggestion, "custom", instruction, true);
  }

  private handleUndo(): void {
    if (this.capture?.adapter.restoreOriginalText) {
      this.capture.adapter.restoreOriginalText();
    }
    this.handleCancel();
  }

  private handleOpenSettings(): void {
    void chrome.runtime
      .sendMessage({ type: MSG.OPEN_OPTIONS })
      .catch(() => {});
    this.handleCancel();
  }
}

const controller = new RewriteController();

// Remember what the user right-clicked BEFORE the context menu opens, while the
// selection is still live.
document.addEventListener(
  "contextmenu",
  (e) => {
    selectionManager.rememberTarget(e.target);
  },
  true,
);

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type === MSG.CONTEXT_MENU_ACTION) {
    const msg = message as ContextMenuActionMessage;
    // Keyboard shortcuts are broadcast to every frame; only the focused frame
    // (the one the user is actually typing in) should respond.
    if (msg.viaShortcut && !document.hasFocus()) return undefined;
    void controller.start(msg.action, {
      targetLanguage: msg.targetLanguage ?? "",
      nativeLanguage: msg.nativeLanguage ?? "",
    });
  }
  if (message.type === MSG.PING_CONTENT) {
    return; // liveness probe
  }
  return undefined;
});
