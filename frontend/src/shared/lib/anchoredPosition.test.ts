import { describe, expect, it } from "vitest";
import {
  computeAnchoredPosition,
  type AnchoredPlacement,
  type AnchoredPositionInput,
} from "./anchoredPosition";

const BASE: AnchoredPositionInput = {
  anchor: { top: 300, left: 400, width: 100, height: 40 },
  floating: { width: 200, height: 120 },
  viewport: { width: 1000, height: 800 },
  placement: "bottom-start",
  offset: 8,
  gutter: 16,
  flip: true,
};

const place = (overrides: Partial<AnchoredPositionInput> = {}) =>
  computeAnchoredPosition({ ...BASE, ...overrides });

const at = (placement: AnchoredPlacement, overrides: Partial<AnchoredPositionInput> = {}) =>
  place({ placement, ...overrides });

describe("computeAnchoredPosition placement", () => {
  it("hangs a bottom side below the anchor, near edges aligned", () => {
    expect(at("bottom-start")).toMatchObject({ top: 348, left: 400, side: "bottom", shift: 0 });
  });

  it("aligns far edges for -end", () => {
    expect(at("bottom-end")).toMatchObject({ top: 348, left: 300 });
  });

  it("centres on the anchor for -center", () => {
    expect(at("bottom-center")).toMatchObject({ top: 348, left: 350 });
  });

  it("stacks a top side above the anchor by its own height", () => {
    expect(at("top-start")).toMatchObject({ top: 172, left: 400, side: "top" });
  });

  it("puts a right side beside the anchor and aligns down the vertical axis", () => {
    expect(at("right-start")).toMatchObject({ left: 508, top: 300, side: "right" });
    expect(at("right-end")).toMatchObject({ left: 508, top: 220 });
    expect(at("right-center")).toMatchObject({ left: 508, top: 260 });
  });

  it("puts a left side beside the anchor by its own width", () => {
    expect(at("left-start")).toMatchObject({ left: 192, top: 300, side: "left" });
  });

  it("reports no size cap while the element fits", () => {
    const result = at("bottom-start");
    expect(result.maxHeight).toBeUndefined();
    expect(result.maxWidth).toBeUndefined();
  });
});

describe("computeAnchoredPosition flip", () => {
  const nearBottom = { anchor: { top: 700, left: 400, width: 100, height: 40 } };

  it("flips to the opposite side when the preferred one cannot hold it", () => {
    expect(at("bottom-start", nearBottom)).toMatchObject({ side: "top", top: 572 });
  });

  it("shrinks in place instead when flipping is off", () => {
    expect(at("bottom-start", { ...nearBottom, flip: false })).toMatchObject({
      side: "bottom",
      top: 748,
      maxHeight: 36,
    });
  });

  it("stays put when the opposite side is no roomier", () => {
    const cramped = {
      anchor: { top: 130, left: 400, width: 100, height: 40 },
      viewport: { width: 1000, height: 300 },
    };
    expect(at("bottom-start", cramped)).toMatchObject({ side: "bottom", maxHeight: 106 });
  });

  it("flips sideways on the horizontal axis too", () => {
    expect(
      at("right-start", { anchor: { top: 300, left: 900, width: 40, height: 40 } }),
    ).toMatchObject({ side: "left", left: 692 });
  });
});

describe("computeAnchoredPosition shift", () => {
  it("nudges a surface back inside the window and reports how far", () => {
    const result = at("bottom-center", {
      anchor: { top: 300, left: 950, width: 40, height: 40 },
    });
    expect(result).toMatchObject({ left: 784, shift: -86 });
  });

  it("shifts down the vertical axis for a side placement", () => {
    const result = at("right-start", {
      anchor: { top: 750, left: 400, width: 100, height: 40 },
    });
    expect(result).toMatchObject({ top: 664, shift: -86 });
  });
});

describe("computeAnchoredPosition size caps", () => {
  it("caps the cross axis to the window and reports the cap", () => {
    expect(at("bottom-start", { floating: { width: 2000, height: 120 } })).toMatchObject({
      maxWidth: 968,
      left: 16,
    });
  });

  it("caps the main axis to the room the chosen side leaves", () => {
    expect(
      at("bottom-start", { floating: { width: 200, height: 5000 }, flip: false }),
    ).toMatchObject({ maxHeight: 436 });
  });
});
