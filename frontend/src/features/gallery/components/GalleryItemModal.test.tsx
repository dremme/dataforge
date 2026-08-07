import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
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

// jsdom has neither a video decoder nor a 2D canvas context, which is exactly why
// these two live in their own module: the flow around them stays testable.
vi.mock("@/features/gallery/lib/videoFrameEncode", () => ({
  seekVideoTo: vi.fn(),
  encodeVideoFrame: vi.fn(),
}));

vi.mock("@/features/folder/api/files", () => ({
  importFiles: vi.fn(),
  previewFileImport: vi.fn(),
}));

const deleteMediaMock = vi.mocked(mediaApi.deleteMedia);
const previewMediaTransferMock = vi.mocked(mediaApi.previewMediaTransfer);
const transferSelectedMediaMock = vi.mocked(mediaApi.transferSelectedMedia);

describe("GalleryItemModal", () => {
  beforeEach(() => {
    installMockBackend();
    deleteMediaMock.mockClear();
    previewMediaTransferMock.mockReset();
    transferSelectedMediaMock.mockReset();
  });

  it("leaves frame timing out of the meta strip", async () => {
    renderWithProviders(
      <GalleryItemModal
        items={[makeItem("clip.mp4", { media_type: "video" })]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
    expect(within(dialog).queryByText("fps")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Frames")).not.toBeInTheDocument();
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
      folderByPath: {
        [HOME_PATH]: {
          ...homeFolder,
          items: [...homeFolder.items, jsonItem],
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

    // The caption is fetched, so the second item needs its text in the folder fixture too.
    installMockBackend({
      folderByPath: {
        [HOME_PATH]: {
          ...homeFolder,
          items: homeFolder.items.map((entry) =>
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
});
