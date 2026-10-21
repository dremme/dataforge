import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemDialog";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { formatModifiedAt } from "@/shared/lib/format";
import * as useCopyFeedbackModule from "@/shared/hooks/useCopyFeedback";
import * as captionsApi from "@/features/gallery/api/captions";
import * as mediaApi from "@/features/gallery/api/media";
import { VideoEditorContext } from "@/features/videoEditor/context/VideoEditorContext";
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

  it("leaves frame timing out of the meta strip", async () => {
    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("clip.mp4", { media_type: "video" })]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
    expect(within(dialog).queryByText("fps")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Frames")).not.toBeInTheDocument();
  });

  it("lists every tag with its confidence, and says why a file has none", async () => {
    const props = {
      index: 0,
      onClose: vi.fn<() => void>(),
      onPrevious: vi.fn<() => void>(),
      onNext: vi.fn<() => void>(),
      onCaptionSaved: vi.fn<(path: string, update: CaptionSaveResponse) => void>(),
    };
    const tagged = makeItem("photo.png", {
      tags: [
        { label: "dog", confidence: 0.874 },
        { label: "beach", confidence: 0.31 },
      ],
    });
    const { rerender } = renderWithProviders(<GalleryItemDialog items={[tagged]} {...props} />);

    const tags = await screen.findByRole("group", { name: "Tags" });
    expect(
      within(tags)
        .getAllByRole("listitem")
        .map((tag) => tag.textContent),
    ).toEqual(["dog87%", "beach31%"]);

    rerender(<GalleryItemDialog items={[makeItem("plain.png")]} {...props} />);
    expect(await screen.findByRole("group", { name: "Tags" })).toHaveTextContent(
      "None. Only favorite folders are tagged.",
    );
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
          stages: [],
          map: [],
        },
      ],
    });

    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /ComfyUI/ }));

    const prompts = await screen.findByRole("dialog", { name: "ComfyUI workflow" });
    expect(within(prompts).getByText("a mountain lake at sunrise")).toBeInTheDocument();

    // The footer button; the header has its own Close.
    await user.click(within(prompts).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("dialog", { name: "ComfyUI workflow" })).not.toBeInTheDocument();
  });

  it("shows the modified date in the media meta section", async () => {
    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const modifiedLabel = formatModifiedAt("2026-03-15T14:30:00.000Z");
    expect(modifiedLabel).not.toBeNull();
    expect(within(dialog).getByText("Modified")).toBeInTheDocument();
    expect(within(dialog).getByText(modifiedLabel!)).toBeInTheDocument();
  });

  it("shows the file size in the media meta section", async () => {
    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png", { size: 2.5 * 1024 * 1024 })]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const meta = within(dialog).getByLabelText("Media details");

    expect(within(meta).getByText("File size")).toBeInTheDocument();
    expect(within(meta).getByText("2.5 MB")).toBeInTheDocument();
  });

  it("shows the aspect ratio next to the dimensions", async () => {
    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
    const copyText = vi
      .fn<(text: string | Promise<string>) => Promise<boolean>>()
      .mockResolvedValue(true);

    vi.spyOn(useCopyFeedbackModule, "useCopyFeedback").mockReturnValue({
      copyState: "idle",
      copyLabel: "Copy",
      copyText,
    });

    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
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

  it("reflects background caption updates while the dialog stays open", async () => {
    const onCaptionSaved = vi.fn<(path: string, update: CaptionSaveResponse) => void>();
    const initialItem = makeItem("sunset.png");
    const updatedItem = {
      ...initialItem,
      description: "Updated by a background folder refresh",
    };

    const { rerender } = renderWithProviders(
      <GalleryItemDialog
        items={[initialItem]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const caption = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });

    await waitFor(() => {
      expect(caption).toHaveValue("Golden hour over the lake");
    });

    rerender(
      <GalleryItemDialog
        items={[updatedItem]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
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
      <GalleryItemDialog
        items={[item]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing scene.png" });
    expect(within(dialog).queryByRole("button", { name: /json caption/i })).not.toBeInTheDocument();
  });

  it("deletes the file after confirmation", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn<(path: string) => void>();
    const items = [
      makeItem("sunset.png"),
      makeItem("beach.jpg", { name: "beach.jpg", path: `${HOME_PATH}\\beach.jpg` }),
    ];

    renderWithProviders(
      <GalleryItemDialog
        items={items}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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
    const onDeleted = vi.fn<(path: string) => void>();
    deleteMediaMock.mockRejectedValueOnce(new Error("Permission denied"));

    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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
      <GalleryItemDialog
        items={[
          makeItem("clip.mp4", {
            media_type: "video",
          }),
        ]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
    expect(
      within(dialog).queryByRole("button", { name: "Open in image preview" }),
    ).not.toBeInTheDocument();
  });

  it("plays audio in a player, with no image tools", async () => {
    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("voice.wav", { media_type: "audio", width: null, height: null })]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
        currentFolder={HOME_PATH}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing voice.wav" });
    const audio = dialog.querySelector("audio")!;
    expect(audio.getAttribute("src")).toContain("/api/media?");
    expect(audio).toHaveAttribute("controls");
    // Paging through clips must not start sound on its own.
    expect(audio).not.toHaveAttribute("autoplay");
    expect(dialog.querySelector(".gallery-item-dialog__waveform")).not.toBeNull();
    expect(dialog.querySelector(".gallery-item-dialog__img")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Open in image preview" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Save a frame/ })).not.toBeInTheDocument();
    // Its own editor instead: sound tools, not the image or video ones.
    expect(within(dialog).getByRole("button", { name: "Edit voice.wav" })).toBeInTheDocument();
  });

  it("navigates within the filtered item list only", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn<() => void>();
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
      <GalleryItemDialog
        items={items}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={onNext}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(within(dialog).getByText("1 / 2")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Next item" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("steps back with Previous item", async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn<() => void>();

    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png"), makeItem("beach.jpg")]}
        index={1}
        onClose={vi.fn<() => void>()}
        onPrevious={onPrevious}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Previous item" }));
    expect(onPrevious).toHaveBeenCalledOnce();
  });

  describe("docked beside the gallery", () => {
    function renderDocked(onNext = vi.fn<() => void>()) {
      renderWithProviders(
        <GalleryItemDialog
          items={[makeItem("sunset.png"), makeItem("beach.jpg")]}
          index={0}
          onClose={vi.fn<() => void>()}
          onPrevious={vi.fn<() => void>()}
          onNext={onNext}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
          focusView={false}
          onFocusViewChange={vi.fn<(focus: boolean) => void>()}
        />,
      );
      return onNext;
    }

    it("steps forward from the header", async () => {
      const user = userEvent.setup();
      const onNext = renderDocked();

      await user.click(await screen.findByRole("button", { name: "Next item" }));
      expect(onNext).toHaveBeenCalledOnce();
    });

    it("resizes the inspector by dragging its edge", async () => {
      renderDocked();
      const edge = await screen.findByRole("separator", { name: "Caption inspector width" });
      // Gives the dialog a right edge at 1200px, so a pointer at 800px means a 400px inspector.
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 1200, 800),
      );
      // jsdom has no pointer capture; the handlers only need it to be reported.
      edge.setPointerCapture = vi.fn<(pointerId: number) => void>();
      edge.hasPointerCapture = () => true;
      edge.releasePointerCapture = vi.fn<(pointerId: number) => void>();

      fireEvent.pointerDown(edge, { pointerId: 1 });
      fireEvent.pointerMove(edge, { pointerId: 1, clientX: 800 });
      fireEvent.pointerUp(edge, { pointerId: 1 });

      expect(edge.setPointerCapture).toHaveBeenCalledWith(1);
      expect(edge).toHaveAttribute("aria-valuenow", "400");
    });
  });

  it("does not navigate with arrow keys while a child overlay is open", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn<() => void>();
    const onPrevious = vi.fn<() => void>();
    const items = [
      makeItem("sunset.png"),
      makeItem("beach.jpg", { name: "beach.jpg", path: `${HOME_PATH}\\beach.jpg` }),
    ];

    renderWithProviders(
      <GalleryItemDialog
        items={items}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={onPrevious}
        onNext={onNext}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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

    function renderKeyboardDialog(overrides: Record<string, unknown> = {}) {
      const props = {
        items: twoItems(),
        index: 0,
        onClose: vi.fn<() => void>(),
        onPrevious: vi.fn<() => void>(),
        onNext: vi.fn<() => void>(),
        onGoTo: vi.fn<(index: number) => void>(),
        onCaptionSaved: vi.fn<(path: string, update: CaptionSaveResponse) => void>(),
        onDeleted: vi.fn<(path: string) => void>(),
        ...overrides,
      };
      const { rerender } = renderWithProviders(<GalleryItemDialog {...props} />);
      return {
        ...props,
        showIndex: (index: number) => rerender(<GalleryItemDialog {...props} index={index} />),
      };
    }

    describe("docked beside the gallery", () => {
      const docked = { focusView: false, onFocusViewChange: vi.fn<(focus: boolean) => void>() };

      function focusOutside(element: HTMLElement) {
        document.body.append(element);
        element.focus();
        return () => element.remove();
      }

      it("closes on Escape while focus is still on the card that opened it", async () => {
        const user = userEvent.setup();
        const cleanup = focusOutside(document.createElement("button"));
        const props = renderKeyboardDialog(docked);
        await screen.findByRole("complementary", { name: "Viewing sunset.png" });

        await user.keyboard("{Escape}");

        await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
        cleanup();
      });

      it("leaves Escape to a text field outside the panel", async () => {
        const user = userEvent.setup();
        const cleanup = focusOutside(document.createElement("input"));
        const props = renderKeyboardDialog(docked);
        await screen.findByRole("complementary", { name: "Viewing sunset.png" });

        await user.keyboard("{Escape}");

        expect(props.onClose).not.toHaveBeenCalled();
        cleanup();
      });
    });

    it("pages with the arrow keys", async () => {
      const user = userEvent.setup();
      const props = renderKeyboardDialog();
      await screen.findByRole("dialog", { name: "Viewing sunset.png" });

      await user.keyboard("{ArrowRight}{ArrowLeft}");

      expect(props.onNext).toHaveBeenCalledTimes(1);
      expect(props.onPrevious).toHaveBeenCalledTimes(1);
    });

    it("leaves a modified arrow to the browser", async () => {
      const user = userEvent.setup();
      const props = renderKeyboardDialog();
      await screen.findByRole("dialog", { name: "Viewing sunset.png" });

      await user.keyboard("{Alt>}{ArrowLeft}{/Alt}{Control>}{ArrowRight}{/Control}");

      expect(props.onPrevious).not.toHaveBeenCalled();
      expect(props.onNext).not.toHaveBeenCalled();
    });

    it("does not page on a key a control inside already handled", async () => {
      const props = renderKeyboardDialog();
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
      const props = renderKeyboardDialog({ index: 1 });
      await screen.findByRole("dialog", { name: "Viewing beach.jpg" });

      await user.keyboard("{Home}");
      expect(props.onGoTo).toHaveBeenLastCalledWith(0);
      props.showIndex(0);

      await user.keyboard("{End}");
      expect(props.onGoTo).toHaveBeenLastCalledWith(1);
    });

    it("saves the caption and moves on with Ctrl+Enter from the editor", async () => {
      const user = userEvent.setup();
      const saveCaption = vi.spyOn(captionsApi, "saveCaption");
      const props = renderKeyboardDialog();

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
      const props = renderKeyboardDialog();

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
      await waitFor(() => expect(props.onNext).toHaveBeenCalledTimes(1));
    });

    it("asks before deleting on the Delete key", async () => {
      const user = userEvent.setup();
      renderKeyboardDialog();
      await screen.findByRole("dialog", { name: "Viewing sunset.png" });

      await user.keyboard("{Delete}");

      expect(await screen.findByRole("alertdialog", { name: "Delete file?" })).toBeInTheDocument();
      expect(deleteMediaMock).not.toHaveBeenCalled();
    });

    it("leaves Delete and Backspace to the caption editor", async () => {
      const user = userEvent.setup();
      renderKeyboardDialog();

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
      <GalleryItemDialog
        items={items}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const caption = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });
    await waitFor(() => expect(caption).toHaveValue("Golden hour over the lake"));

    rerender(
      <GalleryItemDialog
        items={items}
        index={1}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
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

  it("offers no backup comparison when the folder has no caption backup", async () => {
    renderWithProviders(
      <GalleryItemDialog
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(
      within(dialog).queryByRole("button", { name: /Compare the caption/ }),
    ).not.toBeInTheDocument();
  });

  describe("caption backup", () => {
    const renderWithBackup = async (backup: string) => {
      installMockBackend({ captionBackups: { [`${HOME_PATH}\\sunset.png`]: backup } });
      const onClose = vi.fn<() => void>();
      renderWithProviders(
        <GalleryItemDialog
          items={[makeItem("sunset.png")]}
          index={0}
          hasCaptionBackup
          onClose={onClose}
          onPrevious={vi.fn<() => void>()}
          onNext={vi.fn<() => void>()}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
        />,
      );
      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      const compare = await within(dialog).findByRole("button", {
        name: "Compare the caption for sunset.png with its backup",
      });
      return { dialog, compare, onClose };
    };

    it("replaces the restore button with a comparison", async () => {
      const { dialog, compare } = await renderWithBackup("Golden hour over the calm lake");

      expect(compare).toHaveTextContent("Compare backup");
      expect(
        within(dialog).queryByRole("button", { name: /Restore the backed up caption/ }),
      ).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("region", { name: /compared with its backup/ })).toBeNull();
    });

    it("shows word by word what restoring the backup would change", async () => {
      const user = userEvent.setup();
      const { dialog, compare } = await renderWithBackup("Golden hour over the calm lake");

      await user.click(compare);

      expect(compare).toHaveAccessibleName("Back to editing the caption for sunset.png");
      expect(compare).toHaveTextContent("Back to editing");
      // Both act on the editor's text, which the comparison hides.
      expect(within(dialog).queryByRole("button", { name: /Revert caption changes/ })).toBeNull();
      expect(within(dialog).queryByRole("button", { name: /Copy/ })).toBeNull();
      const region = within(dialog).getByRole("region", {
        name: "Caption compared with its backup for sunset.png",
      });
      expect(region).toHaveTextContent("Golden hour over the calm lake");
      expect(region.querySelector("ins")?.textContent?.trim()).toBe("calm");
      expect(region.querySelector("del")).toBeNull();
    });

    it("says when the caption already matches the backup", async () => {
      const user = userEvent.setup();
      const { dialog, compare } = await renderWithBackup("Golden hour over the lake");

      await user.click(compare);

      expect(
        within(dialog).getByRole("region", { name: /compared with its backup/ }),
      ).toHaveTextContent("Matches the backup.");
      expect(
        within(dialog).getByRole("button", {
          name: "Restore the backed up caption for sunset.png",
        }),
      ).toBeDisabled();
    });

    it("restores the backup from the comparison and returns to the editor", async () => {
      const user = userEvent.setup();
      const saveCaption = vi.spyOn(captionsApi, "saveCaption");
      const { dialog, compare } = await renderWithBackup("The caption as it was backed up");

      await user.click(compare);
      await user.click(
        within(dialog).getByRole("button", {
          name: "Restore the backed up caption for sunset.png",
        }),
      );

      await waitFor(() =>
        expect(saveCaption).toHaveBeenLastCalledWith(
          `${HOME_PATH}\\sunset.png`,
          "The caption as it was backed up",
        ),
      );
      expect(compare).toHaveTextContent("Compare backup");
      expect(within(dialog).queryByRole("region", { name: /compared with its backup/ })).toBeNull();
      expect(
        within(dialog).getByRole("button", { name: "Revert caption changes for sunset.png" }),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("textbox", { name: "Caption for sunset.png" })).toHaveValue(
        "The caption as it was backed up",
      );
    });

    it("steps out of the comparison on Escape before it closes the docked inspector", async () => {
      const user = userEvent.setup();
      installMockBackend({ captionBackups: { [`${HOME_PATH}\\sunset.png`]: "A different one" } });
      const onClose = vi.fn<() => void>();
      renderWithProviders(
        <GalleryItemDialog
          items={[makeItem("sunset.png")]}
          index={0}
          hasCaptionBackup
          onClose={onClose}
          onPrevious={vi.fn<() => void>()}
          onNext={vi.fn<() => void>()}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
          focusView={false}
          onFocusViewChange={vi.fn<(focus: boolean) => void>()}
        />,
      );
      const inspector = await screen.findByRole("complementary", { name: "Viewing sunset.png" });

      await user.click(
        await within(inspector).findByRole("button", {
          name: "Compare the caption for sunset.png with its backup",
        }),
      );
      await user.keyboard("{Escape}");

      expect(
        within(inspector).queryByRole("region", { name: /compared with its backup/ }),
      ).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("steps out of the comparison on Escape before it closes the dialog", async () => {
      const user = userEvent.setup();
      const { dialog, compare, onClose } = await renderWithBackup("A different caption");

      await user.click(compare);
      await user.keyboard("{Escape}");

      expect(within(dialog).queryByRole("region", { name: /compared with its backup/ })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
  });
});

describe("GalleryItemDialog video editor action", () => {
  beforeEach(() => {
    installMockBackend();
  });

  function renderWithEditor(name: string, mediaType: "video" | "image") {
    const open = vi.fn<(videoPath: string) => void>();
    renderWithProviders(
      <VideoEditorContext
        value={{ open, openProject: vi.fn<(projectPath: string) => void>(), isOpen: false }}
      >
        <GalleryItemDialog
          items={[makeItem(name, { media_type: mediaType })]}
          index={0}
          onClose={vi.fn<() => void>()}
          onPrevious={vi.fn<() => void>()}
          onNext={vi.fn<() => void>()}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
        />
      </VideoEditorContext>,
    );
    return open;
  }

  it("opens a supported video in the editor", async () => {
    const user = userEvent.setup();
    const open = renderWithEditor("clip.mov", "video");

    await user.click(
      await screen.findByRole("button", { name: "Open clip.mov in the video editor" }),
    );

    await waitFor(() => expect(open).toHaveBeenCalledWith(makeItem("clip.mov").path));
  });

  it("offers nothing for formats the editor cannot play or for stills", async () => {
    renderWithEditor("clip.mkv", "video");
    await screen.findByRole("dialog", { name: "Viewing clip.mkv" });

    expect(screen.queryByRole("button", { name: /in the video editor/ })).not.toBeInTheDocument();
  });
});
