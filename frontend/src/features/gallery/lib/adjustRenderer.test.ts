import { describe, expect, it } from "vitest";
import {
  canZoom,
  definitionBase,
  viewRadius,
  zoomView,
  type RenderRequest,
} from "./adjustRenderer";

function request(overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    view: { x: 0, y: 0, width: 1, height: 1 },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    outputScale: 1,
    outputSize: { width: 4000, height: 3000 },
    detail: { noiseReduction: 0, definition: 0 },
    original: false,
    ...overrides,
  };
}

describe("definitionBase", () => {
  it("shrinks the short side to 256 and keeps the blur a fixed share of the frame", () => {
    expect(definitionBase({ width: 4000, height: 3000 })).toEqual({
      width: 341,
      height: 256,
      sigma: 3.84,
    });
  });

  it("never enlarges a frame that is already small", () => {
    expect(definitionBase({ width: 200, height: 128 })).toEqual({
      width: 200,
      height: 128,
      sigma: 1.92,
    });
  });
});

describe("viewRadius", () => {
  it("scales an output radius down to the pixels the canvas shows", () => {
    expect(viewRadius(4, 1000, request(), 4000)).toBe(1);
  });

  it("grows as the view zooms in and as the output shrinks", () => {
    const zoomed = request({ view: { x: 0, y: 0, width: 0.25, height: 0.25 } });
    expect(viewRadius(4, 1000, zoomed, 4000)).toBe(4);
    expect(viewRadius(4, 1000, request({ outputScale: 0.5 }), 4000)).toBe(2);
  });
});

describe("zoom", () => {
  it("zooms only when the frame has more pixels than the canvas", () => {
    expect(canZoom({ width: 800, height: 600 }, { width: 800, height: 600 })).toBe(false);
    expect(canZoom({ width: 800, height: 600 }, { width: 1600, height: 600 })).toBe(true);
  });

  it("shows one frame pixel per canvas pixel around the pointer", () => {
    const view = zoomView(
      { x: 1, y: 0.5 },
      { width: 800, height: 600 },
      { width: 1600, height: 2400 },
    );
    expect(view).toEqual({ x: 0.5, y: 0.375, width: 0.5, height: 0.25 });
  });
});
