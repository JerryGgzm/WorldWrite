import {
  createAdapterForTarget,
  getDeepActiveElement,
  type InputAdapter,
} from "./input-adapter";
import { MAX_SELECTION_LENGTH } from "@/shared/constants";
import { ERROR_CODES, type ErrorCode } from "@/shared/errors";

export interface Capture {
  adapter: InputAdapter;
  text: string;
  /** The editable element the selection lives in, for reference. */
  target: EventTarget | null;
}

export type CaptureResult =
  | { ok: true; capture: Capture }
  | { ok: false; code: ErrorCode };

/**
 * Captures and remembers the user's selection at the moment a context-menu is
 * opened, then lets the rest of the flow validate and replace it safely.
 */
export class SelectionManager {
  private lastTarget: EventTarget | null = null;

  /** Call from a `contextmenu` listener to remember what was right-clicked. */
  rememberTarget(target: EventTarget | null): void {
    this.lastTarget =
      target ?? getDeepActiveElement() ?? document.activeElement;
  }

  /**
   * Builds an adapter bound to the remembered target and validates that there
   * is non-empty, in-bounds selected text.
   */
  capture(): CaptureResult {
    const deepActive = getDeepActiveElement();
    const target = this.lastTarget ?? deepActive ?? document.activeElement;

    // Pass the deepest focused element as an extra candidate: the clicked
    // target may be a shadow host that isn't itself editable (e.g. LinkedIn).
    const adapter = createAdapterForTarget(target, [
      deepActive,
      document.activeElement,
    ]);
    if (!adapter) {
      // Distinguish "nothing selected" from "editable but unsupported".
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
      // Treat oversized selections as unsupported to avoid huge requests.
      return { ok: false, code: ERROR_CODES.UNSUPPORTED_INPUT };
    }

    return { ok: true, capture: { adapter, text, target } };
  }
}
