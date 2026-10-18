import { useState } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { stubVideoElement } from "@/test/videoElement";
import type { CaptionSaveResponse, GalleryItem } from "@/shared/types";
import * as mediaApi from "@/features/gallery/api/media";
import { importFiles } from "@/features/folder/api/files";
import { encodeVideoFrame, seekVideoTo } from "@/features/gallery/lib/videoFrameEncode";
import { GalleryItemModal } from "./GalleryItemModal";
import type {
  deleteMedia,
  previewMediaTransfer,
  transferSelectedMedia,
} from "@/features/gallery/api/media";
import type { previewFileImport } from "@/features/folder/api/files";

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
        onClose: vi.fn<() => void>(),
        onPrevious: vi.fn<() => void>(),
        onNext: vi.fn<() => void>(),
        onCaptionSaved: vi.fn<(path: string, update: CaptionSaveResponse) => void>(),
        onCopied: vi.fn<() => void | Promise<void>>(),
        ...overrides,
      };

      renderWithProviders(<GalleryItemModal {...props} />);
      return props;
    }

    async function openFrameMode(user: ReturnType<typeof userEvent.setup>) {
      const modal = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      // Metadata never lands on its own in jsdom, so the slider stays disabled without this.
      fireEvent.loadedMetadata(modal.querySelector("video")!);
      await user.click(within(modal).getByRole("button", { name: "Save a frame from clip.mp4" }));
      return modal;
    }

    it("is not offered for a still image", async () => {
      renderWithProviders(
        <GalleryItemModal
          items={[makeItem("sunset.png")]}
          index={0}
          currentFolder={HOME_PATH}
          onClose={vi.fn<() => void>()}
          onPrevious={vi.fn<() => void>()}
          onNext={vi.fn<() => void>()}
          onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
        />,
      );

      const modal = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      expect(
        within(modal).queryByRole("button", { name: /save a frame/i }),
      ).not.toBeInTheDocument();
    });

    it("stays hidden without a destination folder", async () => {
      renderVideoModal({ currentFolder: undefined });

      const modal = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      expect(
        within(modal).queryByRole("button", { name: /save a frame/i }),
      ).not.toBeInTheDocument();
    });

    it("reveals the capture bar and gives it back", async () => {
      const user = userEvent.setup();
      renderVideoModal();

      const modal = await openFrameMode(user);
      expect(within(modal).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();

      const toggle = within(modal).getByRole("button", {
        name: "Exit frame capture for clip.mp4",
      });
      expect(toggle).toHaveAttribute("aria-pressed", "true");

      await user.click(toggle);
      expect(within(modal).queryByRole("group", { name: "Frame capture" })).not.toBeInTheDocument();
    });

    it("writes the frame beside the video and refreshes the folder", async () => {
      const user = userEvent.setup();
      const { onCopied } = renderVideoModal();

      const modal = await openFrameMode(user);
      await user.click(within(modal).getByRole("button", { name: "Save frame" }));

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

      const modal = await openFrameMode(user);
      await user.click(within(modal).getByRole("button", { name: "Save frame" }));

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

      const modal = await openFrameMode(user);
      await user.click(within(modal).getByRole("button", { name: "Save frame" }));

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

      const modal = await openFrameMode(user);
      await user.click(within(modal).getByRole("button", { name: "Save frame" }));

      // No frame was ever presented, so the name falls back to the requested time.
      expect(
        await screen.findByText("Could not save clip_0000000.jpg: The video did not seek in time."),
      ).toBeInTheDocument();
      expect(importFilesMock).not.toHaveBeenCalled();
    });

    it("navigates items with arrow keys while frame capture stays on", async () => {
      const user = userEvent.setup();
      const { onNext, onPrevious } = renderVideoModal();

      const modal = await openFrameMode(user);

      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowLeft}");

      expect(onNext).toHaveBeenCalledTimes(1);
      expect(onPrevious).toHaveBeenCalledTimes(1);
      expect(within(modal).getByRole("button", { name: "Next item" })).toBeEnabled();
      expect(within(modal).getByRole("button", { name: "Previous item" })).toBeEnabled();
      expect(within(modal).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();
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
            onClose={vi.fn<() => void>()}
            onPrevious={() => setIndex((current) => Math.max(0, current - 1))}
            onNext={() => setIndex((current) => Math.min(items.length - 1, current + 1))}
            onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
            onCopied={vi.fn<() => void | Promise<void>>()}
          />
        );
      }

      renderWithProviders(<StickyFrameModal />);

      const firstModal = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      fireEvent.loadedMetadata(firstModal.querySelector("video")!);
      await user.click(
        within(firstModal).getByRole("button", { name: "Save a frame from clip.mp4" }),
      );
      expect(within(firstModal).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();

      await user.click(within(firstModal).getByRole("button", { name: "Next item" }));

      const secondModal = await screen.findByRole("dialog", { name: "Viewing reel.mp4" });
      expect(within(secondModal).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();
      expect(
        within(secondModal).getByRole("button", { name: "Exit frame capture for reel.mp4" }),
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
            onClose={vi.fn<() => void>()}
            onPrevious={() => setIndex((current) => Math.max(0, current - 1))}
            onNext={() => setIndex((current) => Math.min(items.length - 1, current + 1))}
            onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
            onCopied={vi.fn<() => void | Promise<void>>()}
          />
        );
      }

      renderWithProviders(<StickyFrameModal />);

      const firstModal = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      fireEvent.loadedMetadata(firstModal.querySelector("video")!);
      await user.click(
        within(firstModal).getByRole("button", { name: "Save a frame from clip.mp4" }),
      );
      expect(within(firstModal).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();

      await user.keyboard("{ArrowRight}");

      const secondModal = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      expect(
        within(secondModal).queryByRole("group", { name: "Frame capture" }),
      ).not.toBeInTheDocument();
      expect(
        within(secondModal).queryByRole("button", { name: /save a frame/i }),
      ).not.toBeInTheDocument();
    });

    it("lets Escape leave frame mode without closing the modal", async () => {
      const user = userEvent.setup();
      const { onClose } = renderVideoModal();

      const modal = await openFrameMode(user);
      await user.keyboard("{Escape}");

      expect(onClose).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(
          within(modal).queryByRole("group", { name: "Frame capture" }),
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

      const modal = await openFrameMode(user);
      await user.click(within(modal).getByRole("button", { name: "Save frame" }));

      await waitFor(() =>
        expect(within(modal).getByRole("button", { name: "Saving" })).toHaveAttribute(
          "aria-busy",
          "true",
        ),
      );
      expect(within(modal).getByRole("button", { name: "Delete clip.mp4" })).toBeDisabled();
      expect(within(modal).getByRole("button", { name: "Close" })).toBeDisabled();

      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();

      releaseImport?.();
      await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    });
  });
});
