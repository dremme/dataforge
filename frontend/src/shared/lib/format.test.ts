import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countWords,
  estimateTokens,
  formatBytes,
  formatBytesValue,
  formatCount,
  formatDurationSeconds,
  formatModifiedAt,
  formatRelativeTime,
} from "./format";

describe("English formatting on a German system", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses English month names and a consistent local clock", async () => {
    vi.resetModules();
    const dateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new dateTimeFormat(locales ?? "de-DE", options);
    });
    const { formatModifiedAt } = await import("./format");
    const localDate = new Date(2026, 2, 15, 14, 5);
    expect(formatModifiedAt(localDate.toISOString())).toBe("Mar 15, 2026, 14:05");
  });

  it("uses English relative time", async () => {
    vi.resetModules();
    const relativeTimeFormat = Intl.RelativeTimeFormat;
    vi.spyOn(Intl, "RelativeTimeFormat").mockImplementation(function (locales, options) {
      return new relativeTimeFormat(locales ?? "de-DE", options);
    });
    const { formatRelativeTime } = await import("./format");
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    expect(formatRelativeTime("2026-01-01T11:55:00.000Z", now)).toBe("5 minutes ago");
  });
});

describe("formatCount", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1024, "1,024"],
    [1234567, "1,234,567"],
  ])("formats %s with English grouping", (count, expected) => {
    expect(formatCount(count)).toBe(expected);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-01-10T12:00:00.000Z");

  it.each([
    [-60, "just now"],
    [0, "just now"],
    [44, "just now"],
    [45, "45 seconds ago"],
    [60, "1 minute ago"],
    [120, "2 minutes ago"],
    [3600, "1 hour ago"],
    [7200, "2 hours ago"],
    [86400, "yesterday"],
    [172800, "2 days ago"],
  ])("formats an age of %s seconds", (seconds, expected) => {
    expect(formatRelativeTime(new Date(now - seconds * 1000).toISOString(), now)).toBe(expected);
  });

  it("uses the absolute date from one week onward", () => {
    const timestamp = new Date(now - 7 * 86400 * 1000).toISOString();
    expect(formatRelativeTime(timestamp, now)).toBe(formatModifiedAt(timestamp));
  });

  it("returns null for invalid timestamps", () => {
    expect(formatRelativeTime("not-a-date", now)).toBeNull();
  });
});

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

describe("estimateTokens", () => {
  it("returns zero for empty or whitespace-only text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("never counts a word as less than one token", () => {
    // Four characters per token would round "hi" and "a b" down past what they cost.
    expect(estimateTokens("hi")).toBe(1);
    expect(estimateTokens("a b c")).toBe(3);
  });

  it("keeps tag-style captions off the character rule's floor", () => {
    // 21 characters would be ~6 tokens, but each short tag costs at least one.
    expect(estimateTokens("1girl, solo, outdoors")).toBe(6);
  });

  it("follows four characters per token once words get long enough", () => {
    expect(estimateTokens("A".repeat(400))).toBe(100);
    expect(estimateTokens("Golden hour light across the quiet lake")).toBe(10);
  });

  it("ignores surrounding whitespace", () => {
    expect(estimateTokens("  hello world  ")).toBe(estimateTokens("hello world"));
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
