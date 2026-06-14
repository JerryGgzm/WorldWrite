import { describe, it, expect } from "vitest";
import {
  PrivacyGuard,
  FORBIDDEN_OUTGOING_FIELDS,
} from "@/security/privacy-guard";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { RewritePayload, UserSettings } from "@/shared/types";

function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("PrivacyGuard", () => {
  it("privacy mode is on by default", () => {
    expect(new PrivacyGuard(settings()).privacyMode).toBe(true);
  });

  it("does not allow storing history in privacy mode", () => {
    const guard = new PrivacyGuard(
      settings({ privacyMode: true, saveLocalHistory: true }),
    );
    expect(guard.canStoreHistory()).toBe(false);
  });

  it("allows history only when privacy mode off AND opted in", () => {
    expect(
      new PrivacyGuard(
        settings({ privacyMode: false, saveLocalHistory: true }),
      ).canStoreHistory(),
    ).toBe(true);
    expect(
      new PrivacyGuard(
        settings({ privacyMode: false, saveLocalHistory: false }),
      ).canStoreHistory(),
    ).toBe(false);
  });

  it("does not allow context in privacy mode", () => {
    const guard = new PrivacyGuard(
      settings({ privacyMode: true, contextAwareMode: true }),
    );
    expect(guard.canSendContext()).toBe(false);
  });

  it("strips forbidden fields from outgoing payloads", () => {
    const guard = new PrivacyGuard(settings());
    const dirty = {
      selectedText: "hello",
      action: "polish",
      customInstruction: "  warmer ",
      siteType: "linkedin",
      pageUrl: "https://secret.example.com/page",
      pageTitle: "Secret",
      surroundingContext: "lots of page text",
      apiKey: "sk-should-not-be-here",
    } as unknown as RewritePayload;

    const clean = guard.sanitizeOutgoing(dirty);
    const serialized = JSON.stringify(clean);
    for (const field of FORBIDDEN_OUTGOING_FIELDS) {
      expect(serialized).not.toContain(field);
    }
    expect(serialized).not.toContain("secret.example.com");
    expect(serialized).not.toContain("sk-should-not-be-here");
    expect(clean.selectedText).toBe("hello");
    expect(clean.customInstruction).toBe("warmer");
    expect(clean.siteType).toBe("linkedin");
  });

  it("omits empty custom instructions", () => {
    const guard = new PrivacyGuard(settings());
    const clean = guard.sanitizeOutgoing({
      selectedText: "x",
      action: "polish",
      customInstruction: "   ",
    });
    expect(clean.customInstruction).toBeUndefined();
  });
});
