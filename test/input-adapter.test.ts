import { describe, it, expect, beforeEach } from "vitest";
import {
  TextareaAdapter,
  ContentEditableAdapter,
  createAdapterForTarget,
} from "@/content/input-adapter";

beforeEach(() => {
  document.body.innerHTML = "";
});

function makeTextarea(value: string, start: number, end: number) {
  const ta = document.createElement("textarea");
  ta.value = value;
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(start, end);
  return ta;
}

describe("TextareaAdapter", () => {
  it("captures only the selected substring", () => {
    const ta = makeTextarea("Hello brave world", 6, 11); // "brave"
    const adapter = new TextareaAdapter();
    expect(adapter.canHandle(ta)).toBe(true);
    expect(adapter.capture(ta)).toBe(true);
    expect(adapter.getSelectedText()).toBe("brave");
  });

  it("replaces only the selected text, preserving surrounding text", () => {
    const ta = makeTextarea("Hello brave world", 6, 11);
    const adapter = new TextareaAdapter();
    adapter.capture(ta);
    let inputFired = false;
    ta.addEventListener("input", () => (inputFired = true));
    expect(adapter.replaceSelectedText("bold")).toBe(true);
    expect(ta.value).toBe("Hello bold world");
    expect(inputFired).toBe(true);
  });

  it("refuses to replace when the user changed the text (stale selection)", () => {
    const ta = makeTextarea("Hello brave world", 6, 11);
    const adapter = new TextareaAdapter();
    adapter.capture(ta);
    // Simulate the user editing the field after capture.
    ta.value = "Completely different content";
    expect(adapter.replaceSelectedText("bold")).toBe(false);
    expect(ta.value).toBe("Completely different content");
  });

  it("supports input[type=text] and rejects unsupported types", () => {
    const text = document.createElement("input");
    text.type = "text";
    const password = document.createElement("input");
    password.type = "password";
    const adapter = new TextareaAdapter();
    expect(adapter.canHandle(text)).toBe(true);
    expect(adapter.canHandle(password)).toBe(false);
  });

  it("restores the original text (undo)", () => {
    const ta = makeTextarea("Hello brave world", 6, 11);
    const adapter = new TextareaAdapter();
    adapter.capture(ta);
    adapter.replaceSelectedText("bold");
    expect(ta.value).toBe("Hello bold world");
    expect(adapter.restoreOriginalText()).toBe(true);
    expect(ta.value).toBe("Hello brave world");
  });
});

describe("ContentEditableAdapter", () => {
  function makeEditable(text: string) {
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    div.textContent = text;
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div.firstChild!);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return div;
  }

  it("captures the selected text from a contenteditable", () => {
    const div = makeEditable("editable text here");
    const adapter = new ContentEditableAdapter();
    expect(adapter.canHandle(div)).toBe(true);
    expect(adapter.capture(div)).toBe(true);
    expect(adapter.getSelectedText()).toBe("editable text here");
  });

  it("replaces selected content", () => {
    const div = makeEditable("old content");
    const adapter = new ContentEditableAdapter();
    adapter.capture(div);
    const ok = adapter.replaceSelectedText("new content");
    expect(ok).toBe(true);
    expect(div.textContent).toContain("new content");
  });
});

describe("createAdapterForTarget", () => {
  it("returns null when there is no selection or editable target", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(createAdapterForTarget(div)).toBeNull();
  });

  it("returns a TextareaAdapter for a textarea selection", () => {
    const ta = makeTextarea("pick me please", 0, 4);
    const adapter = createAdapterForTarget(ta);
    expect(adapter).not.toBeNull();
    expect(adapter?.getSelectedText()).toBe("pick");
  });
});
