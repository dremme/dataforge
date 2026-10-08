import { act, renderHook, waitFor } from "@testing-library/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/folder/api/folderContents";
import { folderKeys, folderQueryOptions } from "@/features/folder/lib/folderQuery";
import * as preferences from "@/features/folder/lib/folderPreferences";
import type { FolderResponse, Subfolder, SubfolderStatsResponse } from "@/shared/types";
import { queryWrapper } from "@/test/queryClient";
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

function makeFolder(subfolders: Subfolder[], fingerprint = "fp-v1"): FolderResponse {
  return {
    path: FOLDER,
    home: FOLDER,
    parent: null,
    breadcrumbs: [],
    subfolders,
    items: [],
    has_sysprompt: false,
    sysprompt_applies: false,
    has_caption_backup: false,
    has_caption_rules: false,
    item_count: 0,
    subfolder_count: subfolders.length,
    fingerprint,
  };
}

function statsWith(fileCount: number): SubfolderStatsResponse {
  return {
    folder: FOLDER,
    subfolders: [
      {
        path: ALBUM,
        file_count: fileCount,
        captioned_count: 2,
        issue_count: 1,
        duplicate_count: 0,
      },
    ],
  };
}

/** Reads the listing the way the workspace does: from the folder's cache entry. */
function renderWithFolder(initial: FolderResponse) {
  const { client, wrapper } = queryWrapper();
  /** Every rendered listing, so a placeholder that flashed between two counts is caught. */
  const rendered: Array<FolderResponse | undefined> = [];
  client.setQueryData(folderKeys.folder(FOLDER), initial);

  const view = renderHook(
    () => {
      const { data: folder } = useQuery<FolderResponse>({
        queryKey: folderKeys.folder(FOLDER),
        queryFn: skipToken,
      });
      useSubfolderStats(folder?.path, folder?.fingerprint, folder?.subfolders ?? []);
      rendered.push(folder);
      return folder;
    },
    { wrapper },
  );

  const reload = async (next: FolderResponse) => {
    await act(async () => {
      client.setQueryData(folderKeys.folder(FOLDER), next);
    });
  };

  return { view, reload, client, rendered };
}

describe("useSubfolderStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills in counts for subfolders that arrived without them", async () => {
    const fetchStats = vi.spyOn(api, "fetchSubfolderStats").mockResolvedValue(statsWith(3));

    const { view } = renderWithFolder(makeFolder([makeSubfolder()]));

    await waitFor(() =>
      expect(view.result.current?.subfolders[0]).toMatchObject({
        file_count: 3,
        captioned_count: 2,
        issue_count: 1,
        duplicate_count: 0,
      }),
    );
    expect(fetchStats).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when there are no subfolders", async () => {
    const fetchStats = vi.spyOn(api, "fetchSubfolderStats");

    renderWithFolder(makeFolder([]));
    await act(async () => {});

    expect(fetchStats).not.toHaveBeenCalled();
  });

  it("settles after merging instead of refetching in a loop", async () => {
    const fetchStats = vi.spyOn(api, "fetchSubfolderStats").mockResolvedValue(statsWith(3));

    const { view } = renderWithFolder(makeFolder([makeSubfolder()]));
    await waitFor(() => expect(view.result.current?.subfolders[0].file_count).toBe(3));

    view.rerender();
    await act(async () => {});

    expect(fetchStats).toHaveBeenCalledTimes(1);
  });

  it("keeps the counts through a delta that changes only items", async () => {
    const fetchStats = vi.spyOn(api, "fetchSubfolderStats").mockResolvedValue(statsWith(3));

    const { view, reload } = renderWithFolder(makeFolder([makeSubfolder()]));
    await waitFor(() => expect(view.result.current?.subfolders[0].file_count).toBe(3));

    await reload({ ...view.result.current!, fingerprint: "fp-v2" });
    await act(async () => {});

    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(view.result.current?.subfolders[0].file_count).toBe(3);
  });

  it("refetches when a reload replaces the listing with blank counts", async () => {
    const fetchStats = vi
      .spyOn(api, "fetchSubfolderStats")
      .mockResolvedValueOnce(statsWith(3))
      .mockResolvedValueOnce(statsWith(5));

    const { view, reload } = renderWithFolder(makeFolder([makeSubfolder()]));
    await waitFor(() => expect(view.result.current?.subfolders[0].file_count).toBe(3));

    // Same fingerprint: a server that forgot its diff baseline lists the folder again as is.
    await reload(makeFolder([makeSubfolder()]));

    await waitFor(() => expect(view.result.current?.subfolders[0].file_count).toBe(5));
    expect(fetchStats).toHaveBeenCalledTimes(2);
  });

  it("refetches when a reload lands while the stats request is still in flight", async () => {
    // The in-flight answer predates the new files; letting it settle would strand a stale count.
    let settleFirst: (stats: SubfolderStatsResponse) => void = () => {};
    const first = new Promise<SubfolderStatsResponse>((resolve) => {
      settleFirst = resolve;
    });
    const fetchStats = vi
      .spyOn(api, "fetchSubfolderStats")
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(statsWith(5));

    const { view, reload } = renderWithFolder(makeFolder([makeSubfolder()]));
    await waitFor(() => expect(fetchStats).toHaveBeenCalledTimes(1));

    await reload(makeFolder([makeSubfolder()], "fp-v2"));
    await act(async () => {
      settleFirst(statsWith(3));
    });

    await waitFor(() => expect(view.result.current?.subfolders[0].file_count).toBe(5));
    expect(fetchStats).toHaveBeenCalledTimes(2);
  });

  it("recounts a full reload without blanking the counts it carried over", async () => {
    const fetchStats = vi
      .spyOn(api, "fetchSubfolderStats")
      .mockResolvedValueOnce(statsWith(3))
      .mockResolvedValueOnce(statsWith(4));
    const { view, client, rendered } = renderWithFolder(makeFolder([makeSubfolder()]));
    await waitFor(() => expect(view.result.current?.subfolders[0].file_count).toBe(3));

    // A job wrote into the subfolder: its mtime moved, so the parent is listed in full again,
    // and a full listing comes without subfolder counts.
    vi.spyOn(api, "fetchFolderChanges").mockResolvedValue({
      full: true,
      fingerprint: "fp-v2",
      changed: [],
      removed: [],
      stale_subfolders: [],
    });
    vi.spyOn(preferences, "loadFolderContents").mockResolvedValue(
      makeFolder([makeSubfolder()], "fp-v2"),
    );
    await act(async () => {
      await client.fetchQuery({ ...folderQueryOptions(FOLDER), staleTime: 0 });
    });

    await waitFor(() => expect(view.result.current?.subfolders[0].file_count).toBe(4));
    view.rerender();
    await act(async () => {});

    const counts = rendered
      .filter((folder) => folder?.fingerprint === "fp-v2")
      .map((folder) => folder?.subfolders[0].file_count);
    expect(new Set(counts)).toEqual(new Set([3, 4]));
    expect(fetchStats).toHaveBeenCalledTimes(2);
  });
});
