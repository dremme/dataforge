import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { useStickyFloating } from "./useStickyFloating";

function mockRect(
  element: HTMLElement,
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height" | "x" | "y">,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("useStickyFloating", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("returns false while the sentinel is visible", async () => {
    const sentinel = document.createElement("div");
    const main = document.createElement("main");
    main.className = "main";
    main.append(sentinel);
    document.body.append(main);

    mockRect(main, {
      top: 100,
      bottom: 800,
      left: 0,
      right: 1000,
      width: 1000,
      height: 700,
      x: 0,
      y: 100,
    });
    mockRect(sentinel, {
      top: 150,
      bottom: 151,
      left: 0,
      right: 1000,
      width: 1000,
      height: 1,
      x: 0,
      y: 150,
    });

    const sentinelRef = createRef<HTMLDivElement>();
    sentinelRef.current = sentinel;

    const { result } = renderHook(() => useStickyFloating(sentinelRef));

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it("returns true after the sentinel scrolls out of view", async () => {
    const sentinel = document.createElement("div");
    const main = document.createElement("main");
    main.className = "main";
    main.append(sentinel);
    document.body.append(main);

    mockRect(main, {
      top: 100,
      bottom: 800,
      left: 0,
      right: 1000,
      width: 1000,
      height: 700,
      x: 0,
      y: 100,
    });
    mockRect(sentinel, {
      top: 90,
      bottom: 100,
      left: 0,
      right: 1000,
      width: 1000,
      height: 10,
      x: 0,
      y: 90,
    });

    const sentinelRef = createRef<HTMLDivElement>();
    sentinelRef.current = sentinel;

    const { result } = renderHook(() => useStickyFloating(sentinelRef));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});
