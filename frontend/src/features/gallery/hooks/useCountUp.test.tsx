import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { COUNT_UP_MS, easedCount } from "@/features/gallery/lib/countUp";
import { useCountUp } from "./useCountUp";

function Probe({ value }: { value: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const displayed = useCountUp(value, ref);
  return <div ref={ref}>{displayed}</div>;
}

function stubFrames() {
  const callbacks: FrameRequestCallback[] = [];
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    callbacks[id - 1] = () => {};
  });

  return {
    fire(time: number) {
      now = time;
      act(() => {
        const pending = callbacks.splice(0, callbacks.length);
        for (const callback of pending) callback(time);
      });
    },
  };
}

describe("useCountUp", () => {
  it("does not count main-thread delay before the first vsync as animation time", () => {
    const frames = stubFrames();
    render(<Probe value={100} />);

    expect(screen.getByText("0")).toBeInTheDocument();

    // Layout after opening the drawer often lands the first frame tens or hundreds
    // of milliseconds later. That delay is not part of the curve.
    frames.fire(200);
    expect(screen.getByText("0")).toBeInTheDocument();

    frames.fire(216);
    expect(screen.getByText(String(easedCount(0, 100, 16)))).toBeInTheDocument();
    expect(screen.queryByText(String(easedCount(0, 100, 216)))).not.toBeInTheDocument();
  });

  it("reaches the target once the duration has elapsed from the first vsync", () => {
    const frames = stubFrames();
    render(<Probe value={40} />);

    frames.fire(50);
    frames.fire(50 + COUNT_UP_MS);

    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("plays a later value from the figure already on screen", () => {
    const frames = stubFrames();
    const { rerender } = render(<Probe value={40} />);

    frames.fire(0);
    frames.fire(COUNT_UP_MS);
    expect(screen.getByText("40")).toBeInTheDocument();

    rerender(<Probe value={10} />);

    frames.fire(COUNT_UP_MS);
    frames.fire(COUNT_UP_MS + COUNT_UP_MS / 2);

    expect(screen.getByText(String(easedCount(40, 10, COUNT_UP_MS / 2)))).toBeInTheDocument();
  });
});
