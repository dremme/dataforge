import { StrictMode, type ReactNode } from "react";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyImageEdit,
  fetchImageEditState,
  revertImageEdit,
} from "@/features/gallery/api/imageEdit";
import { useImageEdit, type UseImageEditOptions } from "./useImageEdit";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { makeItem } from "@/test/galleryItemModal";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem, ImageEditResponse, ImageEditSpec } from "@/shared/types";

vi.mock("@/features/gallery/api/imageEdit", () => ({
  imageOriginalUrl: (path: string) => `/api/media?path=${path}&original=1`,
  fetchImageEditState: vi.fn(),
  applyImageEdit: vi.fn(),
  revertImageEdit: vi.fn(),
}));

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

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <NotificationsProvider>{children}</NotificationsProvider>
    </StrictMode>
  );
}

function spec(overrides: Partial<ImageEditSpec> = {}): ImageEditSpec {
  return { crop: null, mirror_h: false, mirror_v: false, rotate: 0, scale: 1, ...overrides };
}

/**
 * jsdom decodes nothing, so the hook is handed a stand-in element rather than waiting
 * for a `load` that would never carry a size.
 */
function decoded(width = 1920, height = 1080) {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

function renderEdit(overrides: Partial<UseImageEditOptions> = {}) {
  const setEditMode = vi.fn();
  const onEdited = vi.fn();
  const initial: UseImageEditOptions = {
    item: makeItem("sunset.png"),
    onEdited,
    editMode: true,
    setEditMode,
    ...overrides,
  };

  const view = renderHook((props: UseImageEditOptions) => useImageEdit(props), {
    wrapper,
    initialProps: initial,
  });

  return { ...view, setEditMode, onEdited, initial };
}

/** Renders, then reports the size the panel is gated on. */
async function renderReady(overrides: Partial<UseImageEditOptions> = {}) {
  const view = renderEdit(overrides);
  await act(async () => {
    view.result.current.handleLoad(decoded());
  });
  return view;
}

beforeEach(() => {
  fetchStateMock.mockReset().mockResolvedValue({ path: PHOTO, has_backup: false, spec: null });
  applyMock.mockReset().mockResolvedValue(EDITED);
  revertMock.mockReset().mockResolvedValue({ ...EDITED, has_backup: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useImageEdit", () => {
  describe("readiness", () => {
    it("is not ready until the image reports a size", async () => {
      const { result } = renderEdit();

      expect(result.current.ready).toBe(false);

      await act(async () => result.current.handleLoad(decoded(800, 600)));

      expect(result.current.ready).toBe(true);
      expect(result.current.sourceWidth).toBe(800);
      expect(result.current.sourceHeight).toBe(600);
    });

    it("opens on an untouched draft", async () => {
      const { result } = await renderReady();

      expect(result.current.draft).toEqual({
        crop: { x: 0, y: 0, width: 1, height: 1 },
        mirrorH: false,
        mirrorV: false,
        rotate: 0,
        scale: 1,
      });
      expect(result.current.dirty).toBe(false);
    });
  });

  describe("mode", () => {
    it("turns the mode on and off through the flag the modal owns", async () => {
      const { result, setEditMode, rerender, initial } = await renderReady({ editMode: false });

      act(() => result.current.toggleEditMode());
      expect(setEditMode).toHaveBeenCalledWith(true);

      rerender({ ...initial, editMode: true });
      act(() => result.current.toggleEditMode());
      expect(setEditMode).toHaveBeenLastCalledWith(false);
    });

    it("puts the crop handles away on the way out", async () => {
      const { result } = await renderReady();

      act(() => result.current.setCropActive(true));
      act(() => result.current.exitEditMode());

      expect(result.current.cropActive).toBe(false);
    });

    it("refuses to leave while a render is in flight", async () => {
      let release!: (value: ImageEditResponse) => void;
      applyMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const { result, setEditMode } = await renderReady();

      act(() => result.current.rotateClockwise());
      act(() => result.current.apply());
      act(() => result.current.toggleEditMode());

      expect(setEditMode).not.toHaveBeenCalled();

      await act(async () => release(EDITED));
    });
  });

  describe("the draft", () => {
    it("turns a quarter clockwise, and back again", async () => {
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());
      expect(result.current.draft.rotate).toBe(90);

      act(() => result.current.rotateCounterClockwise());
      expect(result.current.draft.rotate).toBe(0);
    });

    it("reaches a half turn with two quarter turns", async () => {
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());
      act(() => result.current.rotateClockwise());

      expect(result.current.draft.rotate).toBe(180);
    });

    it("toggles each mirror independently", async () => {
      const { result } = await renderReady();

      act(() => result.current.toggleMirrorH());
      expect(result.current.draft).toMatchObject({ mirrorH: true, mirrorV: false });

      act(() => result.current.toggleMirrorV());
      expect(result.current.draft).toMatchObject({ mirrorH: true, mirrorV: true });
    });

    it("hands the stage an orientation the overlay can read drags against", async () => {
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());
      act(() => result.current.toggleMirrorH());

      expect(result.current.orientation).toEqual({ rotate: 90, mirrorH: true, mirrorV: false });
    });

    it("swaps the output size under a quarter turn", async () => {
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());

      expect(result.current.outputWidth).toBe(1080);
      expect(result.current.outputHeight).toBe(1920);
    });

    it("brings the handles out when a shape is picked, and shapes the rectangle", async () => {
      const { result } = await renderReady();

      act(() => result.current.selectAspect("1:1"));

      expect(result.current.cropActive).toBe(true);
      expect(result.current.aspectId).toBe("1:1");
      // A square out of a 16:9 frame is 1080 wide, which is 0.5625 of 1920.
      expect(result.current.draft.crop.width).toBeCloseTo(0.5625);
    });

    it("keeps the rectangle when the lock is released", async () => {
      const { result } = await renderReady();

      act(() => result.current.selectAspect("1:1"));
      const shaped = result.current.draft.crop;
      act(() => result.current.selectAspect("free"));

      expect(result.current.aspectId).toBe("free");
      expect(result.current.aspectRatio).toBeNull();
      expect(result.current.draft.crop).toEqual(shaped);
    });
  });

  describe("seeding from what is on disk", () => {
    it("re-opens on the spec stored beside the file", async () => {
      fetchStateMock.mockResolvedValue({
        path: PHOTO,
        has_backup: true,
        spec: spec({ rotate: 180, mirror_v: true, scale: 0.5 }),
      });
      const { result } = await renderReady();

      await waitFor(() => expect(result.current.draft.rotate).toBe(180));
      expect(result.current.draft).toMatchObject({ mirrorV: true, scale: 0.5 });
      expect(result.current.hasBackup).toBe(true);
      // Already on disk, so there is nothing left to apply.
      expect(result.current.dirty).toBe(false);
    });

    it("restores the shape a stored crop was framed with", async () => {
      fetchStateMock.mockResolvedValue({
        path: PHOTO,
        has_backup: true,
        spec: spec({ crop: { x: 0.21875, y: 0, width: 0.5625, height: 1 } }),
      });
      const { result } = await renderReady();

      await waitFor(() => expect(result.current.aspectId).toBe("1:1"));
    });

    it("does not ask again for a file it is already showing", async () => {
      const { rerender, initial } = await renderReady();

      await waitFor(() => expect(fetchStateMock).toHaveBeenCalled());
      const calls = fetchStateMock.mock.calls.length;

      // A folder refresh hands back a new object for the same file.
      rerender({ ...initial, item: makeItem("sunset.png", { size: 999 }) });

      expect(fetchStateMock.mock.calls.length).toBe(calls);
    });

    it("stays quiet when there is nothing stored to read", async () => {
      fetchStateMock.mockRejectedValue(new Error("nope"));
      const { result } = await renderReady();

      await waitFor(() => expect(fetchStateMock).toHaveBeenCalled());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(result.current.draft.rotate).toBe(0);
    });

    it("asks for nothing at all while the mode is off", async () => {
      await renderReady({ editMode: false });

      expect(fetchStateMock).not.toHaveBeenCalled();
    });
  });

  describe("navigation", () => {
    it("drops the draft when the item changes", async () => {
      const { result, rerender, initial } = await renderReady();

      act(() => result.current.rotateClockwise());
      rerender({ ...initial, item: makeItem("beach.png") });

      expect(result.current.draft.rotate).toBe(0);
      expect(result.current.ready).toBe(false);
    });

    it("survives the listing learning about the backup it just made", async () => {
      // The apply flips `has_backup` when the folder reloads. The `<img>` is not reloaded
      // with it - it was already showing the original - so anything that reset on that
      // field would clear the frame size with nothing left to fire `load` again.
      const { result, rerender, initial } = await renderReady();

      act(() => result.current.rotateClockwise());
      rerender({ ...initial, item: makeItem("sunset.png", { has_backup: true }) });

      expect(result.current.ready).toBe(true);
      expect(result.current.draft.rotate).toBe(90);
      expect(result.current.hasBackup).toBe(true);
    });

    it("keeps the crop tool armed across a swap, the way the mode itself sticks", async () => {
      const { result, rerender, initial } = await renderReady();

      act(() => result.current.setCropActive(true));
      rerender({ ...initial, item: makeItem("beach.png") });

      expect(result.current.cropActive).toBe(true);
    });
  });

  describe("apply", () => {
    it("posts the drafted spec and stays in the mode", async () => {
      const { result, onEdited, setEditMode } = await renderReady();

      act(() => result.current.rotateClockwise());
      act(() => result.current.toggleMirrorH());
      await act(async () => result.current.apply());

      await waitFor(() => expect(applyMock).toHaveBeenCalled());
      expect(applyMock.mock.calls[0][0]).toBe(PHOTO);
      expect(applyMock.mock.calls[0][1]).toEqual(spec({ rotate: 90, mirror_h: true }));
      await waitFor(() => expect(onEdited).toHaveBeenCalled());
      expect(setEditMode).not.toHaveBeenCalled();
    });

    it("reloads the folder before it records what is now on disk", async () => {
      const order: string[] = [];
      applyMock.mockImplementation(async () => {
        order.push("api");
        return EDITED;
      });
      const onEdited = vi.fn(async () => {
        order.push("reloaded");
      });
      const { result } = await renderReady({ onEdited });

      act(() => result.current.rotateClockwise());
      await act(async () => result.current.apply());

      await waitFor(() => expect(order).toEqual(["api", "reloaded"]));
    });

    it("goes quiet once the draft matches what it just wrote", async () => {
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());
      expect(result.current.dirty).toBe(true);

      await act(async () => result.current.apply());
      await waitFor(() => expect(result.current.dirty).toBe(false));

      act(() => result.current.toggleMirrorV());
      expect(result.current.dirty).toBe(true);
    });

    it("reports what it wrote", async () => {
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());
      await act(async () => result.current.apply());

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Edited sunset.png - 1080 x 1920.",
      );
    });

    it("ignores a second click while the first render is still running", async () => {
      let release!: (value: ImageEditResponse) => void;
      applyMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());
      act(() => result.current.apply());
      act(() => result.current.apply());

      expect(applyMock).toHaveBeenCalledTimes(1);
      await act(async () => release(EDITED));
    });

    it("reports a failed render and stays in the mode", async () => {
      applyMock.mockRejectedValue(new Error("Truncated file"));
      const { result, setEditMode } = await renderReady();

      act(() => result.current.rotateClockwise());
      await act(async () => result.current.apply());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not edit sunset.png: Truncated file",
      );
      expect(setEditMode).not.toHaveBeenCalled();
      // Still unwritten, so Apply has to stay reachable.
      expect(result.current.dirty).toBe(true);
      expect(result.current.applying).toBe(false);
    });

    it("writes to the file it started on, even after navigating away", async () => {
      let release!: (value: ImageEditResponse) => void;
      applyMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const { result, rerender, initial } = await renderReady();

      act(() => result.current.rotateClockwise());
      act(() => result.current.apply());
      rerender({ ...initial, item: makeItem("beach.png") });

      expect(applyMock.mock.calls[0][0]).toBe(PHOTO);
      await act(async () => release(EDITED));
    });
  });

  describe("revert", () => {
    it("restores the original and forgets the spec", async () => {
      fetchStateMock.mockResolvedValue({
        path: PHOTO,
        has_backup: true,
        spec: spec({ rotate: 90 }),
      });
      const { result } = await renderReady();
      await waitFor(() => expect(result.current.draft.rotate).toBe(90));

      await act(async () => result.current.revert());

      await waitFor(() => expect(revertMock).toHaveBeenCalledWith(PHOTO));
      expect(result.current.draft.rotate).toBe(0);
      expect(result.current.hasBackup).toBe(false);
      expect(result.current.dirty).toBe(false);
    });

    it("puts the original back when every value is dialled to where it started", async () => {
      // An edited image has to be able to come back upright. Comparing against an
      // untouched source rather than against what is on disk left Apply permanently
      // disabled here, and the server refuses a spec that changes nothing in any case.
      fetchStateMock.mockResolvedValue({
        path: PHOTO,
        has_backup: true,
        spec: spec({ rotate: 90 }),
      });
      const { result } = await renderReady();
      await waitFor(() => expect(result.current.draft.rotate).toBe(90));

      act(() => result.current.rotateCounterClockwise());
      expect(result.current.dirty).toBe(true);

      await act(async () => result.current.apply());

      await waitFor(() => expect(revertMock).toHaveBeenCalledWith(PHOTO));
      expect(applyMock).not.toHaveBeenCalled();
    });

    it("reports a failed restore", async () => {
      revertMock.mockRejectedValue(new Error("No original is stored for this file"));
      const { result } = await renderReady();

      await act(async () => result.current.revert());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not edit sunset.png: No original is stored for this file",
      );
    });
  });

  describe("reset", () => {
    it("goes back to what is on disk, not to an untouched draft", async () => {
      fetchStateMock.mockResolvedValue({
        path: PHOTO,
        has_backup: true,
        spec: spec({ rotate: 180 }),
      });
      const { result } = await renderReady();
      await waitFor(() => expect(result.current.draft.rotate).toBe(180));

      act(() => result.current.toggleMirrorH());
      act(() => result.current.resetDraft());

      expect(result.current.draft).toMatchObject({ rotate: 180, mirrorH: false });
      expect(result.current.dirty).toBe(false);
    });

    it("goes back to nothing at all on a file that was never edited", async () => {
      const { result } = await renderReady();

      act(() => result.current.rotateClockwise());
      act(() => result.current.resetDraft());

      expect(result.current.draft.rotate).toBe(0);
    });
  });

  describe("without an item", () => {
    it("writes nothing when there is no file to write to", async () => {
      const { result } = renderEdit({ item: undefined as unknown as GalleryItem });

      act(() => result.current.apply());

      expect(applyMock).not.toHaveBeenCalled();
      expect(result.current.applying).toBe(false);
    });
  });
});
