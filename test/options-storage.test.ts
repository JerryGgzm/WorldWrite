import { describe, it, expect } from "vitest";
import {
  exportSettings,
  mergeSettings,
  parseImportedSettings,
} from "@/options/options-storage";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { UserSettings } from "@/shared/types";

describe("options-storage", () => {
  it("merges partial settings over defaults", () => {
    const merged = mergeSettings({ targetLanguage: "Japanese" });
    expect(merged.targetLanguage).toBe("Japanese");
    expect(merged.nativeLanguage).toBe(DEFAULT_SETTINGS.nativeLanguage);
    expect(merged.privacyMode).toBe(true);
  });

  it("strips API keys from provider configs on merge", () => {
    const merged = mergeSettings({
      providers: [
        {
          providerId: "openai",
          displayName: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          apiFormat: "openai-compatible",
          apiKey: "sk-should-be-stripped",
        },
      ],
    });
    expect(merged.providers[0].apiKey).toBeUndefined();
  });

  it("never includes API keys in exports", () => {
    const settings: UserSettings = {
      ...DEFAULT_SETTINGS,
      providers: [
        {
          ...DEFAULT_SETTINGS.providers[0],
          apiKey: "sk-secret-key",
        },
      ],
    };
    const exported = exportSettings(settings);
    expect(exported).not.toContain("sk-secret-key");
    expect(exported).not.toContain("apiKey");
  });

  it("round-trips through export/import", () => {
    const exported = exportSettings({
      ...DEFAULT_SETTINGS,
      targetLanguage: "German",
    });
    const imported = parseImportedSettings(exported);
    expect(imported.targetLanguage).toBe("German");
  });
});
