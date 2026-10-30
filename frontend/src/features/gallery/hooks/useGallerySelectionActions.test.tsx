import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MediaApi from "@/features/gallery/api/media";
import { deleteSelectedMedia, restoreDeletedMedia } from "@/features/gallery/api/media";
import { AppProviders } from "@/test/AppProviders";
import { HOME_PATH } from "@/test/fixtures";
import { useGallerySelectionActions } from "./useGallerySelectionActions";

vi.mock("@/features/gallery/api/media", async (importOriginal) => ({
  ...(await importOriginal<typeof MediaApi>()),
  deleteSelectedMedia: vi.fn<typeof deleteSelectedMedia>(),
  restoreDeletedMedia: vi.fn<typeof restoreDeletedMedia>(),
}));

const deleteMock = vi.mocked(deleteSelectedMedia);
const restoreMock = vi.mocked(restoreDeletedMedia);

const SELECTED = [`${HOME_PATH}\\a.png`, `${HOME_PATH}\\b.png`];
const CARD = `${HOME_PATH}\\c.png`;

function renderActions() {
  const onDeleted = vi.fn<(paths: string[]) => void>();
  const onCopied = vi.fn<() => void>();
  const hook = renderHook(
    () =>
      useGallerySelectionActions({
        currentFolder: HOME_PATH,
        visibleSelectedPaths: new Set(SELECTED),
        visibleSelectedCount: SELECTED.length,
        onDeleted,
        onMoved: vi.fn<(paths: string[]) => void>(),
        onCopied,
      }),
    { wrapper: AppProviders },
  );
  return { ...hook, onDeleted, onCopied };
}

describe("useGallerySelectionActions", () => {
  beforeEach(() => {
    deleteMock.mockReset();
    restoreMock.mockReset();
    deleteMock.mockImplementation(async (paths) => ({
      succeeded: [...paths],
      failed: [],
      responses: [],
    }));
  });

  it("offers Undo for what went to the Recycle Bin, restoring each file with its sidecars", async () => {
    const caption = CARD.replace(".png", ".txt");
    deleteMock.mockResolvedValue({
      succeeded: [CARD],
      failed: [],
      responses: [{ path: CARD, deleted: [], retained: [], recycled: [CARD, caption] }],
    });
    restoreMock.mockResolvedValue({ restored: [CARD, caption], missing: [], failed: [] });
    const user = userEvent.setup();
    const { result, onCopied } = renderActions();

    act(() => result.current.openDeleteConfirmFor(CARD));
    await act(() => result.current.overlay.onConfirmDelete());
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith([CARD, caption]));
    await waitFor(() => expect(onCopied).toHaveBeenCalled());
  });

  it("offers no Undo where deletes are permanent", async () => {
    deleteMock.mockResolvedValue({
      succeeded: [CARD],
      failed: [],
      responses: [{ path: CARD, deleted: [], retained: [], recycled: [] }],
    });
    const { result } = renderActions();

    act(() => result.current.openDeleteConfirmFor(CARD));
    await act(() => result.current.overlay.onConfirmDelete());

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("deletes only a card's own file, whatever is selected", async () => {
    const { result, onDeleted } = renderActions();

    act(() => result.current.openDeleteConfirmFor(CARD));
    expect(result.current.overlay.deleteConfirmOpen).toBe(true);
    expect(result.current.overlay.deletesSelection).toBe(false);
    expect([...result.current.overlay.deletePaths]).toEqual([CARD]);

    await act(() => result.current.overlay.onConfirmDelete());

    expect(deleteMock).toHaveBeenCalledWith([CARD]);
    expect(onDeleted).toHaveBeenCalledWith([CARD]);
  });

  it("returns to the selection once a card's confirm is cancelled", () => {
    const { result } = renderActions();

    act(() => result.current.openDeleteConfirmFor(CARD));
    act(() => result.current.overlay.onCancelDelete());
    act(() => result.current.openDeleteConfirm());

    expect(result.current.overlay.deletesSelection).toBe(true);
    expect([...result.current.overlay.deletePaths]).toEqual(SELECTED);
  });
});
