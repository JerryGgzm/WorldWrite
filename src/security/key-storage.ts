import { STORAGE_KEYS } from "@/shared/constants";

/**
 * Minimal async storage-area shape. Both `chrome.storage.local` and
 * `chrome.storage.session` satisfy this in MV3 (promise-based API). Abstracting
 * it lets us unit test KeyStorage without a real browser.
 */
export interface AsyncStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface KeyStorage {
  saveApiKey(providerId: string, apiKey: string): Promise<void>;
  getApiKey(providerId: string): Promise<string | null>;
  deleteApiKey(providerId: string): Promise<void>;
}

type KeyMap = Record<string, string>;

/**
 * Stores API keys in a dedicated, namespaced object so they are never mixed
 * with non-sensitive settings (which can be exported).
 *
 * Security notes:
 * - Keys live only in the configured storage area (local or session).
 * - Keys are never logged, never injected into the DOM, and never returned to
 *   content scripts. Only the background worker reads them at request time.
 * - `sessionOnly` mode keeps keys in `chrome.storage.session`, which is cleared
 *   when the browser session ends and never written to disk.
 */
export class ChromeKeyStorage implements KeyStorage {
  constructor(
    private readonly persistent: AsyncStorageArea,
    private readonly session?: AsyncStorageArea,
  ) {}

  private async readMap(area: AsyncStorageArea): Promise<KeyMap> {
    const result = await area.get(STORAGE_KEYS.API_KEYS);
    const map = result[STORAGE_KEYS.API_KEYS];
    return (map && typeof map === "object" ? map : {}) as KeyMap;
  }

  private async writeMap(area: AsyncStorageArea, map: KeyMap): Promise<void> {
    await area.set({ [STORAGE_KEYS.API_KEYS]: map });
  }

  /**
   * @param sessionOnly when true the key is written only to the session area
   *        and any persisted copy is removed.
   */
  async saveApiKey(
    providerId: string,
    apiKey: string,
    sessionOnly = false,
  ): Promise<void> {
    const targetSession = sessionOnly && this.session;
    if (targetSession) {
      const map = await this.readMap(this.session!);
      map[providerId] = apiKey;
      await this.writeMap(this.session!, map);
      // Ensure no stale persisted copy lingers.
      await this.removeFrom(this.persistent, providerId);
      return;
    }
    const map = await this.readMap(this.persistent);
    map[providerId] = apiKey;
    await this.writeMap(this.persistent, map);
  }

  async getApiKey(providerId: string): Promise<string | null> {
    if (this.session) {
      const sessionMap = await this.readMap(this.session);
      if (sessionMap[providerId]) return sessionMap[providerId];
    }
    const map = await this.readMap(this.persistent);
    return map[providerId] ?? null;
  }

  async deleteApiKey(providerId: string): Promise<void> {
    await this.removeFrom(this.persistent, providerId);
    if (this.session) await this.removeFrom(this.session, providerId);
  }

  private async removeFrom(
    area: AsyncStorageArea,
    providerId: string,
  ): Promise<void> {
    const map = await this.readMap(area);
    if (providerId in map) {
      delete map[providerId];
      await this.writeMap(area, map);
    }
  }
}

/** Builds a KeyStorage backed by the real chrome.storage areas. */
export function createKeyStorage(): ChromeKeyStorage {
  const local = chrome.storage.local as unknown as AsyncStorageArea;
  const session =
    (chrome.storage as unknown as { session?: AsyncStorageArea }).session;
  return new ChromeKeyStorage(local, session);
}
