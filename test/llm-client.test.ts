import { describe, it, expect, vi, afterEach } from "vitest";
import { callLlm, cleanModelOutput } from "@/api/llm-client";
import { ERROR_CODES, AppError } from "@/shared/errors";
import type { ProviderConfig } from "@/shared/types";

const provider: ProviderConfig = {
  providerId: "openai",
  displayName: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiFormat: "openai-compatible",
};

function mockFetchOnce(impl: typeof fetch) {
  vi.stubGlobal("fetch", impl);
}

function okResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => "",
  } as unknown as Response;
}

function errResponse(status: number, body = "error body that must not leak"): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cleanModelOutput", () => {
  it("strips wrapping markdown fences", () => {
    expect(cleanModelOutput("```\nhello\n```")).toBe("hello");
    expect(cleanModelOutput("```text\nhello world\n```")).toBe("hello world");
  });

  it("strips a single pair of wrapping quotes", () => {
    expect(cleanModelOutput('"hello"')).toBe("hello");
    expect(cleanModelOutput("“hello”")).toBe("hello");
  });

  it("does not strip interior quotes", () => {
    expect(cleanModelOutput('say "hi" to them')).toBe('say "hi" to them');
  });

  it("strips a leading conversational label", () => {
    expect(cleanModelOutput("Sure, here is the text:\nHello there")).toBe(
      "Hello there",
    );
  });

  it("returns empty for blank input", () => {
    expect(cleanModelOutput("   ")).toBe("");
  });
});

describe("callLlm", () => {
  it("returns cleaned text on success", async () => {
    mockFetchOnce((async () => okResponse('"Polished text"')) as typeof fetch);
    const out = await callLlm(provider, "sk-test", { system: "s", user: "u" }, new AbortController().signal);
    expect(out).toBe("Polished text");
  });

  it("maps 401 to INVALID_API_KEY and does not leak the body", async () => {
    mockFetchOnce((async () => errResponse(401)) as typeof fetch);
    await expect(
      callLlm(provider, "sk-test", { system: "s", user: "u" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_API_KEY });
  });

  it("maps 404 to MODEL_NOT_FOUND", async () => {
    mockFetchOnce((async () => errResponse(404)) as typeof fetch);
    await expect(
      callLlm(provider, "sk-test", { system: "s", user: "u" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: ERROR_CODES.MODEL_NOT_FOUND });
  });

  it("maps 429 to RATE_LIMITED and surfaces the provider reason", async () => {
    mockFetchOnce((async () =>
      errResponse(
        429,
        JSON.stringify({ error: { message: "Quota exceeded for free tier" } }),
      )) as typeof fetch);
    await expect(
      callLlm(provider, "sk-test", { system: "s", user: "u" }, new AbortController().signal),
    ).rejects.toMatchObject({
      code: ERROR_CODES.RATE_LIMITED,
      detail: "Quota exceeded for free tier",
    });
  });

  it("treats an empty response as EMPTY_RESPONSE", async () => {
    mockFetchOnce((async () => okResponse("   ")) as typeof fetch);
    await expect(
      callLlm(provider, "sk-test", { system: "s", user: "u" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: ERROR_CODES.EMPTY_RESPONSE });
  });

  it("throws NO_API_KEY when key missing", async () => {
    await expect(
      callLlm(provider, "", { system: "s", user: "u" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: ERROR_CODES.NO_API_KEY });
  });

  it("maps an external abort to REQUEST_CANCELLED", async () => {
    const controller = new AbortController();
    mockFetchOnce(((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as unknown as typeof fetch);
    const promise = callLlm(provider, "sk", { system: "s", user: "u" }, controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({
      code: ERROR_CODES.REQUEST_CANCELLED,
    });
  });
});
