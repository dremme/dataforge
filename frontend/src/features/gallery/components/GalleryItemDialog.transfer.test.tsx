import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemDialog";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import * as mediaApi from "@/features/gallery/api/media";
import { GalleryItemDialog } from "./GalleryItemDialog";
import type {
  deleteMedia,
  previewMediaTransfer,
  transferSelectedMedia,
} from "@/features/gallery/api/media";
import type { encodeVideoFrame, seekVideoTo } from "@/features/gallery/lib/videoFrameEncode";
import type { importFiles, previewFileImport } from "@/features/folder/api/files";
import type { CaptionSaveResponse } from "@/shared/types";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

vi.mock("@/features/gallery/api/media", async (importOriginal) => {
  const actual = await importOriginal<typeof mediaApi>();
  return {
    ...actual,
    deleteMedia: vi.fn<typeof deleteMedia>(actual.deleteMedia),
    previewMediaTransfer: vi.fn<typeof previewMediaTransfer>(),
    transferSelectedMedia: vi.fn<typeof transferSelectedMedia>(),
  };
});

// jsdom has neither a video decoder nor a 2D canvas context, which is exactly why
// these two live in their own module: the flow around them stays testable.
vi.mock("@/features/gallery/lib/videoFrameEncode", () => ({
  seekVideoTo: vi.fn<typeof seekVideoTo>(),
  encodeVideoFrame: vi.fn<typeof encodeVideoFrame>(),
}));

vi.mock("@/features/folder/api/files", () => ({
  importFiles: vi.fn<typeof importFiles>(),
  previewFileImport: vi.fn<typeof previewFileImport>(),
}));

const deleteMediaMock = vi.mocked(mediaApi.deleteMedia);
const previewMediaTransferMock = vi.mocked(mediaApi.previewMediaTransfer);
const transferSelectedMediaMock = vi.mocked(mediaApi.transferSelectedMedia);

