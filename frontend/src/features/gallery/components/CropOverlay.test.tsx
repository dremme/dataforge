import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CropOverlay } from "./CropOverlay";
import { IDENTITY_CROP, type CropRect, type Orientation } from "@/features/gallery/lib/crop";

const SOURCE = { width: 1920, height: 1080 };
/** The painted box: jsdom has no layout, so the elements report what a test needs. */
const BOX = { width: 800, height: 450 };
/** Where the media sits inside its host, which pads it in and centres it. */
const VIDEO_OFFSET = { left: 60, top: 20 };

function mediaRefWithBox(tag: "video" | "img" = "video") {
  // jsdom lays nothing out, so the element is told where it sits and how big it is.
  const host = document.createElement("div");
  const media = document.createElement(tag);
  host.appendChild(media);
  document.body.appendChild(host);

  const define = (key: string, value: unknown) =>
    Object.defineProperty(media, key, { value, configurable: true });

  define("offsetParent", host);
  define("offsetLeft", VIDEO_OFFSET.left);
  define("offsetTop", VIDEO_OFFSET.top);
  define("offsetWidth", BOX.width);
  define("offsetHeight", BOX.height);

  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement }).current = media;
  return ref;
}

type Props = Parameters<typeof CropOverlay>[0];

function renderOverlay(overrides: Partial<Props> = {}) {
  const props: Props = {
    mediaRef: mediaRefWithBox(),
    crop: IDENTITY_CROP,
    sourceWidth: SOURCE.width,
    sourceHeight: SOURCE.height,
    aspectRatio: null,
    disabled: false,
    onCropChange: vi.fn(),
    ...overrides,
  };

  render(<CropOverlay {...props} />);
  return props;
}

function drag(element: Element, dx: number, dy: number) {
  fireEvent.pointerDown(element, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  fireEvent.pointerUp(element, { pointerId: 1 });
}

/** jsdom has neither PointerEvent nor pointer capture; without this a drag reads as NaN. */
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

describe("CropOverlay", () => {
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

  it("sits over the painted frame, not over the box it is positioned in", () => {
    // Offset by host padding; layout offsets, not a client rect, so no transform scales it twice.
    renderOverlay();

    const overlay = screen.getByRole("group", { name: "Crop region" });
    expect(overlay).toHaveStyle({
      left: `${VIDEO_OFFSET.left}px`,
      top: `${VIDEO_OFFSET.top}px`,
      width: `${BOX.width}px`,
      height: `${BOX.height}px`,
    });
  });

  it("adds the letterbox bars to that offset", () => {
    // A 1:1 source in a 16:9 element paints a 450-wide column, centred.
    renderOverlay({ sourceWidth: 1080, sourceHeight: 1080 });

    const overlay = screen.getByRole("group", { name: "Crop region" });
    expect(overlay).toHaveStyle({
      left: `${VIDEO_OFFSET.left + (BOX.width - BOX.height) / 2}px`,
      top: `${VIDEO_OFFSET.top}px`,
      width: `${BOX.height}px`,
    });
  });

  it("takes focus on pointerdown, which the drag guard would otherwise suppress", () => {
    // Unfocused, the arrow keys fall through to the modal and navigate the gallery.
    renderOverlay();
    const handle = screen.getByRole("button", { name: "Crop bottom-right corner" });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });

    expect(handle).toHaveFocus();
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

    drag(document.querySelector(".crop-overlay__rect")!, 80, 0);

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
    const ref = createRef<HTMLElement>();
    render(
      <CropOverlay
        mediaRef={ref}
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

    drag(document.querySelector(".crop-overlay__rect")!, 80, 0);

    expect(props.onCropChange).not.toHaveBeenCalled();
  });

  describe("on a turned preview", () => {
    // Overlay rides the host transform; these cover mapping a drag back into the crop frame.
    const turned = (overrides: Partial<Orientation>): Orientation => ({
      rotate: 0,
      mirrorH: false,
      mirrorV: false,
      ...overrides,
    });

    it("reads a rightward drag as downward when the preview is turned clockwise", () => {
      const crop: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
      const props = renderOverlay({ crop, orientation: turned({ rotate: 90 }) });

      // Screen-right, on a frame whose top now faces right, is the source's up - so the
      // bottom edge comes in, and the 80px is measured across the box's *height*.
      drag(screen.getByRole("button", { name: "Crop bottom-right corner" }), 80, 0);

      const next = vi.mocked(props.onCropChange).mock.calls[0][0];
      expect(next.width).toBeCloseTo(0.5);
      expect(next.height).toBeCloseTo(0.5 - 80 / BOX.height);
    });

    it("reads a rightward drag backwards on a mirrored preview", () => {
      const crop: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
      const props = renderOverlay({ crop, orientation: turned({ mirrorH: true }) });

      drag(screen.getByRole("button", { name: "Crop right edge" }), 80, 0);

      const next = vi.mocked(props.onCropChange).mock.calls[0][0];
      expect(next.width).toBeCloseTo(0.4);
    });

    it("maps an arrow key the same way a drag is mapped", () => {
      // The arrows point at the screen too, so a nudge that skipped the mapping would
      // move the rectangle at right angles to the key that was pressed.
      const props = renderOverlay({
        crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        orientation: turned({ rotate: 90 }),
      });

      fireEvent.keyDown(screen.getByRole("button", { name: "Crop bottom-right corner" }), {
        key: "ArrowRight",
      });

      const next = vi.mocked(props.onCropChange).mock.calls[0][0];
      expect(next.width).toBeCloseTo(0.5);
      expect(next.height).toBeCloseTo(0.49);
    });

    it("hands the readout the inverse transform so it stays upright", () => {
      renderOverlay({ orientation: turned({ rotate: 90, mirrorH: true }) });

      expect(screen.getByRole("group", { name: "Crop region" })).toHaveStyle({
        "--crop-readout-transform": "rotate(-90deg) scaleX(-1) scaleY(1)",
      });
    });

    it("leaves an upright preview without a transform to undo", () => {
      renderOverlay();

      expect(screen.getByRole("group", { name: "Crop region" })).toHaveStyle({
        "--crop-readout-transform": "rotate(0deg) scaleX(1) scaleY(1)",
      });
    });
  });
});
