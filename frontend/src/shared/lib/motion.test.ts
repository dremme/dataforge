import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "./motion";

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduced && query.includes("prefers-reduced-motion") })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("motion", () => {
  it("scrolls smoothly by default", () => {
    stubReducedMotion(false);

    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("jumps instead of scrolling when the OS asks for less motion", () => {
    stubReducedMotion(true);

    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
  });
});
