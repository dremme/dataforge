import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadGalleryDisplayMode,
  readCachedDisplayMode,
  updateGalleryDisplayMode,
} from "./galleryDisplayPreferences";

const requestJsonMock = vi.fn();
const putJsonMock = vi.fn();

vi.mock("@/shared/api/http", () => ({
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
  putJson: (...args: unknown[]) => putJsonMock(...args),
}));

vi.mock("@/shared/lib/retry", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

describe("galleryDisplayPreferences", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
    putJsonMock.mockReset();
    localStorage.clear();
  });

  it("loads the mode for a folder from the backend", async () => {
    requestJsonMock.mockResolvedValue({ mode: "list", folder_path: "C:\\Photos\\Trip" });

    const mode = await loadGalleryDisplayMode("C:\\Photos\\Trip");

    expect(requestJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/preferences/gallery-display?"),
    );
    expect(mode).toBe("list");
  });

  it("persists the mode with folder_path", async () => {
    putJsonMock.mockResolvedValue({ mode: "small", folder_path: "C:\\Photos\\A" });

    const mode = await updateGalleryDisplayMode("C:\\Photos\\A", "small");

    expect(putJsonMock).toHaveBeenCalledWith("/api/preferences/gallery-display", {
      mode: "small",
      folder_path: "C:\\Photos\\A",
    });
    expect(mode).toBe("small");
  });

  it("falls back to the cached mode when the backend is unreachable", async () => {
    putJsonMock.mockResolvedValue({ mode: "list", folder_path: "C:\\Photos\\A" });
    await updateGalleryDisplayMode("C:\\Photos\\A", "list");

    requestJsonMock.mockRejectedValue(new Error("offline"));

    expect(await loadGalleryDisplayMode("C:\\Photos\\A")).toBe("list");
  });

  it("falls back to the default for a folder it has never seen", async () => {
    requestJsonMock.mockRejectedValue(new Error("offline"));

    expect(await loadGalleryDisplayMode("C:\\Photos\\Unseen")).toBe("large");
  });

  it("caches under a separator- and case-insensitive key", async () => {
    putJsonMock.mockResolvedValue({ mode: "list", folder_path: "C:\\Photos\\A" });
    await updateGalleryDisplayMode("C:\\Photos\\A", "list");

    expect(readCachedDisplayMode("c:/photos/a")).toBe("list");
  });

  it("reports no cached mode for an unknown folder", () => {
    expect(readCachedDisplayMode("C:\\Photos\\Nope")).toBeNull();
    expect(readCachedDisplayMode(undefined)).toBeNull();
  });

  it("ignores a cache entry holding an unknown mode", () => {
    localStorage.setItem("gallery-display-modes", JSON.stringify({ "c:\\photos\\a": "mosaic" }));

    expect(readCachedDisplayMode("C:\\Photos\\A")).toBeNull();
  });
});
