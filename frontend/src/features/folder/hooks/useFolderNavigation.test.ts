import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as folderPreferences from "@/features/folder/lib/folderPreferences";
import { HOME_PATH, homeFolder, vacationFolder, VACATION_PATH } from "@/test/fixtures";
import type { FolderResponse } from "@/shared/types";
import { useFolderNavigation } from "./useFolderNavigation";

vi.mock("@/features/folder/lib/folderHistory", () => ({
  getFolderFromUrl: () => undefined,
  getFolderFromHistoryEvent: () => undefined,
  syncFolderHistory: vi.fn(),
}));

describe("useFolderNavigation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
