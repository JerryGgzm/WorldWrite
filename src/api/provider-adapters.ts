import type { ApiFormat, BuiltPrompt, ProviderConfig } from "@/shared/types";
import { AppError, ERROR_CODES } from "@/shared/errors";

export interface ProviderRequest {
  url: string;
  init: RequestInit;
}

export interface ProviderAdapter {
  apiFormat: ApiFormat;
  /**
   * Builds the HTTP request. `apiKey` is passed in only here, in the background
   * worker, and is placed in the Authorization header — never in the body.
   */
  buildRequest(
    provider: ProviderConfig,
    apiKey: string,
    prompt: BuiltPrompt,
  ): ProviderRequest;
  /** Extracts the assistant text from a parsed JSON response. */
  parseResponse(json: unknown): string;
}

/** Removes a trailing slash so we can safely append a path. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  apiFormat: "openai-compatible",

  buildRequest(provider, apiKey, prompt): ProviderRequest {
    const url = `${normalizeBaseUrl(provider.baseUrl)}/chat/completions`;
    const body = {
      model: provider.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: 0.3,
      stream: false,
    };
    return {
      url,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json): string {
    const data = json as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new AppError(ERROR_CODES.EMPTY_RESPONSE);
    }
    return content;
  },
};

/**
 * Anthropic (Claude) uses the Messages API, which differs from OpenAI:
 * - endpoint is `/messages`
 * - auth is the `x-api-key` header (not `Authorization: Bearer`)
 * - requires `anthropic-version` and, for browser/extension contexts, the
 *   `anthropic-dangerous-direct-browser-access` header to satisfy CORS
 * - the system prompt is a top-level field, not a message
 * - `max_tokens` is required
 * - the response text lives in `content[].text` blocks
 */
export const anthropicAdapter: ProviderAdapter = {
  apiFormat: "anthropic",

  buildRequest(provider, apiKey, prompt): ProviderRequest {
    const url = `${normalizeBaseUrl(provider.baseUrl)}/messages`;
    const body = {
      model: provider.model,
      max_tokens: 4096,
      temperature: 0.3,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    };
    return {
      url,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json): string {
    const data = json as {
      content?: { type?: string; text?: string }[];
    };
    const text = data?.content
      ?.filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    if (typeof text !== "string" || text.length === 0) {
      throw new AppError(ERROR_CODES.EMPTY_RESPONSE);
    }
    return text;
  },
};

/**
 * Google Gemini uses the `generateContent` endpoint, which differs again:
 * - the model is part of the URL path (`/models/{model}:generateContent`)
 * - auth is the `x-goog-api-key` header (kept out of the URL so it never lands
 *   in logs or history)
 * - the system prompt is `system_instruction`, the user turn goes in `contents`
 * - the response text lives in `candidates[].content.parts[].text`
 */
export const geminiAdapter: ProviderAdapter = {
  apiFormat: "gemini",

  buildRequest(provider, apiKey, prompt): ProviderRequest {
    const model = encodeURIComponent(provider.model);
    const url = `${normalizeBaseUrl(provider.baseUrl)}/models/${model}:generateContent`;
    const body = {
      system_instruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: "user", parts: [{ text: prompt.user }] }],
      generationConfig: { temperature: 0.3 },
    };
    return {
      url,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json): string {
    const data = json as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = parts
      ?.filter((p) => typeof p?.text === "string")
      .map((p) => p.text as string)
      .join("");
    if (typeof text !== "string" || text.length === 0) {
      throw new AppError(ERROR_CODES.EMPTY_RESPONSE);
    }
    return text;
  },
};

const ADAPTERS: Record<ApiFormat, ProviderAdapter> = {
  "openai-compatible": openAiCompatibleAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

export function getAdapter(format: ApiFormat): ProviderAdapter {
  const adapter = ADAPTERS[format];
  if (!adapter) throw new AppError(ERROR_CODES.NO_PROVIDER);
  return adapter;
}
