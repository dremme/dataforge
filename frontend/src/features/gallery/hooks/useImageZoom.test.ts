import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  IMAGE_ZOOM_SCALE,
  effectiveZoomScale,
  originFromPointer,
  useImageZoom,
  zoomCanvasLayout,
} from "./useImageZoom";

describe("originFromPointer", () => {
  it("maps pointer position to percent origin within the box", () => {
    const rect = {
      left: 100,
      top: 50,
      width: 200,
      height: 100,
      right: 300,
      bottom: 150,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect;

    expect(originFromPointer(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(originFromPointer(200, 100, rect)).toEqual({ x: 50, y: 50 });
    expect(originFromPointer(300, 150, rect)).toEqual({ x: 100, y: 100 });
  });

  it("clamps values outside the box", () => {
    const rect = {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    expect(originFromPointer(-20, 150, rect)).toEqual({ x: 0, y: 100 });
  });
});

describe("effectiveZoomScale", () => {
  it("caps zoom so painting stays within source pixels", () => {
    expect(
      effectiveZoomScale(2.5, { width: 400, height: 300 }, { width: 4000, height: 3000 }),
    ).toBe(2.5);
    expect(effectiveZoomScale(2.5, { width: 400, height: 300 }, { width: 480, height: 360 })).toBe(
      1.2,
    );
  });
});

describe("zoomCanvasLayout", () => {
  it("sizes the canvas and pans from the pointer origin within image bounds", () => {
    const topLeft = zoomCanvasLayout({ width: 100, height: 80 }, { x: 0, y: 0 }, 2);
    expect(topLeft.width).toBe(200);
    expect(topLeft.height).toBe(160);
    expect(topLeft.translateX).toBeCloseTo(0);
    expect(topLeft.translateY).toBeCloseTo(0);

    const bottomRight = zoomCanvasLayout({ width: 100, height: 80 }, { x: 100, y: 100 }, 2);
    expect(bottomRight).toEqual({
      width: 200,
      height: 160,
      translateX: -100,
      translateY: -80,
    });
    // Far edge: scaled image bottom-right aligns with viewport bottom-right.
    expect(bottomRight.translateX + bottomRight.width).toBeCloseTo(100);
    expect(bottomRight.translateY + bottomRight.height).toBeCloseTo(80);

    expect(zoomCanvasLayout({ width: 100, height: 80 }, { x: 50, y: 50 }, 2)).toEqual({
      width: 200,
      height: 160,
      translateX: -50,
      translateY: -40,
    });
  });
});

describe("useImageZoom", () => {
  it("zooms in on click using layout size and pans while zoomed", () => {
    const { result } = renderHook(() => useImageZoom("photo.png"));

    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      result.current.recordNaturalSize(1000, 1000);
    });

    act(() => {
      result.current.handleClick({
        preventDefault: () => {},
        currentTarget: element,
        clientX: 25,
        clientY: 75,
        target: element,
      } as unknown as React.MouseEvent<HTMLElement>);
    });

    expect(result.current.zoomed).toBe(true);
    expect(result.current.origin).toEqual({ x: 25, y: 75 });
    expect(result.current.containerStyle).toEqual({ width: 100, height: 100 });
    expect(result.current.canvasStyle).toEqual({
      width: 100 * IMAGE_ZOOM_SCALE,
      height: 100 * IMAGE_ZOOM_SCALE,
      transform: `translate(${-((100 * IMAGE_ZOOM_SCALE - 100) * 25) / 100}px, ${-((100 * IMAGE_ZOOM_SCALE - 100) * 75) / 100}px)`,
    });

    act(() => {
      result.current.handleMouseMove({
        currentTarget: element,
        clientX: 80,
        clientY: 20,
      } as unknown as React.MouseEvent<HTMLElement>);
    });

    expect(result.current.origin).toEqual({ x: 80, y: 20 });
    expect(result.current.canvasStyle?.transform).toBe(
      `translate(${-((100 * IMAGE_ZOOM_SCALE - 100) * 80) / 100}px, ${-((100 * IMAGE_ZOOM_SCALE - 100) * 20) / 100}px)`,
    );
  });

  it("zooms out on a second click", () => {
    const { result } = renderHook(() => useImageZoom("photo.png"));
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      result.current.recordNaturalSize(1000, 1000);
    });
    act(() => {
      result.current.handleClick({
        preventDefault: () => {},
        currentTarget: element,
        clientX: 50,
        clientY: 50,
        target: element,
      } as unknown as React.MouseEvent<HTMLElement>);
    });
    act(() => {
      result.current.handleClick({
        preventDefault: () => {},
        currentTarget: element,
        clientX: 50,
        clientY: 50,
        target: element,
      } as unknown as React.MouseEvent<HTMLElement>);
    });

    expect(result.current.zoomed).toBe(false);
    expect(result.current.canvasStyle).toBeUndefined();
    expect(result.current.containerStyle).toBeUndefined();
  });

  it("resets zoom when the image key changes", () => {
    const { result, rerender } = renderHook(({ key }) => useImageZoom(key), {
      initialProps: { key: "a.png" },
    });
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      result.current.recordNaturalSize(1000, 1000);
    });
    act(() => {
      result.current.handleClick({
        preventDefault: () => {},
        currentTarget: element,
        clientX: 10,
        clientY: 10,
        target: element,
      } as unknown as React.MouseEvent<HTMLElement>);
    });
    expect(result.current.zoomed).toBe(true);

    rerender({ key: "b.png" });
    expect(result.current.zoomed).toBe(false);
  });
});
