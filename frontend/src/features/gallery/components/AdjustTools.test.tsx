import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AdjustTools } from "./AdjustTools";
import { RESTING_ADJUST } from "@/features/gallery/lib/colorAdjust";
import { makeAdjustControls } from "@/test/colorAdjustControls";

describe("AdjustTools", () => {
  it("selects tools with arrows and uses each tool's range", async () => {
    const user = userEvent.setup();
    const controls = makeAdjustControls();
    render(<AdjustTools controls={controls} disabled={false} />);
    const exposure = screen.getByRole("tab", { name: "Exposure" });
    exposure.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Brilliance" })).toHaveFocus();
    expect(screen.getByRole("slider", { name: "Brilliance" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Noise Reduction" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Noise Reduction" }), { key: "End" });
    expect(controls.set).toHaveBeenCalledWith("noise_reduction", 1);
  });

  it("reads Auto once and lets a second click turn it off", async () => {
    const user = userEvent.setup();
    const controls = makeAdjustControls();
    const view = render(<AdjustTools controls={controls} disabled={false} />);
    await user.click(screen.getByRole("tab", { name: "Auto" }));
    expect(controls.activateAuto).toHaveBeenCalledTimes(1);
    view.rerender(
      <AdjustTools
        controls={{ ...controls, auto: { amount: 0.5, suggestion: RESTING_ADJUST } }}
        disabled={false}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Auto, 50" }));
    expect(controls.deactivateAuto).toHaveBeenCalledTimes(1);
  });

  it("keeps reset reachable while a wand reading is pending", async () => {
    const user = userEvent.setup();
    const controls = makeAdjustControls({ autoPending: true });
    render(<AdjustTools controls={controls} disabled={false} />);
    await user.click(screen.getByRole("tab", { name: "Auto" }));
    expect(controls.activateAuto).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reset adjustments" }));
    expect(controls.reset).toHaveBeenCalledTimes(1);
  });

  it("releases comparison on key release, blur and pointer cancellation", () => {
    const controls = makeAdjustControls({ values: { ...RESTING_ADJUST, exposure: 0.3 } });
    render(<AdjustTools controls={controls} disabled={false} />);
    const compare = screen.getByRole("button", { name: "Hold to see the original" });
    fireEvent.keyDown(compare, { key: " " });
    expect(controls.setComparing).toHaveBeenLastCalledWith(true);
    fireEvent.keyUp(compare, { key: " " });
    expect(controls.setComparing).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(compare, { key: "Enter" });
    fireEvent.blur(compare);
    expect(controls.setComparing).toHaveBeenLastCalledWith(false);
    compare.setPointerCapture = () => {};
    fireEvent.pointerDown(compare);
    expect(controls.setComparing).toHaveBeenLastCalledWith(true);
    fireEvent.pointerCancel(compare);
    expect(controls.setComparing).toHaveBeenLastCalledWith(false);
  });

  describe("with more tools than fit", () => {
    // jsdom lays nothing out and ignores scrollLeft, so the strip is given half its tools' width.
    function renderOverflowing() {
      render(<AdjustTools controls={makeAdjustControls()} disabled={false} />);
      const strip = screen.getByRole("tablist");
      let scrollLeft = 0;
      Object.defineProperties(strip, {
        scrollWidth: { value: 600 },
        clientWidth: { value: 300 },
        scrollLeft: {
          get: () => scrollLeft,
          set: (value: number) => {
            scrollLeft = value;
          },
        },
      });
      fireEvent.scroll(strip);
      return strip;
    }

    it("fades only the side that hides more tools", () => {
      const strip = renderOverflowing();
      expect(strip).toHaveClass("adjust-tools__strip--more-end");
      expect(strip).not.toHaveClass("adjust-tools__strip--more-start");

      strip.scrollLeft = 300;
      fireEvent.scroll(strip);

      expect(strip).toHaveClass("adjust-tools__strip--more-start");
      expect(strip).not.toHaveClass("adjust-tools__strip--more-end");
    });

    it("turns a mouse wheel into sideways scrolling", () => {
      const strip = renderOverflowing();

      const wheel = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
      strip.dispatchEvent(wheel);

      expect(strip.scrollLeft).toBe(120);
      expect(wheel.defaultPrevented).toBe(true);
    });
  });
});
