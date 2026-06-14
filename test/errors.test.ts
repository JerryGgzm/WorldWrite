import { describe, it, expect } from "vitest";
import {
  AppError,
  ERROR_CODES,
  buildErrorMessage,
  errorCodeFromStatus,
  extractProviderError,
  userMessageFor,
} from "@/shared/errors";

describe("extractProviderError", () => {
  it("reads error.message from an OpenAI/Anthropic/Gemini-style body", () => {
    expect(
      extractProviderError(
        JSON.stringify({ error: { message: "Quota exceeded for requests" } }),
      ),
    ).toBe("Quota exceeded for requests");
  });

  it("supports a top-level message and string error", () => {
    expect(extractProviderError(JSON.stringify({ message: "boom" }))).toBe(
      "boom",
    );
    expect(extractProviderError(JSON.stringify({ error: "nope" }))).toBe("nope");
  });

  it("falls back to raw text and truncates very long details", () => {
    const long = "x".repeat(400);
    const out = extractProviderError(long)!;
    expect(out.length).toBeLessThanOrEqual(220);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns undefined for empty input", () => {
    expect(extractProviderError("")).toBeUndefined();
  });
});

describe("buildErrorMessage", () => {
  it("appends the provider detail to the base message", () => {
    const msg = buildErrorMessage(
      ERROR_CODES.RATE_LIMITED,
      "Quota exceeded for quota metric 'free_tier_requests'",
    );
    expect(msg).toContain(userMessageFor(ERROR_CODES.RATE_LIMITED));
    expect(msg).toContain("Quota exceeded");
  });

  it("redacts the API key if it ever appears in the detail", () => {
    const msg = buildErrorMessage(
      ERROR_CODES.INVALID_API_KEY,
      "key sk-abc123 is invalid",
      "sk-abc123",
    );
    expect(msg).not.toContain("sk-abc123");
    expect(msg).toContain("***");
  });

  it("returns just the base message when there is no detail", () => {
    expect(buildErrorMessage(ERROR_CODES.RATE_LIMITED)).toBe(
      userMessageFor(ERROR_CODES.RATE_LIMITED),
    );
  });
});

describe("errorCodeFromStatus", () => {
  it("maps common statuses", () => {
    expect(errorCodeFromStatus(401)).toBe(ERROR_CODES.INVALID_API_KEY);
    expect(errorCodeFromStatus(403)).toBe(ERROR_CODES.INVALID_API_KEY);
    expect(errorCodeFromStatus(404)).toBe(ERROR_CODES.MODEL_NOT_FOUND);
    expect(errorCodeFromStatus(429)).toBe(ERROR_CODES.RATE_LIMITED);
    expect(errorCodeFromStatus(500)).toBe(ERROR_CODES.PROVIDER_REQUEST_FAILED);
  });
});

describe("AppError", () => {
  it("carries a code and optional detail", () => {
    const err = new AppError(ERROR_CODES.RATE_LIMITED, "too many requests");
    expect(err.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(err.detail).toBe("too many requests");
    expect(err.userMessage).toBe(userMessageFor(ERROR_CODES.RATE_LIMITED));
  });
});
