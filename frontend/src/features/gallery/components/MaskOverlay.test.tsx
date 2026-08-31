import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaskOverlay } from "./MaskOverlay";
import { newMaskDraft, type MaskDraft } from "@/features/gallery/lib/mask";

const SOURCE = { width: 1920, height: 1080 };
/** The painted box: jsdom has no layout, so the elements report what a test needs. */
const BOX = { width: 800, height: 450 };
const OFFSET = { left: 60, top: 20 };

function mediaRefWithBox(tag: "img" | "video" = "img") {
  // jsdom lays nothing out, so the element is told where it sits and how big it is.
  const host = document.createElement("div");
  const media = document.createElement(tag);
  host.appendChild(media);
  document.body.appendChild(host);

  const define = (key: string, value: unknown) =>
    Object.defineProperty(media, key, { value, configurable: true });

  define("offsetParent", host);
  define("offsetLeft", OFFSET.left);
  define("offsetTop", OFFSET.top);
  define("offsetWidth", BOX.width);
  define("offsetHeight", BOX.height);

  const ref = createRef<HTMLImageElement | HTMLVideoElement>();
  (ref as { current: HTMLElement }).current = media;
  return ref;
}

function maskAt(rect: MaskDraft["rect"], overrides: Partial<MaskDraft> = {}): MaskDraft {
  return { ...newMaskDraft("blur", 0.12, 0), rect, ...overrides };
}

