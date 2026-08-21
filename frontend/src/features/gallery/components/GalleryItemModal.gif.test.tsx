import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import * as mediaApi from "@/features/gallery/api/media";
import { importFiles } from "@/features/folder/api/files";
import { encodeVideoFrame, seekVideoTo } from "@/features/gallery/lib/videoFrameEncode";
import { convertGifToMp4, fetchGifToMp4State } from "@/features/gallery/api/gifToMp4";
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

vi.mock("@/features/gallery/api/gifToMp4", () => ({
  fetchGifToMp4State: vi.fn(),
  convertGifToMp4: vi.fn(),
}));

const seekVideoToMock = vi.mocked(seekVideoTo);
const encodeVideoFrameMock = vi.mocked(encodeVideoFrame);
const importFilesMock = vi.mocked(importFiles);

const fetchGifToMp4StateMock = vi.mocked(fetchGifToMp4State);
const convertGifToMp4Mock = vi.mocked(convertGifToMp4);

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

  describe("GIF viewing and frame capture", () => {
    // The mock backend answers /api/gif-info with 24 frames.
    const SAVED_GIF_FRAME_NAME = "loop_f0000.jpg";

    beforeEach(() => {
      importFilesMock
        .mockReset()
        .mockResolvedValue({ copied: [SAVED_GIF_FRAME_NAME], skipped: [], rejected: [] });
    });

    function renderGifModal(overrides: Partial<Parameters<typeof GalleryItemModal>[0]> = {}) {
      const props = {
        items: [makeItem("loop.gif", { media_type: "gif" as const })],
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

    it("renders through an img rather than a video element", async () => {
      renderGifModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      // A GIF handed to a <video> shows nothing at all, so this is the whole reason
      // "gif" is its own media type instead of folding into "video".
      expect(dialog.querySelector("video")).toBeNull();
      expect(within(dialog).getByRole("img", { name: "loop.gif" })).toBeInTheDocument();
    });

    it("hides the OS image preview the way a video does", async () => {
      renderGifModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      expect(
        within(dialog).queryByRole("button", { name: "Open in image preview" }),
      ).not.toBeInTheDocument();
    });

    it("keeps frame timing out of the meta strip", async () => {
      renderGifModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      // The frame count is fetched for the capture bar, and shown only there.
      expect(within(dialog).queryByText("fps")).not.toBeInTheDocument();
      expect(within(dialog).queryByText("Frames")).not.toBeInTheDocument();
    });

    it("scrubs by frame index and writes an indexed sibling JPG", async () => {
      const user = userEvent.setup();
      const { onCopied } = renderGifModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      await user.click(
        await within(dialog).findByRole("button", { name: "Save a frame from loop.gif" }),
      );

      const bar = within(dialog).getByRole("group", { name: "Frame capture" });
      const slider = within(bar).getByRole("slider", { name: "Frame position" });
      // 24 frames means indices 0..23, and whole-frame steps.
      expect(slider).toHaveAttribute("max", "23");
      expect(slider).toHaveAttribute("step", "1");

      await user.click(within(bar).getByRole("button", { name: "Save frame" }));

      await waitFor(() => expect(importFilesMock).toHaveBeenCalledTimes(1));
      const [destination, files, overwrite] = importFilesMock.mock.calls[0];
      expect(destination).toBe(HOME_PATH);
      expect(files[0].name).toBe(SAVED_GIF_FRAME_NAME);
      expect(overwrite).toBe(true);
      await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    });

    it("never reaches for the video encoder", async () => {
      const user = userEvent.setup();
      renderGifModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      await user.click(
        await within(dialog).findByRole("button", { name: "Save a frame from loop.gif" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "Save frame" }));

      await waitFor(() => expect(importFilesMock).toHaveBeenCalledTimes(1));
      // The GIF path fetches the decoded frame from the server; the canvas route
      // belongs to video alone.
      expect(seekVideoToMock).not.toHaveBeenCalled();
      expect(encodeVideoFrameMock).not.toHaveBeenCalled();
    });

    it("stays hidden without a destination folder", async () => {
      renderGifModal({ currentFolder: undefined });

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      expect(
        within(dialog).queryByRole("button", { name: /save a frame/i }),
      ).not.toBeInTheDocument();
    });
  });
  describe("GIF to MP4 conversion", () => {
    const GIF_PATH = `${HOME_PATH}\\loop.gif`;
    const MP4_PATH = `${HOME_PATH}\\loop.mp4`;

    beforeEach(() => {
      fetchGifToMp4StateMock
        .mockReset()
        .mockResolvedValue({ path: GIF_PATH, target: MP4_PATH, target_exists: false });
      convertGifToMp4Mock.mockReset().mockResolvedValue({
        path: MP4_PATH,
        size: 4096,
        modified_at: "2026-03-15T15:00:00.000Z",
        frame_rate: 24,
      });
    });

    function renderModal(overrides: Partial<Parameters<typeof GalleryItemModal>[0]> = {}) {
      const props = {
        items: [makeItem("loop.gif", { media_type: "gif" as const })],
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

    it("writes the MP4 beside the GIF and reloads the folder", async () => {
      const user = userEvent.setup();
      const { onCopied } = renderModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      await user.click(within(dialog).getByRole("button", { name: "Convert loop.gif to MP4" }));

      await waitFor(() => expect(convertGifToMp4Mock).toHaveBeenCalledWith(GIF_PATH, false));
      expect(await screen.findByRole("status")).toHaveTextContent("Saved loop.mp4 at 24 fps.");
      await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    });

    it("prompts before replacing an MP4 already holding the name", async () => {
      const user = userEvent.setup();
      fetchGifToMp4StateMock.mockResolvedValue({
        path: GIF_PATH,
        target: MP4_PATH,
        target_exists: true,
      });
      renderModal();

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      await user.click(within(dialog).getByRole("button", { name: "Convert loop.gif to MP4" }));

      const prompt = await screen.findByRole("alertdialog", { name: "Replace the existing MP4?" });
      expect(within(prompt).getByText("loop.mp4")).toBeInTheDocument();
      expect(convertGifToMp4Mock).not.toHaveBeenCalled();

      await user.click(within(prompt).getByRole("button", { name: "Replace" }));

      await waitFor(() => expect(convertGifToMp4Mock).toHaveBeenCalledWith(GIF_PATH, true));
    });

    it("offers nothing to convert on a still", async () => {
      renderModal({ items: [makeItem("sunset.png")] });

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      expect(within(dialog).queryByRole("button", { name: /convert/i })).not.toBeInTheDocument();
    });

    it("stays available without a destination folder, since it writes in place", async () => {
      renderModal({ currentFolder: undefined });

      const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
      expect(
        within(dialog).getByRole("button", { name: "Convert loop.gif to MP4" }),
      ).toBeInTheDocument();
    });
  });
});
