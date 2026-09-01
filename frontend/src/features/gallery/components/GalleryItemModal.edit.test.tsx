import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { stubVideoElement } from "@/test/videoElement";
import type { GalleryItem } from "@/shared/types";
import type * as videoEditApi from "@/features/gallery/api/videoEdit";
import {
  applyVideoEdit,
  fetchVideoEditState,
  revertVideoEdit,
} from "@/features/gallery/api/videoEdit";
import { GalleryItemModal } from "./GalleryItemModal";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

vi.mock("@/features/gallery/api/videoEdit", async (importOriginal) => {
  const actual = await importOriginal<typeof videoEditApi>();
  return {
    ...actual,
    fetchVideoEditState: vi.fn(),
    applyVideoEdit: vi.fn(),
    cancelVideoEdit: vi.fn(),
    revertVideoEdit: vi.fn(),
  };
});

const fetchStateMock = vi.mocked(fetchVideoEditState);
const applyMock = vi.mocked(applyVideoEdit);
const revertMock = vi.mocked(revertVideoEdit);

const EDITED = {
  path: `${HOME_PATH}\\clip.mp4`,
  size: 1024,
  modified_at: "2026-03-15T15:00:00.000Z",
  width: 960,
  height: 540,
  has_backup: true,
};

describe("GalleryItemModal", () => {
  describe("video editing", () => {
    let restoreVideo: (() => void) | undefined;

    beforeEach(() => {
      installMockBackend();
      restoreVideo = stubVideoElement({ duration: 12, width: 1920, height: 1080 });
      fetchStateMock
        .mockReset()
        .mockResolvedValue({ path: `${HOME_PATH}\\clip.mp4`, has_backup: false, spec: null });
      applyMock.mockReset().mockResolvedValue(EDITED);
      revertMock.mockReset().mockResolvedValue({ ...EDITED, has_backup: false });
    });

    afterEach(() => {
      // `vi.restoreAllMocks()` does not undo `defineProperty`.
      restoreVideo?.();
      restoreVideo = undefined;
    });

    function renderModal(item: GalleryItem, overrides: Record<string, unknown> = {}) {
      const props = {
        items: [item],
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

    function videoItem(overrides: Partial<GalleryItem> = {}): GalleryItem {
      return makeItem("clip.mp4", { media_type: "video", ...overrides });
    }

    async function openEditMode(user: ReturnType<typeof userEvent.setup>) {
      const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      // Metadata never lands on its own in jsdom, so the timeline stays disabled without it.
      fireEvent.loadedMetadata(dialog.querySelector("video")!);
      await user.click(within(dialog).getByRole("button", { name: "Edit clip.mp4" }));
      // Editing swaps in the original, so the browser mounts a fresh element and reports again.
      fireEvent.loadedMetadata(dialog.querySelector("video")!);
      return dialog;
    }

    it("offers the toggle for an editable video", async () => {
      renderModal(videoItem());

      const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      expect(within(dialog).getByRole("button", { name: "Edit clip.mp4" })).toBeInTheDocument();
    });

    it.each([
      ["a GIF", makeItem("loop.gif", { media_type: "gif" })],
      ["a container it cannot mux", makeItem("clip.avi", { media_type: "video" })],
      // ffmpeg would render an MKV; the browser cannot decode one, and the panel is driven off <video>.
      ["a container the browser cannot decode", makeItem("clip.mkv", { media_type: "video" })],
    ])("does not offer the toggle for %s", async (_label, item) => {
      renderModal(item);

      const dialog = await screen.findByRole("dialog", { name: `Viewing ${item.name}` });
      expect(within(dialog).queryByRole("button", { name: /^Edit /i })).not.toBeInTheDocument();
    });

    it("hands a still image to the image editor rather than this one", async () => {
      // One toggle/mode flag: a still reaching the video panel would be a silent mix-up.
      const user = userEvent.setup();
      renderModal(makeItem("sunset.png"));

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      await user.click(within(dialog).getByRole("button", { name: "Edit sunset.png" }));

      expect(
        within(dialog).queryByRole("group", { name: "Video editing" }),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByRole("group", { name: "Image editing" })).toBeInTheDocument();
    });

    it("opens the panel and surrenders the native controls", async () => {
      const user = userEvent.setup();
      renderModal(videoItem());

      const dialog = await openEditMode(user);

      expect(
        within(dialog).getByRole("button", { name: "Exit video editing for clip.mp4" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(within(dialog).getByRole("group", { name: "Video editing" })).toBeInTheDocument();
      expect(dialog.querySelector("video")).not.toHaveAttribute("controls");
    });

    it("puts the caption and metadata away, and brings them back on exit", async () => {
      const user = userEvent.setup();
      renderModal(videoItem());
      const dialog = await openEditMode(user);

      expect(within(dialog).queryByLabelText(/^Caption for/)).not.toBeInTheDocument();

      await user.click(
        within(dialog).getByRole("button", { name: "Exit video editing for clip.mp4" }),
      );

      expect(within(dialog).getByLabelText(/^Caption for/)).toBeInTheDocument();
    });

    it("plays the stored original rather than the current render", async () => {
      const user = userEvent.setup();
      renderModal(videoItem());

      const dialog = await openEditMode(user);

      expect(dialog.querySelector("video")?.getAttribute("src")).toContain("original=1");
    });

    it("seeds the panel from the spec stored beside the file", async () => {
      const user = userEvent.setup();
      fetchStateMock.mockResolvedValue({
        path: `${HOME_PATH}\\clip.mp4`,
        has_backup: true,
        spec: { masks: [], trim_start: 2, trim_end: 8, crop: null, speed: 2, scale: 0.5 },
      });
      renderModal(videoItem({ has_backup: true }));

      const dialog = await openEditMode(user);

      // Half of the stored trim_start: the handles read the retimed result, and speed is 2.
      await waitFor(() => {
        expect(within(dialog).getByRole("slider", { name: "Trim start" })).toHaveAttribute(
          "aria-valuenow",
          "1",
        );
      });
      // Collapsed, but the tool says it holds a value - that is what makes hiding it safe.
      expect(within(dialog).getByRole("button", { name: "Speed, changed" })).toBeInTheDocument();
    });

    it("locks a crop shape, and Free releases it again", async () => {
      const user = userEvent.setup();
      renderModal(videoItem());
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Crop/ }));
      const square = within(dialog).getByRole("button", { name: "1:1" });
      const free = within(dialog).getByRole("button", { name: "Free" });

      await user.click(square);
      expect(square).toHaveAttribute("aria-pressed", "true");
      expect(free).toHaveAttribute("aria-pressed", "false");

      await user.click(free);

      // What a lock does to the handles is VideoCropOverlay's own test; the overlay
      // cannot render here, since jsdom lays nothing out for it to measure.
      expect(free).toHaveAttribute("aria-pressed", "true");
      expect(square).toHaveAttribute("aria-pressed", "false");
    });

    it("keeps the transport working after navigating with the mode sticky", async () => {
      // Video remounts on item and mode; listeners bound only to mode were left on a discarded element.
      const user = userEvent.setup();
      const items = [videoItem(), makeItem("second.mp4", { media_type: "video" })];
      const props = {
        items,
        index: 0,
        currentFolder: HOME_PATH,
        onClose: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onCaptionSaved: vi.fn(),
        onCopied: vi.fn(),
      };
      const { rerender } = renderWithProviders(<GalleryItemModal {...props} />);
      const dialog = await openEditMode(user);
      const transport = () => within(dialog).getByRole("button", { name: /(Play|Pause) preview/ });

      fireEvent.play(dialog.querySelector("video")!);
      expect(transport()).toHaveAccessibleName("Pause preview");

      rerender(<GalleryItemModal {...props} index={1} />);
      const swapped = dialog.querySelector("video")!;
      fireEvent.loadedMetadata(swapped);

      fireEvent.play(swapped);
      expect(transport()).toHaveAccessibleName("Pause preview");

      fireEvent.pause(swapped);
      expect(transport()).toHaveAccessibleName("Play preview");
    });

    it("re-seeds from the item it navigated to, not the one it left", async () => {
      // Fetch must wait for duration: seeding against NaN collapsed the timeline to 0:00-0:00.
      const user = userEvent.setup();
      const items = [videoItem(), makeItem("second.mp4", { media_type: "video" })];
      const props = {
        items,
        index: 0,
        currentFolder: HOME_PATH,
        onClose: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onCaptionSaved: vi.fn(),
        onCopied: vi.fn(),
      };
      fetchStateMock.mockImplementation(async (mediaPath: string) => ({
        path: mediaPath,
        has_backup: mediaPath.endsWith("second.mp4"),
        spec: mediaPath.endsWith("second.mp4")
          ? { masks: [], trim_start: 3, trim_end: 9, crop: null, speed: 2, scale: 1 }
          : null,
      }));

      const { rerender } = renderWithProviders(<GalleryItemModal {...props} />);
      const dialog = await openEditMode(user);
      const trimStart = () => within(dialog).getByRole("slider", { name: "Trim start" });
      const trimEnd = () => within(dialog).getByRole("slider", { name: "Trim end" });

      await waitFor(() => expect(trimStart()).toHaveAttribute("aria-valuenow", "0"));

      rerender(<GalleryItemModal {...props} index={1} />);
      fireEvent.loadedMetadata(dialog.querySelector("video")!);

      // 3 and 9 of source, halved: this clip's stored spec doubles the speed.
      await waitFor(() => expect(trimStart()).toHaveAttribute("aria-valuenow", "1.5"));
      expect(trimEnd()).toHaveAttribute("aria-valuenow", "4.5");
      expect(within(dialog).getByRole("button", { name: "Speed, changed" })).toBeInTheDocument();

      // ...and back the other way: the second clip's values must not follow the first.
      rerender(<GalleryItemModal {...props} index={0} />);
      fireEvent.loadedMetadata(dialog.querySelector("video")!);

      await waitFor(() => expect(trimEnd()).toHaveAttribute("aria-valuenow", "12"));
      expect(trimStart()).toHaveAttribute("aria-valuenow", "0");
      expect(within(dialog).getByRole("button", { name: "Speed" })).toBeInTheDocument();
    });

    it("restores the shape a stored crop was framed with", async () => {
      const user = userEvent.setup();
      fetchStateMock.mockResolvedValue({
        path: `${HOME_PATH}\\clip.mp4`,
        has_backup: true,
        spec: {
          masks: [],
          trim_start: 0,
          trim_end: null,
          // 1080 wide of a 1920x1080 frame: square.
          crop: { x: 0.21875, y: 0, width: 0.5625, height: 1 },
          speed: 1,
          scale: 1,
        },
      });
      renderModal(videoItem({ has_backup: true }));
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Crop/ }));

      await waitFor(() => {
        expect(within(dialog).getByRole("button", { name: "1:1" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
    });

    it("forgets the shape when navigation lands on another video", async () => {
      const user = userEvent.setup();
      const items = [videoItem(), makeItem("second.mp4", { media_type: "video" })];
      const props = {
        items,
        index: 0,
        currentFolder: HOME_PATH,
        onClose: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onCaptionSaved: vi.fn(),
        onCopied: vi.fn(),
      };
      const { rerender } = renderWithProviders(<GalleryItemModal {...props} />);
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Crop/ }));
      await user.click(within(dialog).getByRole("button", { name: "1:1" }));
      expect(within(dialog).getByRole("button", { name: "1:1" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      rerender(<GalleryItemModal {...props} index={1} />);
      fireEvent.loadedMetadata(dialog.querySelector("video")!);

      // Crop tool still selected: reading "1:1" over an uncropped frame was the bug.
      await waitFor(() => {
        expect(within(dialog).getByRole("button", { name: "Free" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
      expect(within(dialog).getByRole("button", { name: /^Crop/ })).toHaveAccessibleName("Crop");
    });

    it("puts the original back when every value is dialled to where it started", async () => {
      // Identity vs on-disk spec: an untouched source left Apply disabled on a return to 1x.
      const user = userEvent.setup();
      fetchStateMock.mockResolvedValue({
        path: `${HOME_PATH}\\clip.mp4`,
        has_backup: true,
        spec: { masks: [], trim_start: 0, trim_end: null, crop: null, speed: 2, scale: 1 },
      });
      renderModal(videoItem({ has_backup: true }));
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Speed/ }));
      await waitFor(() => {
        expect(within(dialog).getByRole("button", { name: "2x" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
      expect(within(dialog).getByRole("button", { name: "Apply" })).toBeDisabled();

      await user.click(within(dialog).getByRole("button", { name: "1x" }));

      expect(within(dialog).getByRole("button", { name: "Apply" })).toBeEnabled();
      await user.click(within(dialog).getByRole("button", { name: "Apply" }));

      // Restored rather than re-encoded: the backup already holds exactly this file.
      await waitFor(() => expect(revertMock).toHaveBeenCalledWith(`${HOME_PATH}\\clip.mp4`));
      expect(applyMock).not.toHaveBeenCalled();
    });

    it("can unmute the preview, which edit mode otherwise leaves no way to hear", async () => {
      const user = userEvent.setup();
      renderModal(videoItem());
      const dialog = await openEditMode(user);
      const video = dialog.querySelector("video")!;

      expect(video.muted).toBe(true);

      await user.click(within(dialog).getByRole("button", { name: "Unmute preview" }));

      expect(video.muted).toBe(false);

      await user.click(within(dialog).getByRole("button", { name: "Mute preview" }));

      expect(video.muted).toBe(true);
    });

    it("turns frame capture off when editing starts, and back the other way", async () => {
      const user = userEvent.setup();
      renderModal(videoItem());
      const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      fireEvent.loadedMetadata(dialog.querySelector("video")!);

      await user.click(within(dialog).getByRole("button", { name: "Save a frame from clip.mp4" }));
      await user.click(within(dialog).getByRole("button", { name: "Edit clip.mp4" }));

      expect(
        within(dialog).queryByRole("group", { name: "Frame capture" }),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByRole("group", { name: "Video editing" })).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Save a frame from clip.mp4" }));

      expect(
        within(dialog).queryByRole("group", { name: "Video editing" }),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByRole("group", { name: "Frame capture" })).toBeInTheDocument();
    });

    it("steps out of the mode on Escape before it closes the modal", async () => {
      const user = userEvent.setup();
      const props = renderModal(videoItem());
      const dialog = await openEditMode(user);

      fireEvent.keyDown(window, { key: "Escape" });

      await waitFor(() => {
        expect(
          within(dialog).queryByRole("group", { name: "Video editing" }),
        ).not.toBeInTheDocument();
      });
      expect(props.onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    });

    it("posts the drafted spec and leaves the mode so the result is visible", async () => {
      const user = userEvent.setup();
      const props = renderModal(videoItem());
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Speed/ }));
      await user.click(within(dialog).getByRole("button", { name: "0.5x" }));
      await user.click(within(dialog).getByRole("button", { name: "Apply" }));

      await waitFor(() => expect(applyMock).toHaveBeenCalled());
      expect(applyMock.mock.calls[0][0]).toBe(`${HOME_PATH}\\clip.mp4`);
      expect(applyMock.mock.calls[0][1]).toEqual({
        masks: [],
        trim_start: 0,
        trim_end: null,
        crop: null,
        speed: 0.5,
        scale: 1,
      });
      await waitFor(() => expect(props.onCopied).toHaveBeenCalled());
      // Nothing about the surface changes: the editor was already playing the original,
      // which the spec is expressed against, so there is nothing to swap back to.
      expect(within(dialog).getByRole("group", { name: "Video editing" })).toBeInTheDocument();
      expect(dialog.querySelector("video")?.getAttribute("src")).toContain("original=1");
    });

    it("goes quiet once the draft matches what it just wrote", async () => {
      const user = userEvent.setup();
      renderModal(videoItem());
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Speed/ }));
      await user.click(within(dialog).getByRole("button", { name: "0.5x" }));
      expect(within(dialog).getByRole("button", { name: "Apply" })).toBeEnabled();

      await user.click(within(dialog).getByRole("button", { name: "Apply" }));

      await waitFor(() => {
        expect(within(dialog).getByRole("button", { name: "Apply" })).toBeDisabled();
      });
      // ...and wakes up again for a different edit.
      await user.click(within(dialog).getByRole("button", { name: "2x" }));
      expect(within(dialog).getByRole("button", { name: "Apply" })).toBeEnabled();
    });

    it("survives the listing learning about the backup it just made", async () => {
      // Apply flips has_backup; resetting on it clears duration with nothing to fire loadedmetadata.
      const user = userEvent.setup();
      const item = videoItem();
      const props = {
        items: [item],
        index: 0,
        currentFolder: HOME_PATH,
        onClose: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onCaptionSaved: vi.fn(),
        onCopied: vi.fn(),
      };
      const { rerender } = renderWithProviders(<GalleryItemModal {...props} />);
      const dialog = await openEditMode(user);

      rerender(<GalleryItemModal {...props} items={[{ ...item, has_backup: true }]} />);

      expect(
        within(dialog).queryByText("The timeline loads with the video."),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByRole("slider", { name: "Trim start" })).toBeEnabled();
    });

    it("locks the rest of the modal while a render is in flight", async () => {
      const user = userEvent.setup();
      let release: (value: typeof EDITED) => void = () => {};
      applyMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      renderModal(videoItem());
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Speed/ }));
      await user.click(within(dialog).getByRole("button", { name: "2x" }));
      await user.click(within(dialog).getByRole("button", { name: "Apply" }));

      await waitFor(() => {
        expect(within(dialog).getByRole("button", { name: "Delete clip.mp4" })).toBeDisabled();
      });
      expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();

      release(EDITED);
      await waitFor(() => expect(applyMock).toHaveBeenCalled());
    });

    it("reports a failed render and stays in the mode", async () => {
      const user = userEvent.setup();
      applyMock.mockRejectedValue(new Error("Invalid filter"));
      renderModal(videoItem());
      const dialog = await openEditMode(user);

      await user.click(within(dialog).getByRole("button", { name: /^Speed/ }));
      await user.click(within(dialog).getByRole("button", { name: "2x" }));
      await user.click(within(dialog).getByRole("button", { name: "Apply" }));

      expect(await screen.findByText(/Could not edit clip.mp4/)).toBeInTheDocument();
      expect(within(dialog).getByRole("group", { name: "Video editing" })).toBeInTheDocument();
    });

    it("confirms before restoring the original", async () => {
      const user = userEvent.setup();
      fetchStateMock.mockResolvedValue({
        path: `${HOME_PATH}\\clip.mp4`,
        has_backup: true,
        spec: null,
      });
      renderModal(videoItem({ has_backup: true }));
      const dialog = await openEditMode(user);

      await user.click(await within(dialog).findByRole("button", { name: /Revert original/ }));

      expect(revertMock).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Restore" }));
      await waitFor(() => expect(revertMock).toHaveBeenCalledWith(`${HOME_PATH}\\clip.mp4`));
    });

    it("drops the mode when navigation lands on something it cannot edit", async () => {
      const user = userEvent.setup();
      const items = [videoItem(), makeItem("sunset.png")];
      const { rerender } = renderWithProviders(
        <GalleryItemModal
          items={items}
          index={0}
          currentFolder={HOME_PATH}
          onClose={vi.fn()}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onCaptionSaved={vi.fn()}
        />,
      );

      await openEditMode(user);

      rerender(
        <GalleryItemModal
          items={items}
          index={1}
          currentFolder={HOME_PATH}
          onClose={vi.fn()}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onCaptionSaved={vi.fn()}
        />,
      );

      const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
      expect(
        within(dialog).queryByRole("group", { name: "Video editing" }),
      ).not.toBeInTheDocument();
    });
  });
});
