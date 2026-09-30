import { StrictMode } from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdjustCanvas } from "./AdjustCanvas";
import { IDENTITY_CROP } from "@/features/gallery/lib/crop";
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

function preview(overrides: Partial<ColorAdjustControls> = {}) {
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
        crop={IDENTITY_CROP}
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

describe("AdjustCanvas", () => {
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
});
