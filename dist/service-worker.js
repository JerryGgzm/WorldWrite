(function () {
  'use strict';

  const STORAGE_KEYS = {
    SETTINGS: "iaa_settings_v1",
    /** API keys are stored under this namespaced object keyed by providerId. */
    API_KEYS: "iaa_api_keys_v1",
    /** Last custom instruction; only written when privacyMode is off. */
    LAST_INSTRUCTION: "iaa_last_instruction_v1"
  };
  const MAX_INSTRUCTION_LENGTH = 500;
  const APP_NAME = "WorldWrite";
  const CONTEXT_MENU_PARENT_ID = "iaa_root";
  const CONTEXT_MENU_ITEMS = [
    { kind: "action", id: "translate", titleTemplate: "Translate my text to {targetLanguage}" },
    { kind: "action", id: "polish", titleTemplate: "Polish my {targetLanguage}" },
    {
      kind: "action",
      id: "make_professional",
      titleTemplate: "Make my {targetLanguage} more professional"
    },
    { kind: "action", id: "custom", titleTemplate: "Custom rewrite…" },
    { kind: "separator", id: "iaa_sep_1" },
    { kind: "action", id: "explain", titleTemplate: "Explain this message" },
    {
      kind: "action",
      id: "translate_to_native",
      titleTemplate: "Translate this message to {nativeLanguage}"
    }
  ];
  const TONES = [
    { value: "natural", label: "Natural" },
    { value: "professional", label: "Professional" },
    { value: "concise", label: "Concise" },
    { value: "friendly", label: "Friendly" },
    { value: "direct", label: "Direct" },
    { value: "academic", label: "Academic" },
    { value: "casual", label: "Casual" }
  ];
  const SITE_PROMPT_HINTS = {
    linkedin: "Use a professional, warm, concise tone. Avoid sounding overly salesy.",
    email: "Use a polite, clear, professional tone.",
    slack: "Use a concise, natural, conversational tone.",
    github: "Use a precise, technical, clear tone.",
    twitter: "Use a casual, concise, engaging tone.",
    generic: ""
  };
  const DEFAULT_PROVIDER = {
    providerId: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiFormat: "openai-compatible"
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
    GET_LAST_INSTRUCTION: "GET_LAST_INSTRUCTION",
    SET_LAST_INSTRUCTION: "SET_LAST_INSTRUCTION"
  };

  const ERROR_CODES = {
    NO_API_KEY: "NO_API_KEY",
    NO_PROVIDER: "NO_PROVIDER",
    INVALID_API_KEY: "INVALID_API_KEY",
    PROVIDER_REQUEST_FAILED: "PROVIDER_REQUEST_FAILED",
    MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
    RATE_LIMITED: "RATE_LIMITED",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    REQUEST_CANCELLED: "REQUEST_CANCELLED",
    EMPTY_RESPONSE: "EMPTY_RESPONSE",
    UNKNOWN: "UNKNOWN"
  };
  const USER_MESSAGES = {
    NO_TEXT_SELECTED: "No text selected. Highlight some text first.",
    EMPTY_SELECTION: "The selected text is empty.",
    UNSUPPORTED_INPUT: "This input field is not supported.",
    NO_API_KEY: "No API key configured. Add one in the extension settings.",
    NO_PROVIDER: "No AI provider configured. Open the extension settings.",
    INVALID_API_KEY: "Invalid API key. Check your key in the settings.",
    PROVIDER_REQUEST_FAILED: "Provider request failed. Please try again.",
    MODEL_NOT_FOUND: "Model not found. Check the model name in settings.",
    RATE_LIMITED: "Rate limited by the provider. Wait a moment and retry.",
    REQUEST_TIMEOUT: "Request timed out.",
    REQUEST_CANCELLED: "Request cancelled.",
    EMPTY_RESPONSE: "The AI returned an empty response. Try regenerating.",
    SELECTION_CHANGED: "The selected text changed before replacement. Please re-select.",
    CONTENT_SCRIPT_UNAVAILABLE: "This page does not allow the assistant to run here.",
    UNKNOWN: "Something went wrong. Please try again."
  };
  class AppError extends Error {
    code;
    /** Optional provider-supplied reason (sanitized) shown after the base message. */
    detail;
    constructor(code, detail) {
      super(USER_MESSAGES[code]);
      this.name = "AppError";
      this.code = code;
      this.detail = detail;
    }
    get userMessage() {
      return USER_MESSAGES[this.code] ?? USER_MESSAGES.UNKNOWN;
    }
  }
  function extractProviderError(bodyText) {
    if (!bodyText) return void 0;
    let message;
    try {
      const data = JSON.parse(bodyText);
      if (typeof data.error === "string") message = data.error;
      else message = data.error?.message ?? data.message;
    } catch {
      message = bodyText;
    }
    if (!message) return void 0;
    const trimmed = message.trim().replace(/\s+/g, " ");
    if (!trimmed) return void 0;
    return trimmed.length > 220 ? `${trimmed.slice(0, 217)}…` : trimmed;
  }
  function buildErrorMessage(code, detail, secret) {
    const base = userMessageFor(code);
    let safeDetail = detail?.trim();
    if (safeDetail && secret) {
      safeDetail = safeDetail.split(secret).join("***");
    }
    return safeDetail ? `${base} (${safeDetail})` : base;
  }
  function errorCodeFromStatus(status) {
    if (status === 401 || status === 403) return ERROR_CODES.INVALID_API_KEY;
    if (status === 404) return ERROR_CODES.MODEL_NOT_FOUND;
    if (status === 429) return ERROR_CODES.RATE_LIMITED;
    return ERROR_CODES.PROVIDER_REQUEST_FAILED;
  }
  function userMessageFor(code) {
    return USER_MESSAGES[code] ?? USER_MESSAGES.UNKNOWN;
  }

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

  class PrivacyGuard {
    constructor(settings) {
      this.settings = settings;
    }
    get privacyMode() {
      return this.settings.privacyMode;
    }
    /** History may only be saved when the user explicitly opted out of privacy. */
    canStoreHistory() {
      return !this.settings.privacyMode && this.settings.saveLocalHistory;
    }
    /** Surrounding page context may only be sent in context-aware mode. */
    canSendContext() {
      return !this.settings.privacyMode && this.settings.contextAwareMode;
    }
    /**
     * Strips a payload down to only the fields permitted to leave the browser.
     * Even if a caller accidentally attaches page content, it is removed here.
     */
    sanitizeOutgoing(payload) {
      const safe = {
        selectedText: payload.selectedText,
        action: payload.action
      };
      if (payload.customInstruction && payload.customInstruction.trim()) {
        safe.customInstruction = payload.customInstruction.trim();
      }
      if (payload.siteType) {
        safe.siteType = payload.siteType;
      }
      return safe;
    }
  }

  const COMMON_CONSTRAINTS = [
    "Preserve the user's original meaning.",
    "Do not add new facts.",
    "Do not remove important details.",
    "Do not invent context.",
    "Return only the rewritten text.",
    "Do not include explanations unless explicitly requested.",
    "Do not wrap the output in quotes or markdown code fences."
  ];
  function toneLabel(tone) {
    if (!tone) return "Natural";
    const found = TONES.find((t) => t.value === tone);
    return found ? found.label : "Natural";
  }
  function safe(value, fallback) {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  function siteHint(input) {
    if (!input.siteType) return "";
    const hint = SITE_PROMPT_HINTS[input.siteType];
    return hint ? hint : "";
  }
  function strictLine(input) {
    return input.strictMeaningPreservation ? "You must not change the meaning under any circumstances." : "";
  }
  function joinLines(lines) {
    return lines.map((l) => (l ?? "").trim()).filter((l) => l.length > 0).join("\n");
  }
  function buildPolish(input) {
    const target = safe(input.targetLanguage, "the target language");
    return joinLines([
      "You are an inline writing assistant for non-native speakers.",
      "",
      "Task:",
      `Rewrite the selected text to sound natural, fluent, and context-appropriate in ${target}.`,
      "",
      "Rules:",
      "- Preserve the user's original meaning.",
      "- Do not add new facts.",
      "- Do not remove important details.",
      "- Do not make the tone overly formal unless requested.",
      "- Keep the user's intent.",
      "- Return only the rewritten text.",
      strictLine(input),
      siteHint(input) && `- Context: ${siteHint(input)}`,
      "",
      "Tone:",
      toneLabel(input.tone)
    ]);
  }
  function buildTranslate(input) {
    const native = safe(input.nativeLanguage, "the source language");
    const target = safe(input.targetLanguage, "the target language");
    return joinLines([
      "You are a precise translation assistant.",
      "",
      "Task:",
      `Translate the selected text from ${native} to ${target}.`,
      "",
      "Rules:",
      "- Preserve the meaning, intent, and level of formality.",
      "- Make the translation sound natural to a native speaker.",
      "- Do not add new facts.",
      "- Do not remove important details.",
      "- Return only the translated text.",
      strictLine(input),
      siteHint(input) && `- Context: ${siteHint(input)}`
    ]);
  }
  function buildTranslateToNative(input) {
    const native = safe(input.nativeLanguage, "the user's native language");
    const extra = (input.customInstruction ?? "").trim();
    return joinLines([
      "You are a precise translation assistant.",
      "",
      "Task:",
      `Detect the language of the selected text and translate it into ${native}.`,
      "",
      "Rules:",
      "- Preserve the meaning, intent, and level of formality.",
      `- Make the translation sound natural to a native ${native} speaker.`,
      `- If the text is already in ${native}, return it unchanged.`,
      "- Do not add new facts.",
      "- Do not remove important details.",
      "- Do not add explanations or transliterations.",
      "- Return only the translated text.",
      extra && `- Additional instruction from the reader: ${extra}`,
      strictLine(input)
    ]);
  }
  function buildExplain(input) {
    const native = safe(input.nativeLanguage, "the user's native language");
    const extra = (input.customInstruction ?? "").trim();
    return joinLines([
      "You are a helpful communication assistant.",
      "",
      "Task:",
      `Explain, in ${native}, what the selected message means.`,
      "Clarify the intent, tone, and any nuance or implied meaning so the reader fully understands it.",
      "",
      "Rules:",
      "- Be concise and clear.",
      `- Write the explanation in ${native}.`,
      "- Explain the meaning rather than translating word-for-word.",
      "- Do not add new facts or claims that are not supported by the message.",
      extra && `- Additional instruction from the reader: ${extra}`
    ]);
  }
  function buildFixGrammar(input) {
    return joinLines([
      "You are a grammar correction assistant.",
      "",
      "Task:",
      "Fix only grammar, spelling, and punctuation issues in the selected text.",
      "",
      "Rules:",
      "- Do not rewrite the style.",
      "- Do not change the meaning.",
      "- Do not add or remove information.",
      "- Preserve the user's wording as much as possible.",
      "- Return only the corrected text.",
      strictLine(input)
    ]);
  }
  function buildProfessional(input) {
    const target = safe(input.targetLanguage, "the target language");
    return joinLines([
      "You are an inline writing assistant for non-native speakers.",
      "",
      "Task:",
      `Rewrite the selected text to sound more professional and polished in ${target}.`,
      "",
      "Rules:",
      ...COMMON_CONSTRAINTS.map((c) => `- ${c}`),
      "- Keep it professional but not stiff or robotic.",
      strictLine(input),
      siteHint(input) && `- Context: ${siteHint(input)}`
    ]);
  }
  function buildConcise(input) {
    const target = safe(input.targetLanguage, "the target language");
    return joinLines([
      "You are an inline writing assistant for non-native speakers.",
      "",
      "Task:",
      `Rewrite the selected text to be more concise and clear in ${target}.`,
      "",
      "Rules:",
      ...COMMON_CONSTRAINTS.map((c) => `- ${c}`),
      "- Remove redundancy without dropping important details.",
      strictLine(input),
      siteHint(input) && `- Context: ${siteHint(input)}`
    ]);
  }
  function buildCustom(input) {
    const instruction = safe(
      input.customInstruction,
      "Improve the selected text while keeping its meaning."
    );
    return joinLines([
      "You are an inline writing assistant.",
      "",
      "User instruction:",
      instruction,
      "",
      "Rules:",
      "- Follow the user's instruction.",
      "- Preserve the original meaning unless the user explicitly asks to change it.",
      "- Do not add unsupported facts.",
      "- Do not invent context.",
      "- Return only the revised text.",
      "- Do not wrap the output in quotes or markdown code fences.",
      siteHint(input) && `- Context: ${siteHint(input)}`
    ]);
  }
  const BUILDERS = {
    translate: buildTranslate,
    translate_to_native: buildTranslateToNative,
    explain: buildExplain,
    polish: buildPolish,
    fix_grammar: buildFixGrammar,
    make_professional: buildProfessional,
    make_concise: buildConcise,
    custom: buildCustom
  };
  function buildPrompt(input) {
    const builder = BUILDERS[input.action] ?? buildPolish;
    const system = builder(input);
    const selected = safe(input.selectedText, "");
    const user = `Selected text:
${selected}`;
    return { system, user };
  }

  function normalizeBaseUrl(baseUrl) {
    return baseUrl.trim().replace(/\/+$/, "");
  }
  const openAiCompatibleAdapter = {
    apiFormat: "openai-compatible",
    buildRequest(provider, apiKey, prompt) {
      const url = `${normalizeBaseUrl(provider.baseUrl)}/chat/completions`;
      const body = {
        model: provider.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        temperature: 0.3,
        stream: false
      };
      return {
        url,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        }
      };
    },
    parseResponse(json) {
      const data = json;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new AppError(ERROR_CODES.EMPTY_RESPONSE);
      }
      return content;
    }
  };
  const anthropicAdapter = {
    apiFormat: "anthropic",
    buildRequest(provider, apiKey, prompt) {
      const url = `${normalizeBaseUrl(provider.baseUrl)}/messages`;
      const body = {
        model: provider.model,
        max_tokens: 4096,
        temperature: 0.3,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }]
      };
      return {
        url,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify(body)
        }
      };
    },
    parseResponse(json) {
      const data = json;
      const text = data?.content?.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
      if (typeof text !== "string" || text.length === 0) {
        throw new AppError(ERROR_CODES.EMPTY_RESPONSE);
      }
      return text;
    }
  };
  const geminiAdapter = {
    apiFormat: "gemini",
    buildRequest(provider, apiKey, prompt) {
      const model = encodeURIComponent(provider.model);
      const url = `${normalizeBaseUrl(provider.baseUrl)}/models/${model}:generateContent`;
      const body = {
        system_instruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: "user", parts: [{ text: prompt.user }] }],
        generationConfig: { temperature: 0.3 }
      };
      return {
        url,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(body)
        }
      };
    },
    parseResponse(json) {
      const data = json;
      const parts = data?.candidates?.[0]?.content?.parts;
      const text = parts?.filter((p) => typeof p?.text === "string").map((p) => p.text).join("");
      if (typeof text !== "string" || text.length === 0) {
        throw new AppError(ERROR_CODES.EMPTY_RESPONSE);
      }
      return text;
    }
  };
  const ADAPTERS = {
    "openai-compatible": openAiCompatibleAdapter,
    anthropic: anthropicAdapter,
    gemini: geminiAdapter
  };
  function getAdapter(format) {
    const adapter = ADAPTERS[format];
    if (!adapter) throw new AppError(ERROR_CODES.NO_PROVIDER);
    return adapter;
  }

  function cleanModelOutput(raw) {
    let text = (raw ?? "").trim();
    if (!text) return "";
    const fenceMatch = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }
    text = text.replace(
      /^(sure|certainly|of course|here(?:'s| is))[^\n]*:\s*\n+/i,
      ""
    );
    const quotePairs = [
      ['"', '"'],
      ["'", "'"],
      ["“", "”"],
      ["‘", "’"],
      ["「", "」"]
    ];
    for (const [open, close] of quotePairs) {
      if (text.length >= 2 && text.startsWith(open) && text.endsWith(close) && // avoid stripping quotes that are part of the content (interior quote)
      !text.slice(1, -1).includes(close)) {
        text = text.slice(1, -1).trim();
        break;
      }
    }
    return text.trim();
  }
  const HARD_TIMEOUT_MS = 6e4;
  async function callLlm(provider, apiKey, prompt, signal) {
    if (!apiKey) throw new AppError(ERROR_CODES.NO_API_KEY);
    const adapter = getAdapter(provider.apiFormat);
    const { url, init } = adapter.buildRequest(provider, apiKey, prompt);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), HARD_TIMEOUT_MS);
    const onExternalAbort = () => timeoutController.abort();
    signal.addEventListener("abort", onExternalAbort);
    let response;
    try {
      response = await fetch(url, { ...init, signal: timeoutController.signal });
    } catch (err) {
      if (signal.aborted) throw new AppError(ERROR_CODES.REQUEST_CANCELLED);
      if (timeoutController.signal.aborted)
        throw new AppError(ERROR_CODES.REQUEST_TIMEOUT);
      throw new AppError(ERROR_CODES.PROVIDER_REQUEST_FAILED);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onExternalAbort);
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const detail = extractProviderError(bodyText);
      throw new AppError(errorCodeFromStatus(response.status), detail);
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new AppError(ERROR_CODES.PROVIDER_REQUEST_FAILED);
    }
    const content = adapter.parseResponse(json);
    const cleaned = cleanModelOutput(content);
    if (!cleaned) throw new AppError(ERROR_CODES.EMPTY_RESPONSE);
    return cleaned;
  }

  function titleFor(template, settings) {
    return template.replace("{targetLanguage}", settings.targetLanguage).replace("{nativeLanguage}", settings.nativeLanguage);
  }
  async function rebuildContextMenu() {
    const settings = await loadSettings();
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PARENT_ID,
      title: APP_NAME,
      contexts: ["editable", "selection"]
    });
    for (const item of CONTEXT_MENU_ITEMS) {
      if (item.kind === "separator") {
        chrome.contextMenus.create({
          id: item.id,
          parentId: CONTEXT_MENU_PARENT_ID,
          type: "separator",
          contexts: ["editable", "selection"]
        });
        continue;
      }
      chrome.contextMenus.create({
        id: item.id,
        parentId: CONTEXT_MENU_PARENT_ID,
        title: titleFor(item.titleTemplate, settings),
        contexts: ["editable", "selection"]
      });
    }
  }
  const ACTION_IDS = new Set(
    CONTEXT_MENU_ITEMS.filter((i) => i.kind === "action").map((i) => i.id)
  );
  function registerContextMenuClicks() {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.parentMenuItemId !== CONTEXT_MENU_PARENT_ID) return;
      if (!tab?.id) return;
      if (!ACTION_IDS.has(String(info.menuItemId))) return;
      const action = info.menuItemId;
      void loadSettings().then((settings) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: MSG.CONTEXT_MENU_ACTION,
            action,
            targetLanguage: settings.targetLanguage,
            nativeLanguage: settings.nativeLanguage
          },
          { frameId: info.frameId }
        ).catch(() => {
        });
      });
    });
  }

  const keyStorage = createKeyStorage();
  const inFlight = /* @__PURE__ */ new Map();
  function activeProvider(settings) {
    return settings.providers.find((p) => p.providerId === settings.activeProviderId) ?? settings.providers[0] ?? null;
  }
  async function handleRewrite(requestId, payload) {
    const settings = await loadSettings();
    const guard = new PrivacyGuard(settings);
    const safePayload = guard.sanitizeOutgoing(payload);
    const provider = activeProvider(settings);
    if (!provider) {
      return fail(requestId, ERROR_CODES.NO_PROVIDER);
    }
    const apiKey = await keyStorage.getApiKey(provider.providerId);
    if (!apiKey) {
      return fail(requestId, ERROR_CODES.NO_API_KEY);
    }
    const prompt = buildPrompt({
      selectedText: safePayload.selectedText,
      action: safePayload.action,
      nativeLanguage: settings.nativeLanguage,
      targetLanguage: settings.targetLanguage,
      tone: settings.defaultTone,
      customInstruction: safePayload.customInstruction,
      strictMeaningPreservation: settings.defaultBehavior === "preserve_meaning_strictly",
      siteType: safePayload.siteType
    });
    const controller = new AbortController();
    inFlight.set(requestId, controller);
    try {
      const text = await callLlm(provider, apiKey, prompt, controller.signal);
      return { ok: true, requestId, text };
    } catch (err) {
      if (err instanceof AppError) {
        return fail(requestId, err.code, buildErrorMessage(err.code, err.detail, apiKey));
      }
      return fail(requestId, ERROR_CODES.UNKNOWN);
    } finally {
      inFlight.delete(requestId);
    }
  }
  function fail(requestId, code, message) {
    return {
      ok: false,
      requestId,
      errorCode: code,
      message: message ?? userMessageFor(code)
    };
  }
  async function handleTestConnection(provider, apiKey) {
    if (!apiKey) {
      return { ok: false, message: "No API key provided." };
    }
    const controller = new AbortController();
    try {
      const text = await callLlm(
        provider,
        apiKey,
        {
          system: "You are a connection tester. Reply with the single word: OK.",
          user: "Reply with OK."
        },
        controller.signal
      );
      return {
        ok: true,
        message: `Connection successful. Model responded (${text.slice(0, 40)}).`
      };
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false, message: buildErrorMessage(err.code, err.detail, apiKey) };
      }
      return { ok: false, message: humanize(ERROR_CODES.UNKNOWN) };
    }
  }
  async function getLastInstruction() {
    const settings = await loadSettings();
    if (settings.privacyMode) return "";
    const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_INSTRUCTION);
    const value = result[STORAGE_KEYS.LAST_INSTRUCTION];
    return typeof value === "string" ? value : "";
  }
  async function setLastInstruction(instruction) {
    const settings = await loadSettings();
    if (settings.privacyMode) {
      await chrome.storage.local.remove(STORAGE_KEYS.LAST_INSTRUCTION);
      return;
    }
    const trimmed = instruction.trim().slice(0, MAX_INSTRUCTION_LENGTH);
    if (!trimmed) {
      await chrome.storage.local.remove(STORAGE_KEYS.LAST_INSTRUCTION);
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_INSTRUCTION]: trimmed });
  }
  function humanize(code) {
    switch (code) {
      case ERROR_CODES.INVALID_API_KEY:
        return "Invalid API key.";
      case ERROR_CODES.MODEL_NOT_FOUND:
        return "Model not found. Check the model name.";
      case ERROR_CODES.RATE_LIMITED:
        return "Rate limited. Try again shortly.";
      case ERROR_CODES.REQUEST_TIMEOUT:
        return "Request timed out.";
      default:
        return "Provider request failed. Check base URL and model.";
    }
  }
  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return false;
      switch (message.type) {
        case MSG.REWRITE_REQUEST: {
          handleRewrite(message.requestId, message.payload).then(sendResponse);
          return true;
        }
        case MSG.CANCEL_REQUEST: {
          const controller = inFlight.get(message.requestId);
          controller?.abort();
          inFlight.delete(message.requestId);
          sendResponse({ ok: true });
          return false;
        }
        case MSG.TEST_CONNECTION: {
          handleTestConnection(message.provider, message.apiKey).then(
            sendResponse
          );
          return true;
        }
        case MSG.OPEN_OPTIONS: {
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          return false;
        }
        case MSG.GET_LAST_INSTRUCTION: {
          getLastInstruction().then((value) => sendResponse({ value }));
          return true;
        }
        case MSG.SET_LAST_INSTRUCTION: {
          setLastInstruction(message.instruction).then(
            () => sendResponse({ ok: true })
          );
          return true;
        }
        default:
          return false;
      }
    }
  );
  const COMMAND_ACTIONS = {
    "polish-selection": "polish",
    "translate-selection": "translate",
    "translate-to-native-selection": "translate_to_native"
  };
  chrome.commands?.onCommand.addListener((command) => {
    const action = COMMAND_ACTIONS[command];
    if (!action) return;
    void loadSettings().then((settings) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) return;
        chrome.tabs.sendMessage(tab.id, {
          type: MSG.CONTEXT_MENU_ACTION,
          action,
          viaShortcut: true,
          targetLanguage: settings.targetLanguage,
          nativeLanguage: settings.nativeLanguage
        }).catch(() => {
        });
      });
    });
  });
  chrome.runtime.onInstalled.addListener((details) => {
    void rebuildContextMenu();
    if (details.reason === "install") {
      chrome.runtime.openOptionsPage();
    }
  });
  chrome.runtime.onStartup.addListener(() => {
    void rebuildContextMenu();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEYS.SETTINGS]) {
      void rebuildContextMenu();
      const next = changes[STORAGE_KEYS.SETTINGS].newValue;
      if (next?.privacyMode) {
        void chrome.storage.local.remove(STORAGE_KEYS.LAST_INSTRUCTION);
      }
    }
  });
  registerContextMenuClicks();

})();
