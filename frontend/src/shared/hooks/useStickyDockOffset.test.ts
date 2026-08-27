import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { STICKY_DOCK_OFFSET_PROPERTY, useStickyDockOffset } from "./useStickyDockOffset";

// setup.ts ResizeObserver never fires; this only covers the initial measurement.
function setup({ withScrollRoot = true } = {}) {
  const element = document.createElement("section");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 96,
    left: 0,
    right: 1000,
    width: 1000,
    height: 96,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const main = document.createElement("main");
  if (withScrollRoot) main.className = "main";
  main.append(element);
  document.body.append(main);

  const elementRef = createRef<HTMLElement>();
  elementRef.current = element;

  return { elementRef, main };
}

describe("useStickyDockOffset", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("publishes the measured height on the scroll root", () => {
    const { elementRef, main } = setup();

    renderHook(() => useStickyDockOffset(elementRef));

    expect(main.style.getPropertyValue(STICKY_DOCK_OFFSET_PROPERTY)).toBe("96px");
  });

  it("clears the property when the measured element unmounts", () => {
    const { elementRef, main } = setup();

    const { unmount } = renderHook(() => useStickyDockOffset(elementRef));
    unmount();

    expect(main.style.getPropertyValue(STICKY_DOCK_OFFSET_PROPERTY)).toBe("");
  });

  it("does nothing without a scroll root", () => {
    const { elementRef, main } = setup({ withScrollRoot: false });

    expect(() => renderHook(() => useStickyDockOffset(elementRef))).not.toThrow();
    expect(main.style.getPropertyValue(STICKY_DOCK_OFFSET_PROPERTY)).toBe("");
  });
});
