// Centralised, user-facing error codes and messages. Raw stack traces and
// provider responses must never be shown directly to the user.

export const ERROR_CODES = {
  NO_TEXT_SELECTED: "NO_TEXT_SELECTED",
  EMPTY_SELECTION: "EMPTY_SELECTION",
  UNSUPPORTED_INPUT: "UNSUPPORTED_INPUT",
  NO_API_KEY: "NO_API_KEY",
  NO_PROVIDER: "NO_PROVIDER",
  INVALID_API_KEY: "INVALID_API_KEY",
  PROVIDER_REQUEST_FAILED: "PROVIDER_REQUEST_FAILED",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
  SELECTION_CHANGED: "SELECTION_CHANGED",
  CONTENT_SCRIPT_UNAVAILABLE: "CONTENT_SCRIPT_UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const USER_MESSAGES: Record<ErrorCode, string> = {
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
  SELECTION_CHANGED:
    "The selected text changed before replacement. Please re-select.",
  CONTENT_SCRIPT_UNAVAILABLE:
    "This page does not allow the assistant to run here.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Optional provider-supplied reason (sanitized) shown after the base message. */
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string) {
    super(USER_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
  }

  get userMessage(): string {
    return USER_MESSAGES[this.code] ?? USER_MESSAGES.UNKNOWN;
  }
}

/**
 * Extracts a short, human-readable reason from a provider error body. OpenAI,
 * Anthropic and Gemini all expose it at `error.message`. Truncated and returned
 * as plain text; callers are responsible for redacting any secrets.
 */
export function extractProviderError(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  let message: string | undefined;
  try {
    const data = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string } | string;
      message?: string;
    };
    if (typeof data.error === "string") message = data.error;
    else message = data.error?.message ?? data.message;
  } catch {
    message = bodyText;
  }
  if (!message) return undefined;
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}…` : trimmed;
}

/** Combines the canned message with an optional, key-redacted provider detail. */
export function buildErrorMessage(
  code: string,
  detail?: string,
  secret?: string,
): string {
  const base = userMessageFor(code);
  let safeDetail = detail?.trim();
  if (safeDetail && secret) {
    safeDetail = safeDetail.split(secret).join("***");
  }
  return safeDetail ? `${base} (${safeDetail})` : base;
}

/**
 * Maps an HTTP status code to a safe error code. Never includes the raw
 * provider body to avoid leaking secrets or stack traces.
 */
export function errorCodeFromStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return ERROR_CODES.INVALID_API_KEY;
  if (status === 404) return ERROR_CODES.MODEL_NOT_FOUND;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  return ERROR_CODES.PROVIDER_REQUEST_FAILED;
}

export function userMessageFor(code: string): string {
  return (USER_MESSAGES as Record<string, string>)[code] ?? USER_MESSAGES.UNKNOWN;
}
