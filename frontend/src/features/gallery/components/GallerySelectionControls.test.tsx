import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import * as mediaApi from "@/features/gallery/api/media";
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "@/shared/hooks/scrollLockManager";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { withGallerySelection } from "@/test/gallerySelection";
import type { GallerySelectionValue } from "@/features/gallery/context/GallerySelectionContext";
import { GallerySelectionControls } from "./GallerySelectionControls";

vi.mock("@/features/gallery/api/media", async (importOriginal) => {
  const actual = await importOriginal<typeof mediaApi>();
  return {
    ...actual,
    deleteSelectedMedia: vi.fn(),
    moveSelectedMedia: vi.fn(),
    previewMediaMove: vi.fn(),
  };
});

const deleteSelectedMediaMock = vi.mocked(mediaApi.deleteSelectedMedia);
const moveSelectedMediaMock = vi.mocked(mediaApi.moveSelectedMedia);
const previewMediaMoveMock = vi.mocked(mediaApi.previewMediaMove);

const BOTH_SELECTED = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

/**
 * The folder is a prop; everything about the selection comes from context.
 * `totalCount` stays 2 so "all selected" matches BOTH_SELECTED.
 */
function renderControls(selection: Partial<GallerySelectionValue> = {}) {
  return renderWithProviders(
    withGallerySelection(<GallerySelectionControls currentFolder={HOME_PATH} totalCount={2} />, {
      selectionMode: true,
      selectedCount: 2,
      selectedPaths: BOTH_SELECTED,
      ...selection,
    }),
  );
}

