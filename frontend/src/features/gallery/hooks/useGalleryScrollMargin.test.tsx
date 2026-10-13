import { useRef } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGalleryScrollMargin } from "./useGalleryScrollMargin";

function List({ columns }: { columns: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  const { scrollMargin } = useGalleryScrollMargin(listRef, [columns]);
  return (
    <main>
      <div ref={listRef} data-margin={scrollMargin} />
    </main>
  );
}

describe("useGalleryScrollMargin", () => {
  const Native = window.ResizeObserver;
  afterEach(() => {
    window.ResizeObserver = Native;
  });

  it("remeasures when its inputs change without starting a new observer", () => {
    const observers: string[] = [];
    window.ResizeObserver = class extends Native {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        observers.push("created");
      }
    };
    const top = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const { container, rerender } = render(<List columns={3} />);
    const list = () => container.querySelector("[data-margin]") as HTMLElement;

    expect(list().dataset.margin).toBe("0");

    top.mockImplementation(function (this: HTMLElement) {
      return { top: this.tagName === "MAIN" ? 20 : 120 } as DOMRect;
    });
    rerender(<List columns={4} />);

    expect(list().dataset.margin).toBe("100");
    // A new observer created mid-resize is what browsers report as an undelivered loop.
    expect(observers).toHaveLength(1);
    top.mockRestore();
  });
});
