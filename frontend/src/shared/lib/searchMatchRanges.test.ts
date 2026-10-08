import { describe, expect, it } from "vitest";
import { findLiteralMatchRanges, findSearchMatchRanges } from "./searchMatchRanges";

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

  it("highlights nothing for an invalid regex, as the filter matches nothing", () => {
    expect(findSearchMatchRanges("land(scape photo", "land(scape", true)).toEqual([]);
  });
});

describe("findLiteralMatchRanges", () => {
  it("returns nothing without terms or text", () => {
    expect(findLiteralMatchRanges("Golden hour sunset", [])).toEqual([]);
    expect(findLiteralMatchRanges("", ["sunset"])).toEqual([]);
  });

  it("returns every term's matches sorted by position", () => {
    expect(
      findLiteralMatchRanges("a blue car on a wet street", ["wet street", "blue car"]),
    ).toEqual([
      { from: 2, to: 10 },
      { from: 16, to: 26 },
    ]);
  });

  it("merges overlapping matches from different terms", () => {
    expect(findLiteralMatchRanges("a blue car", ["blue car", "car"])).toEqual([
      { from: 2, to: 10 },
    ]);
  });

  it("skips a term the text does not contain", () => {
    expect(findLiteralMatchRanges("a red car", ["a blue car", "red"])).toEqual([
      { from: 2, to: 5 },
    ]);
  });

  it("treats regex metacharacters literally", () => {
    expect(findLiteralMatchRanges("shot at f/2.8 aperture", ["f/2.8"])).toEqual([
      { from: 8, to: 13 },
    ]);
  });
});
