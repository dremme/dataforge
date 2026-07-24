import { describe, expect, it } from "vitest";
import { countWords, formatModifiedAt } from "./format";

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
