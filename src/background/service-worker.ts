import { MAX_INSTRUCTION_LENGTH, STORAGE_KEYS } from "@/shared/constants";
import { MSG } from "@/shared/types";
import type {
  ProviderConfig,
  RewriteAction,
  RewriteResponse,
  RuntimeMessage,
  TestConnectionResponse,
  UserSettings,
} from "@/shared/types";
import {
  AppError,
  ERROR_CODES,
  buildErrorMessage,
  userMessageFor,
} from "@/shared/errors";
import { loadSettings } from "@/options/options-storage";
import { createKeyStorage } from "@/security/key-storage";
import { PrivacyGuard } from "@/security/privacy-guard";
import { buildPrompt } from "@/api/prompt-builder";
import { callLlm } from "@/api/llm-client";
import { rebuildContextMenu, registerContextMenuClicks } from "./context-menu";

const keyStorage = createKeyStorage();

/** Tracks in-flight requests so they can be aborted by requestId. */
const inFlight = new Map<string, AbortController>();

function activeProvider(settings: UserSettings): ProviderConfig | null {
  return (
    settings.providers.find((p) => p.providerId === settings.activeProviderId) ??
    settings.providers[0] ??
    null
  );
}

async function handleRewrite(
  requestId: string,
  payload: import("@/shared/types").RewritePayload,
): Promise<RewriteResponse> {
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
    strictMeaningPreservation:
      settings.defaultBehavior === "preserve_meaning_strictly",
    siteType: safePayload.siteType,
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

function fail(requestId: string, code: string, message?: string): RewriteResponse {
  return {
    ok: false,
    requestId,
    errorCode: code,
    message: message ?? userMessageFor(code),
  };
}

async function handleTestConnection(
  provider: ProviderConfig,
  apiKey: string,
): Promise<TestConnectionResponse> {
  if (!apiKey) {
    return { ok: false, message: "No API key provided." };
  }
  const controller = new AbortController();
  try {
    const text = await callLlm(
      provider,
      apiKey,
      {
        system:
          "You are a connection tester. Reply with the single word: OK.",
        user: "Reply with OK.",
      },
      controller.signal,
    );
    return {
      ok: true,
      message: `Connection successful. Model responded (${text.slice(0, 40)}).`,
    };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, message: buildErrorMessage(err.code, err.detail, apiKey) };
    }
    return { ok: false, message: humanize(ERROR_CODES.UNKNOWN) };
  }
}

/**
 * Returns the last custom instruction. Honors privacy mode: when on, nothing is
 * ever read back (and any stray value is treated as empty).
 */
async function getLastInstruction(): Promise<string> {
  const settings = await loadSettings();
  if (settings.privacyMode) return "";
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_INSTRUCTION);
  const value = result[STORAGE_KEYS.LAST_INSTRUCTION];
  return typeof value === "string" ? value : "";
}

/**
 * Persists the last custom instruction, but only when privacy mode is off.
 * In privacy mode any previously stored value is cleared to leave no trace.
 */
async function setLastInstruction(instruction: string): Promise<void> {
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

function humanize(code: string): string {
  // Lazy import avoided; map a few common codes for the options UI.
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
  (message: RuntimeMessage, sender, sendResponse) => {
    // Only accept messages originating from this extension's own content scripts
    // and pages. Web pages cannot message us (no externally_connectable), but we
    // verify the sender id as defence in depth.
    if (sender.id !== chrome.runtime.id) return false;
    switch (message.type) {
      case MSG.REWRITE_REQUEST: {
        handleRewrite(message.requestId, message.payload).then(sendResponse);
        return true; // async
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
          sendResponse,
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
        setLastInstruction(message.instruction).then(() =>
          sendResponse({ ok: true }),
        );
        return true;
      }
      default:
        return false;
    }
  },
);

// Keyboard shortcuts: forward to every frame; the focused frame responds.
const COMMAND_ACTIONS: Record<string, RewriteAction> = {
  "polish-selection": "polish",
  "translate-selection": "translate",
  "translate-to-native-selection": "translate_to_native",
};

chrome.commands?.onCommand.addListener((command) => {
  const action = COMMAND_ACTIONS[command];
  if (!action) return;
  void loadSettings().then((settings) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.tabs
        .sendMessage(tab.id, {
          type: MSG.CONTEXT_MENU_ACTION,
          action,
          viaShortcut: true,
          targetLanguage: settings.targetLanguage,
          nativeLanguage: settings.nativeLanguage,
        })
        .catch(() => {});
    });
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  void rebuildContextMenu();
  // First-run: take the user straight to setup so they are never stuck.
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void rebuildContextMenu();
});

// Keep the "Translate to {lang}" label in sync with the user's settings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.SETTINGS]) {
    void rebuildContextMenu();
    // If the user just enabled privacy mode, leave no stored instruction behind.
    const next = changes[STORAGE_KEYS.SETTINGS].newValue as
      | Partial<UserSettings>
      | undefined;
    if (next?.privacyMode) {
      void chrome.storage.local.remove(STORAGE_KEYS.LAST_INSTRUCTION);
    }
  }
});

registerContextMenuClicks();
