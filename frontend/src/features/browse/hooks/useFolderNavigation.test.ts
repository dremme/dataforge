import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as folderPreferences from "@/features/browse/lib/folderPreferences";
import { HOME_PATH, homeBrowse, vacationBrowse, VACATION_PATH } from "@/test/fixtures";
import type { BrowseResponse } from "@/shared/types";
import { useFolderNavigation } from "./useFolderNavigation";

vi.mock("@/features/browse/lib/folderHistory", () => ({
  getFolderFromUrl: () => undefined,
  getFolderFromHistoryEvent: () => undefined,
  syncFolderHistory: vi.fn(),
}));

describe("useFolderNavigation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("drops stale browse responses when navigation outpaces loading", async () => {
    const resolvers = new Map<string | undefined, (value: BrowseResponse) => void>();

    vi.spyOn(folderPreferences, "loadBrowseFolder").mockImplementation((path) => {
      return new Promise<BrowseResponse>((resolve) => {
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
      resolvers.get(VACATION_PATH)?.(vacationBrowse);
      await Promise.resolve();
    });

    await act(async () => {
      resolvers.get(undefined)?.(homeBrowse);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.browse?.folder).toBe(VACATION_PATH);
      expect(result.current.loading).toBe(false);
    });
  });

  it("keeps navigation context when a folder fails to load", async () => {
    const missingPath = `${HOME_PATH}\\Missing`;

    vi.spyOn(folderPreferences, "loadBrowseFolder")
      .mockResolvedValueOnce(homeBrowse)
      .mockRejectedValueOnce(new Error("Folder not found"));

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.browse?.folder).toBe(HOME_PATH);
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.navigateTo(missingPath);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "folder-not-found" });
      expect(result.current.browse?.folder).toBe(missingPath);
      expect(result.current.browse?.breadcrumbs.length).toBeGreaterThan(0);
      expect(result.current.browse?.items).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
  });

  it("clears browse state when the backend is unreachable", async () => {
    vi.spyOn(folderPreferences, "loadBrowseFolder")
      .mockResolvedValueOnce(homeBrowse)
      .mockRejectedValueOnce(new Error("Request failed (502)"));

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.browse?.folder).toBe(HOME_PATH);
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.navigateTo(VACATION_PATH);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "backend-unreachable" });
      expect(result.current.browse).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  it("shows folder not found after a silent reload discovers the folder is missing", async () => {
    const missingPath = `${HOME_PATH}\\Missing`;

    vi.spyOn(folderPreferences, "loadBrowseFolder")
      .mockResolvedValueOnce(homeBrowse)
      .mockRejectedValueOnce(new Error("Folder not found"));

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.browse?.folder).toBe(HOME_PATH);
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.navigateTo(missingPath);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "folder-not-found" });
      expect(result.current.browse?.folder).toBe(missingPath);
    });

    vi.spyOn(folderPreferences, "loadBrowseFolder").mockRejectedValueOnce(
      new Error("Folder not found"),
    );

    await act(async () => {
      await result.current.reloadFolder({ silent: true });
    });

    await waitFor(() => {
      expect(result.current.error).toEqual({ kind: "folder-not-found" });
      expect(result.current.browse?.folder).toBe(missingPath);
      expect(result.current.browse?.items).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
    });
  });

  it("keeps browse content mounted during silent reloads", async () => {
    const loadBrowseFolder = vi
      .spyOn(folderPreferences, "loadBrowseFolder")
      .mockResolvedValue(homeBrowse);

    const { result } = renderHook(() => useFolderNavigation());

    await waitFor(() => {
      expect(result.current.browse?.folder).toBe(homeBrowse.folder);
      expect(result.current.loading).toBe(false);
    });

    let resolveReload: ((value: BrowseResponse) => void) | undefined;
    loadBrowseFolder.mockImplementation(
      () =>
        new Promise<BrowseResponse>((resolve) => {
          resolveReload = resolve;
        }),
    );

    act(() => {
      void result.current.reloadFolder({ silent: true });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.browse?.folder).toBe(homeBrowse.folder);

    await act(async () => {
      resolveReload?.(vacationBrowse);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.refreshing).toBe(false);
      expect(result.current.browse?.folder).toBe(VACATION_PATH);
    });
  });
});
