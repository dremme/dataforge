import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoCropOverlay } from "./VideoCropOverlay";
import { IDENTITY_CROP, type CropRect } from "@/features/gallery/lib/videoEdit";

const SOURCE = { width: 1920, height: 1080 };
/** The painted box: jsdom has no layout, so the element reports what a test needs. */
const BOX = { width: 800, height: 450 };

function videoRefWithBox() {
  const video = document.createElement("video");
  Object.defineProperty(video, "clientWidth", { value: BOX.width, configurable: true });
  Object.defineProperty(video, "clientHeight", { value: BOX.height, configurable: true });
  document.body.appendChild(video);

  const ref = createRef<HTMLVideoElement>();
  (ref as { current: HTMLVideoElement }).current = video;
  return ref;
}

type Props = Parameters<typeof VideoCropOverlay>[0];

function renderOverlay(overrides: Partial<Props> = {}) {
  const props: Props = {
    videoRef: videoRefWithBox(),
    crop: IDENTITY_CROP,
    sourceWidth: SOURCE.width,
    sourceHeight: SOURCE.height,
    aspectRatio: null,
    disabled: false,
    onCropChange: vi.fn(),
    ...overrides,
  };

  render(<VideoCropOverlay {...props} />);
  return props;
}

function drag(element: Element, dx: number, dy: number) {
  fireEvent.pointerDown(element, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  fireEvent.pointerUp(element, { pointerId: 1 });
}

/**
 * jsdom ships neither `PointerEvent` nor the pointer capture API. Without the class,
 * Testing Library falls back to a bare `Event` and the coordinates never arrive, so a
 * drag reads as `NaN` rather than as a distance.
 */
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", PointerEventPolyfill);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
});

describe("VideoCropOverlay", () => {
  it("labels every handle", () => {
    renderOverlay();

    expect(screen.getByRole("button", { name: "Crop top-left corner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crop bottom-right corner" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("shows the output size in source pixels, not painted ones", () => {
    renderOverlay({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } });

    expect(screen.getByText("960 x 540")).toBeInTheDocument();
  });

  it("turns a corner drag into a fraction of the painted frame", () => {
    const crop: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const props = renderOverlay({ crop });

    // 80px across an 800px box is a tenth of the frame.
    drag(screen.getByRole("button", { name: "Crop bottom-right corner" }), 80, 45);

    const next = vi.mocked(props.onCropChange).mock.calls[0][0];
    expect(next.width).toBeCloseTo(0.6);
    expect(next.height).toBeCloseTo(0.6);
  });

  it("nudges a handle by a fixed step from the keyboard", () => {
    const props = renderOverlay({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });

    fireEvent.keyDown(screen.getByRole("button", { name: "Crop right edge" }), {
      key: "ArrowRight",
    });

    const next = vi.mocked(props.onCropChange).mock.calls[0][0];
    expect(next.width).toBeCloseTo(0.51);
  });

  it("nudges further with Shift held", () => {
    const props = renderOverlay({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });

    fireEvent.keyDown(screen.getByRole("button", { name: "Crop right edge" }), {
      key: "ArrowRight",
      shiftKey: true,
    });

    const next = vi.mocked(props.onCropChange).mock.calls[0][0];
    expect(next.width).toBeCloseTo(0.55);
  });

  it("moves the whole rectangle when the interior is dragged", () => {
    const crop: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const props = renderOverlay({ crop });

    drag(document.querySelector(".video-crop-overlay__rect")!, 80, 0);

    const next = vi.mocked(props.onCropChange).mock.calls[0][0];
    expect(next.x).toBeCloseTo(0.35);
    expect(next.width).toBeCloseTo(0.5);
  });

  it("offers only the corners under an aspect lock", () => {
    renderOverlay({ aspectRatio: 1 });

    expect(screen.getByRole("button", { name: "Crop top-left corner" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Crop right edge" })).toBeDisabled();
  });

  it("positions the scrims to cover everything the crop leaves out", () => {
    renderOverlay({ crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });

    const overlay = screen.getByRole("group", { name: "Crop region" });
    expect(overlay).toHaveStyle({
      "--crop-x": "25%",
      "--crop-y": "25%",
      "--crop-w": "50%",
      "--crop-h": "50%",
    });
  });

  it("renders nothing until the frame has been measured", () => {
    const ref = createRef<HTMLVideoElement>();
    render(
      <VideoCropOverlay
        videoRef={ref}
        crop={IDENTITY_CROP}
        sourceWidth={0}
        sourceHeight={0}
        aspectRatio={null}
        disabled={false}
        onCropChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("group", { name: "Crop region" })).not.toBeInTheDocument();
  });

  it("refuses to drag while other work is in flight", () => {
    const props = renderOverlay({ disabled: true });

    drag(document.querySelector(".video-crop-overlay__rect")!, 80, 0);

    expect(props.onCropChange).not.toHaveBeenCalled();
  });
});
