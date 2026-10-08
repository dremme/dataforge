import { describe, expect, it } from "vitest";
import { toolbarNeedsCompact } from "./toolbarCompact";

const row = { row: 1000, stats: 200, actions: 400, labels: 220, controls: 360, gap: 10 };

describe("toolbarNeedsCompact", () => {
  it("keeps the labels while stats, actions and controls share the row", () => {
    expect(toolbarNeedsCompact(row, false)).toBe(false);
  });

  it("drops them once the controls grow past the row", () => {
    expect(toolbarNeedsCompact({ ...row, controls: 400 }, false)).toBe(true);
  });

  it("judges a compact row by its full labels, so it cannot flip back and forth", () => {
    const compacted = { ...row, actions: 180, controls: 400 };

    expect(toolbarNeedsCompact(compacted, true)).toBe(true);
    expect(toolbarNeedsCompact({ ...compacted, controls: 360 }, true)).toBe(false);
  });

  it("leaves out stats that sit on a row of their own", () => {
    expect(toolbarNeedsCompact({ ...row, stats: 0, controls: 580 }, false)).toBe(false);
  });
});
