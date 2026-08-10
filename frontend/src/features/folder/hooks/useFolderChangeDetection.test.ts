import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { FOLDER_NOT_FOUND_MESSAGE } from "@/shared/api/http";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import { installFakeEventSource } from "@/test/fakeEventSource";
import {
  RELOAD_DEBOUNCE_MS,
  VISIBLE_POLL_MS,
  useFolderChangeDetection,
} from "./useFolderChangeDetection";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ServerEventsProvider, null, children);

/** The hook now reads pushed folder events, so it needs the stream around it. */
function renderDetection<T>(render: () => T) {
  return renderHook(render, { wrapper });
}

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

    renderDetection(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
    });
    expect(reloadFolder).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
    });
    expect(reloadFolder).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });
    expect(reloadFolder).toHaveBeenCalledTimes(1);
  });

  it("checks immediately when the tab becomes visible again", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");

    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v2" });

    renderDetection(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

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
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(reloadFolder).toHaveBeenCalledTimes(1);
  });

  it("syncs the fingerprint baseline without reloading while reloads are suspended", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v2" });

    renderDetection(() =>
      useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { suspendReloads: true }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(reloadFolder).not.toHaveBeenCalled();
  });

  it("reloads the folder when polling detects that it no longer exists", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint").mockRejectedValueOnce(
      new Error(FOLDER_NOT_FOUND_MESSAGE),
    );

    renderDetection(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(reloadFolder).toHaveBeenCalledTimes(1);
  });

  it("does not keep polling after the folder is already known to be missing", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v1" });

    renderDetection(() =>
      useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { enabled: false }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
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

    renderDetection(() =>
      useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { applyDelta }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
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

    renderDetection(() =>
      useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { applyDelta }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
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

    renderDetection(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
    });

    expect(api.fetchFolderChanges).not.toHaveBeenCalled();
    expect(api.fetchFolderFingerprint).toHaveBeenCalled();
  });

  it("syncBaseline updates the known fingerprint without reloading", async () => {
    const reloadFolder = vi.fn().mockResolvedValue(null);
    vi.spyOn(api, "fetchFolderFingerprint")
      .mockResolvedValueOnce({ fingerprint: "fp-after-save" })
      .mockResolvedValue({ fingerprint: "fp-after-save" });

    const { result } = renderDetection(() =>
      useFolderChangeDetection("C:\\Photos", "fp-before-save", reloadFolder),
    );

    await act(async () => {
      await result.current.syncBaseline();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VISIBLE_POLL_MS);
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(reloadFolder).not.toHaveBeenCalled();
  });

  describe("pushed folder events", () => {
    it("asks for the delta against the baseline it already had, not the pushed one", async () => {
      const reloadFolder = vi.fn().mockResolvedValue(null);
      const applyDelta = vi.fn();
      const changes = { full: false, fingerprint: "fp-v2", changed: [], removed: [] };
      vi.spyOn(api, "fetchFolderChanges").mockResolvedValue(changes);
      const stream = installFakeEventSource();

      renderDetection(() =>
        useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { applyDelta }),
      );

      await act(async () => {
        stream.open();
        stream.push({ type: "folder", path: "C:\\Photos", fingerprint: "fp-v2" });
        await Promise.resolve();
      });

      // `since` is the old baseline. Sending the pushed fingerprint instead would make
      // the server answer `full` every time and turn each delta into a whole reload.
      expect(api.fetchFolderChanges).toHaveBeenCalledWith("C:\\Photos", "fp-v1");
      expect(applyDelta).toHaveBeenCalledExactlyOnceWith(changes);
      expect(reloadFolder).not.toHaveBeenCalled();
    });

    it("asks for nothing when the pushed fingerprint is the one already held", async () => {
      const reloadFolder = vi.fn().mockResolvedValue(null);
      vi.spyOn(api, "fetchFolderChanges");
      vi.spyOn(api, "fetchFolderFingerprint");
      const stream = installFakeEventSource();

      renderDetection(() => useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder));

      await act(async () => {
        stream.open();
        stream.push({ type: "folder", path: "C:\\Photos", fingerprint: "fp-v1" });
        await Promise.resolve();
      });

      expect(api.fetchFolderChanges).not.toHaveBeenCalled();
      expect(api.fetchFolderFingerprint).not.toHaveBeenCalled();
    });

    it("takes the baseline from the event and asks nothing while reloads are suspended", async () => {
      const reloadFolder = vi.fn().mockResolvedValue(null);
      vi.spyOn(api, "fetchFolderChanges");
      vi.spyOn(api, "fetchFolderFingerprint");
      const stream = installFakeEventSource();

      renderDetection(() =>
        useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { suspendReloads: true }),
      );

      await act(async () => {
        stream.open();
        // A job rewriting captions pushes about once a second; answering each one with
        // a request whose result is discarded is the cost this removes.
        stream.push({ type: "folder", path: "C:\\Photos", fingerprint: "fp-v2" });
        await Promise.resolve();
      });

      expect(api.fetchFolderChanges).not.toHaveBeenCalled();
      expect(api.fetchFolderFingerprint).not.toHaveBeenCalled();
      expect(reloadFolder).not.toHaveBeenCalled();
    });

    it("ignores another folder but still matches its own by case and separator", async () => {
      const reloadFolder = vi.fn().mockResolvedValue(null);
      const applyDelta = vi.fn();
      vi.spyOn(api, "fetchFolderChanges").mockResolvedValue({
        full: false,
        fingerprint: "fp-v2",
        changed: [],
        removed: [],
      });
      const stream = installFakeEventSource();

      renderDetection(() =>
        useFolderChangeDetection("C:\\Photos", "fp-v1", reloadFolder, { applyDelta }),
      );

      await act(async () => {
        stream.open();
        stream.push({ type: "folder", path: "C:\\Videos", fingerprint: "fp-other" });
        await Promise.resolve();
      });
      expect(api.fetchFolderChanges).not.toHaveBeenCalled();

      await act(async () => {
        // The watcher keys folders in a folded form, so this is the same folder.
        stream.push({ type: "folder", path: "c:/photos", fingerprint: "fp-v2" });
        await Promise.resolve();
      });
      expect(api.fetchFolderChanges).toHaveBeenCalledWith("C:\\Photos", "fp-v1");
    });
  });
});
