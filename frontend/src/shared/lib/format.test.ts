import { describe, expect, it } from "vitest";
import { countWords, formatBytes, formatModifiedAt, parseJsonContent } from "./format";

describe("formatModifiedAt", () => {
  it("formats ISO timestamps for display", () => {
    const formatted = formatModifiedAt("2026-06-19T14:30:00.000Z");
    expect(formatted).not.toBeNull();
    expect(formatted).toContain("2026");
  });

  it("returns null for invalid timestamps", () => {
    expect(formatModifiedAt("not-a-date")).toBeNull();
  });
});

describe("countWords", () => {
  it("returns zero for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("counts words separated by whitespace", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  leading and trailing  ")).toBe(3);
  });
});

describe("formatBytes", () => {
  it("rounds large values to whole gigabytes", () => {
    expect(formatBytes(32 * 1024 ** 3)).toBe("32 GB");
  });

  it("keeps one decimal for smaller values", () => {
    expect(formatBytes(8.5 * 1024 ** 3)).toBe("8.5 GB");
  });
});

describe("parseJsonContent", () => {
  it("accepts JSON objects", () => {
    expect(parseJsonContent('{"description":"Scene"}')).toEqual({
      ok: true,
      value: { description: "Scene" },
    });
  });

  it("accepts JSON arrays", () => {
    expect(parseJsonContent('[{"desc":"Tree"}]')).toEqual({
      ok: true,
      value: [{ desc: "Tree" }],
    });
  });

  it("rejects invalid JSON", () => {
    expect(parseJsonContent("{bad json")).toEqual({
      ok: false,
      error: expect.any(String) as string,
    });
  });

  it("rejects primitives", () => {
    expect(parseJsonContent('"caption only"')).toEqual({
      ok: false,
      error: "Caption JSON must be an object or array.",
    });
  });
});
