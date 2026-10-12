import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AnchoredPlacement } from "@/shared/lib/anchoredPosition";
import { useAnchoredPosition } from "./useAnchoredPosition";

function fakeRect(partial: Partial<DOMRect>): DOMRect {
  const { top = 0, left = 0, width = 0, height = 0 } = partial;
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** jsdom has no layout; supply the anchor rect and surface size. */
function stubLayout(anchor: Partial<DOMRect>, floating: Partial<DOMRect>) {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    return fakeRect(this.classList.contains("floating") ? floating : anchor);
  });
}

function Fixture({ active, placement }: { active: boolean; placement?: AnchoredPlacement }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);

  useAnchoredPosition(anchorRef, floatingRef, active, { placement, gutter: 16, offset: 8 });

  return (
    <>
      <div ref={anchorRef} className="anchor" />
      <div ref={floatingRef} className="floating" data-testid="floating" />
    </>
  );
}

const ANCHOR = { top: 200, left: 400, width: 100, height: 40 };
const FLOATING = { width: 200, height: 120 };

describe("useAnchoredPosition", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("places the surface against its anchor and names the side it chose", () => {
    stubLayout(ANCHOR, FLOATING);
    const { getByTestId } = render(<Fixture active placement="bottom-end" />);

    const floating = getByTestId("floating");
    expect(floating.style.left).toBe("300px");
    expect(floating.style.top).toBe("248px");
    expect(floating.dataset.side).toBe("bottom");
  });

  it("writes nothing while inactive", () => {
    stubLayout(ANCHOR, FLOATING);
    const { getByTestId } = render(<Fixture active={false} />);

    expect(getByTestId("floating").style.left).toBe("");
  });

  it("caps the surface to the room its side leaves", () => {
    stubLayout({ ...ANCHOR, top: 700 }, FLOATING);
    const { getByTestId } = render(<Fixture active placement="bottom-end" />);

    const floating = getByTestId("floating");
    // No room below, so it goes above rather than shrinking into 36px.
    expect(floating.dataset.side).toBe("top");
    expect(floating.style.maxHeight).toBe("");
  });

  it("follows its anchor when the page scrolls beneath it", () => {
    vi.useFakeTimers();
    const rect = stubLayout(ANCHOR, FLOATING);
    const { getByTestId } = render(<Fixture active placement="bottom-end" />);
    expect(getByTestId("floating").style.top).toBe("248px");

    rect.mockImplementation(function (this: Element) {
      return fakeRect(this.classList.contains("floating") ? FLOATING : { ...ANCHOR, top: 120 });
    });
    act(() => {
      fireEvent.scroll(document);
      vi.advanceTimersToNextFrame();
    });

    expect(getByTestId("floating").style.top).toBe("168px");
  });

  it("re-places the surface when the window resizes", () => {
    vi.useFakeTimers();
    stubLayout({ ...ANCHOR, left: 700 }, FLOATING);
    const { getByTestId } = render(<Fixture active placement="bottom-end" />);
    expect(getByTestId("floating").style.left).toBe("600px");

    vi.spyOn(window, "innerWidth", "get").mockReturnValue(600);
    act(() => {
      fireEvent.resize(window);
      vi.advanceTimersToNextFrame();
    });

    expect(getByTestId("floating").style.left).toBe("384px");
  });

  it("measures a burst of scroll events once, on the next frame", () => {
    vi.useFakeTimers();
    const rect = stubLayout(ANCHOR, FLOATING);
    render(<Fixture active placement="bottom-end" />);
    rect.mockClear();

    act(() => {
      fireEvent.scroll(document);
      fireEvent.scroll(document);
      fireEvent.scroll(document);
    });
    expect(rect).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    // One placement reads the anchor and the surface once each.
    expect(rect).toHaveBeenCalledTimes(2);
  });

  it("drops a frame still pending when the surface goes away", () => {
    vi.useFakeTimers();
    const rect = stubLayout(ANCHOR, FLOATING);
    const { rerender } = render(<Fixture active placement="bottom-end" />);

    act(() => {
      fireEvent.scroll(document);
    });
    rerender(<Fixture active={false} placement="bottom-end" />);
    rect.mockClear();
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(rect).not.toHaveBeenCalled();
  });

  it("stops listening once the surface goes away", () => {
    stubLayout(ANCHOR, FLOATING);
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<Fixture active placement="bottom-end" />);

    unmount();

    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), { capture: true });
  });
});
