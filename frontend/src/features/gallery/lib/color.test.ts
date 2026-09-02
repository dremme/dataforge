import { describe, expect, it } from "vitest";
import { colorMatrix, feColorMatrixValues, isColorIdentity, formatWarmth } from "./color";
import { emptyDraft, type ImageEditDraft } from "./imageEdit";

function draft(overrides: Partial<ImageEditDraft> = {}): ImageEditDraft {
  return { ...emptyDraft(), ...overrides };
}

describe("colorMatrix", () => {
  it("matches the worked example the backend asserts too", () => {
    const matrix = colorMatrix(
      draft({ brightness: 1.2, contrast: 0.9, saturation: 1.3, warmth: 0.5, hue: 45 }),
    );

    const expected = [
      0.887188238, -0.646119437, 0.832623555, 12.675535, 0.181137464, 1.186195672, -0.250340389,
      13.18672, -0.823323811, 0.801695265, 0.964121481, 11.126653,
    ];
    matrix.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 4));
  });

  it("flattens the channel mix at zero saturation, which is what grey means", () => {
    const [r0, r1, r2] = colorMatrix(draft({ saturation: 0 }));

    // Every row becomes the luma weights, so R, G and B all land on the same value.
    expect([r0, r1, r2]).toEqual([0.213, 0.715, 0.072]);
  });

  it("lays the feColorMatrix values out as four rows with an identity alpha row", () => {
    const values = feColorMatrixValues(draft()).split(" ").map(Number);

    expect(values).toHaveLength(20);
    // Identity color: the RGB rows are the identity with zero offset, alpha passes through.
    expect(values.slice(0, 5)).toEqual([1, 0, 0, 0, 0]);
    expect(values.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });
});

describe("isColorIdentity", () => {
  it("holds for an untouched draft", () => {
    expect(isColorIdentity(draft())).toBe(true);
  });

  it.each([
    ["brightness", { brightness: 1.1 }],
    ["contrast", { contrast: 0.9 }],
    ["saturation", { saturation: 1.2 }],
    ["warmth", { warmth: 0.3 }],
    ["hue", { hue: 20 }],
  ])("breaks on %s", (_label, overrides) => {
    expect(isColorIdentity(draft(overrides))).toBe(false);
  });
});

describe("formatWarmth", () => {
  it("signs the direction and keeps the same width either way", () => {
    expect(formatWarmth(0)).toBe("0");
    expect(formatWarmth(0.5)).toBe("+50");
    expect(formatWarmth(-0.5)).toBe("-50");
  });
});
