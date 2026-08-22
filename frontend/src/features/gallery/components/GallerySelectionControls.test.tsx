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
import { withGallerySelectionActions } from "@/test/gallerySelection";
import type { GallerySelectionValue } from "@/features/gallery/context/GallerySelectionContext";
import { GallerySelectionControls } from "./GallerySelectionControls";

vi.mock("@/features/gallery/api/media", async (importOriginal) => {
  const actual = await importOriginal<typeof mediaApi>();
  return {
    ...actual,
    deleteSelectedMedia: vi.fn(),
    transferSelectedMedia: vi.fn(),
    previewMediaTransfer: vi.fn(),
  };
});

const deleteSelectedMediaMock = vi.mocked(mediaApi.deleteSelectedMedia);
const transferSelectedMediaMock = vi.mocked(mediaApi.transferSelectedMedia);
const previewMediaTransferMock = vi.mocked(mediaApi.previewMediaTransfer);

const BOTH_SELECTED = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

/**
 * Everything about the selection comes from context, batch actions included —
 * the harness mounts the real ones with their dialogs, the way the app does.
 * `totalCount` stays 2 so "all selected" matches BOTH_SELECTED.
 *
 * No filter is active in these cases, so everything selected is also on screen:
 * the visible pair is derived from `selectedPaths` rather than restated, which
 * keeps a case from claiming a count its own set contradicts. Pass
 * `visibleSelectedPaths` explicitly to test the two coming apart.
 */
function renderControls(selection: Partial<GallerySelectionValue> = {}, totalCount = 2) {
  const merged = {
    selectionMode: true,
    selectedPaths: BOTH_SELECTED,
    ...selection,
  };
  const visibleSelectedPaths = merged.visibleSelectedPaths ?? merged.selectedPaths;

  return renderWithProviders(
    withGallerySelectionActions(
      <GallerySelectionControls totalCount={totalCount} />,
      { ...merged, visibleSelectedPaths, visibleSelectedCount: visibleSelectedPaths.size },
      { currentFolder: HOME_PATH },
    ),
  );
}

