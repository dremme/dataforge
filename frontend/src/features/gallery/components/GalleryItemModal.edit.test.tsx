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
      return dialog;
    }

    it("offers the toggle for an editable video", async () => {
      renderModal(videoItem());

      const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
      expect(within(dialog).getByRole("button", { name: "Edit clip.mp4" })).toBeInTheDocument();
    });

    it.each([
      ["a still image", makeItem("sunset.png")],
      ["a GIF", makeItem("loop.gif", { media_type: "gif" })],
      ["a container it cannot mux", makeItem("clip.avi", { media_type: "video" })],
    ])("does not offer the toggle for %s", async (_label, item) => {
      renderModal(item);

      const dialog = await screen.findByRole("dialog", { name: `Viewing ${item.name}` });
      expect(within(dialog).queryByRole("button", { name: /^Edit /i })).not.toBeInTheDocument();
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
        spec: { trim_start: 2, trim_end: 8, crop: null, speed: 2, scale: 0.5 },
      });
      renderModal(videoItem({ has_backup: true }));

      const dialog = await openEditMode(user);

      await waitFor(() => {
        expect(within(dialog).getByRole("slider", { name: "Trim start" })).toHaveAttribute(
          "aria-valuenow",
          "2",
        );
      });
      expect(within(dialog).getByRole("button", { name: "2x" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
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

      await user.click(within(dialog).getByRole("button", { name: "0.5x" }));
      await user.click(within(dialog).getByRole("button", { name: /Apply/ }));

      await waitFor(() => expect(applyMock).toHaveBeenCalled());
      expect(applyMock.mock.calls[0][0]).toBe(`${HOME_PATH}\\clip.mp4`);
      expect(applyMock.mock.calls[0][1]).toEqual({
        trim_start: 0,
        trim_end: null,
        crop: null,
        speed: 0.5,
        scale: 1,
      });
      await waitFor(() => expect(props.onCopied).toHaveBeenCalled());
      expect(
        within(dialog).queryByRole("group", { name: "Video editing" }),
      ).not.toBeInTheDocument();
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

      await user.click(within(dialog).getByRole("button", { name: "2x" }));
      await user.click(within(dialog).getByRole("button", { name: /Apply/ }));

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

      await user.click(within(dialog).getByRole("button", { name: "2x" }));
      await user.click(within(dialog).getByRole("button", { name: /Apply/ }));

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
