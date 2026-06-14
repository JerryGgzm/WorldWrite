import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/api/prompt-builder";
import type { PromptInput, RewriteAction } from "@/shared/types";

function base(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    selectedText: "hello world",
    action: "polish",
    nativeLanguage: "Chinese",
    targetLanguage: "English",
    tone: "natural",
    strictMeaningPreservation: false,
    ...overrides,
  };
}

const ALL_ACTIONS: RewriteAction[] = [
  "translate",
  "translate_to_native",
  "explain",
  "polish",
  "fix_grammar",
  "make_professional",
  "make_concise",
  "custom",
];

describe("PromptBuilder", () => {
  it("never emits undefined/null in any action", () => {
    for (const action of ALL_ACTIONS) {
      const { system, user } = buildPrompt(base({ action }));
      expect(system).not.toMatch(/undefined|null/);
      expect(user).not.toMatch(/undefined|null/);
      expect(system.length).toBeGreaterThan(0);
    }
  });

  it("every action preserves meaning / forbids new facts", () => {
    for (const action of ALL_ACTIONS) {
      const { system } = buildPrompt(base({ action }));
      const lower = system.toLowerCase();
      expect(lower).toContain("meaning");
      expect(lower).toMatch(
        /do not add (new facts|or remove information|unsupported facts)/,
      );
    }
  });

  it("includes the selected text in the user prompt", () => {
    const { user } = buildPrompt(base({ selectedText: "我想合作" }));
    expect(user).toContain("我想合作");
  });

  // Scenario 1: Chinese rough message -> polished English cold outreach
  it("polish targets the configured target language", () => {
    const { system } = buildPrompt(
      base({ action: "polish", targetLanguage: "English" }),
    );
    expect(system).toContain("English");
    expect(system).toContain("natural");
  });

  // Scenario 2: grammar only must not rewrite style
  it("grammar-only forbids style rewriting", () => {
    const { system } = buildPrompt(base({ action: "fix_grammar" }));
    expect(system).toContain("Do not rewrite the style");
    expect(system).toContain("Do not change the meaning");
  });

  // Scenario 3 & 5: site hints injected
  it("injects LinkedIn site hint for professional-but-warm tone", () => {
    const { system } = buildPrompt(
      base({ action: "make_professional", siteType: "linkedin" }),
    );
    expect(system.toLowerCase()).toContain("warm");
  });

  it("injects slack concise hint", () => {
    const { system } = buildPrompt(
      base({ action: "make_concise", siteType: "slack" }),
    );
    expect(system.toLowerCase()).toContain("conversational");
  });

  // Scenario 4: github technical
  it("injects github technical hint", () => {
    const { system } = buildPrompt(
      base({ action: "polish", siteType: "github" }),
    );
    expect(system.toLowerCase()).toContain("technical");
  });

  // Scenario 6 & 7: custom instruction is included and still protects meaning
  it("custom instruction is included and protects original meaning", () => {
    const { system } = buildPrompt(
      base({ action: "custom", customInstruction: "make it warmer" }),
    );
    expect(system).toContain("make it warmer");
    expect(system.toLowerCase()).toContain(
      "preserve the original meaning unless the user explicitly asks",
    );
  });

  it("custom without instruction still produces a safe default", () => {
    const { system } = buildPrompt(
      base({ action: "custom", customInstruction: undefined }),
    );
    expect(system).not.toMatch(/undefined|null/);
    expect(system.toLowerCase()).toContain("meaning");
  });

  // Scenario 8: translation must not add new facts / explanations
  it("translate forbids adding facts and only returns the translation", () => {
    const { system } = buildPrompt(
      base({ action: "translate", nativeLanguage: "Chinese" }),
    );
    expect(system).toContain("Translate the selected text from Chinese to English");
    expect(system).toContain("Do not add new facts");
    expect(system).toContain("Return only the translated text");
  });

  it("translate-to-native auto-detects source and targets the native language", () => {
    const { system } = buildPrompt(
      base({
        action: "translate_to_native",
        nativeLanguage: "Chinese",
        targetLanguage: "English",
      }),
    );
    expect(system).toContain("Detect the language of the selected text");
    expect(system).toContain("translate it into Chinese");
    expect(system).toContain("If the text is already in Chinese");
    expect(system).toContain("Return only the translated text");
  });

  it("strict meaning preservation adds a hard constraint", () => {
    const { system } = buildPrompt(
      base({ action: "polish", strictMeaningPreservation: true }),
    );
    expect(system).toContain("must not change the meaning");
  });

  it("falls back to safe language labels when settings are blank", () => {
    const { system } = buildPrompt(
      base({
        action: "translate",
        nativeLanguage: "",
        targetLanguage: "",
      }),
    );
    expect(system).not.toMatch(/undefined|null/);
    expect(system).toContain("the source language");
    expect(system).toContain("the target language");
  });
});
