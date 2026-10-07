import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { folderKeys } from "@/features/folder/lib/folderQuery";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import type { FolderChangesResponse, FolderResponse } from "@/shared/types";
import { installFakeEventSource, type FakeStream } from "@/test/fakeEventSource";
import { homeFolder } from "@/test/fixtures";
import { queryWrapper } from "@/test/queryClient";
import {
  RELOAD_THROTTLE_MS,
  VISIBLE_POLL_MS,
  useFolderChangeDetection,
  type UseFolderChangeDetectionOptions,
} from "./useFolderChangeDetection";

const PATH = homeFolder.path;
const held: FolderResponse = { ...homeFolder, fingerprint: "fp-v1" };

function delta(fingerprint: string): FolderChangesResponse {
  return { full: false, fingerprint, changed: [], removed: [], stale_subfolders: [] };
}

function renderDetection(
  options: UseFolderChangeDetectionOptions = {},
  { seed = true }: { seed?: boolean } = {},
) {
  const { client, wrapper: Queries } = queryWrapper();
  if (seed) client.setQueryData(folderKeys.folder(PATH), held);

  // The hook reads pushed folder events, so it needs the stream around it too.
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Queries, null, createElement(ServerEventsProvider, null, children));

  const view = renderHook(() => useFolderChangeDetection(PATH, options), { wrapper });
  return { ...view, client };
}

const heldFingerprint = (client: QueryClient) =>
  client.getQueryData<FolderResponse>(folderKeys.folder(PATH))?.fingerprint;

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Connecting re-reads every push-fed query; settle that first so it does not muddy counts. */
async function connect(stream: FakeStream) {
  await act(async () => {
    stream.open();
  });
  await flush();
  vi.mocked(api.fetchFolderChanges).mockClear();
}

describe("useFolderChangeDetection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue(delta("fp-v1"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-reads on a slow poll, asking what changed since the listing held", async () => {
    vi.mocked(api.fetchFolderChanges).mockResolvedValue(delta("fp-v2"));
    const { client } = renderDetection();

    await flush(VISIBLE_POLL_MS);

    expect(api.fetchFolderChanges).toHaveBeenCalledExactlyOnceWith(
      PATH,
      "fp-v1",
      expect.any(AbortSignal),
      false,
    );
    expect(heldFingerprint(client)).toBe("fp-v2");
  });

  it("checks at once when the tab becomes visible again", async () => {
    renderDetection();

    // Bubbles, as the browser's does: the query client listens on window.
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    await flush();

    expect(api.fetchFolderChanges).toHaveBeenCalledTimes(1);
  });

  it("asks nothing while reloads are suspended", async () => {
    const stream = installFakeEventSource();
    renderDetection({ suspendReloads: true });
    await connect(stream);

    // A job rewriting captions pushes about once a second; its end re-reads once instead.
    act(() => stream.push({ type: "folder", path: PATH, fingerprint: "fp-v2" }));
    await flush(VISIBLE_POLL_MS);

    expect(api.fetchFolderChanges).not.toHaveBeenCalled();
  });

  it("stops checking once the folder is known to be missing", async () => {
    renderDetection({ enabled: false });

    await flush(VISIBLE_POLL_MS * 2);

    expect(api.fetchFolderChanges).not.toHaveBeenCalled();
  });

  describe("pushed folder events", () => {
    it("asks for the delta against the baseline held, not the pushed one", async () => {
      const stream = installFakeEventSource();
      const { client } = renderDetection();
      await connect(stream);
      vi.mocked(api.fetchFolderChanges).mockResolvedValue(delta("fp-v2"));

      act(() => stream.push({ type: "folder", path: PATH, fingerprint: "fp-v2" }));
      await flush();

      // Sending the pushed fingerprint would make the server answer full every time.
      expect(api.fetchFolderChanges).toHaveBeenCalledExactlyOnceWith(
        PATH,
        "fp-v1",
        expect.any(AbortSignal),
        false,
      );
      expect(heldFingerprint(client)).toBe("fp-v2");
    });

    it("asks for nothing when the pushed fingerprint is the one already held", async () => {
      const stream = installFakeEventSource();
      renderDetection();
      await connect(stream);

      act(() => stream.push({ type: "folder", path: PATH, fingerprint: "fp-v1" }));
      await flush();

      expect(api.fetchFolderChanges).not.toHaveBeenCalled();
    });

    it("folds a burst of pushes into one more re-read at the end", async () => {
      const stream = installFakeEventSource();
      renderDetection();
      await connect(stream);

      act(() => stream.push({ type: "folder", path: PATH, fingerprint: "fp-v2" }));
      await flush();
      act(() => stream.push({ type: "folder", path: PATH, fingerprint: "fp-v3" }));
      act(() => stream.push({ type: "folder", path: PATH, fingerprint: "fp-v4" }));
      await flush();
      expect(api.fetchFolderChanges).toHaveBeenCalledTimes(1);

      await flush(RELOAD_THROTTLE_MS);
      expect(api.fetchFolderChanges).toHaveBeenCalledTimes(2);
    });

    it("checks a change pushed during the first listing once that listing lands", async () => {
      const stream = installFakeEventSource();
      const { client } = renderDetection({}, { seed: false });
      await connect(stream);

      act(() => stream.push({ type: "folder", path: PATH, fingerprint: "fp-v2" }));
      await flush();
      expect(api.fetchFolderChanges).not.toHaveBeenCalled();

      act(() => {
        client.setQueryData(folderKeys.folder(PATH), held);
      });
      await flush();

      expect(api.fetchFolderChanges).toHaveBeenCalledTimes(1);
    });

    it("ignores another folder but still matches its own by case and separator", async () => {
      const stream = installFakeEventSource();
      renderDetection();
      await connect(stream);

      act(() => stream.push({ type: "folder", path: "C:\\Videos", fingerprint: "fp-other" }));
      await flush();
      expect(api.fetchFolderChanges).not.toHaveBeenCalled();

      // The watcher keys folders in a folded form, so this is the same folder.
      act(() => stream.push({ type: "folder", path: "c:/photos", fingerprint: "fp-v2" }));
      await flush();
      expect(api.fetchFolderChanges).toHaveBeenCalledTimes(1);
    });
  });

  it("adopts the server's fingerprint after the tab wrote to the folder itself", async () => {
    vi.spyOn(api, "fetchFolderFingerprint").mockResolvedValue({ fingerprint: "fp-v2" });
    const { result, client } = renderDetection();

    await act(async () => {
      await result.current.syncBaseline();
    });

    expect(heldFingerprint(client)).toBe("fp-v2");
    expect(api.fetchFolderChanges).not.toHaveBeenCalled();
  });
});
