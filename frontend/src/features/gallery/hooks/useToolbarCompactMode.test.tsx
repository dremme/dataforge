import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as toolbarCompact from "@/features/gallery/lib/toolbarCompact";
import { classNames } from "@/shared/lib/classNames";
import { useToolbarCompactMode } from "./useToolbarCompactMode";

const needsCompact = vi.hoisted(() => vi.fn<() => boolean>(() => false));

vi.mock("@/features/gallery/lib/toolbarCompact", async (importOriginal) => ({
  ...(await importOriginal<typeof toolbarCompact>()),
  toolbarNeedsCompact: needsCompact,
}));

function ToolbarProbe({ label = "Auto-caption" }: { label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const compact = useToolbarCompactMode(ref);
  return (
    <div ref={ref} className={classNames("toolbar", compact && "toolbar--compact")}>
      <span className="toolbar__measure" />
      <div className="toolbar__actions">{label}</div>
      <div className="toolbar__controls">
        <input aria-label="Search" />
      </div>
    </div>
  );
}

describe("useToolbarCompactMode", () => {
  const SetupResizeObserver = window.ResizeObserver;
  let resized: ResizeObserverCallback | undefined;
  let watched: Element[] = [];
  let actEnvironment: unknown;

  beforeEach(() => {
    // setup.ts defines it writable but not configurable, so it is assigned, not stubbed.
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe(element: Element) {
        watched.push(element);
      }
      unobserve() {}
      disconnect() {}
    };
    actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    watched = [];
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

  it("watches nothing that resizes when it flips, which browsers report as a loop", () => {
    const { container } = render(<ToolbarProbe />);
    const classes = watched.map((element) => element.className || element.tagName);

    expect(classes).toContain("toolbar__measure");
    expect(classes).toContain("INPUT");
    // The toolbar's height and the actions' width both change with the compact mode.
    expect(watched).not.toContain(container.querySelector(".toolbar"));
    expect(watched).not.toContain(container.querySelector(".toolbar__actions"));
  });

  it("checks again when an action's label changes", async () => {
    const { rerender } = render(<ToolbarProbe />);
    needsCompact.mockClear();

    rerender(<ToolbarProbe label="Auto-caption 3 of 120" />);

    await vi.waitFor(() => expect(needsCompact).toHaveBeenCalled());
  });
});
