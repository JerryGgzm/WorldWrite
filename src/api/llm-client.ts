import type { BuiltPrompt, ProviderConfig } from "@/shared/types";
import {
  AppError,
  ERROR_CODES,
  errorCodeFromStatus,
  extractProviderError,
} from "@/shared/errors";
import { getAdapter } from "./provider-adapters";

/**
 * Cleans common model artefacts so the user sees only the rewritten text.
 * Conservative on purpose: it removes wrapping fences/quotes/labels but never
 * touches the inner content.
 */
export function cleanModelOutput(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  // Strip a single wrapping fenced code block: ```lang\n ... \n```
  const fenceMatch = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Strip a leading conversational preamble line like "Sure, here is the text:"
  // — only when the first line starts with a known filler and ends with a colon.
  text = text.replace(
    /^(sure|certainly|of course|here(?:'s| is))[^\n]*:\s*\n+/i,
    "",
  );

  // Strip a single pair of wrapping quotes if they enclose the whole string.
  const quotePairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["「", "」"],
  ];
  for (const [open, close] of quotePairs) {
    if (
      text.length >= 2 &&
      text.startsWith(open) &&
      text.endsWith(close) &&
      // avoid stripping quotes that are part of the content (interior quote)
      !text.slice(1, -1).includes(close)
    ) {
      text = text.slice(1, -1).trim();
      break;
    }
  }

  return text.trim();
}

const HARD_TIMEOUT_MS = 60_000;

/**
 * Calls the configured provider and returns cleaned text. Runs only in the
 * background service worker so the API key never reaches a page context.
 *
 * @param signal external AbortSignal (tied to the requestId) for cancellation.
 */
export async function callLlm(
  provider: ProviderConfig,
  apiKey: string,
  prompt: BuiltPrompt,
  signal: AbortSignal,
): Promise<string> {
  if (!apiKey) throw new AppError(ERROR_CODES.NO_API_KEY);

  const adapter = getAdapter(provider.apiFormat);
  const { url, init } = adapter.buildRequest(provider, apiKey, prompt);

  // Combine the external signal with a hard timeout guard.
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), HARD_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  signal.addEventListener("abort", onExternalAbort);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: timeoutController.signal });
  } catch (err) {
    if (signal.aborted) throw new AppError(ERROR_CODES.REQUEST_CANCELLED);
    if (timeoutController.signal.aborted)
      throw new AppError(ERROR_CODES.REQUEST_TIMEOUT);
    // Network-level failure. Never include the raw error (may contain URL/key).
    throw new AppError(ERROR_CODES.PROVIDER_REQUEST_FAILED);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onExternalAbort);
  }

  if (!response.ok) {
    // Read the body to surface the provider's real reason (e.g. which quota was
    // exceeded). The key lives in a header, not the body; the background worker
    // still redacts the key from the detail before showing it, as defence in
    // depth.
    const bodyText = await response.text().catch(() => "");
    const detail = extractProviderError(bodyText);
    throw new AppError(errorCodeFromStatus(response.status), detail);
  }

  let json: unknown;
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
