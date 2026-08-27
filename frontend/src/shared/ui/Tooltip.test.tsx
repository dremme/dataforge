import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows tooltip below the trigger after the hover delay", async () => {
    vi.useFakeTimers();

    render(
      <Tooltip content="Missing caption">
        <button type="button">Filter</button>
      </Tooltip>,
    );

    const button = screen.getByRole("button", { name: "Filter" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(button.parentElement!);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("Missing caption");
  });

  it("puts extra classes on the hover wrapper", () => {
    render(
      <Tooltip content=".png" className="stats-drawer__mix-cell">
        <span>slice</span>
      </Tooltip>,
    );

    expect(screen.getByText("slice").parentElement).toHaveClass(
      "tooltip",
      "stats-drawer__mix-cell",
    );
  });

  it("renders the bubble outside the trigger, so no ancestor can clip it", () => {
    render(
      <Tooltip content="Copied!" open>
        <button type="button">Copy</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole("button", { name: "Copy" }).parentElement!;
    const bubble = screen.getByRole("tooltip");

    expect(wrapper.contains(bubble)).toBe(false);
    expect(bubble.parentElement).toBe(document.body);
  });

  it("does not duplicate aria-describedby when tooltip content matches aria-label", async () => {
    vi.useFakeTimers();

    render(
      <Tooltip content="5 folders">
        <span aria-label="5 folders">5</span>
      </Tooltip>,
    );

    const stat = screen.getByLabelText("5 folders");

    fireEvent.mouseEnter(stat.parentElement!);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(stat).not.toHaveAttribute("aria-describedby");
  });

  it("can be forced open without waiting for hover", () => {
    render(
      <Tooltip content="Copied!" open>
        <button type="button">Copy</button>
      </Tooltip>,
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent("Copied!");
  });

  it("hides on click so it does not sit over the control it just activated", async () => {
    vi.useFakeTimers();

    render(
      <Tooltip content="Display mode: Large">
        <button type="button">Display mode</button>
      </Tooltip>,
    );

    const button = screen.getByRole("button", { name: "Display mode" });
    fireEvent.mouseEnter(button.parentElement!);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.click(button);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("cancels a pending show when the trigger is clicked before the delay", async () => {
    vi.useFakeTimers();

    render(
      <Tooltip content="Filter by media type, caption status and duplicates">
        <button type="button">Filter media</button>
      </Tooltip>,
    );

    const button = screen.getByRole("button", { name: "Filter media" });
    fireEvent.mouseEnter(button.parentElement!);
    fireEvent.click(button);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays visible when forced open even after a click", () => {
    render(
      <Tooltip content="Copied!" open>
        <button type="button">Copy</button>
      </Tooltip>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Copied!");
  });

  it("hides while the trigger is expanded, then stays hidden after it collapses", async () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <Tooltip content="Automation jobs">
        <button type="button" aria-expanded={false}>
          Open automation jobs
        </button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole("button", { name: "Open automation jobs" }).parentElement!;
    fireEvent.mouseEnter(wrapper);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    rerender(
      <Tooltip content="Automation jobs">
        <button type="button" aria-expanded={true}>
          Open automation jobs
        </button>
      </Tooltip>,
    );

    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(
      <Tooltip content="Automation jobs">
        <button type="button" aria-expanded={false}>
          Open automation jobs
        </button>
      </Tooltip>,
    );

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows tooltips for disabled controls via the wrapper", async () => {
    vi.useFakeTimers();

    render(
      <Tooltip content="No backup available">
        <button type="button" disabled>
          Restore
        </button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole("button", { name: "Restore" }).parentElement;
    expect(wrapper).toHaveClass("tooltip--disabled-wrap");

    fireEvent.mouseEnter(wrapper!);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("No backup available");
  });
});

describe("Tooltip placement", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  /** jsdom has no layout; supply the trigger rect and bubble size. */
  function showTooltip(anchor: Partial<DOMRect>, bubble: Partial<DOMRect>) {
    vi.useFakeTimers();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains("tooltip__bubble")) return fakeRect(bubble);
      if (this.classList.contains("tooltip")) return fakeRect(anchor);
      return fakeRect({});
    });

    render(
      <Tooltip content="Filter by media type and caption status">
        <button type="button">Filter</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Filter" }).parentElement!);
    act(() => {
      vi.advanceTimersByTime(400);
    });

    return screen.getByRole("tooltip");
  }

  const TRIGGER = { top: 300, width: 100, height: 20 };
  const BUBBLE = { width: 200, height: 40 };

  it("centres the bubble under a trigger with room on both sides", () => {
    const bubble = showTooltip({ ...TRIGGER, left: 450 }, BUBBLE);

    expect(bubble.style.left).toBe("400px");
    expect(bubble.style.top).toBe("328px");
    expect(bubble.style.getPropertyValue("--anchored-shift")).toBe("0px");
    expect(bubble.dataset.side).toBe("bottom");
  });

  it("slides a bubble back in from the right edge", () => {
    // Centred it would run 850 to 1050, overrunning the 992px limit by 58.
    const bubble = showTooltip({ ...TRIGGER, left: 900 }, BUBBLE);

    expect(bubble.style.left).toBe("792px");
    expect(bubble.style.getPropertyValue("--anchored-shift")).toBe("-58px");
  });

  it("slides a bubble back in from the left edge", () => {
    const bubble = showTooltip({ ...TRIGGER, left: 20 }, BUBBLE);

    expect(bubble.style.left).toBe("8px");
    expect(bubble.style.getPropertyValue("--anchored-shift")).toBe("38px");
  });

  it("publishes the full shift even where the arrow cannot follow it that far", () => {
    // The CSS clamps the arrow to the bubble's own ends; the shift stays honest.
    const bubble = showTooltip({ ...TRIGGER, left: 1180 }, { width: 60, height: 40 });

    expect(bubble.style.getPropertyValue("--anchored-shift")).toBe("-268px");
  });

  it("flips above a trigger with no room beneath it", () => {
    const bubble = showTooltip({ ...TRIGGER, top: 780, left: 450 }, BUBBLE);

    expect(bubble.dataset.side).toBe("top");
    expect(bubble.style.top).toBe("732px");
  });
});
