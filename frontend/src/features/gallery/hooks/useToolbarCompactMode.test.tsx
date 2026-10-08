import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as toolbarCompact from "@/features/gallery/lib/toolbarCompact";
import { classNames } from "@/shared/lib/classNames";
import { useToolbarCompactMode } from "./useToolbarCompactMode";

const needsCompact = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/features/gallery/lib/toolbarCompact", async (importOriginal) => ({
  ...(await importOriginal<typeof toolbarCompact>()),
  toolbarNeedsCompact: needsCompact,
}));

function ToolbarProbe() {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useToolbarCompactMode(ref);
  return (
    <div ref={ref} className={classNames("toolbar", compact && "toolbar--compact")}>
      <div className="toolbar__actions" />
      <div className="toolbar__controls" />
    </div>
  );
}

describe("useToolbarCompactMode", () => {
  const SetupResizeObserver = window.ResizeObserver;
  let resized: ResizeObserverCallback | undefined;
  let actEnvironment: unknown;

  beforeEach(() => {
    // setup.ts defines it writable but not configurable, so it is assigned, not stubbed.
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  afterEach(() => {
    window.ResizeObserver = SetupResizeObserver;
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
    needsCompact.mockReturnValue(false);
  });

  it("switches before the browser paints, so the wrapped row is never shown", () => {
    const { container } = render(<ToolbarProbe />);
    const toolbar = container.querySelector(".toolbar")!;
    expect(toolbar).not.toHaveClass("toolbar--compact");

    // As the browser runs it: no act() around the callback, nothing flushed afterwards.
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
    needsCompact.mockReturnValue(true);
    resized!([], {} as ResizeObserver);

    expect(toolbar).toHaveClass("toolbar--compact");
  });
});
