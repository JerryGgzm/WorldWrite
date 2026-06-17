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

  it("still replaces after the editor rebuilds its DOM nodes (LinkedIn/Quill)", () => {
    const div = makeEditable("please fix this sentence");
    const adapter = new ContentEditableAdapter();
    expect(adapter.capture(div)).toBe(true);

    // Simulate a rich editor re-rendering: the original text node is detached
    // and replaced by brand new nodes holding the identical text/offsets.
    div.textContent = "";
    div.appendChild(document.createTextNode("please fix "));
    div.appendChild(document.createTextNode("this sentence"));

    // execCommand isn't implemented in jsdom, so the manual DOM fallback runs.
    const ok = adapter.replaceSelectedText("polish my whole draft");
    expect(ok).toBe(true);
    expect(div.textContent).toBe("polish my whole draft");
  });

  it("refuses to replace when the text at the offsets changed", () => {
    const div = makeEditable("the original words");
    const adapter = new ContentEditableAdapter();
    adapter.capture(div);
    // User edited the field: same length is irrelevant, content differs.
    div.textContent = "totally different words";
    expect(adapter.replaceSelectedText("anything")).toBe(false);
  });

  it("anchors to the editing root so it survives inner-node rebuilds (LinkedIn/Reddit)", () => {
    const root = document.createElement("div");
    Object.defineProperty(root, "isContentEditable", { value: true });
    const span = document.createElement("span");
    Object.defineProperty(span, "isContentEditable", { value: true });
    span.textContent = "fix my grammar here";
    root.appendChild(span);
    document.body.appendChild(root);

    const range = document.createRange();
    range.selectNodeContents(span.firstChild!);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const adapter = new ContentEditableAdapter();
    // The right-click target is the inner span, not the editable root.
    expect(adapter.capture(span)).toBe(true);
    expect(adapter.getSelectedText()).toBe("fix my grammar here");

    // Editor re-renders: detach the inner span and rebuild with fresh nodes.
    root.removeChild(span);
    const rebuilt = document.createElement("span");
    rebuilt.textContent = "fix my grammar here";
    root.appendChild(rebuilt);

    expect(adapter.replaceSelectedText("polished version")).toBe(true);
    expect(root.textContent).toBe("polished version");
  });

  it("relocates after the editor swaps spaces for non-breaking spaces", () => {
    const div = makeEditable("hello there world");
    const adapter = new ContentEditableAdapter();
    expect(adapter.capture(div)).toBe(true);
    div.textContent = "hello\u00a0there\u00a0world";
    expect(adapter.replaceSelectedText("new text")).toBe(true);
    expect(div.textContent).toBe("new text");
  });

  it("does not edit a detached editing root", () => {
    const div = makeEditable("some draft text");
    const adapter = new ContentEditableAdapter();
    adapter.capture(div);
    div.remove();
    expect(adapter.replaceSelectedText("nope")).toBe(false);
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

  it("prefers an editable extra candidate over a non-editable click target", () => {
    // Simulates a site (e.g. LinkedIn) where the right-click target is a wrapper
    // that isn't itself contenteditable, while the real editor is elsewhere.
    const wrapper = document.createElement("div");
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    editable.textContent = "edit me";
    document.body.appendChild(wrapper);
    document.body.appendChild(editable);

    const range = document.createRange();
    range.selectNodeContents(editable.firstChild!);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const adapter = createAdapterForTarget(wrapper, [editable]);
    expect(adapter).not.toBeNull();
    expect(adapter?.getSelectedText()).toBe("edit me");
    // Should be the ContentEditable adapter (supports undo), not Fallback.
    expect(typeof adapter?.restoreOriginalText).toBe("function");
  });
});
