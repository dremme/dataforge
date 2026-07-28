import { describe, expect, it } from "vitest";
import { findSearchMatchRanges } from "./searchMatchRanges";

describe("findSearchMatchRanges", () => {
  it("returns nothing for a blank query", () => {
    expect(findSearchMatchRanges("Golden hour sunset", "   ", false)).toEqual([]);
  });

  it("finds case-insensitive plain substrings", () => {
    expect(findSearchMatchRanges("Golden hour sunset", "SUN", false)).toEqual([
      { from: 12, to: 15 },
    ]);
  });

  it("finds every plain occurrence", () => {
    expect(findSearchMatchRanges("aa ba aa", "aa", false)).toEqual([
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ]);
  });

  it("matches with a regular expression", () => {
    expect(findSearchMatchRanges("cat and dog", "cat|dog", true)).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
  });

  it("falls back to plain substring for an invalid regex", () => {
    expect(findSearchMatchRanges("land(scape photo", "land(scape", true)).toEqual([
      { from: 0, to: 10 },
    ]);
  });
});
