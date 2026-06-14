true&&(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
}());

const STORAGE_KEYS = {
  SETTINGS: "iaa_settings_v1",
  /** API keys are stored under this namespaced object keyed by providerId. */
  API_KEYS: "iaa_api_keys_v1"};
const COMMON_LANGUAGES = [
  "English",
  "Chinese",
  "Spanish",
  "French",
  "German",
  "Japanese",
  "Korean",
  "Portuguese",
  "Italian",
  "Russian",
  "Arabic",
  "Hindi",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Dutch",
  "Turkish",
  "Polish"
];
const APP_NAME = "WorldWrite";
const APP_TAGLINE = "Write in your language. Be understood anywhere.";
const TONES = [
  { value: "natural", label: "Natural" },
  { value: "professional", label: "Professional" },
  { value: "concise", label: "Concise" },
  { value: "friendly", label: "Friendly" },
  { value: "direct", label: "Direct" },
  { value: "academic", label: "Academic" },
  { value: "casual", label: "Casual" }
];
const BEHAVIORS = [
  { value: "preserve_meaning_strictly", label: "Preserve meaning strictly" },
  { value: "fix_grammar_only", label: "Fix grammar only" },
  { value: "rewrite_naturally", label: "Rewrite naturally" },
  { value: "translate_naturally", label: "Translate naturally" },
  { value: "translate_literally", label: "Translate literally" }
];
const DEFAULT_PROVIDER = {
  providerId: "openai",
  displayName: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiFormat: "openai-compatible"
};
const PROVIDER_PRESETS = [
  { providerId: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiFormat: "openai-compatible", enabled: true },
  { providerId: "anthropic", displayName: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", apiFormat: "anthropic", enabled: true },
  { providerId: "gemini", displayName: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash", apiFormat: "gemini", enabled: true },
  { providerId: "openrouter", displayName: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5", apiFormat: "openai-compatible", enabled: true },
  { providerId: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiFormat: "openai-compatible", enabled: true },
  { providerId: "groq", displayName: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", apiFormat: "openai-compatible", enabled: false },
  { providerId: "together", displayName: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", apiFormat: "openai-compatible", enabled: false },
  { providerId: "ollama", displayName: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.1", apiFormat: "openai-compatible", enabled: false },
  { providerId: "lmstudio", displayName: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", model: "local-model", apiFormat: "openai-compatible", enabled: false },
  { providerId: "litellm", displayName: "LiteLLM", baseUrl: "http://localhost:4000/v1", model: "gpt-4o-mini", apiFormat: "openai-compatible", enabled: false }
];
const PROVIDER_KEY_HELP = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
  openrouter: "https://openrouter.ai/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  groq: "https://console.groq.com/keys",
  together: "https://api.together.ai/settings/api-keys"
};
const DEFAULT_SETTINGS = {
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  defaultTone: "natural",
  defaultBehavior: "rewrite_naturally",
  activeProviderId: DEFAULT_PROVIDER.providerId,
  providers: [DEFAULT_PROVIDER],
  privacyMode: true,
  contextAwareMode: false,
  saveLocalHistory: false,
  sessionOnlyKey: false
};

const MSG = {
  REWRITE_REQUEST: "REWRITE_REQUEST",
  CANCEL_REQUEST: "CANCEL_REQUEST",
  TEST_CONNECTION: "TEST_CONNECTION",
  CONTEXT_MENU_ACTION: "CONTEXT_MENU_ACTION",
  OPEN_OPTIONS: "OPEN_OPTIONS",
  PING_CONTENT: "PING_CONTENT",
  GET_LAST_INSTRUCTION: "GET_LAST_INSTRUCTION",
  SET_LAST_INSTRUCTION: "SET_LAST_INSTRUCTION"
};

async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = result[STORAGE_KEYS.SETTINGS];
  return mergeSettings(stored);
}
function mergeSettings(stored) {
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers: Array.isArray(stored.providers) && stored.providers.length > 0 ? stored.providers.map((p) => ({ ...p, apiKey: void 0 })) : structuredClone(DEFAULT_SETTINGS.providers)
  };
}
async function saveSettings(settings) {
  const sanitized = {
    ...settings,
    providers: settings.providers.map((p) => ({ ...p, apiKey: void 0 }))
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: sanitized });
}
function exportSettings(settings) {
  const sanitized = {
    ...settings,
    providers: settings.providers.map((p) => ({ ...p, apiKey: void 0 }))
  };
  return JSON.stringify(
    { version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), settings: sanitized },
    null,
    2
  );
}
function parseImportedSettings(raw) {
  const parsed = JSON.parse(raw);
  return mergeSettings(parsed.settings ?? parsed);
}

class ChromeKeyStorage {
  constructor(persistent, session) {
    this.persistent = persistent;
    this.session = session;
  }
  async readMap(area) {
    const result = await area.get(STORAGE_KEYS.API_KEYS);
    const map = result[STORAGE_KEYS.API_KEYS];
    return map && typeof map === "object" ? map : {};
  }
  async writeMap(area, map) {
    await area.set({ [STORAGE_KEYS.API_KEYS]: map });
  }
  /**
   * @param sessionOnly when true the key is written only to the session area
   *        and any persisted copy is removed.
   */
  async saveApiKey(providerId, apiKey, sessionOnly = false) {
    const targetSession = sessionOnly && this.session;
    if (targetSession) {
      const map2 = await this.readMap(this.session);
      map2[providerId] = apiKey;
      await this.writeMap(this.session, map2);
      await this.removeFrom(this.persistent, providerId);
      return;
    }
    const map = await this.readMap(this.persistent);
    map[providerId] = apiKey;
    await this.writeMap(this.persistent, map);
  }
  async getApiKey(providerId) {
    if (this.session) {
      const sessionMap = await this.readMap(this.session);
      if (sessionMap[providerId]) return sessionMap[providerId];
    }
    const map = await this.readMap(this.persistent);
    return map[providerId] ?? null;
  }
  async deleteApiKey(providerId) {
    await this.removeFrom(this.persistent, providerId);
    if (this.session) await this.removeFrom(this.session, providerId);
  }
  async removeFrom(area, providerId) {
    const map = await this.readMap(area);
    if (providerId in map) {
      delete map[providerId];
      await this.writeMap(area, map);
    }
  }
}
function createKeyStorage() {
  const local = chrome.storage.local;
  const session = chrome.storage.session;
  return new ChromeKeyStorage(local, session);
}

export { APP_NAME as A, BEHAVIORS as B, COMMON_LANGUAGES as C, MSG as M, PROVIDER_PRESETS as P, TONES as T, PROVIDER_KEY_HELP as a, APP_TAGLINE as b, createKeyStorage as c, exportSettings as e, loadSettings as l, parseImportedSettings as p, saveSettings as s };
