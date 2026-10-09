import { describe, expect, it } from "vitest";
import { fittedSize } from "./sizeFit";

type Case = [[number, number], number, number, boolean, [number, number] | null];

// Same table as backend/test_size_fit.py: both ports must land on the same sizes.
const CASES: Case[] = [
  [[3840, 2160], 2, 32, false, [1920, 1088]],
  [[2048, 1536], 2, 32, false, [1664, 1248]],
  [[3840, 2160], 2, 8, false, [1928, 1088]],
  [[2160, 3840], 2, 32, false, [1088, 1920]],
  [[1920, 1080], 2, 32, false, [1920, 1056]],
  [[1000, 1000], 4, 64, false, [960, 960]],
  [[1919, 1081], 64, 1, false, [1919, 1081]],
  [[1919, 1081], 64, 1, true, [1918, 1080]],
  [[1920, 1080], 1, 5, true, [1370, 770]],
  [[1000, 20], 1, 32, false, null],
];

describe("fittedSize", () => {
  it.each(CASES)(
    "%j at %s MP on a %s px grid (even: %s)",
    (size, megapixels, multiple, even, expected) => {
      const result = fittedSize(
        { width: size[0], height: size[1] },
        { megapixels, multiple },
        even,
      );

      expect(result && [result.width, result.height]).toEqual(expected);
    },
  );
});
