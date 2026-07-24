import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as scrollRoot from "../gallery/scrollRoot";
import { GALLERY_BACK_TO_TOP_THRESHOLD_PX, useGalleryBackToTop } from "./useGalleryBackToTop";

describe("useGalleryBackToTop", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hides the button until the scroll root passes the threshold", () => {
    const scrollElement = document.createElement("main");
    scrollElement.className = "main";
    Object.defineProperty(scrollElement, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(scrollElement);

    const { result } = renderHook(() => useGalleryBackToTop(scrollElement));

    expect(result.current.visible).toBe(false);

    act(() => {
      Object.defineProperty(scrollElement, "scrollTop", {
        value: GALLERY_BACK_TO_TOP_THRESHOLD_PX + 1,
        writable: true,
        configurable: true,
      });
      scrollElement.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.visible).toBe(true);
  });

  it("scrolls the main container to the top", () => {
    const scrollElement = document.createElement("main");
    scrollElement.className = "main";
    document.body.appendChild(scrollElement);

    const scrollContainerToTop = vi
      .spyOn(scrollRoot, "scrollContainerToTop")
      .mockReturnValue(() => {});

    const { result } = renderHook(() => useGalleryBackToTop(scrollElement));

    act(() => {
      result.current.scrollToTop();
    });

    expect(scrollContainerToTop).toHaveBeenCalledWith(scrollElement);
  });

  it("resets visibility when the scroll element is removed", () => {
    const scrollElement = document.createElement("main");
    scrollElement.className = "main";
    Object.defineProperty(scrollElement, "scrollTop", {
      value: GALLERY_BACK_TO_TOP_THRESHOLD_PX + 50,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(scrollElement);

    const { result, rerender } = renderHook(
      ({ element }: { element: HTMLElement | null }) => useGalleryBackToTop(element),
      { initialProps: { element: scrollElement as HTMLElement | null } },
    );

    act(() => {
      scrollElement.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.visible).toBe(true);

    rerender({ element: null });

    expect(result.current.visible).toBe(false);
  });
});
