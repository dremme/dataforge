import { afterEach, describe, expect, it, vi } from "vitest";
import { readStored, readStoredJson, writeStored, writeStoredJson } from "@/shared/lib/storage";

const KEY = "storage-test-key";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("readStored / writeStored", () => {
  it("round-trips a value through localStorage by default", () => {
    writeStored(KEY, "sample");
    expect(readStored(KEY)).toBe("sample");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("targets sessionStorage when asked", () => {
    writeStored(KEY, "sample", "session");
    expect(readStored(KEY, "session")).toBe("sample");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("returns null for a missing key", () => {
    expect(readStored(KEY)).toBeNull();
  });

  it("returns null when reading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });

    expect(readStored(KEY)).toBeNull();
  });

  it("ignores write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });

    expect(() => writeStored(KEY, "sample")).not.toThrow();
  });
});

describe("readStoredJson / writeStoredJson", () => {
  const parseStrings = (value: unknown): string[] | null =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : null;

  it("round-trips JSON values", () => {
    writeStoredJson(KEY, ["one", "two"]);
    expect(readStoredJson(KEY, parseStrings, [])).toEqual(["one", "two"]);
  });

  it("falls back when the entry is missing", () => {
    expect(readStoredJson(KEY, parseStrings, ["default"])).toEqual(["default"]);
  });

  it("falls back when the entry is not valid JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readStoredJson(KEY, parseStrings, [])).toEqual([]);
  });

  it("falls back when the parser rejects the shape", () => {
    localStorage.setItem(KEY, JSON.stringify({ unexpected: true }));
    expect(readStoredJson(KEY, parseStrings, ["default"])).toEqual(["default"]);
  });
});
