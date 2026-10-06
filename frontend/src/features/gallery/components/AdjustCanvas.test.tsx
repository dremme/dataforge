import { StrictMode } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustCanvas } from "./AdjustCanvas";
import { IDENTITY_CROP, type CropRect } from "@/features/gallery/lib/crop";
import { makeAdjustControls } from "@/test/colorAdjustControls";
import { RESTING_ADJUST } from "@/features/gallery/lib/colorAdjust";
import type { ColorAdjustControls } from "@/features/gallery/hooks/useColorAdjust";
import type * as RendererModule from "@/features/gallery/lib/adjustRenderer";

const gpu = vi.hoisted(() => ({
  create: vi.fn(),
  renderer: {
    hasSource: true,
    floatTargets: true,
    setSource: vi.fn(),
    setLut: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("@/features/gallery/lib/adjustRenderer", async (importOriginal) => ({
  ...(await importOriginal<typeof RendererModule>()),
  AdjustRenderer: { create: gpu.create },
}));
vi.mock("@/features/gallery/hooks/usePaintedBox", () => ({
  usePaintedBox: () => ({ left: 0, top: 0, width: 320, height: 180 }),
}));

function preview(overrides: Partial<ColorAdjustControls> = {}, crop: CropRect = IDENTITY_CROP) {
  const video = document.createElement("video");
  Object.defineProperties(video, {
    videoWidth: { value: 640 },
    videoHeight: { value: 360 },
    readyState: { value: 2 },
  });
  const controls = makeAdjustControls({ active: true, ...overrides });
  const onPictureChange = vi.fn();
  const onShowingChange = vi.fn();
  const view = render(
    <StrictMode>
      <AdjustCanvas
        mediaRef={{ current: video }}
        sourceWidth={640}
        sourceHeight={360}
        crop={crop}
        scale={1}
        controls={controls}
        onPictureChange={onPictureChange}
        onShowingChange={onShowingChange}
      />
    </StrictMode>,
  );
  return {
    ...view,
    video,
    controls,
    onPictureChange,
    onShowingChange,
    canvas: view.container.querySelector("canvas")!,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  gpu.renderer.floatTargets = true;
  gpu.create.mockReturnValue(gpu.renderer);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdjustCanvas", () => {
  it("keeps its renderer and published picture when playback switches to another decoder", () => {
    const view = preview();
    const next = document.createElement("video");
    Object.defineProperties(next, {
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
      readyState: { value: 2 },
    });
    const picture = view.onPictureChange.mock.calls.at(-1)![0];
    const creations = gpu.create.mock.calls.length;
    const disposals = gpu.renderer.dispose.mock.calls.length;
    gpu.renderer.setSource.mockClear();
    view.rerender(
      <StrictMode>
        <AdjustCanvas
          mediaRef={{ current: next }}
          sourceWidth={640}
          sourceHeight={360}
          crop={IDENTITY_CROP}
          scale={1}
          controls={view.controls}
          onPictureChange={view.onPictureChange}
          onShowingChange={view.onShowingChange}
        />
      </StrictMode>,
    );
    expect(gpu.renderer.setSource).toHaveBeenCalledWith(next, 640, 360, true);
    expect(gpu.create).toHaveBeenCalledTimes(creations);
    expect(gpu.renderer.dispose).toHaveBeenCalledTimes(disposals);
    expect(view.onPictureChange.mock.calls.at(-1)![0]).toBe(picture);
    gpu.renderer.setSource.mockClear();
    fireEvent.seeked(view.video);
    expect(gpu.renderer.setSource).not.toHaveBeenCalled();
    fireEvent.seeked(next);
    expect(gpu.renderer.setSource).toHaveBeenCalledWith(next, 640, 360, true);
  });

  it("uploads an already paused video and later seeks without waiting for playback", () => {
    const { video, unmount } = preview();
    expect(gpu.renderer.setSource).toHaveBeenCalledWith(video, 640, 360, true);
    gpu.renderer.setSource.mockClear();
    fireEvent.seeked(video);
    expect(gpu.renderer.setSource).toHaveBeenCalledWith(video, 640, 360, true);
    unmount();
    expect(gpu.renderer.dispose).toHaveBeenCalledTimes(2);
  });

  it("shows the original when WebGL is unavailable", () => {
    gpu.create.mockReturnValue(null);
    const { canvas, controls, onShowingChange, onPictureChange } = preview();
    expect(canvas).toHaveAttribute("hidden");
    expect(controls.setPreviewAvailable).toHaveBeenLastCalledWith(false);
    expect(onShowingChange).toHaveBeenLastCalledWith(false);
    expect(onPictureChange).toHaveBeenLastCalledWith(null);
  });

  it("does not pretend to preview noise reduction without floating point render targets", () => {
    gpu.renderer.floatTargets = false;
    const { canvas, controls } = preview({ values: { ...RESTING_ADJUST, noise_reduction: 0.5 } });
    expect(canvas).toHaveAttribute("hidden");
    expect(controls.setPreviewAvailable).toHaveBeenLastCalledWith(false);
  });

  it("uncovers the original on context loss and rebuilds after restoration", () => {
    const { canvas, controls, onShowingChange } = preview();
    fireEvent(canvas, new Event("webglcontextlost", { cancelable: true }));
    expect(canvas).toHaveAttribute("hidden");
    expect(onShowingChange).toHaveBeenLastCalledWith(false);
    expect(controls.setPreviewAvailable).toHaveBeenLastCalledWith(false);
    fireEvent(canvas, new Event("webglcontextrestored"));
    expect(canvas).not.toHaveAttribute("hidden");
    expect(controls.setPreviewAvailable).toHaveBeenLastCalledWith(true);
    expect(gpu.create).toHaveBeenCalledTimes(3);
  });

  it("paints an image that finishes loading after the preview mounted", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 640, height: 360, close: vi.fn() })),
    );
    const image = document.createElement("img");
    let loaded = false;
    Object.defineProperties(image, {
      complete: { get: () => loaded },
      naturalWidth: { get: () => (loaded ? 640 : 0) },
    });
    render(
      <StrictMode>
        <AdjustCanvas
          mediaRef={{ current: image }}
          sourceWidth={640}
          sourceHeight={360}
          crop={IDENTITY_CROP}
          scale={1}
          controls={makeAdjustControls({ active: true })}
        />
      </StrictMode>,
    );

    loaded = true;
    fireEvent.load(image);

    await waitFor(() => expect(gpu.renderer.render).toHaveBeenCalled());
  });

  it("zooms a cropped frame to one output pixel per canvas pixel of the whole frame", () => {
    // The stage shows the whole frame while editing; the crop is only an overlay on it.
    const crop = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
    const { canvas, unmount } = preview({}, crop);
    expect(canvas).toHaveClass("adjust-canvas--inspectable");
    unmount();

    gpu.renderer.render.mockClear();
    preview({ zoomed: true }, crop);
    expect(gpu.renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({ view: expect.objectContaining({ width: 0.5, height: 0.5 }) }),
    );
  });
});