describe("GallerySelectionControls", () => {
  beforeEach(() => {
    installMockBackend();
    deleteSelectedMediaMock.mockReset();
    transferSelectedMediaMock.mockReset();
    previewMediaTransferMock.mockReset();
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
      selectedPaths: new Set(),
      enterSelectionMode: onEnterSelectionMode,
    });

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onEnterSelectionMode).toHaveBeenCalledTimes(1);
  });

  it("carries the transfer and delete actions as labelled icons", () => {
    renderControls();

    for (const name of ["Copy selected files", "Move selected files", "Delete selected files"]) {
      const button = screen.getByRole("button", { name });
      // Icon-only: the accessible name is the label, not rendered text.
      expect(button).toHaveTextContent("");
      expect(button).toHaveAttribute("aria-label", name);
      expect(screen.getByText(name)).toHaveRole("tooltip");
    }

    // The selection verbs keep their text, so the row still reads as a toolbar.
    expect(screen.getByRole("button", { name: "All" })).toHaveTextContent("All");
    expect(screen.getByRole("button", { name: "Invert" })).toHaveTextContent("Invert");
    expect(screen.getByRole("button", { name: "None" })).toHaveTextContent("None");
  });

  it("places Invert between All and None", () => {
    renderControls();

    const labels = [...screen.getByRole("button", { name: "All" }).parentElement!.children]
      .filter((node) => node instanceof HTMLButtonElement)
      .map((button) => button.textContent || button.getAttribute("aria-label"));

    expect(labels.slice(1, 4)).toEqual(["All", "Invert", "None"]);
  });

  it("inverts the selection from the header", async () => {
    const user = userEvent.setup();
    const invertSelectedPaths = vi.fn();

    renderControls({
      invertSelectedPaths,
      selectedPaths: new Set([`${HOME_PATH}\\sunset.png`]),
    });

    await user.click(screen.getByRole("button", { name: "Invert" }));

    expect(invertSelectedPaths).toHaveBeenCalledTimes(1);
  });

  it("keeps Invert available when everything or nothing is selected", () => {
    const { unmount } = renderControls();
    expect(screen.getByRole("button", { name: "All" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Invert" })).toBeEnabled();
    unmount();

    renderControls({ selectedPaths: new Set() });
    expect(screen.getByRole("button", { name: "None" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Invert" })).toBeEnabled();
  });

  it("disables Invert when there are no files to flip", () => {
    renderControls({ selectedPaths: new Set() }, 0);

    expect(screen.getByRole("button", { name: "Invert" })).toBeDisabled();
  });

  it("deletes only the selected files the filters leave visible", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const visiblePath = `${HOME_PATH}\\sunset.png`;
    const selectedPaths = new Set([visiblePath, `${HOME_PATH}\\beach.jpg`]);
    const visibleSelectedPaths = new Set([visiblePath]);

    deleteSelectedMediaMock.mockResolvedValue({ succeeded: [visiblePath], failed: [] });

    renderControls({ selectedPaths, visibleSelectedPaths, onDeleted }, 1);

    await user.click(screen.getByRole("button", { name: "Delete selected files" }));

    // The dialog promises exactly what the delete will reach, not the whole set.
    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteSelectedMediaMock).toHaveBeenCalledWith([visiblePath]);
      expect(onDeleted).toHaveBeenCalledWith([visiblePath]);
    });
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

    await user.click(screen.getByRole("button", { name: "Delete selected files" }));

    const confirmDialog = await screen.findByRole("alertdialog", {
      name: "Delete selected files?",
    });
    // The scope row says what and where; the description is left the caveats.
    expect(confirmDialog.querySelector(".dialog-scope__line")).toHaveTextContent(
      "2 selected files in Photos",
    );
    expect(within(confirmDialog).getByText(/matching caption sidecars/i)).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/Recycle Bin/i)).toBeInTheDocument();

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

    renderControls({ selectedPaths });

    await user.click(screen.getByRole("button", { name: "Delete selected files" }));

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

    // The busy window under test is held open by `onDeleted`'s pending promise,
    // not by the delete call, so this resolves straight away.
    deleteSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      failed: [],
    });

    renderControls({ selectedPaths, onDeleted });

    await user.click(screen.getByRole("button", { name: "Delete selected files" }));

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

  it("clears the selection on Escape rather than leaving selection mode", () => {
    const exitSelectionMode = vi.fn();
    const clearSelectedPaths = vi.fn();

    renderControls({ exitSelectionMode, clearSelectedPaths });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(clearSelectedPaths).toHaveBeenCalledTimes(1);
    expect(exitSelectionMode).not.toHaveBeenCalled();
  });

  it("exits selection mode on Escape once nothing is selected", () => {
    const exitSelectionMode = vi.fn();
    const clearSelectedPaths = vi.fn();

    renderControls({
      selectedPaths: new Set(),
      exitSelectionMode,
      clearSelectedPaths,
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(exitSelectionMode).toHaveBeenCalledTimes(1);
    expect(clearSelectedPaths).not.toHaveBeenCalled();
  });

  it("ignores Escape entirely while scroll lock is active", () => {
    const exitSelectionMode = vi.fn();
    const clearSelectedPaths = vi.fn();
    const handle = acquireScrollLock("confirm-dialog-open");

    renderControls({ exitSelectionMode, clearSelectedPaths });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(exitSelectionMode).not.toHaveBeenCalled();
    expect(clearSelectedPaths).not.toHaveBeenCalled();
    releaseScrollLock(handle);
  });

  it("ignores Escape entirely while the delete confirm dialog is open", async () => {
    const user = userEvent.setup();
    const exitSelectionMode = vi.fn();
    const clearSelectedPaths = vi.fn();

    renderControls({ exitSelectionMode, clearSelectedPaths });

    await user.click(screen.getByRole("button", { name: "Delete selected files" }));
    await screen.findByRole("alertdialog", { name: "Delete selected files?" });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(exitSelectionMode).not.toHaveBeenCalled();
    expect(clearSelectedPaths).not.toHaveBeenCalled();
  });

  it("moves selected files after choosing a destination folder", async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    previewMediaTransferMock.mockResolvedValue({
      eligible: ["sunset.png", "beach.jpg"],
      conflicts: [],
      skipped: [],
    });
    transferSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      skipped: [],
      failed: [],
    });

    renderControls({ selectedPaths, onMoved });

    await user.click(screen.getByRole("button", { name: "Move selected files" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    await waitFor(() => {
      expect(previewMediaTransferMock).toHaveBeenCalledWith(
        "move",
        VACATION_PATH,
        Array.from(selectedPaths),
      );
      expect(transferSelectedMediaMock).toHaveBeenCalledWith(
        "move",
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

    previewMediaTransferMock.mockResolvedValue({
      eligible: [],
      conflicts: ["sunset.png"],
      skipped: [],
    });
    transferSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      skipped: [],
      failed: [],
    });

    renderControls({ selectedPaths });

    await user.click(screen.getByRole("button", { name: "Move selected files" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    const overwriteDialog = await screen.findByRole("alertdialog", {
      name: "Replace existing files?",
    });
    expect(within(overwriteDialog).getByText(/move only new files/i)).toBeInTheDocument();

    await user.click(within(overwriteDialog).getByRole("button", { name: "Replace existing" }));

    await waitFor(() => {
      expect(transferSelectedMediaMock).toHaveBeenCalledWith(
        "move",
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

    previewMediaTransferMock.mockResolvedValue({
      eligible: ["sunset.png", "beach.jpg"],
      conflicts: [],
      skipped: [],
    });
    transferSelectedMediaMock.mockResolvedValue({
      succeeded: [`${HOME_PATH}\\beach.jpg`],
      skipped: [],
      failed: [
        { path: `${HOME_PATH}\\sunset.png`, error: "sunset.png is used by another process" },
      ],
    });

    renderControls({ selectedPaths, onMoved });

    await user.click(screen.getByRole("button", { name: "Move selected files" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    expect(
      await screen.findByText(/Could not move sunset\.png: sunset\.png is used by another process/),
    ).toBeInTheDocument();
  });

  it("copies selected files and keeps them in the current folder", async () => {
    const user = userEvent.setup();
    const onMoved = vi.fn();
    const onCopied = vi.fn();
    const exitSelectionMode = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    previewMediaTransferMock.mockResolvedValue({
      eligible: ["sunset.png", "beach.jpg"],
      conflicts: [],
      skipped: [],
    });
    transferSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      skipped: [],
      failed: [],
    });

    renderControls({ selectedPaths, onMoved, onCopied, exitSelectionMode });

    await user.click(screen.getByRole("button", { name: "Copy selected files" }));

    const picker = await screen.findByRole("dialog", { name: "Copy to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Copy here" }));

    await waitFor(() => {
      expect(previewMediaTransferMock).toHaveBeenCalledWith(
        "copy",
        VACATION_PATH,
        Array.from(selectedPaths),
      );
      expect(transferSelectedMediaMock).toHaveBeenCalledWith(
        "copy",
        VACATION_PATH,
        Array.from(selectedPaths),
        false,
      );
      expect(onCopied).toHaveBeenCalled();
    });

    // The originals stay put, so nothing is dropped and the selection survives.
    expect(onMoved).not.toHaveBeenCalled();
    expect(exitSelectionMode).not.toHaveBeenCalled();
    expect(await screen.findByText("Copied 2 files to Vacation.")).toBeInTheDocument();
  });

  it("offers to copy only new files when the destination already has conflicts", async () => {
    const user = userEvent.setup();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`]);

    previewMediaTransferMock.mockResolvedValue({
      eligible: [],
      conflicts: ["sunset.png"],
      skipped: [],
    });
    transferSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      skipped: [],
      failed: [],
    });

    renderControls({ selectedPaths });

    await user.click(screen.getByRole("button", { name: "Copy selected files" }));

    const picker = await screen.findByRole("dialog", { name: "Copy to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Copy here" }));

    const overwriteDialog = await screen.findByRole("alertdialog", {
      name: "Replace existing files?",
    });
    expect(within(overwriteDialog).getByText(/copy only new files/i)).toBeInTheDocument();

    await user.click(within(overwriteDialog).getByRole("button", { name: "Replace existing" }));

    await waitFor(() => {
      expect(transferSelectedMediaMock).toHaveBeenCalledWith(
        "copy",
        VACATION_PATH,
        Array.from(selectedPaths),
        true,
      );
    });
  });

  it("reports files the backend could not copy", async () => {
    const user = userEvent.setup();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`]);

    previewMediaTransferMock.mockResolvedValue({
      eligible: ["sunset.png"],
      conflicts: [],
      skipped: [],
    });
    transferSelectedMediaMock.mockResolvedValue({
      succeeded: [],
      skipped: [],
      failed: [{ path: `${HOME_PATH}\\sunset.png`, error: "destination is read-only" }],
    });

    renderControls({ selectedPaths });

    await user.click(screen.getByRole("button", { name: "Copy selected files" }));

    const picker = await screen.findByRole("dialog", { name: "Copy to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Copy here" }));

    expect(
      await screen.findByText(/Could not copy sunset\.png: destination is read-only/),
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

    await user.click(screen.getByRole("button", { name: "Delete selected files" }));

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
