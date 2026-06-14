import { describe, it, expect, beforeEach } from "vitest";
import { ChromeKeyStorage, type AsyncStorageArea } from "@/security/key-storage";

class MemoryArea implements AsyncStorageArea {
  store: Record<string, unknown> = {};
  async get(keys: string | string[] | null) {
    if (keys === null) return { ...this.store };
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (k in this.store) out[k] = this.store[k];
    return out;
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.store, items);
  }
  async remove(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) delete this.store[k];
  }
}

let persistent: MemoryArea;
let session: MemoryArea;
let storage: ChromeKeyStorage;

beforeEach(() => {
  persistent = new MemoryArea();
  session = new MemoryArea();
  storage = new ChromeKeyStorage(persistent, session);
});

describe("ChromeKeyStorage", () => {
  it("saves and reads a key", async () => {
    await storage.saveApiKey("openai", "sk-123");
    expect(await storage.getApiKey("openai")).toBe("sk-123");
  });

  it("returns null for an unknown provider", async () => {
    expect(await storage.getApiKey("missing")).toBeNull();
  });

  it("deletes a key from both areas", async () => {
    await storage.saveApiKey("openai", "sk-123");
    await storage.deleteApiKey("openai");
    expect(await storage.getApiKey("openai")).toBeNull();
  });

  it("session-only keys are stored in the session area, not persistent", async () => {
    await storage.saveApiKey("openai", "sk-session", true);
    expect(JSON.stringify(persistent.store)).not.toContain("sk-session");
    expect(JSON.stringify(session.store)).toContain("sk-session");
    expect(await storage.getApiKey("openai")).toBe("sk-session");
  });

  it("session key takes precedence over a persisted one", async () => {
    await storage.saveApiKey("openai", "sk-persist");
    await storage.saveApiKey("openai", "sk-session", true);
    expect(await storage.getApiKey("openai")).toBe("sk-session");
  });

  it("keeps keys isolated per provider", async () => {
    await storage.saveApiKey("openai", "sk-a");
    await storage.saveApiKey("groq", "sk-b");
    expect(await storage.getApiKey("openai")).toBe("sk-a");
    expect(await storage.getApiKey("groq")).toBe("sk-b");
  });
});
