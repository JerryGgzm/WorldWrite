import { describe, it, expect } from "vitest";
import { computeWordDiff } from "@/content/diff";

describe("computeWordDiff", () => {
  it("marks identical text as equal", () => {
    const parts = computeWordDiff("hello world", "hello world");
    expect(parts.every((p) => p.type === "eq")).toBe(true);
  });

  it("detects an added word", () => {
    const parts = computeWordDiff("hello world", "hello brave world");
    const added = parts.filter((p) => p.type === "add").map((p) => p.text.trim());
    expect(added.join("")).toContain("brave");
  });

  it("detects a removed word", () => {
    const parts = computeWordDiff("hello brave world", "hello world");
    const removed = parts
      .filter((p) => p.type === "del")
      .map((p) => p.text.trim());
    expect(removed.join("")).toContain("brave");
  });

  it("reconstructs both sides from the diff", () => {
    const a = "the quick brown fox";
    const b = "the slow brown cat";
    const parts = computeWordDiff(a, b);
    const left = parts
      .filter((p) => p.type !== "add")
      .map((p) => p.text)
      .join("");
    const right = parts
      .filter((p) => p.type !== "del")
      .map((p) => p.text)
      .join("");
    expect(left).toBe(a);
    expect(right).toBe(b);
  });
});
