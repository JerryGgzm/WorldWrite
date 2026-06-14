import { DEFAULT_SETTINGS, STORAGE_KEYS } from "@/shared/constants";
import type { UserSettings } from "@/shared/types";

/** Loads settings merged over defaults. Never contains API keys. */
export async function loadSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = result[STORAGE_KEYS.SETTINGS] as Partial<UserSettings> | undefined;
  return mergeSettings(stored);
}

export function mergeSettings(
  stored: Partial<UserSettings> | undefined,
): UserSettings {
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers:
      Array.isArray(stored.providers) && stored.providers.length > 0
        ? stored.providers.map((p) => ({ ...p, apiKey: undefined }))
        : structuredClone(DEFAULT_SETTINGS.providers),
  };
}

/** Persists settings. Strips any stray apiKey from provider configs first. */
export async function saveSettings(settings: UserSettings): Promise<void> {
  const sanitized: UserSettings = {
    ...settings,
    providers: settings.providers.map((p) => ({ ...p, apiKey: undefined })),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: sanitized });
}

/**
 * Produces an export blob. API keys are NEVER included by default, so a user
 * can safely share or back up their configuration.
 */
export function exportSettings(settings: UserSettings): string {
  const sanitized: UserSettings = {
    ...settings,
    providers: settings.providers.map((p) => ({ ...p, apiKey: undefined })),
  };
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), settings: sanitized },
    null,
    2,
  );
}

export function parseImportedSettings(raw: string): UserSettings {
  const parsed = JSON.parse(raw) as { settings?: Partial<UserSettings> };
  return mergeSettings(parsed.settings ?? (parsed as Partial<UserSettings>));
}
