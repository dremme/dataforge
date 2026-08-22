import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
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

/**
 * jsdom performs no layout, so the two measurements a placement rests on are
 * supplied by class: where the anchor sits, and how big the surface is.
 */
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
    const rect = stubLayout(ANCHOR, FLOATING);
    const { getByTestId } = render(<Fixture active placement="bottom-end" />);
    expect(getByTestId("floating").style.top).toBe("248px");

    rect.mockImplementation(function (this: Element) {
      return fakeRect(this.classList.contains("floating") ? FLOATING : { ...ANCHOR, top: 120 });
    });
    act(() => {
      fireEvent.scroll(document);
    });

    expect(getByTestId("floating").style.top).toBe("168px");
  });

  it("re-places the surface when the window resizes", () => {
    stubLayout({ ...ANCHOR, left: 700 }, FLOATING);
    const { getByTestId } = render(<Fixture active placement="bottom-end" />);
    expect(getByTestId("floating").style.left).toBe("600px");

    vi.spyOn(window, "innerWidth", "get").mockReturnValue(600);
    act(() => {
      fireEvent.resize(window);
    });

    expect(getByTestId("floating").style.left).toBe("384px");
  });

  it("stops listening once the surface goes away", () => {
    stubLayout(ANCHOR, FLOATING);
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<Fixture active placement="bottom-end" />);

    unmount();

    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), { capture: true });
  });
});
