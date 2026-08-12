import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGalleryDisplayMode } from "./useGalleryDisplayMode";

const loadMock = vi.fn();
const updateMock = vi.fn();
const readCachedMock = vi.fn();

vi.mock("@/features/gallery/preferences/galleryDisplayPreferences", () => ({
  loadGalleryDisplayMode: (...args: unknown[]) => loadMock(...args),
  updateGalleryDisplayMode: (...args: unknown[]) => updateMock(...args),
  readCachedDisplayMode: (...args: unknown[]) => readCachedMock(...args),
}));

describe("useGalleryDisplayMode", () => {
  afterEach(() => {
    loadMock.mockReset();
    updateMock.mockReset();
    readCachedMock.mockReset();
  });

  it("loads the stored mode for the open folder", async () => {
    readCachedMock.mockReturnValue(null);
    loadMock.mockResolvedValue("list");

    const { result } = renderHook(() => useGalleryDisplayMode("C:\\Photos\\A"));

    expect(result.current.displayMode).toBe("large");
    await waitFor(() => expect(result.current.displayMode).toBe("list"));
    expect(loadMock).toHaveBeenCalledWith("C:\\Photos\\A");
  });

  it("paints the cached mode before the request resolves", () => {
    readCachedMock.mockReturnValue("small");
    loadMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useGalleryDisplayMode("C:\\Photos\\A"));

    expect(result.current.displayMode).toBe("small");
  });

  it("re-seeds on navigation instead of showing the previous folder's mode", async () => {
    readCachedMock.mockReturnValue(null);
    loadMock.mockResolvedValue("list");

    const { result, rerender } = renderHook(
      ({ folder }: { folder: string }) => useGalleryDisplayMode(folder),
      { initialProps: { folder: "C:\\Photos\\A" } },
    );

    await waitFor(() => expect(result.current.displayMode).toBe("list"));

    loadMock.mockReturnValue(new Promise(() => {}));
    rerender({ folder: "C:\\Photos\\B" });

    expect(result.current.displayMode).toBe("large");
  });

  it("applies the choice immediately and persists it", async () => {
    readCachedMock.mockReturnValue(null);
    loadMock.mockResolvedValue("large");
    updateMock.mockResolvedValue("small");

    const { result } = renderHook(() => useGalleryDisplayMode("C:\\Photos\\A"));
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    act(() => result.current.setDisplayMode("small"));

    expect(result.current.displayMode).toBe("small");
    expect(updateMock).toHaveBeenCalledWith("C:\\Photos\\A", "small");
  });

  it("keeps the choice when persistence fails", async () => {
    readCachedMock.mockReturnValue(null);
    loadMock.mockResolvedValue("large");
    updateMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useGalleryDisplayMode("C:\\Photos\\A"));
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    act(() => result.current.setDisplayMode("list"));

    expect(result.current.displayMode).toBe("list");
  });

  it("does not call the backend without an open folder", () => {
    readCachedMock.mockReturnValue(null);

    const { result } = renderHook(() => useGalleryDisplayMode(undefined));

    act(() => result.current.setDisplayMode("list"));

    expect(loadMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(result.current.displayMode).toBe("list");
  });
});
