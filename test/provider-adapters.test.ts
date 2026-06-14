import { describe, it, expect } from "vitest";
import {
  anthropicAdapter,
  geminiAdapter,
  getAdapter,
  normalizeBaseUrl,
  openAiCompatibleAdapter,
} from "@/api/provider-adapters";
import type { ProviderConfig } from "@/shared/types";

const provider: ProviderConfig = {
  providerId: "openai",
  displayName: "OpenAI",
  baseUrl: "https://api.openai.com/v1/",
  model: "gpt-4o-mini",
  apiFormat: "openai-compatible",
};

describe("openAiCompatibleAdapter", () => {
  it("normalizes trailing slashes in base url", () => {
    expect(normalizeBaseUrl("https://x.com/v1/")).toBe("https://x.com/v1");
    expect(normalizeBaseUrl("https://x.com/v1")).toBe("https://x.com/v1");
  });

  it("builds the chat completions URL", () => {
    const { url } = openAiCompatibleAdapter.buildRequest(
      provider,
      "sk-test",
      { system: "s", user: "u" },
    );
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("puts the API key in the Authorization header, never in the body", () => {
    const { init } = openAiCompatibleAdapter.buildRequest(
      provider,
      "sk-secret",
      { system: "s", user: "u" },
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-secret");
    expect(init.body as string).not.toContain("sk-secret");
  });

  it("includes system and user messages in the body", () => {
    const { init } = openAiCompatibleAdapter.buildRequest(
      provider,
      "sk-test",
      { system: "SYS", user: "USR" },
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages[1]).toEqual({ role: "user", content: "USR" });
    expect(body.stream).toBe(false);
  });

  it("parses the assistant content", () => {
    const text = openAiCompatibleAdapter.parseResponse({
      choices: [{ message: { content: "result text" } }],
    });
    expect(text).toBe("result text");
  });

  it("throws on a malformed response", () => {
    expect(() => openAiCompatibleAdapter.parseResponse({})).toThrow();
  });
});

const claude: ProviderConfig = {
  providerId: "anthropic",
  displayName: "Anthropic (Claude)",
  baseUrl: "https://api.anthropic.com/v1",
  model: "claude-sonnet-4-5",
  apiFormat: "anthropic",
};

describe("anthropicAdapter", () => {
  it("builds the messages URL", () => {
    const { url } = anthropicAdapter.buildRequest(claude, "sk-ant", {
      system: "s",
      user: "u",
    });
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("uses x-api-key (not Authorization) and required Anthropic headers", () => {
    const { init } = anthropicAdapter.buildRequest(claude, "sk-ant-secret", {
      system: "s",
      user: "u",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-secret");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(init.body as string).not.toContain("sk-ant-secret");
  });

  it("puts the system prompt at the top level and user in messages", () => {
    const { init } = anthropicAdapter.buildRequest(claude, "sk-ant", {
      system: "SYSTEM",
      user: "USER",
    });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.system).toBe("SYSTEM");
    expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("parses concatenated text content blocks", () => {
    const text = anthropicAdapter.parseResponse({
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "Claude" },
      ],
    });
    expect(text).toBe("Hello Claude");
  });

  it("throws on an empty content array", () => {
    expect(() => anthropicAdapter.parseResponse({ content: [] })).toThrow();
  });
});

const gemini: ProviderConfig = {
  providerId: "gemini",
  displayName: "Google Gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-2.5-flash",
  apiFormat: "gemini",
};

describe("geminiAdapter", () => {
  it("puts the model in the URL path and not the key", () => {
    const { url } = geminiAdapter.buildRequest(gemini, "gkey-secret", {
      system: "s",
      user: "u",
    });
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(url).not.toContain("gkey-secret");
  });

  it("uses x-goog-api-key header and keeps the key out of the body", () => {
    const { init } = geminiAdapter.buildRequest(gemini, "gkey-secret", {
      system: "s",
      user: "u",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gkey-secret");
    expect(headers.Authorization).toBeUndefined();
    expect(init.body as string).not.toContain("gkey-secret");
  });

  it("maps system to system_instruction and user to contents", () => {
    const { init } = geminiAdapter.buildRequest(gemini, "gkey", {
      system: "SYSTEM",
      user: "USER",
    });
    const body = JSON.parse(init.body as string);
    expect(body.system_instruction.parts[0].text).toBe("SYSTEM");
    expect(body.contents[0]).toEqual({
      role: "user",
      parts: [{ text: "USER" }],
    });
  });

  it("parses candidate text parts", () => {
    const text = geminiAdapter.parseResponse({
      candidates: [
        { content: { parts: [{ text: "Hello " }, { text: "Gemini" }] } },
      ],
    });
    expect(text).toBe("Hello Gemini");
  });

  it("throws when there are no candidates", () => {
    expect(() => geminiAdapter.parseResponse({ candidates: [] })).toThrow();
  });
});

describe("getAdapter", () => {
  it("resolves all formats", () => {
    expect(getAdapter("openai-compatible").apiFormat).toBe("openai-compatible");
    expect(getAdapter("anthropic").apiFormat).toBe("anthropic");
    expect(getAdapter("gemini").apiFormat).toBe("gemini");
  });
});
