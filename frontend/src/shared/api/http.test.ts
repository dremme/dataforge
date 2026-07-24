import { describe, expect, it } from "vitest";
import {
  BACKEND_UNREACHABLE,
  FOLDER_NOT_FOUND_MESSAGE,
  formatApiError,
  parseApiError,
  resolveBrowseError,
} from "@/shared/api/http";

describe("resolveBrowseError", () => {
  it("classifies gateway failures as backend unreachable", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(resolveBrowseError(new Error(`Request failed (${status})`))).toEqual({
        kind: "backend-unreachable",
      });
    }
  });

  it("classifies folder and fetch failures", () => {
    expect(resolveBrowseError(new Error(FOLDER_NOT_FOUND_MESSAGE))).toEqual({
      kind: "folder-not-found",
    });
    expect(resolveBrowseError(new TypeError("Failed to fetch"))).toEqual({
      kind: "backend-unreachable",
    });
  });

  it("preserves other API error messages", () => {
    expect(resolveBrowseError(new Error("Caption save failed"))).toEqual({
      kind: "other",
      message: "Caption save failed",
    });
  });
});

describe("formatApiError", () => {
  it("returns a single-line message for inline errors", () => {
    expect(formatApiError(new Error(`Request failed (502)`))).toBe(
      `${BACKEND_UNREACHABLE.title}. ${BACKEND_UNREACHABLE.description}`,
    );
    expect(formatApiError(new Error(FOLDER_NOT_FOUND_MESSAGE))).toBe(FOLDER_NOT_FOUND_MESSAGE);
  });
});

describe("parseApiError", () => {
  it("maps empty gateway responses to a backend unreachable message", async () => {
    for (const status of [500, 502, 503, 504]) {
      const response = new Response(JSON.stringify({}), {
        status,
        headers: { "Content-Type": "application/json" },
      });
      await expect(parseApiError(response)).resolves.toBe(BACKEND_UNREACHABLE.description);
    }
  });

  it("preserves API detail messages", async () => {
    const response = new Response(JSON.stringify({ detail: FOLDER_NOT_FOUND_MESSAGE }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    await expect(parseApiError(response)).resolves.toBe(FOLDER_NOT_FOUND_MESSAGE);
  });
});
