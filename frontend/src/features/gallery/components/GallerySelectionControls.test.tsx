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
import { renderWithProviders } from "@/test/renderWithProviders";
import { GallerySelectionControls } from "./GallerySelectionControls";

const render = renderWithProviders;

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

const defaultProps = {
  currentFolder: HOME_PATH,
  totalCount: 2,
  selectionMode: true,
  selectedCount: 2,
  selectedPaths: new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]),
  onEnterSelectionMode: vi.fn(),
  onExitSelectionMode: vi.fn(),
  onSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  onDeleted: vi.fn(),
  onMoved: vi.fn(),
};

describe("GallerySelectionControls", () => {
  beforeEach(() => {
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

    render(
      <GallerySelectionControls
        {...defaultProps}
        selectionMode={false}
        selectedCount={0}
        selectedPaths={new Set()}
        onEnterSelectionMode={onEnterSelectionMode}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onEnterSelectionMode).toHaveBeenCalledTimes(1);
  });

  it("deletes selected files after confirmation", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const onExitSelectionMode = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    deleteSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      failed: [],
    });

    render(
      <GallerySelectionControls
        {...defaultProps}
        selectedPaths={selectedPaths}
        onDeleted={onDeleted}
        onExitSelectionMode={onExitSelectionMode}
      />,
    );

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
      expect(onExitSelectionMode).toHaveBeenCalledTimes(1);
    });
  });

  it("uses singular copy when one file is selected", async () => {
    const user = userEvent.setup();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`]);

    deleteSelectedMediaMock.mockResolvedValue({
      succeeded: Array.from(selectedPaths),
      failed: [],
    });

    render(
      <GallerySelectionControls
        {...defaultProps}
        selectedCount={1}
        selectedPaths={selectedPaths}
      />,
    );

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

    render(
      <GallerySelectionControls
        {...defaultProps}
        selectedCount={1}
        selectedPaths={selectedPaths}
        onDeleted={onDeleted}
      />,
    );

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
    const onExitSelectionMode = vi.fn();

    render(
      <GallerySelectionControls {...defaultProps} onExitSelectionMode={onExitSelectionMode} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onExitSelectionMode).toHaveBeenCalledTimes(1);
  });

  it("does not exit selection mode on Escape while scroll lock is active", () => {
    const onExitSelectionMode = vi.fn();
    const handle = acquireScrollLock("confirm-dialog-open");

    render(
      <GallerySelectionControls {...defaultProps} onExitSelectionMode={onExitSelectionMode} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onExitSelectionMode).not.toHaveBeenCalled();
    releaseScrollLock(handle);
  });

  it("does not exit selection mode on Escape while the delete confirm dialog is open", async () => {
    const user = userEvent.setup();
    const onExitSelectionMode = vi.fn();

    render(
      <GallerySelectionControls {...defaultProps} onExitSelectionMode={onExitSelectionMode} />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("alertdialog", { name: "Delete selected files?" });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onExitSelectionMode).not.toHaveBeenCalled();
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

    render(
      <GallerySelectionControls
        {...defaultProps}
        selectedPaths={selectedPaths}
        onMoved={onMoved}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Move" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.clear(within(picker).getByLabelText("Folder path"));
    await user.type(within(picker).getByLabelText("Folder path"), VACATION_PATH);
    await user.click(within(picker).getByRole("button", { name: "Move" }));

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

    render(
      <GallerySelectionControls
        {...defaultProps}
        selectedCount={1}
        selectedPaths={selectedPaths}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Move" }));

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.clear(within(picker).getByLabelText("Folder path"));
    await user.type(within(picker).getByLabelText("Folder path"), VACATION_PATH);
    await user.click(within(picker).getByRole("button", { name: "Move" }));

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

  it("applies partial deletes silently and keeps selection mode open", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const onExitSelectionMode = vi.fn();
    const selectedPaths = new Set([`${HOME_PATH}\\sunset.png`, `${HOME_PATH}\\beach.jpg`]);

    deleteSelectedMediaMock.mockResolvedValue({
      succeeded: [`${HOME_PATH}\\sunset.png`],
      failed: [{ path: `${HOME_PATH}\\beach.jpg`, error: new Error("Permission denied") }],
    });

    render(
      <GallerySelectionControls
        {...defaultProps}
        selectedPaths={selectedPaths}
        onDeleted={onDeleted}
        onExitSelectionMode={onExitSelectionMode}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirmDialog = await screen.findByRole("alertdialog", {
      name: "Delete selected files?",
    });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith([`${HOME_PATH}\\sunset.png`]);
      expect(onExitSelectionMode).not.toHaveBeenCalled();
    });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
