import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("rounds large values to whole gigabytes", () => {
    expect(formatBytes(32 * 1024 ** 3)).toBe("32 GB");
  });

  it("keeps one decimal for smaller values", () => {
    expect(formatBytes(8.5 * 1024 ** 3)).toBe("8.5 GB");
  });
});
