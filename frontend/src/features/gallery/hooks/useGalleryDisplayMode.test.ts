import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithQueryClient } from "@/test/queryClient";
import { displayModeKey, useGalleryDisplayMode } from "./useGalleryDisplayMode";

const loadMock = vi.fn();
const updateMock = vi.fn();
const readCachedMock = vi.fn();

vi.mock("@/features/gallery/preferences/galleryDisplayPreferences", () => ({
  fetchDisplayMode: (...args: unknown[]) => loadMock(...args),
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

    const { result } = renderHookWithQueryClient(() => useGalleryDisplayMode("C:\\Photos\\A"));

    expect(result.current.displayMode).toBe("large");
    await waitFor(() => expect(result.current.displayMode).toBe("list"));
    expect(loadMock).toHaveBeenCalledWith("C:\\Photos\\A");
  });

  it("paints the cached mode before the request resolves", () => {
    readCachedMock.mockReturnValue("small");
    loadMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHookWithQueryClient(() => useGalleryDisplayMode("C:\\Photos\\A"));

    expect(result.current.displayMode).toBe("small");
  });

  it("re-seeds on navigation instead of showing the previous folder's mode", async () => {
    readCachedMock.mockReturnValue(null);
    loadMock.mockResolvedValue("list");

    const { result, rerender } = renderHookWithQueryClient(
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

    const { result } = renderHookWithQueryClient(() => useGalleryDisplayMode("C:\\Photos\\A"));
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    act(() => result.current.setDisplayMode("small"));

    await waitFor(() => expect(result.current.displayMode).toBe("small"));
    expect(updateMock).toHaveBeenCalledWith("C:\\Photos\\A", "small");
  });

  it("keeps a pending save attached to the folder where it started", async () => {
    readCachedMock.mockReturnValue(null);
    loadMock.mockResolvedValue("large");
    let finishSave!: (mode: string) => void;
    const saving = new Promise<string>((resolve) => {
      finishSave = resolve;
    });
    updateMock.mockReturnValue(saving);
    const first = "C:\\Photos\\A";
    const second = "C:\\Photos\\B";
    const { result, rerender, client } = renderHookWithQueryClient(
      ({ folder }: { folder: string }) => useGalleryDisplayMode(folder),
      { initialProps: { folder: first } },
    );
    await waitFor(() => expect(result.current.displayMode).toBe("large"));
    act(() => result.current.setDisplayMode("small"));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(first, "small"));
    rerender({ folder: second });
    await waitFor(() => expect(client.getQueryData(displayModeKey(second))).toBe("large"));
    await act(async () => {
      finishSave("small");
      await saving;
    });
    expect(result.current.displayMode).toBe("large");
    expect(client.getQueryData(displayModeKey(first))).toBe("small");
    expect(client.getQueryData(displayModeKey(second))).toBe("large");
  });

  it("keeps the choice when persistence fails", async () => {
    readCachedMock.mockReturnValue(null);
    loadMock.mockResolvedValue("large");
    updateMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHookWithQueryClient(() => useGalleryDisplayMode("C:\\Photos\\A"));
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    act(() => result.current.setDisplayMode("list"));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(result.current.displayMode).toBe("list");
  });

  it("keeps the cached mode when the backend cannot be reached", async () => {
    readCachedMock.mockReturnValue("list");
    loadMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHookWithQueryClient(() => useGalleryDisplayMode("C:\\Photos\\A"));

    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(result.current.displayMode).toBe("list");
  });

  it("does not call the backend without an open folder", () => {
    readCachedMock.mockReturnValue(null);

    const { result } = renderHookWithQueryClient(() => useGalleryDisplayMode(undefined));

    act(() => result.current.setDisplayMode("list"));

    expect(loadMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(result.current.displayMode).toBe("large");
  });
});
