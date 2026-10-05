import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { formatModifiedAt } from "@/shared/lib/format";
import * as useCopyFeedbackModule from "@/shared/hooks/useCopyFeedback";
import * as captionsApi from "@/features/gallery/api/captions";
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

  it("opens the workflow prompts from the ComfyUI badge", async () => {
    const user = userEvent.setup();
    vi.spyOn(captionsApi, "fetchComfyWorkflow").mockResolvedValue({ has_workflow: true });
    vi.spyOn(captionsApi, "fetchComfyWorkflowPrompts").mockResolvedValue({
      has_workflow: true,
      matched_node_id: "7",
      orphan_prompts: [],
      has_editor_workflow: false,
      matched_by_size: false,
      branches: [
        {
          node_id: "7",
          class_type: "SaveImage",
          label: "Text to Image",
          filename_prefix: "sunset",
          is_preview: false,
          matches_filename: true,
          prompts: [
            {
              role: "positive",
              text: "a mountain lake at sunrise",
              node_id: "3",
              node_title: "Positive Prompt",
              input_name: "positive",
            },
          ],
          parameters: [],
          loras: [],
        },
      ],
    });

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

    await user.click(await screen.findByRole("button", { name: /ComfyUI/ }));

    const prompts = await screen.findByRole("dialog", { name: "ComfyUI workflow" });
    expect(within(prompts).getByText("a mountain lake at sunrise")).toBeInTheDocument();
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

  it("shows the aspect ratio next to the dimensions", async () => {
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
    const meta = within(dialog).getByLabelText("Media details");

    expect(within(meta).getByText("Aspect ratio")).toBeInTheDocument();
    expect(within(meta).getByText("16:9")).toBeInTheDocument();
  });

  it("reports the caption in estimated tokens beside the caption label", async () => {
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
    const meta = within(dialog).getByLabelText("Media details");
    const heading = within(dialog).getByText("Caption").parentElement!;

    expect(within(heading).getByText("~7 tokens")).toBeInTheDocument();
    expect(meta).not.toHaveTextContent("tokens");
    expect(dialog).not.toHaveTextContent("Characters");

    const captionInput = await screen.findByLabelText("Caption for sunset.png");
    await user.clear(captionInput);
    await user.type(captionInput, "Short");

    await waitFor(() => {
      expect(within(heading).getByText("~2 tokens")).toBeInTheDocument();
    });
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

  it("does not offer a JSON caption editor", async () => {
    const item = makeItem("scene.png", {
      description: "Scene caption",
    });

    renderWithProviders(
      <GalleryItemModal
        items={[item]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing scene.png" });
    expect(within(dialog).queryByRole("button", { name: /json caption/i })).not.toBeInTheDocument();
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

  describe("keyboard", () => {
    const twoItems = () => [
      makeItem("sunset.png"),
      makeItem("beach.jpg", { name: "beach.jpg", path: `${HOME_PATH}\\beach.jpg` }),
    ];

    function renderKeyboardModal(overrides: Record<string, unknown> = {}) {
      const props = {
        items: twoItems(),
        index: 0,
        onClose: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onGoTo: vi.fn(),
        onCaptionSaved: vi.fn(),
        onDeleted: vi.fn(),
        ...overrides,
      };
      renderWithProviders(<GalleryItemModal {...props} />);
      return props;
    }

    it("pages with the arrow keys", async () => {
      const user = userEvent.setup();
      const props = renderKeyboardModal();
      await screen.findByRole("dialog", { name: "Viewing sunset.png" });

      await user.keyboard("{ArrowRight}{ArrowLeft}");

      expect(props.onNext).toHaveBeenCalledTimes(1);
      expect(props.onPrevious).toHaveBeenCalledTimes(1);
    });

    it("leaves a modified arrow to the browser", async () => {
      const user = userEvent.setup();
      const props = renderKeyboardModal();
      await screen.findByRole("dialog", { name: "Viewing sunset.png" });

      await user.keyboard("{Alt>}{ArrowLeft}{/Alt}{Control>}{ArrowRight}{/Control}");

      expect(props.onPrevious).not.toHaveBeenCalled();
      expect(props.onNext).not.toHaveBeenCalled();
    });

    it("does not page on a key a control inside already handled", async () => {
      const props = renderKeyboardModal();
      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });

      // A focused mask surface nudges on the arrows and removes on Delete this way.
      for (const key of ["ArrowRight", "Delete"]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        event.preventDefault();
        dialog.dispatchEvent(event);
      }

      expect(props.onNext).not.toHaveBeenCalled();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("jumps to the first and last item with Home and End", async () => {
      const user = userEvent.setup();
      const props = renderKeyboardModal({ index: 1 });
      await screen.findByRole("dialog", { name: "Viewing beach.jpg" });

      await user.keyboard("{Home}");
      expect(props.onGoTo).toHaveBeenLastCalledWith(0);

      await user.keyboard("{End}");
      expect(props.onGoTo).toHaveBeenLastCalledWith(1);
    });

    it("saves the caption and moves on with Ctrl+Enter from the editor", async () => {
      const user = userEvent.setup();
      const saveCaption = vi.spyOn(captionsApi, "saveCaption");
      const props = renderKeyboardModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      const caption = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });
      await waitFor(() => expect(caption).toHaveValue("Golden hour over the lake"));
      await user.click(caption);
      await user.keyboard(" at dusk");
      await user.keyboard("{Control>}{Enter}{/Control}");

      expect(saveCaption).toHaveBeenCalledWith(
        `${HOME_PATH}\\sunset.png`,
        "Golden hour over the lake at dusk",
      );
      expect(props.onNext).toHaveBeenCalledTimes(1);
    });

    it("moves on with Ctrl+Enter that the caption editor has already claimed", async () => {
      const props = renderKeyboardModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      const caption = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });
      // The real editor prevents the default so CodeMirror inserts no blank line.
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      caption.dispatchEvent(event);

      expect(props.onNext).toHaveBeenCalledTimes(1);
    });

    it("asks before deleting on the Delete key", async () => {
      const user = userEvent.setup();
      renderKeyboardModal();
      await screen.findByRole("dialog", { name: "Viewing sunset.png" });

      await user.keyboard("{Delete}");

      expect(await screen.findByRole("alertdialog", { name: "Delete file?" })).toBeInTheDocument();
      expect(deleteMediaMock).not.toHaveBeenCalled();
    });

    it("leaves Delete and Backspace to the caption editor", async () => {
      const user = userEvent.setup();
      renderKeyboardModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      await user.click(within(dialog).getByRole("textbox", { name: "Caption for sunset.png" }));
      await user.keyboard("{Backspace}{Delete}");

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
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

  it("reports an autosave failure and resends the caption on retry", async () => {
    const user = userEvent.setup();
    const saveCaption = vi
      .spyOn(captionsApi, "saveCaption")
      .mockRejectedValueOnce(new Error("Disk is full"));

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
    await user.click(within(dialog).getByRole("textbox", { name: "Caption for sunset.png" }));
    await user.keyboard(" at dusk");

    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent("Disk is full"),
    );

    saveCaption.mockResolvedValue({
      description: "Golden hour over the lake at dusk",
      has_description: true,
      has_caption_file: true,
      caption_status: "text",
      caption_file: `${HOME_PATH}\\sunset.txt`,
      issue_fixes: [],
      rule_findings: [],
      has_issue_file: false,
    });

    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("Saved"));
    expect(saveCaption).toHaveBeenCalledTimes(2);
  });

  it("reverts the caption to the text the file was opened with", async () => {
    const user = userEvent.setup();
    const saveCaption = vi.spyOn(captionsApi, "saveCaption");

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
    const revert = within(dialog).getByRole("button", {
      name: "Revert caption changes for sunset.png",
    });
    expect(revert).toBeDisabled();

    const editor = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });
    await user.click(editor);
    await user.keyboard(" at dusk");

    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("Saved"));
    expect(revert).toBeEnabled();

    await user.click(revert);

    await waitFor(() =>
      expect(saveCaption).toHaveBeenLastCalledWith(
        `${HOME_PATH}\\sunset.png`,
        "Golden hour over the lake",
      ),
    );
    expect(editor).toHaveValue("Golden hour over the lake");
    await waitFor(() => expect(revert).toBeDisabled());
  });

  it("offers no backup restore when the folder has no caption backup", async () => {
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
    expect(
      within(dialog).queryByRole("button", { name: /Restore the backed up caption/ }),
    ).not.toBeInTheDocument();
  });

  it("restores this file's backed up caption", async () => {
    const user = userEvent.setup();
    installMockBackend({
      captionBackups: { [`${HOME_PATH}\\sunset.png`]: "The caption as it was backed up" },
    });
    const saveCaption = vi.spyOn(captionsApi, "saveCaption");

    renderWithProviders(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        hasCaptionBackup
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const restore = await within(dialog).findByRole("button", {
      name: "Restore the backed up caption for sunset.png",
    });

    await user.click(restore);

    await waitFor(() =>
      expect(saveCaption).toHaveBeenLastCalledWith(
        `${HOME_PATH}\\sunset.png`,
        "The caption as it was backed up",
      ),
    );
  });
});
