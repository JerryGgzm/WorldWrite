import type { RewritePayload, UserSettings } from "@/shared/types";

/**
 * PrivacyGuard enforces what may leave the user's browser and what may be
 * stored. It is the single source of truth for privacy decisions so the rest
 * of the code cannot accidentally widen the data surface.
 *
 * Default (privacy mode on):
 * - Only the selected text, chosen action, language settings and an optional
 *   custom instruction may be sent to the user's own configured provider.
 * - Page URL, page title and surrounding context are never sent.
 * - No selected text, AI response or history is stored.
 */
export class PrivacyGuard {
  constructor(private readonly settings: UserSettings) {}

  get privacyMode(): boolean {
    return this.settings.privacyMode;
  }

  /** History may only be saved when the user explicitly opted out of privacy. */
  canStoreHistory(): boolean {
    return !this.settings.privacyMode && this.settings.saveLocalHistory;
  }

  /** Surrounding page context may only be sent in context-aware mode. */
  canSendContext(): boolean {
    return !this.settings.privacyMode && this.settings.contextAwareMode;
  }

  /**
   * Strips a payload down to only the fields permitted to leave the browser.
   * Even if a caller accidentally attaches page content, it is removed here.
   */
  sanitizeOutgoing(payload: RewritePayload): RewritePayload {
    const safe: RewritePayload = {
      selectedText: payload.selectedText,
      action: payload.action,
    };
    if (payload.customInstruction && payload.customInstruction.trim()) {
      safe.customInstruction = payload.customInstruction.trim();
    }
    // siteType is only a tone hint (an enum), not page content, so it is safe.
    if (payload.siteType) {
      safe.siteType = payload.siteType;
    }
    return safe;
  }
}

/**
 * Fields that must never appear in an outgoing request body by default. Used by
 * tests and as documentation of the privacy contract.
 */
export const FORBIDDEN_OUTGOING_FIELDS = [
  "pageUrl",
  "pageTitle",
  "surroundingContext",
  "fullPageContent",
  "history",
  "apiKey",
] as const;
