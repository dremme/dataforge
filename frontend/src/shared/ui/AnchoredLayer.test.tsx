import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchoredLayer } from "./AnchoredLayer";

function Fixture({ open, exitDuration }: { open: boolean; exitDuration?: number }) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button ref={anchorRef} type="button">
        Trigger
      </button>
      <AnchoredLayer
        anchorRef={anchorRef}
        open={open}
        exitDuration={exitDuration}
        className="fixture__panel"
        role="menu"
        label="Options"
      >
        <span>Panel body</span>
      </AnchoredLayer>
    </div>
  );
}

describe("AnchoredLayer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing while closed", () => {
    render(<Fixture open={false} />);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("portals the surface to the body, clear of any clipping ancestor", () => {
    const { container } = render(<Fixture open />);
    const panel = screen.getByRole("menu");

    expect(container.contains(panel)).toBe(false);
    expect(panel.parentElement).toBe(document.body);
  });

  it("names the surface and carries the caller's own class", () => {
    render(<Fixture open />);
    const panel = screen.getByRole("menu", { name: "Options" });

    expect(panel).toHaveClass("anchored", "fixture__panel");
    expect(panel).toHaveAttribute("data-state", "open");
  });

  it("unmounts immediately when no exit is declared", () => {
    const { rerender } = render(<Fixture open />);

    rerender(<Fixture open={false} />);

    expect(document.querySelector(".fixture__panel")).toBeNull();
  });

  it("keeps an exiting surface mounted but out of the accessibility tree", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Fixture open exitDuration={150} />);

    rerender(<Fixture open={false} exitDuration={150} />);

    const panel = document.querySelector(".fixture__panel");
    expect(panel).toHaveAttribute("data-state", "closed");
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("menu")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(document.querySelector(".fixture__panel")).toBeNull();
  });
});
