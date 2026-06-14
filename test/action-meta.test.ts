import { describe, it, expect } from "vitest";
import { getActionMeta } from "@/shared/constants";

const langs = { targetLanguage: "English", nativeLanguage: "Chinese" };

describe("getActionMeta", () => {
  it("outgoing actions are replaceable and labeled 'For text you wrote'", () => {
    for (const action of ["translate", "polish", "make_professional", "custom"] as const) {
      const meta = getActionMeta(action, langs);
      expect(meta.canReplace).toBe(true);
      expect(meta.incoming).toBe(false);
      expect(meta.subtitle).toBe("For text you wrote");
      expect(meta.selectedLabel).toBe("Selected text");
    }
  });

  it("incoming actions are read-only and labeled 'For a message you received'", () => {
    for (const action of ["explain", "translate_to_native"] as const) {
      const meta = getActionMeta(action, langs);
      expect(meta.canReplace).toBe(false);
      expect(meta.incoming).toBe(true);
      expect(meta.subtitle).toBe("For a message you received");
      expect(meta.selectedLabel).toBe("Selected message");
    }
  });

  it("titles and result labels reflect the task", () => {
    expect(getActionMeta("translate", langs).title).toBe("Translate to English");
    expect(getActionMeta("translate", langs).resultLabel).toBe("Translation");
    expect(getActionMeta("polish", langs).title).toBe("Polish English");
    expect(getActionMeta("polish", langs).resultLabel).toBe("Suggestion");
    expect(getActionMeta("make_professional", langs).title).toBe(
      "Make English more professional",
    );
    expect(getActionMeta("custom", langs).title).toBe("Custom rewrite");
    expect(getActionMeta("explain", langs).title).toBe("Understand this message");
    expect(getActionMeta("explain", langs).resultLabel).toBe("Meaning");
    expect(getActionMeta("translate_to_native", langs).title).toBe(
      "Translate to Chinese",
    );
    expect(getActionMeta("translate_to_native", langs).resultLabel).toBe(
      "Translation",
    );
  });
});