describe("GalleryItemDialog", () => {
  beforeEach(() => {
    installMockBackend();
    deleteMediaMock.mockClear();
    previewMediaTransferMock.mockReset();
    transferSelectedMediaMock.mockReset();
  });

  describe("move and copy", () => {
    const SUNSET_PATH = `${HOME_PATH}\\sunset.png`;

    type TransferDialogHandlers = {
      onClose: Mock<() => void>;
      onMoved: Mock<(paths: string[]) => void>;
      onCopied: Mock<() => void>;
    };

    function renderTransferDialog(overrides: Partial<TransferDialogHandlers> = {}) {
      const handlers: TransferDialogHandlers = {
        onClose: vi.fn<() => void>(),
        onMoved: vi.fn<(paths: string[]) => void>(),
        onCopied: vi.fn<() => void>(),
        ...overrides,
      };

      renderWithProviders(
        <GalleryItemDialog
          items={[makeItem("sunset.png")]}
          index={0}
          currentFolder={HOME_PATH}
          onClose={handlers.onClose}
          onPrevious={vi.fn<() => void>()}
          onNext={vi.fn<() => void>()}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
          onMoved={handlers.onMoved}
          onCopied={handlers.onCopied}
        />,
      );

      return handlers;
    }

    /** Walks the picker from the header button through to the confirm click. */
    async function pickDestination(
      user: ReturnType<typeof userEvent.setup>,
      mode: "Move" | "Copy",
    ) {
      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      await user.click(
        within(dialog).getByRole("button", { name: `${mode} sunset.png to another folder` }),
      );

      const picker = await screen.findByRole("dialog", { name: `${mode} to folder` });
      await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
      await user.click(within(picker).getByRole("button", { name: `${mode} here` }));

      return picker;
    }

    it("moves the viewed file to a chosen destination", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({
        eligible: ["sunset.png"],
        conflicts: [],
        skipped: [],
      });
      transferSelectedMediaMock.mockResolvedValue({
        succeeded: [SUNSET_PATH],
        skipped: [],
        failed: [],
        transferred: [],
      });

      const { onMoved, onCopied } = renderTransferDialog();

      await pickDestination(user, "Move");

      await waitFor(() => {
        expect(previewMediaTransferMock).toHaveBeenCalledWith("move", VACATION_PATH, [SUNSET_PATH]);
        expect(transferSelectedMediaMock).toHaveBeenCalledWith(
          "move",
          VACATION_PATH,
          [SUNSET_PATH],
          false,
        );
        expect(onMoved).toHaveBeenCalledWith([SUNSET_PATH]);
      });
      expect(onCopied).not.toHaveBeenCalled();
    });

    it("copies the viewed file and names it in the confirmation", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({
        eligible: ["sunset.png"],
        conflicts: [],
        skipped: [],
      });
      transferSelectedMediaMock.mockResolvedValue({
        succeeded: [SUNSET_PATH],
        skipped: [],
        failed: [],
        transferred: [],
      });

      const { onMoved, onCopied } = renderTransferDialog();

      await pickDestination(user, "Copy");

      await waitFor(() => {
        expect(transferSelectedMediaMock).toHaveBeenCalledWith(
          "copy",
          VACATION_PATH,
          [SUNSET_PATH],
          false,
        );
        expect(onCopied).toHaveBeenCalled();
      });
      expect(onMoved).not.toHaveBeenCalled();
      expect(await screen.findByText("Copied sunset.png to Vacation.")).toBeInTheDocument();
    });

    it("names the viewed file in the destination picker instead of counting a selection", async () => {
      const user = userEvent.setup();
      renderTransferDialog();

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      await user.click(
        within(dialog).getByRole("button", { name: "Move sunset.png to another folder" }),
      );

      const picker = await screen.findByRole("dialog", { name: "Move to folder" });
      expect(within(picker).getByText("sunset.png")).toBeInTheDocument();
      expect(within(picker).queryByText(/selected file/)).not.toBeInTheDocument();
    });

    it("asks whether to replace an existing file at the destination", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({
        eligible: [],
        conflicts: ["sunset.png"],
        skipped: [],
      });
      transferSelectedMediaMock.mockResolvedValue({
        succeeded: [SUNSET_PATH],
        skipped: [],
        failed: [],
        transferred: [],
      });

      renderTransferDialog();

      await pickDestination(user, "Move");

      const overwriteDialog = await screen.findByRole("alertdialog", {
        name: "Replace existing files?",
      });
      expect(within(overwriteDialog).getByText(/move only new files/i)).toBeInTheDocument();

      await user.click(within(overwriteDialog).getByRole("button", { name: "Replace existing" }));

      await waitFor(() => {
        expect(transferSelectedMediaMock).toHaveBeenCalledWith(
          "move",
          VACATION_PATH,
          [SUNSET_PATH],
          true,
        );
      });
    });

    it("moves only the new files when existing ones are skipped", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({
        eligible: [],
        conflicts: ["sunset.png"],
        skipped: [],
      });
      transferSelectedMediaMock.mockResolvedValue({
        succeeded: [],
        skipped: [SUNSET_PATH],
        failed: [],
        transferred: [],
      });

      renderTransferDialog();

      await pickDestination(user, "Move");
      const overwriteDialog = await screen.findByRole("alertdialog", {
        name: "Replace existing files?",
      });
      await user.click(within(overwriteDialog).getByRole("button", { name: "Skip existing" }));

      await waitFor(() => {
        expect(transferSelectedMediaMock).toHaveBeenCalledWith(
          "move",
          VACATION_PATH,
          [SUNSET_PATH],
          false,
        );
      });
    });

    it("reports a file the backend could not move", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({
        eligible: ["sunset.png"],
        conflicts: [],
        skipped: [],
      });
      transferSelectedMediaMock.mockResolvedValue({
        succeeded: [],
        skipped: [],
        failed: [{ path: SUNSET_PATH, error: "sunset.png is used by another process" }],
        transferred: [],
      });

      const { onMoved } = renderTransferDialog();

      await pickDestination(user, "Move");

      expect(
        await screen.findByText("Could not move sunset.png: sunset.png is used by another process"),
      ).toBeInTheDocument();
      expect(onMoved).not.toHaveBeenCalled();
    });

    it("warns when the destination accepts nothing", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({ eligible: [], conflicts: [], skipped: [] });

      renderTransferDialog();

      await pickDestination(user, "Copy");

      expect(
        await screen.findByText("sunset.png cannot be copied to that folder."),
      ).toBeInTheDocument();
      expect(transferSelectedMediaMock).not.toHaveBeenCalled();
    });

    it("does not navigate with arrow keys while the destination picker is open", async () => {
      const user = userEvent.setup();
      const onNext = vi.fn<() => void>();
      const onPrevious = vi.fn<() => void>();

      renderWithProviders(
        <GalleryItemDialog
          items={[
            makeItem("sunset.png"),
            makeItem("beach.jpg", { path: `${HOME_PATH}\\beach.jpg` }),
          ]}
          index={0}
          currentFolder={HOME_PATH}
          onClose={vi.fn<() => void>()}
          onPrevious={onPrevious}
          onNext={onNext}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
          onMoved={vi.fn<(paths: string[]) => void | Promise<void>>()}
          onCopied={vi.fn<() => void | Promise<void>>()}
        />,
      );

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      await user.click(
        within(dialog).getByRole("button", { name: "Move sunset.png to another folder" }),
      );
      await screen.findByRole("dialog", { name: "Move to folder" });

      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowLeft}");

      expect(onNext).not.toHaveBeenCalled();
      expect(onPrevious).not.toHaveBeenCalled();
    });

    it("locks the header and refuses to close while a transfer is in flight", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({
        eligible: ["sunset.png"],
        conflicts: [],
        skipped: [],
      });

      let releaseTransfer: (() => void) | undefined;
      transferSelectedMediaMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseTransfer = () =>
              resolve({ succeeded: [SUNSET_PATH], skipped: [], failed: [], transferred: [] });
          }),
      );

      const { onClose, onMoved } = renderTransferDialog();

      await pickDestination(user, "Move");

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      const moveButton = within(dialog).getByRole("button", {
        name: "Move sunset.png to another folder",
      });

      await waitFor(() => expect(moveButton).toHaveAttribute("aria-busy", "true"));
      expect(moveButton).toBeDisabled();
      expect(
        within(dialog).getByRole("button", { name: "Copy sunset.png to another folder" }),
      ).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Delete sunset.png" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();

      // The panel must stay put: the grid is about to mutate under it.
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();

      releaseTransfer?.();
      await waitFor(() => expect(onMoved).toHaveBeenCalledWith([SUNSET_PATH]));
    });

    it("hides move and copy without a current folder", async () => {
      renderWithProviders(
        <GalleryItemDialog
          items={[makeItem("sunset.png")]}
          index={0}
          onClose={vi.fn<() => void>()}
          onPrevious={vi.fn<() => void>()}
          onNext={vi.fn<() => void>()}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
          onMoved={vi.fn<(paths: string[]) => void | Promise<void>>()}
          onCopied={vi.fn<() => void | Promise<void>>()}
        />,
      );

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      expect(
        within(dialog).queryByRole("button", { name: "Move sunset.png to another folder" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "Copy sunset.png to another folder" }),
      ).not.toBeInTheDocument();
    });
  });
});
