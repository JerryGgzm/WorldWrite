import "@testing-library/jest-dom/vitest";

// Minimal in-memory chrome.storage mock so modules that touch chrome.storage
// (options-storage, etc.) work under jsdom. Tests that need precise control
// inject their own storage areas instead.
class MemoryArea {
  private store: Record<string, unknown> = {};
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
  _reset() {
    this.store = {};
  }
}

const local = new MemoryArea();
const session = new MemoryArea();

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local,
    session,
    onChanged: { addListener: () => {} },
  },
  runtime: {
    sendMessage: async () => ({ ok: true }),
    onMessage: { addListener: () => {} },
    openOptionsPage: () => {},
  },
  contextMenus: {
    create: () => {},
    removeAll: async () => {},
    onClicked: { addListener: () => {} },
  },
  tabs: { sendMessage: async () => {} },
  action: { onClicked: { addListener: () => {} } },
};