const FIRST = maskAt({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
const SECOND = maskAt({ x: 0.05, y: 0.05, width: 0.1, height: 0.1 }, { mode: "pixelate" });

type Props = Parameters<typeof MaskOverlay>[0];

function maskProps(overrides: Partial<Props> = {}): Props {
  return {
    mediaRef: mediaRefWithBox(),
    src: "/api/media?path=photo.png&original=1",
    masks: [FIRST],
    selectedId: FIRST.id,
    sourceWidth: SOURCE.width,
    sourceHeight: SOURCE.height,
    disabled: false,
    interactive: true,
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
}

function renderOverlay(overrides: Partial<Props> = {}) {
  const props: Props = {
    mediaRef: mediaRefWithBox(),
    src: "/api/media?path=photo.png&original=1",
    masks: [FIRST],
    selectedId: FIRST.id,
    sourceWidth: SOURCE.width,
    sourceHeight: SOURCE.height,
    disabled: false,
    interactive: true,
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };

  render(<MaskOverlay {...props} />);
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
  // Real capture semantics: without them a move on a handle also runs the rectangle's handler.
  const captured = new Set<Element>();
  Element.prototype.setPointerCapture = vi.fn(function (this: Element) {
    captured.clear();
    captured.add(this);
  });
  Element.prototype.releasePointerCapture = vi.fn(function (this: Element) {
    captured.delete(this);
  });
  Element.prototype.hasPointerCapture = vi.fn(function (this: Element) {
    return captured.has(this);
  });
});

describe("MaskOverlay", () => {
  it("paints one region for each rectangle", () => {
    renderOverlay({ masks: [FIRST, SECOND], selectedId: null });

    expect(document.querySelectorAll(".mask-overlay__region")).toHaveLength(2);
  });

  it("names a region after the mode it is set to", () => {
    renderOverlay({ masks: [FIRST, SECOND], selectedId: null });

    expect(screen.getByRole("button", { name: "Blur region 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pixelate region 2" })).toBeInTheDocument();
  });

  it("sits over the painted frame, not over the box it is positioned in", () => {
    renderOverlay();

    expect(screen.getByRole("group", { name: "Blur regions" })).toHaveStyle({
      left: `${OFFSET.left}px`,
      top: `${OFFSET.top}px`,
      width: `${BOX.width}px`,
      height: `${BOX.height}px`,
    });
  });

  it("places each region by fraction of that frame", () => {
    renderOverlay();

    expect(document.querySelector(".mask-overlay__region")).toHaveStyle({
      "--mask-x": "25%",
      "--mask-y": "25%",
      "--mask-w": "50%",
      "--mask-h": "50%",
    });
  });

  it("gives handles to the selected region only", () => {
    renderOverlay({ masks: [FIRST, SECOND], selectedId: FIRST.id });

    expect(
      screen.getByRole("button", { name: "Blur region 1 bottom-right corner" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pixelate region 2 bottom-right corner" }),
    ).not.toBeInTheDocument();
  });

  it("shows the selected region's size in source pixels", () => {
    renderOverlay();

    expect(screen.getByText(/960 × 540/)).toBeInTheDocument();
  });

  it("selects a region when it is pressed", () => {
    const props = renderOverlay({ masks: [FIRST, SECOND], selectedId: FIRST.id });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Pixelate region 2" }), {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });

    expect(props.onSelect).toHaveBeenCalledWith(SECOND.id);
  });

  it("moves the whole rectangle when its surface is dragged", () => {
    const props = renderOverlay();

    // 80px across an 800px box is a tenth of the frame.
    drag(screen.getByRole("button", { name: "Blur region 1" }), 80, 0);

    const [maskId, rect] = vi.mocked(props.onChange).mock.calls[0];
    expect(maskId).toBe(FIRST.id);
    expect(rect.x).toBeCloseTo(0.35);
    expect(rect.width).toBeCloseTo(0.5);
  });

  it("keeps up with a drag that outruns rendering", () => {
    // Pointer events arrive faster than React commits, so every move still sees the first rect.
    const props = renderOverlay();
    const surface = screen.getByRole("button", { name: "Blur region 1" });

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 140, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 180, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    // 80px across an 800px box is a tenth of the frame, however many moves it took.
    const calls = vi.mocked(props.onChange).mock.calls;
    expect(calls[calls.length - 1][1].x).toBeCloseTo(0.35);
  });

  it("keeps a handle under the pointer across the same run of moves", () => {
    const props = renderOverlay();
    const handle = screen.getByRole("button", { name: "Blur region 1 bottom-right corner" });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 180, clientY: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    const calls = vi.mocked(props.onChange).mock.calls;
    expect(calls[calls.length - 1][1].width).toBeCloseTo(0.6);
  });

  it("resizes from a handle", () => {
    const props = renderOverlay();

    drag(screen.getByRole("button", { name: "Blur region 1 bottom-right corner" }), 80, 45);

    const [, rect] = vi.mocked(props.onChange).mock.calls[0];
    expect(rect.width).toBeCloseTo(0.6);
    expect(rect.height).toBeCloseTo(0.6);
  });

  it("lets a region go far smaller than a crop may", () => {
    const props = renderOverlay({
      masks: [SECOND],
      selectedId: SECOND.id,
    });

    // A crop would stop at 5% of the frame; a face needs less.
    drag(screen.getByRole("button", { name: "Pixelate region 1 bottom-right corner" }), -70, 0);

    const [, rect] = vi.mocked(props.onChange).mock.calls[0];
    expect(rect.width).toBeCloseTo(0.0125);
  });

  it("nudges the rectangle from the keyboard", () => {
    const props = renderOverlay();

    fireEvent.keyDown(screen.getByRole("button", { name: "Blur region 1" }), { key: "ArrowRight" });

    const [, rect] = vi.mocked(props.onChange).mock.calls[0];
    expect(rect.x).toBeCloseTo(0.26);
  });

  it("removes the region on Delete", () => {
    const props = renderOverlay();

    fireEvent.keyDown(screen.getByRole("button", { name: "Blur region 1" }), { key: "Delete" });

    expect(props.onRemove).toHaveBeenCalledWith(FIRST.id);
  });

  it("drops the selection when the picture is pressed beside every region", () => {
    const props = renderOverlay();

    fireEvent.pointerDown(screen.getByRole("group", { name: "Blur regions" }), {
      pointerId: 1,
      clientX: 700,
      clientY: 400,
    });

    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("keeps the selection when a region itself is pressed", () => {
    const props = renderOverlay();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Blur region 1" }), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    expect(props.onSelect).not.toHaveBeenCalledWith(null);
  });

  it("keeps the selection long enough for the remove button to fire", () => {
    // Deselecting on the way down would unmount the button before its click landed.
    const props = renderOverlay();
    const remove = screen.getByRole("button", { name: "Remove blur region 1" });

    fireEvent.pointerDown(remove, { pointerId: 1, clientX: 100, clientY: 100 });

    expect(props.onSelect).not.toHaveBeenCalledWith(null);
  });

  it("removes the region from its own button", () => {
    const props = renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: "Remove blur region 1" }));

    expect(props.onRemove).toHaveBeenCalledWith(FIRST.id);
  });

  it("keeps the rectangle and its handles reachable by pointer and arrow keys", () => {
    // tabIndex -1, not disabled: a click still focuses them, so a nudge lands on the right one.
    const props = renderOverlay();
    const surface = screen.getByRole("button", { name: "Blur region 1" });

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(surface).toHaveFocus();

    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(props.onChange).toHaveBeenCalled();
  });

  it("shows the picture as Apply would write it when another tool holds the stage", () => {
    renderOverlay({ interactive: false });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelectorAll(".mask-overlay__fill")).toHaveLength(1);
  });

  it("keeps the selection to itself while another tool holds the stage", () => {
    renderOverlay({ interactive: false });

    expect(document.querySelector(".mask-overlay__region--selected")).toBeNull();
  });

  it("refuses to drag while other work is in flight", () => {
    const props = renderOverlay({ disabled: true });

    drag(screen.getByRole("button", { name: "Blur region 1" }), 80, 0);

    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("renders nothing until the frame has been measured", () => {
    const ref = createRef<HTMLImageElement>();
    render(
      <MaskOverlay
        mediaRef={ref}
        src="photo.png"
        masks={[FIRST]}
        selectedId={null}
        sourceWidth={0}
        sourceHeight={0}
        disabled={false}
        interactive
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.queryByRole("group", { name: "Blur regions" })).not.toBeInTheDocument();
  });

  it("reads a rightward drag as downward when the preview is turned clockwise", () => {
    const props = renderOverlay({ orientation: { rotate: 90, mirrorH: false, mirrorV: false } });

    drag(screen.getByRole("button", { name: "Blur region 1" }), 80, 0);

    const [, rect] = vi.mocked(props.onChange).mock.calls[0];
    expect(rect.x).toBeCloseTo(0.25);
    expect(rect.y).toBeCloseTo(0.25 - 80 / BOX.height);
  });

  /** A paint attempt is observable: paintMask sizes the bitmap before it asks for a context. */
  function paintedSizes() {
    return [...document.querySelectorAll<HTMLCanvasElement>(".mask-overlay__fill")].map(
      (c) => c.width,
    );
  }

  function readyVideo(ref: ReturnType<typeof mediaRefWithBox>, readyState: number) {
    const video = ref.current as HTMLVideoElement;
    Object.defineProperty(video, "readyState", { value: readyState, configurable: true });
    Object.defineProperty(video, "videoWidth", { value: SOURCE.width, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: SOURCE.height, configurable: true });
    return video;
  }

  it("paints as soon as a video that was not ready at mount decodes a frame", () => {
    const mediaRef = mediaRefWithBox("video");
    readyVideo(mediaRef, 1);

    renderOverlay({ mediaRef });
    expect(paintedSizes()).toEqual([300]);

    readyVideo(mediaRef, 4);
    fireEvent(mediaRef.current!, new Event("loadeddata"));

    expect(paintedSizes()[0]).not.toBe(300);
  });

  it("paints at mount when the video already had a frame", () => {
    const mediaRef = mediaRefWithBox("video");
    readyVideo(mediaRef, 4);

    renderOverlay({ mediaRef });

    expect(paintedSizes()[0]).not.toBe(300);
  });

  it("lays regions over a video the same way it does over a picture", () => {
    renderOverlay({ mediaRef: mediaRefWithBox("video"), masks: [FIRST, SECOND], selectedId: null });

    expect(document.querySelectorAll(".mask-overlay__region")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Blur regions" })).toHaveStyle({
      width: `${BOX.width}px`,
    });
  });

  it("repaints from presented frames, so a paused video still shows its first one", () => {
    // readyState says the data arrived, not that the picture can be drawn; a paused video that
    // has finished loading fires nothing further, so a frame callback is the only trigger left.
    const mediaRef = mediaRefWithBox("video");
    const video = readyVideo(mediaRef, 4);
    let onFrame: (() => void) | null = null;
    const cancelled: number[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: (callback: () => void) => {
        onFrame = callback;
        return 7;
      },
      configurable: true,
    });
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      value: (handle: number) => cancelled.push(handle),
      configurable: true,
    });

    const view = render(<MaskOverlay {...maskProps({ mediaRef })} />);
    expect(onFrame).not.toBeNull();

    // The canvas is cleared, standing in for a draw that produced no picture.
    const canvas = document.querySelector<HTMLCanvasElement>(".mask-overlay__fill")!;
    canvas.width = 300;
    onFrame!();
    expect(canvas.width).not.toBe(300);

    view.unmount();
    expect(cancelled).toEqual([7]);
  });

  it("repaints a playing video per frame, and stops when it stops", () => {
    const mediaRef = mediaRefWithBox("video");
    const video = mediaRef.current as HTMLVideoElement;
    const frames = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const cancels = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    // jsdom decodes nothing, so `paused` is told what a playing element would report.
    Object.defineProperty(video, "paused", { value: false, configurable: true });

    renderOverlay({ mediaRef });

    expect(frames).toHaveBeenCalled();

    fireEvent.pause(video);
    expect(cancels).toHaveBeenCalled();

    frames.mockRestore();
    cancels.mockRestore();
  });

  it("leaves a picture without a frame loop to run", () => {
    const frames = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    renderOverlay();

    expect(frames).not.toHaveBeenCalled();
    frames.mockRestore();
  });

  it("hands the readout the inverse transform so it stays upright", () => {
    renderOverlay({ orientation: { rotate: 90, mirrorH: true, mirrorV: false } });

    expect(screen.getByRole("group", { name: "Blur regions" })).toHaveStyle({
      "--mask-readout-transform": "rotate(-90deg) scaleX(-1) scaleY(1)",
    });
  });
});
