import { describe, it, expect, beforeEach } from "vitest";
import { SelectionManager } from "@/content/selection-manager";
import { ERROR_CODES } from "@/shared/errors";

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("SelectionManager", () => {
  it("reports NO_TEXT_SELECTED when nothing is selected", () => {
    const mgr = new SelectionManager();
    const div = document.createElement("div");
    document.body.appendChild(div);
    mgr.rememberTarget(div);
    const result = mgr.capture();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ERROR_CODES.NO_TEXT_SELECTED);
  });

  it("captures a valid textarea selection", () => {
    const ta = document.createElement("textarea");
    ta.value = "capture this text";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, 7);
    const mgr = new SelectionManager();
    mgr.rememberTarget(ta);
    const result = mgr.capture();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.capture.text).toBe("capture");
  });

  it("reports EMPTY_SELECTION for whitespace-only selection", () => {
    const ta = document.createElement("textarea");
    ta.value = "    ";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, 4);
    const mgr = new SelectionManager();
    mgr.rememberTarget(ta);
    const result = mgr.capture();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ERROR_CODES.EMPTY_SELECTION);
  });
});
