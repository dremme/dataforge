import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  BACKEND_UNREACHABLE,
  FOLDER_NOT_FOUND,
  NetworkError,
  formatApiError,
  postJson,
  putJson,
  requestJson,
  resolveFolderError,
} from "@/shared/api/http";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("requestJson errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a fetch that never reached the API as a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(requestJson("/api/thing")).rejects.toBeInstanceOf(NetworkError);
  });

  it("reports a gateway answer without a detail as a network error", async () => {
    for (const status of [500, 502, 503, 504]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, status));

      await expect(requestJson("/api/thing")).rejects.toBeInstanceOf(NetworkError);
    }
  });

  it("keeps a server error that explains itself", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ detail: "Failed to fingerprint folder" }, 500),
    );

    const error = await requestJson("/api/thing").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: "Failed to fingerprint folder" });
  });

  it("carries the machine-readable code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ detail: "Folder not found", code: "folder_not_found" }, 404),
    );

    const error = await requestJson("/api/thing").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 404, code: "folder_not_found" });
  });

  it("names the status when the body has no detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 418));

    await expect(requestJson("/api/thing")).rejects.toThrow("Request failed (418)");
  });

  it("lets a cancelled request through untouched", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);

    await expect(requestJson("/api/thing")).rejects.toBe(abort);
  });
});

describe("resolveFolderError", () => {
  it("classifies by error type and code, not by message", () => {
    expect(resolveFolderError(new NetworkError())).toEqual({ kind: "backend-unreachable" });
    expect(resolveFolderError(new ApiError(404, "Folder not found", "folder_not_found"))).toEqual({
      kind: "folder-not-found",
    });
    // A job error that happens to read the same is not the folder going missing.
    expect(resolveFolderError(new Error("Folder not found"))).toEqual({
      kind: "other",
      message: "Folder not found",
    });
  });

  it("preserves other API error messages", () => {
    expect(resolveFolderError(new ApiError(400, "Caption save failed"))).toEqual({
      kind: "other",
      message: "Caption save failed",
    });
  });
});

describe("formatApiError", () => {
  it("returns a single-line message for inline errors", () => {
    expect(formatApiError(new NetworkError())).toBe(
      `${BACKEND_UNREACHABLE.title}. ${BACKEND_UNREACHABLE.description}`,
    );
    expect(formatApiError(new ApiError(404, "Folder not found", "folder_not_found"))).toBe(
      FOLDER_NOT_FOUND.title,
    );
    expect(formatApiError(undefined)).toBe("Something went wrong.");
  });
});

describe("postJson / putJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOk() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  it("sends a JSON body with the matching content type", async () => {
    const fetchSpy = mockFetchOk();

    await expect(postJson<{ ok: boolean }>("/api/thing", { name: "sample" })).resolves.toEqual({
      ok: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/thing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "sample" }),
    });
  });

  it("uses PUT for putJson", async () => {
    const fetchSpy = mockFetchOk();

    await putJson("/api/thing", { name: "sample" });

    expect(fetchSpy).toHaveBeenCalledWith("/api/thing", expect.objectContaining({ method: "PUT" }));
  });

  it("surfaces API errors from the response detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Folder is read-only" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(postJson("/api/thing", {})).rejects.toThrow("Folder is read-only");
  });
});
