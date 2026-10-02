import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import * as folderHistory from "@/features/folder/lib/folderHistory";
import * as folderPreferences from "@/features/folder/lib/folderPreferences";
import { folderKeys } from "@/features/folder/lib/folderQuery";
import {
  clearFolderScrollMemory,
  recallFolderScroll,
  rememberFolderScroll,
} from "@/features/folder/lib/folderScrollMemory";
import { ApiError, NetworkError } from "@/shared/api/http";
import { HOME_PATH, homeFolder, vacationFolder, VACATION_PATH } from "@/test/fixtures";
import { createTestQueryClient, queryWrapper, renderHookWithQueryClient } from "@/test/queryClient";
import { renderHook } from "@testing-library/react";
import type { FolderChangesResponse, FolderResponse } from "@/shared/types";
import { useFolderNavigation } from "./useFolderNavigation";

// Stands in for the real History API: a push mints a key, a replace keeps the
// one already on the entry, and popstate hands both back off the event state.
vi.mock("@/features/folder/lib/folderHistory", () => {
  let minted = 0;
  let currentKey: string | undefined;

  return {
    getFolderFromUrl: () => undefined,
    getFolderFromHistoryEvent: (event: PopStateEvent) => event.state?.folderPath ?? undefined,
    getEntryKeyFromHistoryEvent: (event: PopStateEvent) => event.state?.entryKey,
    getCurrentEntryKey: () => currentKey,
    syncFolderHistory: vi.fn((_path: string | undefined, mode: string) => {
      if (mode === "none") return undefined;
      if (mode === "push" || !currentKey) {
        minted += 1;
        currentKey = `entry-${minted}`;
      }
      return currentKey;
    }),
    __resetHistory: () => {
      minted = 0;
      currentKey = undefined;
    },
  };
});

const resetHistory = (folderHistory as unknown as { __resetHistory: () => void }).__resetHistory;

/** jsdom has no layout, so `.main` needs a writable `scrollTop` to observe. */
function mountScrollElement(scrollTop: number): HTMLElement {
  const element = document.createElement("main");
  element.className = "main";
  Object.defineProperty(element, "scrollTop", { value: scrollTop, writable: true });
  document.body.appendChild(element);
  return element;
}

const folderNotFound = () => new ApiError(404, "Folder not found", "folder_not_found");

function unchanged(folder: FolderResponse): FolderChangesResponse {
  return { full: false, fingerprint: folder.fingerprint, changed: [], removed: [] };
}

function changedWholly(fingerprint: string): FolderChangesResponse {
  return { full: true, fingerprint, changed: [], removed: [] };
}

/** Full listings held until the test answers them, keyed by the path asked for. */
function holdListings() {
  const resolvers = new Map<string | undefined, (value: FolderResponse) => void>();
  vi.spyOn(folderPreferences, "loadFolderContents").mockImplementation(
    (path) => new Promise<FolderResponse>((resolve) => resolvers.set(path, resolve)),
  );
  return resolvers;
}

async function renderAtHome() {
  vi.spyOn(folderPreferences, "loadFolderContents").mockImplementation(async (path) =>
    path === VACATION_PATH ? vacationFolder : homeFolder,
  );
  vi.spyOn(api, "fetchFolderChanges").mockImplementation(async (path) =>
    unchanged(path === VACATION_PATH ? vacationFolder : homeFolder),
  );

  const view = renderHookWithQueryClient(() => useFolderNavigation());
  await waitFor(() => {
    expect(view.result.current.folder?.path).toBe(HOME_PATH);
    expect(view.result.current.loading).toBe(false);
  });
  return view;
}

