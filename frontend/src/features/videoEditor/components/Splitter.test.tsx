import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Splitter } from "./Splitter";

function renderSplitter(orientation: "vertical" | "horizontal") {
  const onResize = vi.fn<(delta: number) => void>();
  const onReset = vi.fn<() => void>();
  render(
    <Splitter label="Panel size" orientation={orientation} onResize={onResize} onReset={onReset} />,
  );
  return { onResize, onReset, handle: screen.getByRole("separator", { name: "Panel size" }) };
}

describe("Splitter", () => {
  const capture = Element.prototype.setPointerCapture;
  beforeAll(() => {
    Element.prototype.setPointerCapture = () => undefined;
  });
  afterAll(() => {
    Element.prototype.setPointerCapture = capture;
  });

  it("reports how far it is dragged and stops when let go", () => {
    const { onResize, handle } = renderSplitter("vertical");

    fireEvent.pointerDown(handle, { clientX: 100 });
    expect(handle).toHaveClass("video-editor__splitter--dragging");
    fireEvent.pointerMove(handle, { clientX: 130 });
    fireEvent.pointerMove(handle, { clientX: 120 });
    fireEvent.pointerUp(handle);
    fireEvent.pointerMove(handle, { clientX: 200 });

    expect(onResize.mock.calls).toEqual([[30], [-10]]);
    expect(handle).not.toHaveClass("video-editor__splitter--dragging");
  });

  it("nudges with the arrows along its own axis, further with Shift", () => {
    const { onResize, handle } = renderSplitter("horizontal");

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });

    expect(onResize.mock.calls).toEqual([[-10], [40]]);
  });

  it("goes back to its starting size on a double-click", () => {
    const { onReset, handle } = renderSplitter("vertical");

    fireEvent.doubleClick(handle);

    expect(onReset).toHaveBeenCalled();
  });
});