describe("GallerySelectionControls", () => {
  beforeEach(() => {
    installMockBackend();
    deleteSelectedMediaMock.mockReset();
    moveSelectedMediaMock.mockReset();
    previewMediaMoveMock.mockReset();
    resetScrollLockManagerForTests();
  });

  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("enters selection mode from the idle state", async () => {
    const user = userEvent.setup();
    const onEnterSelectionMode = vi.fn();

    renderControls({
      selectionMode: false,
      selectedCount: 0,
      selectedPaths: new Set(),
      enterSelectionMode: onEnterSelectionMode,
    });

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onEnterSelectionMode).toHaveBeenCalledTimes(1);
  });

  it("deletes selected files after confirmation", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const exitSelectionMode = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    deleteSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      failed: [],
    });

    renderControls({ selectedPaths, onDeleted, exitSelectionMode });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirmDialog = await screen.findByRole("alertdialog", {
      name: "Delete selected files?",
    });
    expect(within(confirmDialog).getByText(/permanently delete/i)).toBeInTheDocument();
    expect(within(confirmDialog).getByText("2 selected files")).toBeInTheDocument();

    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteSelectedMediaMock).toHaveBeenCalledWith(Array.from(selectedPaths));
      expect(onDeleted).toHaveBeenCalledWith(Array.from(selectedPaths));
      expect(exitSelectionMode).toHaveBeenCalledTimes(1);
    });
  });

  it("uses singular copy when one file is selected", async () => {
    const user = userEvent.setup();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`]);

    deleteSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      failed: [],
    });

    renderControls({ selectedCount: 1, selectedPaths });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    expect(within(confirmDialog).getByText("sunset.png")).toBeInTheDocument();
  });

  it("keeps controls disabled with a spinner until deletion and refresh finish", async () => {
    const user = userEvent.setup();
    let resolveDeleted: (() => void) | undefined;
    const onDeleted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDeleted = resolve;
        }),
    );
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`]);

    deleteSelectedMediaMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ succeeded: Array.from(selectedPaths), failed: [] });
          }, 50);
        }),
    );

    renderControls({ selectedCount: 1, selectedPaths, onDeleted });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(within(confirmDialog).getByRole("button", { name: "Deleting..." })).toBeDisabled();
      expect(onDeleted).toHaveBeenCalled();
    });
    expect(within(confirmDialog).getByRole("button", { name: "Deleting..." })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(document.querySelector(".gallery-controls__btn-icon.app-icon--spin")).toBeTruthy();

    resolveDeleted!();

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("exits selection mode when Escape is pressed", () => {
    const exitSelectionMode = vi.fn();

    renderControls({ exitSelectionMode });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(exitSelectionMode).toHaveBeenCalledTimes(1);
  });

  it("does not exit selection mode on Escape while scroll lock is active", () => {
    const exitSelectionMode = vi.fn();
    const handle = acquireScrollLock("confirm-dialog-open");

    renderControls({ exitSelectionMode });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(exitSelectionMode).not.toHaveBeenCalled();
    releaseScrollLock(handle);
  });

  it("does not exit selection mode on Escape while the delete confirm dialog is open", async () => {
    const user = userEvent.setup();
    const exitSelectionMode = vi.fn();

    renderControls({ exitSelectionMode });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("alertdialog", { name: "Delete selected files?" });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(exitSelectionMode).not.toHaveBeenCalled();
  });

  it("moves selected files after choosing a destination folder", async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    previewMediaMoveMock.mockResolvedValue({
      movable: ["sunset.png", "beach.jpg"],
      conflicts: [],
      skipped: [],
    });
    moveSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      skipped: [],
      failed: [],
    });

    renderControls({ selectedPaths, onMoved });

    await user.click(screen.getByRole("button", { name: "Move" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    await waitFor(() => {
      expect(previewMediaMoveMock).toHaveBeenCalledWith(VACATION_PATH, Array.from(selectedPaths));
      expect(moveSelectedMediaMock).toHaveBeenCalledWith(
        VACATION_PATH,
        Array.from(selectedPaths),
        false,
      );
      expect(onMoved).toHaveBeenCalledWith(Array.from(selectedPaths));
    });
  });

  it("asks whether to replace files when the destination already has conflicts", async () => {
    const user = userEvent.setup();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`]);

    previewMediaMoveMock.mockResolvedValue({
      movable: [],
      conflicts: ["sunset.png"],
      skipped: [],
    });
    moveSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      skipped: [],
      failed: [],
    });

    renderControls({ selectedCount: 1, selectedPaths });

    await user.click(screen.getByRole("button", { name: "Move" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    const overwriteDialog = await screen.findByRole("alertdialog", {
      name: "Replace existing files?",
    });
    expect(within(overwriteDialog).getByText(/move only new files/i)).toBeInTheDocument();

    await user.click(within(overwriteDialog).getByRole("button", { name: "Replace existing" }));

    await waitFor(() => {
      expect(moveSelectedMediaMock).toHaveBeenCalledWith(
        VACATION_PATH,
        Array.from(selectedPaths),
        true,
      );
    });
  });

  it("reports files the backend could not move", async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    previewMediaMoveMock.mockResolvedValue({
      movable: ["sunset.png", "beach.jpg"],
      conflicts: [],
      skipped: [],
    });
    moveSelectedMediaMock.mockResolvedValue({
      succeeded: [`${HOME_PATH}\\beach.jpg`],
      skipped: [],
      failed: [
        { path: `${HOME_PATH}\\sunset.png`, error: "sunset.png is used by another process" },
      ],
    });

    renderControls({ selectedPaths, onMoved });

    await user.click(screen.getByRole("button", { name: "Move" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    expect(
      await screen.findByText(/Could not move sunset\.png: sunset\.png is used by another process/),
    ).toBeInTheDocument();
  });

  it("reports files the backend could not delete and keeps selection mode open", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const exitSelectionMode = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    deleteSelectedMediaMock.mockResolvedValue({
      succeeded: [`${HOME_PATH}\\sunset.png`],
      failed: [{ path: `${HOME_PATH}\\beach.jpg`, error: new Error("Permission denied") }],
    });

    renderControls({ selectedPaths, onDeleted, exitSelectionMode });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirmDialog = await screen.findByRole("alertdialog", {
      name: "Delete selected files?",
    });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith([`${HOME_PATH}\\sunset.png`]);
      expect(exitSelectionMode).not.toHaveBeenCalled();
    });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Could not delete beach.jpg: Permission denied"),
    ).toBeInTheDocument();
  });
});
