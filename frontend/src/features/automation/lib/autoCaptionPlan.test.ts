import { describe, expect, it } from "vitest";
import { autoCaptionPlan } from "./autoCaptionPlan";

const NONE = { total: 0, drafts: 0, from_scratch: 0, unreadable: 0, long_enough: 0 };

describe("autoCaptionPlan", () => {
  it("names a fresh dataset as captions to write, not a hidden prerequisite", () => {
    expect(autoCaptionPlan({ ...NONE, total: 4, from_scratch: 4 })).toBe(
      "4 captions to write from scratch.",
    );
  });

  it("separates drafts, new captions and what is left alone", () => {
    expect(
      autoCaptionPlan({ total: 7, drafts: 1, from_scratch: 2, long_enough: 3, unreadable: 1 }),
    ).toBe(
      "1 draft to expand, 2 captions to write from scratch. " +
        "Left alone: 3 captions already long enough, 1 unreadable caption.",
    );
  });

  it("says when there is nothing to do", () => {
    expect(autoCaptionPlan({ ...NONE, total: 2, long_enough: 2 })).toBe(
      "Nothing to caption. Left alone: 2 captions already long enough.",
    );
  });
});
