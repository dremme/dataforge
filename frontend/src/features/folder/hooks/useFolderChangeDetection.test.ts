import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { FOLDER_NOT_FOUND_MESSAGE } from "@/shared/api/http";
import { useFolderChangeDetection } from "./useFolderChangeDetection";

describe("useFolderChangeDetection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces folder reloads after polling detects a fingerprint change", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint")
      .mockResolvedValueOnce({ fingerprint: "fp-v1" })
      .mockResolvedValueOnce({ fingerprint: "fp-v2" });

    renderHook(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(reloadFolder).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(reloadFolder).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(reloadFolder).toHaveBeenCalledTimes(1);
  });

  it("checks immediately when the tab becomes visible again", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");

    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v2" });

    renderHook(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(reloadFolder).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(reloadFolder).toHaveBeenCalledTimes(1);
  });

  it("syncs the fingerprint baseline without reloading while reloads are suspended", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v2" });

    renderHook(() =>
      useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { suspendReloads: true }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(reloadFolder).not.toHaveBeenCalled();
  });

  it("reloads the folder when polling detects that it no longer exists", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint").mockRejectedValueOnce(
      new Error(FOLDER_NOT_FOUND_MESSAGE),
    );

    renderHook(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(reloadFolder).toHaveBeenCalledTimes(1);
  });

  it("does not keep polling after the folder is already known to be missing", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v1" });

    renderHook(() =>
      useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { enabled: false }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(api.fetchFolderFingerprint).not.toHaveBeenCalled();
    expect(reloadFolder).not.toHaveBeenCalled();
  });

  it("patches from a delta instead of reloading the folder", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    const applyDelta = vi.fn();
    const changes = {
      full: false,
      fingerprint: "fp-v2",
      changed: [],
      removed: ["C:\\Photos\\gone.png"],
    };
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue(changes);

    renderHook(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { applyDelta }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(api.fetchFolderChanges).toHaveBeenCalledWith("C:\\Photos", "fp-v1");
    // Applied straight away: patching needs no debounce.
    expect(applyDelta).toHaveBeenCalledExactlyOnceWith(changes);
    expect(reloadFolder).not.toHaveBeenCalled();
  });

  it("falls back to a full reload when the server cannot describe the change", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    const applyDelta = vi.fn();
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue({
      full: true,
      fingerprint: "fp-v2",
      changed: [],
      removed: [],
    });

    renderHook(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { applyDelta }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(applyDelta).not.toHaveBeenCalled();
    expect(reloadFolder).toHaveBeenCalledTimes(1);
  });

  it("asks only for the cheap fingerprint when there is nowhere to apply a delta", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue({
      full: false,
      fingerprint: "fp-v2",
      changed: [],
      removed: [],
    });
    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v1" });

    renderHook(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(api.fetchFolderChanges).not.toHaveBeenCalled();
    expect(api.fetchFolderFingerprint).toHaveBeenCalled();
  });

  it("syncBaseline updates the known fingerprint without reloading", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint")
      .mockResolvedValueOnce({ fingerprint: "fp-after-save" })
      .mockResolvedValue({ fingerprint: "fp-after-save" });

    const { result } = renderHook(() =>
      useFolderChangeDetection("C:\\Photos", "fp-before-save", reloadFolder),
    );

    await act(async () => {
      await result.current.syncBaseline();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(reloadFolder).not.toHaveBeenCalled();
  });
});
