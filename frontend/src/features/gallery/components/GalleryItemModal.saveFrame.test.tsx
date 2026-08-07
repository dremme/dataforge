import { useState } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { stubVideoElement } from "@/test/videoElement";
import type { GalleryItem } from "@/shared/types";
import * as mediaApi from "@/features/gallery/api/media";
import { importFiles } from "@/features/folder/api/files";
import { encodeVideoFrame, seekVideoTo } from "@/features/gallery/lib/videoFrameEncode";
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

const seekVideoToMock = vi.mocked(seekVideoTo);
const encodeVideoFrameMock = vi.mocked(encodeVideoFrame);
const importFilesMock = vi.mocked(importFiles);

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

  describe("save frame", () => {
    const SAVED_FRAME_NAME = "clip_0004000.jpg";
    let restoreVideo: (() => void) | undefined;

    beforeEach(() => {
      restoreVideo = stubVideoElement({ duration: 12 });
      // The presented frame's time is what names the file, so 4 s means clip_0004000.jpg.
      seekVideoToMock.mockReset().mockResolvedValue(4);
      encodeVideoFrameMock
        .mockReset()
        .mockResolvedValue(new Blob(["frame"], { type: "image/jpeg" }));
      importFilesMock
        .mockReset()
        .mockResolvedValue({ copied: [SAVED_FRAME_NAME], skipped: [], rejected: [] });
    });

    afterEach(() => {
      // `vi.restoreAllMocks()` does not undo `defineProperty`, so this cannot be
      // left to the global teardown.
      restoreVideo?.();
      restoreVideo = undefined;
    });

    function videoItem(): GalleryItem {
      return makeItem("clip.mp4", { media_type: "video" });
    }

    function renderVideoModal(overrides: Partial<Parameters<typeof GalleryItemModal>[0]> = {}) {
      const props = {
        items: [videoItem()],
        index: 0,
        currentFolder: HOME_PATH,
        onClose: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onCaptionSaved: vi.fn(),
        onCopied: vi.fn(),
        ...overrides,
      };

      renderWithProviders(<GalleryItemModal {...props} />);
      return props;
    }

    async function openFrameMode(user: ReturnType<typeof userEvent.setup>) {
      const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      // Metadata never lands on its own in jsdom, so the slider stays disabled without this.
      fireEvent.loadedMetadata(dialog.querySelector("video")!);
      await user.click(within(dialog).getByRole("button", { name: "Save a frame from clip.mp4" }));
      return dialog;
    }

    it("is not offered for a still image", async () => {
      renderWithProviders(
        <GalleryItemModal
          items={[makeItem("sunset.png")]}
          index={0}
          currentFolder={HOME_PATH}
          onClose={vi.fn()}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onCaptionSaved={vi.fn()}
        />,
      );

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      expect(
        within(dialog).queryByRole("button", { name: /save a frame/i }),
      ).not.toBeInTheDocument();
    });

    it("stays hidden without a destination folder", async () => {
      renderVideoModal({ currentFolder: undefined });

      const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      expect(
        within(dialog).queryByRole("button", { name: /save a frame/i }),
      ).not.toBeInTheDocument();
    });

    it("reveals the capture bar and gives it back", async () => {
      const user = userEvent.setup();
      renderVideoModal();

      const dialog = await openFrameMode(user);
      expect(within(dialog).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();

      const toggle = within(dialog).getByRole("button", {
        name: "Exit frame capture for clip.mp4",
      });
      expect(toggle).toHaveAttribute("aria-pressed", "true");

      await user.click(toggle);
      expect(
        within(dialog).queryByRole("group", { name: "Frame capture" }),
      ).not.toBeInTheDocument();
    });

    it("writes the frame beside the video and refreshes the folder", async () => {
      const user = userEvent.setup();
      const { onCopied } = renderVideoModal();

      const dialog = await openFrameMode(user);
      await user.click(within(dialog).getByRole("button", { name: "Save frame" }));

      await waitFor(() => expect(importFilesMock).toHaveBeenCalledTimes(1));
      const [folder, files, overwrite] = importFilesMock.mock.calls[0];
      expect(folder).toBe(HOME_PATH);
      expect(files[0].name).toBe(SAVED_FRAME_NAME);
      expect(files[0].type).toBe("image/jpeg");
      expect(overwrite).toBe(true);

      expect(await screen.findByText(`Saved frame as ${SAVED_FRAME_NAME}.`)).toBeInTheDocument();
      await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    });

    it("reports an upload failure and leaves the folder alone", async () => {
      const user = userEvent.setup();
      importFilesMock.mockRejectedValueOnce(new Error("Permission denied"));
      const { onCopied } = renderVideoModal();

      const dialog = await openFrameMode(user);
      await user.click(within(dialog).getByRole("button", { name: "Save frame" }));

      expect(
        await screen.findByText(`Could not save ${SAVED_FRAME_NAME}: Permission denied`),
      ).toBeInTheDocument();
      expect(onCopied).not.toHaveBeenCalled();
    });

    it("reports a file the backend refused", async () => {
      const user = userEvent.setup();
      importFilesMock.mockResolvedValueOnce({
        copied: [],
        skipped: [],
        rejected: [SAVED_FRAME_NAME],
      });
      const { onCopied } = renderVideoModal();

      const dialog = await openFrameMode(user);
      await user.click(within(dialog).getByRole("button", { name: "Save frame" }));

      expect(
        await screen.findByText(
          `Could not save ${SAVED_FRAME_NAME}: the server rejected that file.`,
        ),
      ).toBeInTheDocument();
      expect(onCopied).not.toHaveBeenCalled();
    });

    it("surfaces a seek that never completes", async () => {
      const user = userEvent.setup();
      seekVideoToMock.mockRejectedValueOnce(new Error("The video did not seek in time."));
      renderVideoModal();

      const dialog = await openFrameMode(user);
      await user.click(within(dialog).getByRole("button", { name: "Save frame" }));

      // No frame was ever presented, so the name falls back to the requested time.
      expect(
        await screen.findByText("Could not save clip_0000000.jpg: The video did not seek in time."),
      ).toBeInTheDocument();
      expect(importFilesMock).not.toHaveBeenCalled();
    });

    it("navigates items with arrow keys while frame capture stays on", async () => {
      const user = userEvent.setup();
      const { onNext, onPrevious } = renderVideoModal();

      const dialog = await openFrameMode(user);

      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowLeft}");

      expect(onNext).toHaveBeenCalledTimes(1);
      expect(onPrevious).toHaveBeenCalledTimes(1);
      expect(within(dialog).getByRole("button", { name: "Next item" })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: "Previous item" })).toBeEnabled();
      expect(within(dialog).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();
    });

    it("keeps frame capture on when moving to another video", async () => {
      const user = userEvent.setup();
      const items = [
        makeItem("clip.mp4", { media_type: "video" }),
        makeItem("reel.mp4", { media_type: "video" }),
      ];

      function StickyFrameModal() {
        const [index, setIndex] = useState(0);
        return (
          <GalleryItemModal
            items={items}
            index={index}
            currentFolder={HOME_PATH}
            onClose={vi.fn()}
            onPrevious={() => setIndex((current) => Math.max(0, current - 1))}
            onNext={() => setIndex((current) => Math.min(items.length - 1, current + 1))}
            onCaptionSaved={vi.fn()}
            onCopied={vi.fn()}
          />
        );
      }

      renderWithProviders(<StickyFrameModal />);

      const firstDialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      fireEvent.loadedMetadata(firstDialog.querySelector("video")!);
      await user.click(
        within(firstDialog).getByRole("button", { name: "Save a frame from clip.mp4" }),
      );
      expect(within(firstDialog).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();

      await user.click(within(firstDialog).getByRole("button", { name: "Next item" }));

      const secondDialog = await screen.findByRole("dialog", { name: "Viewing reel.mp4" });
      expect(
        within(secondDialog).getByRole("group", { name: "Frame capture" }),
      ).toBeInTheDocument();
      expect(
        within(secondDialog).getByRole("button", { name: "Exit frame capture for reel.mp4" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("drops frame capture when the next item cannot capture frames", async () => {
      const user = userEvent.setup();
      const items = [makeItem("clip.mp4", { media_type: "video" }), makeItem("sunset.png")];

      function StickyFrameModal() {
        const [index, setIndex] = useState(0);
        return (
          <GalleryItemModal
            items={items}
            index={index}
            currentFolder={HOME_PATH}
            onClose={vi.fn()}
            onPrevious={() => setIndex((current) => Math.max(0, current - 1))}
            onNext={() => setIndex((current) => Math.min(items.length - 1, current + 1))}
            onCaptionSaved={vi.fn()}
            onCopied={vi.fn()}
          />
        );
      }

      renderWithProviders(<StickyFrameModal />);

      const firstDialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      fireEvent.loadedMetadata(firstDialog.querySelector("video")!);
      await user.click(
        within(firstDialog).getByRole("button", { name: "Save a frame from clip.mp4" }),
      );
      expect(within(firstDialog).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();

      await user.keyboard("{ArrowRight}");

      const secondDialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      expect(
        within(secondDialog).queryByRole("group", { name: "Frame capture" }),
      ).not.toBeInTheDocument();
      expect(
        within(secondDialog).queryByRole("button", { name: /save a frame/i }),
      ).not.toBeInTheDocument();
    });

    it("lets Escape leave frame mode without closing the modal", async () => {
      const user = userEvent.setup();
      const { onClose } = renderVideoModal();

      const dialog = await openFrameMode(user);
      await user.keyboard("{Escape}");

      expect(onClose).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(
          within(dialog).queryByRole("group", { name: "Frame capture" }),
        ).not.toBeInTheDocument(),
      );
    });

    it("locks the header and refuses to close while the frame uploads", async () => {
      const user = userEvent.setup();
      let releaseImport: (() => void) | undefined;
      importFilesMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseImport = () =>
              resolve({ copied: [SAVED_FRAME_NAME], skipped: [], rejected: [] });
          }),
      );

      const { onClose, onCopied } = renderVideoModal();

      const dialog = await openFrameMode(user);
      await user.click(within(dialog).getByRole("button", { name: "Save frame" }));

      await waitFor(() =>
        expect(within(dialog).getByRole("button", { name: "Saving" })).toHaveAttribute(
          "aria-busy",
          "true",
        ),
      );
      expect(within(dialog).getByRole("button", { name: "Delete clip.mp4" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();

      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();

      releaseImport?.();
      await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    });
  });
});
