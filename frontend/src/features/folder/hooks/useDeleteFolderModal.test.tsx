import { act, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteFolder } from "@/features/folder/api/folders";
import type * as FoldersApi from "@/features/folder/api/folders";
import {
  readRecentFolderPaths,
  restoreRecentFolders,
} from "@/features/folder/lib/folderPreferences";
import { AppProviders } from "@/test/AppProviders";
import { useDeleteFolderModal } from "./useDeleteFolderModal";

vi.mock("@/features/folder/api/folders", async (importOriginal) => ({
  ...(await importOriginal<typeof FoldersApi>()),
  deleteFolder: vi.fn<typeof deleteFolder>(),
}));

const deleteFolderMock = vi.mocked(deleteFolder);

function renderModal({
  enabled = true,
  onDeleted = vi.fn<(parentPath: string) => Promise<void> | void>(),
} = {}) {
  return renderHook(
    () =>
      useDeleteFolderModal({
        folderPath: "C:\\Photos\\Empty",
        folderLabel: "Empty",
        enabled,
        onDeleted,
      }),
    { wrapper: AppProviders },
  );
}

describe("useDeleteFolderModal", () => {
  afterEach(() => {
    deleteFolderMock.mockReset();
    restoreRecentFolders([]);
  });

  it("offers nothing to open while the folder is not empty", () => {
    const { result } = renderModal({ enabled: false });

    expect(result.current.openModal).toBeUndefined();
    expect(result.current.overlay).toBeNull();
  });

  it("deletes the folder, forgets it, and lands on the parent", async () => {
    restoreRecentFolders(["C:\\Photos\\Empty", "C:\\Photos"]);
    deleteFolderMock.mockResolvedValue({
      path: "C:\\Photos\\Empty",
      parent: "C:\\Photos",
      deletes_to_trash: true,
    });
    const onDeleted = vi.fn<(parentPath: string) => Promise<void> | void>();
    const { result } = renderModal({ onDeleted });

    act(() => result.current.openModal?.());
    expect(result.current.overlay?.folderLabel).toBe("Empty");

    await act(async () => {
      await result.current.overlay?.onConfirm();
    });

    expect(deleteFolderMock).toHaveBeenCalledWith("C:\\Photos\\Empty");
    expect(onDeleted).toHaveBeenCalledWith("C:\\Photos");
    expect(readRecentFolderPaths()).toEqual(["C:\\Photos"]);
    expect(result.current.overlay).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Moved folder Empty to the Recycle Bin.");
  });

  it("closes and explains a refusal without leaving the folder", async () => {
    deleteFolderMock.mockRejectedValue(new Error("Folder is not empty: contains notes.txt"));
    const onDeleted = vi.fn<(parentPath: string) => Promise<void> | void>();
    const { result } = renderModal({ onDeleted });

    act(() => result.current.openModal?.());
    await act(async () => {
      await result.current.overlay?.onConfirm();
    });

    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.overlay).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Folder is not empty: contains notes.txt");
  });
});
