import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it } from "vitest";
import {
  IMAGE_ZOOM_SCALE,
  containedRect,
  measureZoomGeometry,
  originFromPointer,
  useImageZoom,
  zoomTranslate,
  type ZoomGeometry,
} from "./useImageZoom";

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    left: x,
    top: y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    x,
    y,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A viewport > canvas > img tree with fixed boxes, like `ZoomableImage` renders. */
function zoomTree({
  viewport,
  img = viewport,
  natural = { width: 1000, height: 1000 },
  offsetWidth = 0,
}: {
  viewport: DOMRect;
  img?: DOMRect;
  natural?: { width: number; height: number };
  offsetWidth?: number;
}) {
  const root = document.createElement("div");
  const canvas = document.createElement("div");
  canvas.className = "zoomable-image__canvas";
  const image = document.createElement("img");
  image.style.objectFit = "contain";
  Object.defineProperty(image, "naturalWidth", { value: natural.width });
  Object.defineProperty(image, "naturalHeight", { value: natural.height });
  Object.defineProperty(root, "offsetWidth", { value: offsetWidth });
  root.getBoundingClientRect = () => viewport;
  canvas.getBoundingClientRect = () => img;
  image.getBoundingClientRect = () => img;
  canvas.append(image);
  root.append(canvas);
  return root;
}

function click(element: HTMLElement, clientX: number, clientY: number) {
  return {
    preventDefault: () => {},
    currentTarget: element,
    target: element,
    clientX,
    clientY,
  } as unknown as ReactMouseEvent<HTMLElement>;
}

/** Where the transformed content lands, relative to the viewport. */
function zoomedContent(geometry: ZoomGeometry, origin: { x: number; y: number }, scale: number) {
  const { x, y } = zoomTranslate(geometry, origin, scale);
  const { canvas, content } = geometry;
  return {
    left: canvas.x + x + (content.x - canvas.x) * scale,
    top: canvas.y + y + (content.y - canvas.y) * scale,
    width: content.width * scale,
    height: content.height * scale,
  };
}

describe("originFromPointer", () => {
  it("maps pointer position to percent origin within the box", () => {
    const rect = domRect(100, 50, 200, 100);

    expect(originFromPointer(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(originFromPointer(200, 100, rect)).toEqual({ x: 50, y: 50 });
    expect(originFromPointer(300, 150, rect)).toEqual({ x: 100, y: 100 });
  });

  it("clamps values outside the box", () => {
    expect(originFromPointer(-20, 150, domRect(0, 0, 100, 100))).toEqual({ x: 0, y: 100 });
  });
});

describe("containedRect", () => {
  it("letterboxes the painted image inside a wider box", () => {
    expect(containedRect({ x: 0, y: 0, width: 800, height: 300 }, 400, 300)).toEqual({
      x: 200,
      y: 0,
      width: 400,
      height: 300,
    });
  });
});

describe("zoomTranslate", () => {
  // A 4:3 image letterboxed in a wide viewport: the zoomed box must stay 4:3.
  const letterboxed: ZoomGeometry = {
    viewport: { width: 800, height: 300 },
    canvas: { x: 0, y: 0, width: 800, height: 300 },
    content: { x: 200, y: 0, width: 400, height: 300 },
  };

  it("pans the overflowing axis edge to edge with the pointer", () => {
    const start = zoomedContent(letterboxed, { x: 0, y: 0 }, 2.5);
    expect(start).toMatchObject({ left: 0, top: 0, width: 1000, height: 750 });

    const end = zoomedContent(letterboxed, { x: 100, y: 100 }, 2.5);
    expect(end.left + end.width).toBeCloseTo(800);
    expect(end.top + end.height).toBeCloseTo(300);
  });

  it("centres an axis that still fits after zooming", () => {
    const tall: ZoomGeometry = {
      viewport: { width: 400, height: 1000 },
      canvas: { x: 0, y: 0, width: 400, height: 1000 },
      content: { x: 0, y: 450, width: 400, height: 100 },
    };

    for (const y of [0, 100]) {
      const zoomed = zoomedContent(tall, { x: 50, y }, 2);
      expect(zoomed.top).toBeCloseTo(400);
      expect(zoomed.height).toBe(200);
    }
  });
});

describe("measureZoomGeometry", () => {
  it("measures the painted image, not its letterboxed element", () => {
    const root = zoomTree({
      viewport: domRect(10, 20, 800, 300),
      natural: { width: 640, height: 480 },
    });

    expect(measureZoomGeometry(root)).toEqual({
      viewport: { width: 800, height: 300 },
      canvas: { x: 0, y: 0, width: 800, height: 300 },
      content: { x: 200, y: 0, width: 400, height: 300 },
    });
  });

  it("converts visually scaled rects into CSS pixels", () => {
    const root = zoomTree({ viewport: domRect(0, 0, 50, 50), offsetWidth: 100 });

    expect(measureZoomGeometry(root)?.viewport).toEqual({ width: 100, height: 100 });
    expect(measureZoomGeometry(root)?.content).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("useImageZoom", () => {
  it("zooms with a uniform scale and pans while zoomed", () => {
    const { result } = renderHook(() => useImageZoom("photo.png"));
    const element = zoomTree({ viewport: domRect(0, 0, 100, 100) });

    act(() => {
      result.current.handleClick(click(element, 0, 0));
    });

    expect(result.current.zoomed).toBe(true);
    expect(result.current.canvasStyle).toEqual({
      transform: `translate(0px, 0px) scale(${IMAGE_ZOOM_SCALE})`,
    });

    act(() => {
      result.current.handleMouseMove(click(element, 100, 100));
    });

    const overflow = 100 * IMAGE_ZOOM_SCALE - 100;
    expect(result.current.canvasStyle?.transform).toBe(
      `translate(${-overflow}px, ${-overflow}px) scale(${IMAGE_ZOOM_SCALE})`,
    );
  });

  it("zooms an image already shown above its native size", () => {
    const { result } = renderHook(() => useImageZoom("small.png"));
    const element = zoomTree({
      viewport: domRect(0, 0, 400, 400),
      natural: { width: 100, height: 100 },
    });

    act(() => {
      result.current.handleClick(click(element, 200, 200));
    });

    expect(result.current.canvasStyle?.transform).toContain(`scale(${IMAGE_ZOOM_SCALE})`);
  });

  it("zooms out on a second click", () => {
    const { result } = renderHook(() => useImageZoom("photo.png"));
    const element = zoomTree({ viewport: domRect(0, 0, 100, 100) });

    act(() => {
      result.current.handleClick(click(element, 50, 50));
    });
    act(() => {
      result.current.handleClick(click(element, 50, 50));
    });

    expect(result.current.zoomed).toBe(false);
    expect(result.current.canvasStyle).toBeUndefined();
  });

  it("resets zoom when the image key changes", () => {
    const { result, rerender } = renderHook(({ key }) => useImageZoom(key), {
      initialProps: { key: "a.png" },
    });
    const element = zoomTree({ viewport: domRect(0, 0, 100, 100) });

    act(() => {
      result.current.handleClick(click(element, 10, 10));
    });
    expect(result.current.zoomed).toBe(true);

    rerender({ key: "b.png" });
    expect(result.current.zoomed).toBe(false);
  });
});
