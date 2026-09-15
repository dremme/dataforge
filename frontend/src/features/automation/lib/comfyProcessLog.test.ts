import { describe, expect, it } from "vitest";
import { shouldStickToBottom } from "./comfyProcessLog";

describe("shouldStickToBottom", () => {
  it("follows new output while the view sits at the bottom", () => {
    expect(shouldStickToBottom(760, 1000, 240)).toBe(true);
  });

  it("lets go once the reader scrolls up to read something", () => {
    expect(shouldStickToBottom(400, 1000, 240)).toBe(false);
  });

  it("re-pins within a pixel or two of the bottom", () => {
    // Sub-pixel scroll heights and browser zoom mean the exact figure is never reached.
    expect(shouldStickToBottom(754, 1000, 240)).toBe(true);
  });

  it("treats content shorter than the box as pinned", () => {
    expect(shouldStickToBottom(0, 100, 240)).toBe(true);
  });
});