describe("useFolderNavigation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearFolderScrollMemory();
    resetHistory();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("drops stale folder responses when navigation outpaces loading", async () => {
    const resolvers = holdListings();
    const { result } = renderHookWithQueryClient(() => useFolderNavigation());

    await waitFor(() => expect(resolvers.has(undefined)).toBe(true));

    act(() => {
      void result.current.navigateTo(VACATION_PATH);
    });
    await waitFor(() => expect(resolvers.has(VACATION_PATH)).toBe(true));

    await act(async () => {
      resolvers.get(VACATION_PATH)?.(vacationFolder);
    });
    await act(async () => {
      resolvers.get(undefined)?.(homeFolder);
    });

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(VACATION_PATH);
      expect(result.current.loading).toBe(false);
    });
  });

  it("files the default folder under the path the server named", async () => {
    const { result, client } = await renderAtHome();

    expect(client.getQueryData(folderKeys.folder(HOME_PATH))).toBe(homeFolder);
    expect(result.current.folder).toBe(homeFolder);
    expect(folderHistory.syncFolderHistory).toHaveBeenLastCalledWith(HOME_PATH, "replace");
  });

  it("keeps navigation context when a folder fails to load", async () => {
    const missingPath = `${HOME_PATH}\\Missing`;
    const { result } = await renderAtHome();
    vi.spyOn(folderPreferences, "loadFolderContents").mockRejectedValue(folderNotFound());

    await act(async () => {
      await result.current.navigateTo(missingPath);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "folder-not-found" });
      expect(result.current.folder?.path).toBe(missingPath);
      expect(result.current.folder?.breadcrumbs.length).toBeGreaterThan(0);
      expect(result.current.folder?.items).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
  });

  it("clears folder state once retries for an unreachable backend are spent", async () => {
    vi.spyOn(folderPreferences, "loadFolderContents")
      .mockResolvedValueOnce(homeFolder)
      .mockRejectedValue(new NetworkError());

    const { wrapper } = queryWrapper(createTestQueryClient({ retry: false }));
    const { result } = renderHook(() => useFolderNavigation(), { wrapper });
    await waitFor(() => expect(result.current.folder?.path).toBe(HOME_PATH));

    await act(async () => {
      await result.current.navigateTo(VACATION_PATH);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "backend-unreachable" });
      expect(result.current.folder).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  it("revisits a cached folder by asking what changed since the listing it holds", async () => {
    const { result } = await renderAtHome();
    await act(async () => {
      await result.current.navigateTo(VACATION_PATH);
    });
    const listings = vi.mocked(folderPreferences.loadFolderContents).mock.calls.length;

    await act(async () => {
      await result.current.navigateTo(HOME_PATH);
    });

    expect(result.current.folder).toBe(homeFolder);
    expect(result.current.loading).toBe(false);
    expect(api.fetchFolderChanges).toHaveBeenLastCalledWith(
      HOME_PATH,
      homeFolder.fingerprint,
      expect.any(AbortSignal),
      // Opening it, so the server makes it the folder to start in next time.
      true,
    );
    expect(folderPreferences.loadFolderContents).toHaveBeenCalledTimes(listings);
  });

  it("applies a delta to the cached listing instead of relisting", async () => {
    const { result } = await renderAtHome();
    const [first] = homeFolder.items;
    const renamed = { ...first, name: "renamed.png", path: `${HOME_PATH}\\renamed.png` };
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue({
      full: false,
      fingerprint: "fp-home-2",
      changed: [renamed],
      removed: [first.path],
    });
    const listings = vi.mocked(folderPreferences.loadFolderContents).mock.calls.length;

    await act(async () => {
      await result.current.reloadFolder();
    });

    await waitFor(() => expect(result.current.folder?.fingerprint).toBe("fp-home-2"));
    const paths = result.current.folder?.items.map((item) => item.path);
    expect(paths).toContain(renamed.path);
    expect(paths).not.toContain(first.path);
    expect(folderPreferences.loadFolderContents).toHaveBeenCalledTimes(listings);
  });

  it("lists the folder again when the server cannot describe the change", async () => {
    const { result } = await renderAtHome();
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue(changedWholly("fp-home-2"));
    const relisted = { ...homeFolder, fingerprint: "fp-home-2" };
    vi.spyOn(folderPreferences, "loadFolderContents").mockResolvedValue(relisted);

    await act(async () => {
      await result.current.reloadFolder();
    });

    await waitFor(() => expect(result.current.folder).toEqual(relisted));
  });

  it("settles both flags when a reload supersedes an uncached navigation", async () => {
    const resolvers = holdListings();
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue(changedWholly("fp-new"));
    const { result } = renderHookWithQueryClient(() => useFolderNavigation());

    await waitFor(() => expect(resolvers.has(undefined)).toBe(true));
    await act(async () => {
      resolvers.get(undefined)?.(homeFolder);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // An uncached destination blanks the grid, so this load owns the loading flag.
    act(() => {
      void result.current.navigateTo(VACATION_PATH);
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    act(() => {
      void result.current.reloadFolder();
    });

    await act(async () => {
      resolvers.get(VACATION_PATH)?.(vacationFolder);
    });

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(VACATION_PATH);
      expect(result.current.refreshing).toBe(false);
      expect(result.current.loading).toBe(false);
    });
  });

  it("settles both flags when an uncached navigation supersedes a reload", async () => {
    const resolvers = holdListings();
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue(changedWholly("fp-new"));
    const { result } = renderHookWithQueryClient(() => useFolderNavigation());

    await waitFor(() => expect(resolvers.has(undefined)).toBe(true));
    await act(async () => {
      resolvers.get(undefined)?.(homeFolder);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      void result.current.reloadFolder();
    });
    await waitFor(() => expect(result.current.refreshing).toBe(true));

    act(() => {
      void result.current.navigateTo(VACATION_PATH);
    });
    await act(async () => {
      resolvers.get(VACATION_PATH)?.(vacationFolder);
    });

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(VACATION_PATH);
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
    });
  });

  it("shows folder not found when a reload discovers the folder is gone", async () => {
    const { result } = await renderAtHome();
    vi.spyOn(api, "fetchFolderChanges").mockRejectedValue(folderNotFound());

    await act(async () => {
      await result.current.reloadFolder();
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "folder-not-found" });
      expect(result.current.folder?.path).toBe(HOME_PATH);
      expect(result.current.folder?.items).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
    });
  });

  it("keeps folder content mounted during reloads", async () => {
    const { result } = await renderAtHome();

    let answer: ((value: FolderChangesResponse) => void) | undefined;
    vi.spyOn(api, "fetchFolderChanges").mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );

    act(() => {
      void result.current.reloadFolder();
    });

    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.folder?.path).toBe(HOME_PATH);

    await act(async () => {
      answer?.(unchanged(homeFolder));
    });

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.folder).toBe(homeFolder);
  });

  it("patches the listing it shows through setFolder", async () => {
    const { result } = await renderAtHome();

    act(() => {
      result.current.setFolder((current) => current && { ...current, has_caption_rules: true });
    });

    await waitFor(() => expect(result.current.folder?.has_caption_rules).toBe(true));
  });

  describe("scroll intents", () => {
    it("remembers where the outgoing folder was left and asks for the top", async () => {
      const { result } = await renderAtHome();
      const element = mountScrollElement(900);

      await act(async () => {
        await result.current.navigateTo(VACATION_PATH);
      });

      // "entry-1" is the entry the initial load replaced into.
      expect(recallFolderScroll("entry-1")).toBe(900);
      expect(result.current.scrollIntent).toEqual({
        id: 1,
        mode: "reset",
        path: VACATION_PATH,
        target: 0,
      });
      expect(element.scrollTop).toBe(900);
    });

    it("saves the outgoing entry and restores the target entry on back", async () => {
      const { result } = await renderAtHome();
      mountScrollElement(900);

      await act(async () => {
        await result.current.navigateTo(VACATION_PATH);
      });

      const element = document.querySelector("main") as HTMLElement;
      element.scrollTop = 300;

      await act(async () => {
        window.dispatchEvent(
          new PopStateEvent("popstate", {
            state: { folderPath: HOME_PATH, entryKey: "entry-1" },
          }),
        );
      });

      // The entry we just left keeps its own offset for a later Forward.
      expect(recallFolderScroll("entry-2")).toBe(300);
      expect(result.current.scrollIntent).toEqual({
        id: 2,
        mode: "restore",
        path: HOME_PATH,
        target: 900,
      });
    });

    it("targets the top for a history entry with no remembered offset", async () => {
      const { result } = await renderAtHome();
      mountScrollElement(900);

      await act(async () => {
        window.dispatchEvent(
          new PopStateEvent("popstate", {
            state: { folderPath: VACATION_PATH, entryKey: "entry-from-a-previous-page-load" },
          }),
        );
      });

      expect(result.current.scrollIntent).toMatchObject({ mode: "restore", target: 0 });
    });

    it("emits nothing for a reload", async () => {
      const { result } = await renderAtHome();
      mountScrollElement(900);

      await act(async () => {
        await result.current.navigateTo(VACATION_PATH);
      });
      const afterNavigation = result.current.scrollIntent;

      await act(async () => {
        await result.current.reloadFolder();
      });

      expect(result.current.scrollIntent).toBe(afterNavigation);
    });

    it("emits nothing when navigating to the folder already open", async () => {
      const { result } = await renderAtHome();
      mountScrollElement(900);
      rememberFolderScroll("entry-1", 900);

      await act(async () => {
        await result.current.navigateTo(HOME_PATH);
      });

      expect(result.current.scrollIntent).toBeNull();
    });
  });
});
