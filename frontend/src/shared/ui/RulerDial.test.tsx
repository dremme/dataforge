import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RulerDial, DIAL_PIXELS_PER_STEP } from "./RulerDial";

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

  it("scrubs the ruler and stops on pointer cancellation", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const { slider, onChange } = dial({ value: 0.5 });
    slider.setPointerCapture = vi.fn();
    slider.hasPointerCapture = vi.fn(() => true);
    fireEvent.pointerDown(slider, { button: 0, clientX: 100 });
    fireEvent.pointerMove(slider, { clientX: 100 + 10 * DIAL_PIXELS_PER_STEP });
    expect(onChange).toHaveBeenLastCalledWith(0.4);
    expect(slider).toHaveFocus();
    fireEvent.pointerCancel(slider);
    onChange.mockClear();
    fireEvent.pointerMove(slider, { clientX: 140 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
