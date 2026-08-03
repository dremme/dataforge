import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, VACATION_PATH, homeBrowse } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { GalleryItem } from "@/shared/types";
import { formatModifiedAt } from "@/shared/lib/format";
import * as useCopyFeedbackModule from "@/shared/hooks/useCopyFeedback";
import * as mediaApi from "@/features/gallery/api/media";
import { GalleryItemModal } from "./GalleryItemModal";

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
    deleteMedia: vi.fn(actual.deleteMedia),
    previewMediaTransfer: vi.fn(),
    transferSelectedMedia: vi.fn(),
  };
});

const deleteMediaMock = vi.mocked(mediaApi.deleteMedia);
const previewMediaTransferMock = vi.mocked(mediaApi.previewMediaTransfer);
const transferSelectedMediaMock = vi.mocked(mediaApi.transferSelectedMedia);

function makeItem(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `${HOME_PATH}\\${name}`,
    description: "Golden hour over the lake",
    has_description: true,
    has_caption_file: true,
    issue_fixes: [],
    has_issue_file: false,
    caption_status: "text",
    caption_file_type: "txt",
    media_type: "image",
    modified_at: "2026-03-15T14:30:00.000Z",
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

describe("GalleryItemModal", () => {
  beforeEach(() => {
    installMockBackend();
    deleteMediaMock.mockClear();
    previewMediaTransferMock.mockReset();
    transferSelectedMediaMock.mockReset();
  });

  it("shows the modified date in the media meta section", async () => {
    renderWithProviders(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const modifiedLabel = formatModifiedAt("2026-03-15T14:30:00.000Z");
    expect(modifiedLabel).not.toBeNull();
    expect(within(dialog).getByText("Modified")).toBeInTheDocument();
    expect(within(dialog).getByText(modifiedLabel!)).toBeInTheDocument();
  });

  it("copies the caption without re-fetch loops", async () => {
    const user = userEvent.setup();
    const onCaptionSaved = vi.fn();
    const copyText = vi.fn().mockResolvedValue(true);

    vi.spyOn(useCopyFeedbackModule, "useCopyFeedback").mockReturnValue({
      copyState: "idle",
      copyLabel: "Copy",
      copyText,
    });

    renderWithProviders(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });

    await waitFor(() => {
      expect(onCaptionSaved).toHaveBeenCalledTimes(1);
    });

    const copyButton = within(dialog).getByRole("button", { name: "Copy" });
    expect(copyButton).not.toBeDisabled();

    await user.click(copyButton);

    expect(copyText).toHaveBeenCalledWith("Golden hour over the lake");
    expect(onCaptionSaved).toHaveBeenCalledTimes(1);
  });

  it("reflects background caption updates while the modal stays open", async () => {
    const onCaptionSaved = vi.fn();
    const initialItem = makeItem("sunset.png");
    const updatedItem = {
      ...initialItem,
      description: "Updated by a background folder refresh",
    };

    const { rerender } = renderWithProviders(
      <GalleryItemModal
        items={[initialItem]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const caption = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });

    await waitFor(() => {
      expect(caption).toHaveValue("Golden hour over the lake");
    });

    rerender(
      <GalleryItemModal
        items={[updatedItem]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    await waitFor(() => {
      expect(caption).toHaveValue("Updated by a background folder refresh");
    });
  });

  it("opens the editor for .json captions", async () => {
    const user = userEvent.setup();
    const jsonItem = makeItem("scene.png", {
      description: "JSON scene caption",
      caption_file_type: "json",
    });
    const jsonContent = JSON.stringify(
      {
        description: "JSON scene caption",
      },
      null,
      2,
    );

    installMockBackend({
      browseByPath: {
        [HOME_PATH]: {
          ...homeBrowse,
          items: [...homeBrowse.items, jsonItem],
        },
      },
    });

    renderWithProviders(
      <GalleryItemModal
        items={[jsonItem]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing scene.png" });

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Edit JSON caption" })).not.toBeDisabled();
    });

    await user.click(within(dialog).getByRole("button", { name: "Edit JSON caption" }));

    const jsonEditor = await screen.findByRole("dialog", {
      name: "Edit JSON caption for scene.png",
    });
    const jsonInput = within(jsonEditor).getByRole("textbox", {
      name: "JSON caption for scene.png",
    });

    expect(jsonInput).toHaveValue(jsonContent);
  });

  it("deletes the file after confirmation", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const items = [
      makeItem("sunset.png"),
      makeItem("beach.jpg", { name: "beach.jpg", path: `${HOME_PATH}\\beach.jpg` }),
    ];

    renderWithProviders(
      <GalleryItemModal
        items={items}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sunset.png" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith(`${HOME_PATH}\\sunset.png`);
    });
  });

  it("notifies when the file cannot be deleted", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    deleteMediaMock.mockRejectedValueOnce(new Error("Permission denied"));

    renderWithProviders(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sunset.png" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Could not delete sunset.png: Permission denied"),
    ).toBeInTheDocument();
  });

  it("opens images in the image preview", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Open in image preview" }));

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "Open in image preview" }),
      ).not.toBeDisabled();
    });
  });

  it("does not offer image preview for videos", async () => {
    renderWithProviders(
      <GalleryItemModal
        items={[
          makeItem("clip.mp4", {
            media_type: "video",
            caption_file_type: null,
          }),
        ]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
    expect(
      within(dialog).queryByRole("button", { name: "Open in image preview" }),
    ).not.toBeInTheDocument();
  });

  it("navigates within the filtered item list only", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const items = [
      makeItem("sunset.png"),
      makeItem("beach.jpg", {
        description: null,
        has_description: false,
        has_caption_file: false,
        caption_status: "none",
        caption_file_type: null,
      }),
    ];

    renderWithProviders(
      <GalleryItemModal
        items={items}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={onNext}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(within(dialog).getByText("1 / 2")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Next item" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("does not navigate with arrow keys while a child overlay is open", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const items = [
      makeItem("sunset.png"),
      makeItem("beach.jpg", { name: "beach.jpg", path: `${HOME_PATH}\\beach.jpg` }),
    ];

    renderWithProviders(
      <GalleryItemModal
        items={items}
        index={0}
        onClose={vi.fn()}
        onPrevious={onPrevious}
        onNext={onNext}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sunset.png" }));
    await screen.findByRole("alertdialog", { name: "Delete file?" });

    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowLeft}");

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("drops a caption selection when moving to another item", async () => {
    const items = [makeItem("sunset.png"), makeItem("beach.jpg", { description: "A quiet shore" })];

    // The caption is fetched, so the second item needs its text in the browse fixture too.
    installMockBackend({
      browseByPath: {
        [HOME_PATH]: {
          ...homeBrowse,
          items: homeBrowse.items.map((entry) =>
            entry.name === "beach.jpg"
              ? {
                  ...entry,
                  description: "A quiet shore",
                  has_description: true,
                  has_caption_file: true,
                  caption_status: "text",
                  caption_file_type: "txt",
                }
              : entry,
          ),
        },
      },
    });

    const { rerender } = renderWithProviders(
      <GalleryItemModal
        items={items}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const caption = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });
    await waitFor(() => expect(caption).toHaveValue("Golden hour over the lake"));

    rerender(
      <GalleryItemModal
        items={items}
        index={1}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const nextCaption = await screen.findByRole("textbox", { name: "Caption for beach.jpg" });
    await waitFor(() => expect(nextCaption).toHaveValue("A quiet shore"));

    // A reused editor carries the old item's selection into the new caption.
    expect(nextCaption).not.toBe(caption);
  });

  describe("move and copy", () => {
    const SUNSET_PATH = `${HOME_PATH}\\sunset.png`;

    type TransferModalHandlers = {
      onClose: ReturnType<typeof vi.fn>;
      onMoved: ReturnType<typeof vi.fn>;
      onCopied: ReturnType<typeof vi.fn>;
    };

    function renderTransferModal(overrides: Partial<TransferModalHandlers> = {}) {
      const handlers: TransferModalHandlers = {
        onClose: vi.fn(),
        onMoved: vi.fn(),
        onCopied: vi.fn(),
        ...overrides,
      };

      renderWithProviders(
        <GalleryItemModal
          items={[makeItem("sunset.png")]}
          index={0}
          currentFolder={HOME_PATH}
          onClose={handlers.onClose}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onCaptionSaved={vi.fn()}
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
      });

      const { onMoved, onCopied } = renderTransferModal();

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
      });

      const { onMoved, onCopied } = renderTransferModal();

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
      renderTransferModal();

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
      });

      renderTransferModal();

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
      });

      const { onMoved } = renderTransferModal();

      await pickDestination(user, "Move");

      expect(
        await screen.findByText("Could not move sunset.png: sunset.png is used by another process"),
      ).toBeInTheDocument();
      expect(onMoved).not.toHaveBeenCalled();
    });

    it("warns when the destination accepts nothing", async () => {
      const user = userEvent.setup();
      previewMediaTransferMock.mockResolvedValue({ eligible: [], conflicts: [], skipped: [] });

      renderTransferModal();

      await pickDestination(user, "Copy");

      expect(
        await screen.findByText("sunset.png cannot be copied to that folder."),
      ).toBeInTheDocument();
      expect(transferSelectedMediaMock).not.toHaveBeenCalled();
    });

    it("does not navigate with arrow keys while the destination picker is open", async () => {
      const user = userEvent.setup();
      const onNext = vi.fn();
      const onPrevious = vi.fn();

      renderWithProviders(
        <GalleryItemModal
          items={[
            makeItem("sunset.png"),
            makeItem("beach.jpg", { path: `${HOME_PATH}\\beach.jpg` }),
          ]}
          index={0}
          currentFolder={HOME_PATH}
          onClose={vi.fn()}
          onPrevious={onPrevious}
          onNext={onNext}
          onCaptionSaved={vi.fn()}
          onMoved={vi.fn()}
          onCopied={vi.fn()}
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
            releaseTransfer = () => resolve({ succeeded: [SUNSET_PATH], skipped: [], failed: [] });
          }),
      );

      const { onClose, onMoved } = renderTransferModal();

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
        <GalleryItemModal
          items={[makeItem("sunset.png")]}
          index={0}
          onClose={vi.fn()}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onCaptionSaved={vi.fn()}
          onMoved={vi.fn()}
          onCopied={vi.fn()}
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
