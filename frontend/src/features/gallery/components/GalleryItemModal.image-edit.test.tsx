import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { stubImageElement } from "@/test/imageElement";
import { stubVideoElement } from "@/test/videoElement";
import type { GalleryItem, ImageEditResponse } from "@/shared/types";
import type * as imageEditApi from "@/features/gallery/api/imageEdit";
import {
  applyImageEdit,
  fetchImageEditState,
  revertImageEdit,
} from "@/features/gallery/api/imageEdit";
import { GalleryItemModal } from "./GalleryItemModal";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

vi.mock("@/features/gallery/api/imageEdit", async (importOriginal) => {
  const actual = await importOriginal<typeof imageEditApi>();
  return {
    ...actual,
    fetchImageEditState: vi.fn(),
    applyImageEdit: vi.fn(),
    revertImageEdit: vi.fn(),
  };
});

const fetchStateMock = vi.mocked(fetchImageEditState);
const applyMock = vi.mocked(applyImageEdit);
const revertMock = vi.mocked(revertImageEdit);

const PHOTO = `${HOME_PATH}\\sunset.png`;

const EDITED: ImageEditResponse = {
  path: PHOTO,
  size: 2048,
  modified_at: "2026-03-15T15:00:00.000Z",
  width: 1080,
  height: 1920,
  has_backup: true,
};

