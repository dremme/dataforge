import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as folderHistory from "@/features/folder/lib/folderHistory";
import * as folderPreferences from "@/features/folder/lib/folderPreferences";
import {
  clearFolderScrollMemory,
  recallFolderScroll,
  rememberFolderScroll,
} from "@/features/folder/lib/folderScrollMemory";
import { HOME_PATH, homeFolder, vacationFolder, VACATION_PATH } from "@/test/fixtures";
import type { FolderResponse } from "@/shared/types";
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
    const resolvers = new Map<string | undefined, (value: FolderResponse) => void>();

    vi.spyOn(folderPreferences, "loadFolderContents").mockImplementation((path) => {
      return new Promise<FolderResponse>((resolve) => {
        resolvers.set(path, resolve);
      });
    });

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(resolvers.has(undefined)).toBe(true);
    });

    await act(async () => {
      void result.current.navigateTo(VACATION_PATH);
    });

    await waitFor(() => {
      expect(resolvers.has(VACATION_PATH)).toBe(true);
    });

    await act(async () => {
      resolvers.get(VACATION_PATH)?.(vacationFolder);
      await Promise.resolve();
    });

    await act(async () => {
      resolvers.get(undefined)?.(homeFolder);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(VACATION_PATH);
      expect(result.current.loading).toBe(false);
    });
  });

  it("keeps navigation context when a folder fails to load", async () => {
    const missingPath = `${HOME_PATH}\\Missing`;

    vi.spyOn(folderPreferences, "loadFolderContents")
      .mockResolvedValueOnce(homeFolder)
      .mockRejectedValueOnce(new Error("Folder not found"));

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(HOME_PATH);
      expect(result.current.loading).toBe(false);
    });

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

  it("clears folder state when the backend is unreachable", async () => {
    vi.spyOn(folderPreferences, "loadFolderContents")
      .mockResolvedValueOnce(homeFolder)
      .mockRejectedValueOnce(new Error("Request failed (502)"));

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(HOME_PATH);
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.navigateTo(VACATION_PATH);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "backend-unreachable" });
      expect(result.current.folder).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  it("settles both flags when a silent reload supersedes an uncached navigation", async () => {
    const resolvers = new Map<string | undefined, (value: FolderResponse) => void>();
    vi.spyOn(folderPreferences, "loadFolderContents").mockImplementation(
      (path) => new Promise<FolderResponse>((resolve) => resolvers.set(path, resolve)),
    );

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => expect(resolvers.has(undefined)).toBe(true));
    await act(async () => {
      resolvers.get(undefined)?.(homeFolder);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // An uncached destination blanks the grid, so this load owns `loading`.
    act(() => {
      void result.current.navigateTo(VACATION_PATH);
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    // A background reload lands mid-navigation and takes over the generation,
    // leaving the navigation's `finally` unreachable.
    act(() => {
      void result.current.reloadFolder({ silent: true });
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      resolvers.get(VACATION_PATH)?.(vacationFolder);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(VACATION_PATH);
      expect(result.current.refreshing).toBe(false);
      // Used to stick on, pinning the folder behind a skeleton that never cleared.
      expect(result.current.loading).toBe(false);
    });
  });

  it("settles both flags when an uncached navigation supersedes a silent reload", async () => {
    const resolvers = new Map<string | undefined, (value: FolderResponse) => void>();
    vi.spyOn(folderPreferences, "loadFolderContents").mockImplementation(
      (path) => new Promise<FolderResponse>((resolve) => resolvers.set(path, resolve)),
    );

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => expect(resolvers.has(undefined)).toBe(true));
    await act(async () => {
      resolvers.get(undefined)?.(homeFolder);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      void result.current.reloadFolder({ silent: true });
    });
    expect(result.current.refreshing).toBe(true);

    act(() => {
      void result.current.navigateTo(VACATION_PATH);
    });

    await act(async () => {
      resolvers.get(VACATION_PATH)?.(vacationFolder);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(VACATION_PATH);
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
    });
  });

  it("shows folder not found after a silent reload discovers the folder is missing", async () => {
    const missingPath = `${HOME_PATH}\\Missing`;

    vi.spyOn(folderPreferences, "loadFolderContents")
      .mockResolvedValueOnce(homeFolder)
      .mockRejectedValueOnce(new Error("Folder not found"));

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(HOME_PATH);
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.navigateTo(missingPath);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "folder-not-found" });
      expect(result.current.folder?.path).toBe(missingPath);
    });

    vi.spyOn(folderPreferences, "loadFolderContents").mockRejectedValueOnce(
      new Error("Folder not found"),
    );

    await act(async () => {
      await result.current.reloadFolder({ silent: true });
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "folder-not-found" });
      expect(result.current.folder?.path).toBe(missingPath);
      expect(result.current.folder?.items).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
    });
  });

  it("keeps folder content mounted during silent reloads", async () => {
    const loadFolderContents = vi
      .spyOn(folderPreferences, "loadFolderContents")
      .mockResolvedValue(homeFolder);

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.folder?.path).toBe(homeFolder.path);
      expect(result.current.loading).toBe(false);
    });

    let resolveReload: ((value: FolderResponse) => void) | undefined;
    loadFolderContents.mockImplementation(
      () =>
        new Promise<FolderResponse>((resolve) => {
          resolveReload = resolve;
        }),
    );

    act(() => {
      void result.current.reloadFolder({ silent: true });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.folder?.path).toBe(homeFolder.path);

    await act(async () => {
      resolveReload?.(vacationFolder);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.refreshing).toBe(false);
      expect(result.current.folder?.path).toBe(VACATION_PATH);
    });
  });

  describe("scroll intents", () => {
    async function renderAtHome() {
      vi.spyOn(folderPreferences, "loadFolderContents").mockImplementation(async (path) =>
        path === VACATION_PATH ? vacationFolder : homeFolder,
      );

      const view = renderHook(() => useFolderNavigation());
      await waitFor(() => {
        expect(view.result.current.folder?.path).toBe(HOME_PATH);
        expect(view.result.current.loading).toBe(false);
      });
      return view;
    }

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
        await Promise.resolve();
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
        await Promise.resolve();
      });

      expect(result.current.scrollIntent).toMatchObject({ mode: "restore", target: 0 });
    });

    it("emits nothing for a silent reload", async () => {
      const { result } = await renderAtHome();
      mountScrollElement(900);

      await act(async () => {
        await result.current.navigateTo(VACATION_PATH);
      });
      const afterNavigation = result.current.scrollIntent;

      await act(async () => {
        await result.current.reloadFolder({ silent: true });
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
