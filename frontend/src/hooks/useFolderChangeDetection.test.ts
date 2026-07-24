import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { FOLDER_NOT_FOUND_MESSAGE } from "../api/http";
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

  it("debounces browse reloads after polling detects a fingerprint change", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchBrowseFingerprint")
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

    vi.spyOn(api, "fetchBrowseFingerprint").mockResolvedValue({ fingerprint: "fp-v2" });

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
    vi.spyOn(api, "fetchBrowseFingerprint").mockResolvedValue({ fingerprint: "fp-v2" });

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
    vi.spyOn(api, "fetchBrowseFingerprint").mockRejectedValueOnce(
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
    vi.spyOn(api, "fetchBrowseFingerprint").mockResolvedValue({ fingerprint: "fp-v1" });

    renderHook(() =>
      useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { enabled: false }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(api.fetchBrowseFingerprint).not.toHaveBeenCalled();
    expect(reloadFolder).not.toHaveBeenCalled();
  });

  it("syncBaseline updates the known fingerprint without reloading", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchBrowseFingerprint")
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