describe("GalleryItemModal", () => {
  describe("image editing", () => {
    let restoreImage: (() => void) | undefined;
    let restoreVideo: (() => void) | undefined;

    beforeEach(() => {
      installMockBackend();
      restoreImage = stubImageElement({ width: 1920, height: 1080 });
      restoreVideo = stubVideoElement({ duration: 12, width: 1920, height: 1080 });
      fetchStateMock.mockReset().mockResolvedValue({ path: PHOTO, has_backup: false, spec: null });
      applyMock.mockReset().mockResolvedValue(EDITED);
      revertMock.mockReset().mockResolvedValue({ ...EDITED, has_backup: false });
    });

    afterEach(() => {
      // `vi.restoreAllMocks()` does not undo `defineProperty`.
      restoreImage?.();
      restoreVideo?.();
      restoreImage = undefined;
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

      const view = renderWithProviders(<GalleryItemModal {...props} />);
      return { ...view, props };
    }

    function imageItem(overrides: Partial<GalleryItem> = {}): GalleryItem {
      return makeItem("sunset.png", overrides);
    }

    async function openEditMode(user: ReturnType<typeof userEvent.setup>, name = "sunset.png") {
      const dialog = await screen.findByRole("dialog", { name: `Viewing ${name}` });
      await user.click(within(dialog).getByRole("button", { name: `Edit ${name}` }));
      // jsdom decodes nothing, so `load` never fires on its own - and the panel stays
      // locked until the image has reported a size.
      fireEvent.load(dialog.querySelector("img")!);
      return dialog;
    }

    describe("the toggle", () => {
      it.each([["sunset.png"], ["sunset.jpg"], ["sunset.jpeg"], ["photo.webp"], ["photo.bmp"]])(
        "is offered for %s",
        async (name) => {
          renderModal(makeItem(name));

          const dialog = await screen.findByRole("dialog", { name: `Viewing ${name}` });
          expect(within(dialog).getByRole("button", { name: `Edit ${name}` })).toBeInTheDocument();
        },
      );

      it.each([
        // A Pillow round-trip would flatten the animation; a GIF gets frame capture here.
        ["a GIF", makeItem("loop.gif", { media_type: "gif" })],
        ["a format Pillow will not write back", makeItem("scan.tiff")],
      ])("is withheld for %s", async (_label, item) => {
        renderModal(item);

        const dialog = await screen.findByRole("dialog", { name: `Viewing ${item.name}` });
        expect(
          within(dialog).queryByRole("button", { name: `Edit ${item.name}` }),
        ).not.toBeInTheDocument();
      });

      it("says which mode it is in", async () => {
        const user = userEvent.setup();
        renderModal(imageItem());

        const dialog = await openEditMode(user);

        expect(
          within(dialog).getByRole("button", { name: "Exit image editing for sunset.png" }),
        ).toHaveAttribute("aria-pressed", "true");
      });
    });

    describe("the stage", () => {
      it("opens the panel and shows the stored original", async () => {
        const user = userEvent.setup();
        renderModal(imageItem());

        const dialog = await openEditMode(user);

        expect(within(dialog).getByRole("group", { name: "Image editing" })).toBeInTheDocument();
        expect(dialog.querySelector("img")?.getAttribute("src")).toContain("original=1");
      });

      it("gives up zooming for the duration", async () => {
        // The stage carries the rotation; two transforms would fight the overlay's measurements.
        const user = userEvent.setup();
        renderModal(imageItem());

        const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
        expect(within(dialog).getByRole("button", { name: /^Zoom in/ })).toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "Edit sunset.png" }));

        expect(within(dialog).queryByRole("button", { name: /^Zoom in/ })).not.toBeInTheDocument();
      });

      it("turns the picture with the draft", async () => {
        const user = userEvent.setup();
        renderModal(imageItem());
        const dialog = await openEditMode(user);

        await user.click(within(dialog).getByRole("button", { name: /^Rotate$/ }));
        await user.click(within(dialog).getByRole("button", { name: "Rotate right 90°" }));

        expect(dialog.querySelector(".image-edit-stage__canvas")).toHaveStyle({
          "--edit-rotate": "90deg",
        });
      });

      it("says the picture is on its side, which is what swaps its size constraints", async () => {
        // Stage measures nothing: a rotated img lays out upright, so sizing from that box loops.
        const user = userEvent.setup();
        renderModal(imageItem());
        const dialog = await openEditMode(user);
        const stage = dialog.querySelector(".image-edit-stage")!;

        expect(stage).not.toHaveClass("image-edit-stage--turned");

        await user.click(within(dialog).getByRole("button", { name: /^Rotate$/ }));
        await user.click(within(dialog).getByRole("button", { name: "Rotate right 90°" }));
        expect(stage).toHaveClass("image-edit-stage--turned");

        // A half turn leaves the frame the way up it started.
        await user.click(within(dialog).getByRole("button", { name: "Rotate right 90°" }));
        expect(stage).not.toHaveClass("image-edit-stage--turned");
      });

      it("mirrors the picture with the draft", async () => {
        const user = userEvent.setup();
        renderModal(imageItem());
        const dialog = await openEditMode(user);

        await user.click(within(dialog).getByRole("button", { name: /^Rotate$/ }));
        await user.click(within(dialog).getByRole("button", { name: "Mirror horizontally" }));

        expect(dialog.querySelector(".image-edit-stage__canvas")).toHaveStyle({
          "--edit-flip-x": "-1",
        });
      });

      it("puts the caption and metadata away, and brings them back on exit", async () => {
        const user = userEvent.setup();
        renderModal(imageItem());
        const dialog = await openEditMode(user);

        expect(within(dialog).queryByLabelText(/^Caption for/)).not.toBeInTheDocument();

        await user.click(
          within(dialog).getByRole("button", { name: "Exit image editing for sunset.png" }),
        );

        expect(within(dialog).getByLabelText(/^Caption for/)).toBeInTheDocument();
      });
    });

    describe("alongside the modal's other modes", () => {
      it("steps out of the mode on Escape before it closes the modal", async () => {
        const user = userEvent.setup();
        const { props } = renderModal(imageItem());
        const dialog = await openEditMode(user);

        await user.keyboard("{Escape}");

        expect(props.onClose).not.toHaveBeenCalled();
        expect(within(dialog).getByLabelText(/^Caption for/)).toBeInTheDocument();
      });

      it("turns frame capture off when a GIF is left for an image", async () => {
        // One editMode flag for both editors; frame capture shares the stage with neither.
        const user = userEvent.setup();
        const gif = makeItem("loop.gif", { media_type: "gif" });
        const { rerender, props } = renderModal(gif);

        const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
        await user.click(
          within(dialog).getByRole("button", { name: "Save a frame from loop.gif" }),
        );

        rerender(<GalleryItemModal {...props} items={[imageItem()]} />);

        expect(
          screen.queryByRole("button", { name: /^Exit frame capture/ }),
        ).not.toBeInTheDocument();
      });

      it("drops the mode when navigation lands on something it cannot edit", async () => {
        const user = userEvent.setup();
        const { rerender, props } = renderModal(imageItem());
        await openEditMode(user);

        rerender(
          <GalleryItemModal {...props} items={[makeItem("loop.gif", { media_type: "gif" })]} />,
        );

        const dialog = await screen.findByRole("dialog", { name: "Viewing loop.gif" });
        expect(
          within(dialog).queryByRole("group", { name: "Image editing" }),
        ).not.toBeInTheDocument();
      });

      it("keeps the mode across a swap onto another image", async () => {
        const user = userEvent.setup();
        const { rerender, props } = renderModal(imageItem());
        await openEditMode(user);

        rerender(<GalleryItemModal {...props} items={[makeItem("beach.jpg")]} />);

        const dialog = await screen.findByRole("dialog", { name: "Viewing beach.jpg" });
        expect(within(dialog).getByRole("group", { name: "Image editing" })).toBeInTheDocument();
      });
    });

    describe("applying", () => {
      it("posts the drafted spec and leaves the mode so the result is visible", async () => {
        const user = userEvent.setup();
        const { props } = renderModal(imageItem());
        const dialog = await openEditMode(user);

        await user.click(within(dialog).getByRole("button", { name: /^Rotate$/ }));
        await user.click(within(dialog).getByRole("button", { name: "Rotate right 90°" }));
        await user.click(within(dialog).getByRole("button", { name: "Apply" }));

        await waitFor(() => expect(applyMock).toHaveBeenCalled());
        expect(applyMock.mock.calls[0][0]).toBe(PHOTO);
        expect(applyMock.mock.calls[0][1]).toEqual({
          crop: null,
          mirror_h: false,
          mirror_v: false,
          rotate: 90,
          scale: 1,
        });
        await waitFor(() => expect(props.onCopied).toHaveBeenCalled());
        // Nothing about the surface changes: the editor was already showing the original,
        // which the spec is expressed against, so there is nothing to swap back to.
        expect(within(dialog).getByRole("group", { name: "Image editing" })).toBeInTheDocument();
        expect(dialog.querySelector("img")?.getAttribute("src")).toContain("original=1");
      });

      it("locks the rest of the modal while a render is in flight", async () => {
        let release!: (value: ImageEditResponse) => void;
        applyMock.mockReturnValue(
          new Promise((resolve) => {
            release = resolve;
          }),
        );
        const user = userEvent.setup();
        renderModal(imageItem());
        const dialog = await openEditMode(user);

        await user.click(within(dialog).getByRole("button", { name: /^Rotate$/ }));
        await user.click(within(dialog).getByRole("button", { name: "Rotate right 90°" }));
        await user.click(within(dialog).getByRole("button", { name: "Apply" }));

        await waitFor(() =>
          expect(within(dialog).getByRole("button", { name: /^Delete /i })).toBeDisabled(),
        );
        expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();

        release(EDITED);
        await waitFor(() =>
          expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled(),
        );
      });

      it("reports a failed render and stays in the mode", async () => {
        applyMock.mockRejectedValue(new Error("Truncated file"));
        const user = userEvent.setup();
        renderModal(imageItem());
        const dialog = await openEditMode(user);

        await user.click(within(dialog).getByRole("button", { name: /^Rotate$/ }));
        await user.click(within(dialog).getByRole("button", { name: "Rotate right 90°" }));
        await user.click(within(dialog).getByRole("button", { name: "Apply" }));

        expect(await screen.findByText(/Could not edit sunset.png/)).toBeInTheDocument();
        expect(within(dialog).getByRole("group", { name: "Image editing" })).toBeInTheDocument();
      });
    });

    describe("reverting", () => {
      it("confirms before restoring the original", async () => {
        const user = userEvent.setup();
        fetchStateMock.mockResolvedValue({
          path: PHOTO,
          has_backup: true,
          spec: { crop: null, mirror_h: false, mirror_v: false, rotate: 90, scale: 1 },
        });
        renderModal(imageItem({ has_backup: true }));
        const dialog = await openEditMode(user);

        await user.click(await within(dialog).findByRole("button", { name: "Revert original" }));
        expect(revertMock).not.toHaveBeenCalled();

        await user.click(await screen.findByRole("button", { name: "Restore" }));

        await waitFor(() => expect(revertMock).toHaveBeenCalledWith(PHOTO));
      });
    });
  });
});
