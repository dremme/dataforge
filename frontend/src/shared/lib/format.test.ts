import { describe, expect, it } from "vitest";
import {
  countWords,
  formatBytes,
  formatBytesValue,
  formatDurationSeconds,
  formatModifiedAt,
} from "./format";

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

describe("formatDurationSeconds", () => {
  it("formats a video length as whole seconds", () => {
    expect(formatDurationSeconds(5.4)).toBe("5 s");
    expect(formatDurationSeconds(10)).toBe("10 s");
  });

  it("returns an empty string when the length is missing", () => {
    expect(formatDurationSeconds(0)).toBe("");
    expect(formatDurationSeconds(Number.NaN)).toBe("");
    expect(formatDurationSeconds(null)).toBe("");
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
  it("rounds to whole gigabytes", () => {
    expect(formatBytes(32 * 1024 ** 3)).toBe("32 GB");
    expect(formatBytes(8.5 * 1024 ** 3)).toBe("9 GB");
    expect(formatBytes(1.9 * 1024 ** 3)).toBe("2 GB");
  });
});

describe("formatBytesValue", () => {
  it("rounds to whole gigabytes without the unit", () => {
    expect(formatBytesValue(32 * 1024 ** 3)).toBe("32");
    expect(formatBytesValue(8.5 * 1024 ** 3)).toBe("9");
  });
});
