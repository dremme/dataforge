import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RulerDial } from "./RulerDial";

function dial(overrides: Partial<Parameters<typeof RulerDial>[0]> = {}) {
  const onChange = vi.fn<(value: number) => void>();
  const props = {
    label: "Exposure",
    value: 0,
    min: -1,
    max: 1,
    step: 0.01,
    format: String,
    ...overrides,
    onChange,
  };
  render(<RulerDial {...props} />);
  return { ...props, slider: screen.getByRole("slider") };
}

describe("RulerDial", () => {
  it.each([
    ["ArrowRight", false, 0.01],
    ["ArrowLeft", false, -0.01],
    ["ArrowUp", true, 0.1],
    ["PageDown", false, -0.1],
    ["Home", false, -1],
    ["End", false, 1],
  ])("handles %s with shift=%s", (key, shiftKey, expected) => {
    const { slider, onChange } = dial();
    fireEvent.keyDown(slider, { key, shiftKey });
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it("rounds step values without floating point noise", () => {
    const { slider, onChange } = dial({ value: 0.28 });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(0.29);
  });

  it("clamps at the limits without emitting another change", () => {
    const { slider, onChange } = dial({ value: 1 });
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resets to the tool's resting value on double click", () => {
    const { slider, onChange } = dial({ value: 0.8, rest: 0.5 });
    fireEvent.doubleClick(slider);
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("ignores keyboard, wheel and reset while disabled", () => {
    const { slider, onChange } = dial({ disabled: true, value: 0.5 });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.wheel(slider, { deltaY: 1 });
    fireEvent.doubleClick(slider);
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute("aria-disabled", "true");
  });

  describe("dragging", () => {
    // The track runs from x=100 to x=300, so one pixel is one step of a -1..1 dial.
    function draggable(overrides: Partial<Parameters<typeof RulerDial>[0]> = {}) {
      vi.stubGlobal("PointerEvent", MouseEvent);
      const props = dial(overrides);
      const track = props.slider.querySelector(".ruler-dial__track") as HTMLElement;
      track.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;
      props.slider.setPointerCapture = vi.fn();
      props.slider.hasPointerCapture = vi.fn(() => true);
      return props;
    }

    it("jumps to where the track is pressed and follows the pointer", () => {
      const { slider, onChange } = draggable();
      fireEvent.pointerDown(slider, { button: 0, clientX: 250 });
      expect(onChange).toHaveBeenLastCalledWith(0.5);
      expect(slider).toHaveFocus();
      fireEvent.pointerMove(slider, { clientX: 120 });
      expect(onChange).toHaveBeenLastCalledWith(-0.8);
    });

    it("drags the knob from where it was grabbed, without a jump", () => {
      const { slider, onChange } = draggable({ value: 0.5 });
      fireEvent.pointerDown(slider, { button: 0, clientX: 254 });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.pointerMove(slider, { clientX: 264 });
      expect(onChange).toHaveBeenLastCalledWith(0.6);
    });

    it("settles on the resting value near it", () => {
      const { slider, onChange } = draggable({ value: 0.5 });
      fireEvent.pointerDown(slider, { button: 0, clientX: 201 });
      expect(onChange).toHaveBeenLastCalledWith(0);
    });

    it("stops following once the pointer is cancelled", () => {
      const { slider, onChange } = draggable();
      fireEvent.pointerDown(slider, { button: 0, clientX: 250 });
      fireEvent.pointerCancel(slider);
      onChange.mockClear();
      fireEvent.pointerMove(slider, { clientX: 140 });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it("fills from the resting value to the knob, or from the origin when given", () => {
    const { slider } = dial({ value: -0.5 });
    expect(slider.style.getPropertyValue("--dial-fill-start")).toBe("25%");
    expect(slider.style.getPropertyValue("--dial-fill-end")).toBe("50%");
    expect(slider.style.getPropertyValue("--dial-value")).toBe("25%");
  });

  it("measures an amount from its origin rather than its resting value", () => {
    const { slider } = dial({ value: 0.3, min: 0, max: 1, rest: 0.5, origin: 0 });
    expect(slider.style.getPropertyValue("--dial-fill-start")).toBe("0%");
    expect(slider.style.getPropertyValue("--dial-fill-end")).toBe("30%");
    expect(slider.querySelector(".ruler-dial__tick--rest")).toHaveStyle({ left: "50%" });
  });
});
