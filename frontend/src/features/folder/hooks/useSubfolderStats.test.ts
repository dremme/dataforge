import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { clearFolderCache } from "@/features/folder/lib/folderCache";
import type { FolderResponse, Subfolder } from "@/shared/types";
import { useSubfolderStats } from "./useSubfolderStats";

const FOLDER = "C:\\Photos";
const ALBUM = "C:\\Photos\\Album";

function makeSubfolder(overrides: Partial<Subfolder> = {}): Subfolder {
  return {
    name: "Album",
    path: ALBUM,
    file_count: null,
    captioned_count: null,
    issue_count: null,
    ...overrides,
  };
}

function makeFolder(subfolders: Subfolder[]): FolderResponse {
  return {
    path: FOLDER,
    home: FOLDER,
    parent: null,
    breadcrumbs: [],
    subfolders,
    items: [],
    sysprompt: null,
    has_caption_backup: false,
    item_count: 0,
    subfolder_count: subfolders.length,
    fingerprint: "fp-v1",
  };
}

/**
 * Drives the hook off real React state, the way `useAppWorkspace` does.
 *
 * The merged counts have to flow back into the hook's own input - a harness that
 * only records what `setFolder` was called with would never re-render, and so
 * would not exercise the settling behaviour these tests are about.
 */
function renderWithFolder(initial: FolderResponse) {
  const view = renderHook(() => {
    const [folder, setFolder] = useState<FolderResponse | null>(initial);
    useSubfolderStats(folder?.path, folder?.subfolders ?? [], setFolder);
    return { folder, setFolder };
  });

  /** Stand in for a background reload: a fresh payload with counts stripped. */
  const silentReload = async (next: FolderResponse) => {
    await act(async () => {
      view.result.current.setFolder(next);
    });
  };

  return { view, silentReload };
}

describe("useSubfolderStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearFolderCache();
  });

  it("fills in counts for subfolders that arrived without them", async () => {
    const fetchStats = vi.spyOn(api, "fetchSubfolderStats").mockResolvedValue({
      folder: FOLDER,
      subfolders: [{ path: ALBUM, file_count: 3, captioned_count: 2, issue_count: 1 }],
    });

    const { view } = renderWithFolder(makeFolder([makeSubfolder()]));
    await act(async () => {});

    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(view.result.current.folder?.subfolders[0]).toMatchObject({
      file_count: 3,
      captioned_count: 2,
      issue_count: 1,
    });
  });

  it("does not fetch when there are no subfolders", async () => {
    const fetchStats = vi.spyOn(api, "fetchSubfolderStats");

    renderWithFolder(makeFolder([]));
    await act(async () => {});

    expect(fetchStats).not.toHaveBeenCalled();
  });

  it("settles after merging instead of refetching in a loop", async () => {
    const fetchStats = vi.spyOn(api, "fetchSubfolderStats").mockResolvedValue({
      folder: FOLDER,
      subfolders: [{ path: ALBUM, file_count: 3, captioned_count: 2, issue_count: 1 }],
    });

    const { view } = renderWithFolder(makeFolder([makeSubfolder()]));
    await act(async () => {});

    view.rerender();
    await act(async () => {});

    expect(fetchStats).toHaveBeenCalledTimes(1);
  });

  it("refetches when a background reload replaces the payload with blank counts", async () => {
    // A drag-and-drop import - or any background reload - swaps in a fresh
    // folder response whose subfolders carry no counts. The folder path and the
    // number of subfolders both come back unchanged, so nothing about the
    // folder's identity signals that the numbers need fetching again.
    const fetchStats = vi
      .spyOn(api, "fetchSubfolderStats")
      .mockResolvedValueOnce({
        folder: FOLDER,
        subfolders: [{ path: ALBUM, file_count: 3, captioned_count: 2, issue_count: 1 }],
      })
      .mockResolvedValueOnce({
        folder: FOLDER,
        subfolders: [{ path: ALBUM, file_count: 5, captioned_count: 2, issue_count: 1 }],
      });

    const { view, silentReload } = renderWithFolder(makeFolder([makeSubfolder()]));
    await act(async () => {});
    expect(view.result.current.folder?.subfolders[0].file_count).toBe(3);

    await silentReload(makeFolder([makeSubfolder()]));
    await act(async () => {});

    expect(fetchStats).toHaveBeenCalledTimes(2);
    expect(view.result.current.folder?.subfolders[0].file_count).toBe(5);
  });
});
