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
    const wrapper = button.parentElement;
    expect(wrapper).not.toHaveClass("tooltip--visible");

    fireEvent.mouseEnter(wrapper!);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(wrapper).toHaveClass("tooltip--visible");
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

  it("does not duplicate aria-describedby when tooltip content matches aria-label", async () => {
    vi.useFakeTimers();

    render(
      <Tooltip content="5 folders">
        <span aria-label="5 folders">5</span>
      </Tooltip>,
    );

    const stat = screen.getByLabelText("5 folders");
    const wrapper = stat.parentElement;

    fireEvent.mouseEnter(wrapper!);

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

    const wrapper = screen.getByRole("button", { name: "Copy" }).parentElement;
    expect(wrapper).toHaveClass("tooltip--visible");
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
    const wrapper = button.parentElement!;
    fireEvent.mouseEnter(wrapper);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(wrapper).toHaveClass("tooltip--visible");

    fireEvent.click(button);

    expect(wrapper).not.toHaveClass("tooltip--visible");
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
    const wrapper = button.parentElement!;
    fireEvent.mouseEnter(wrapper);
    fireEvent.click(button);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(wrapper).not.toHaveClass("tooltip--visible");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays visible when forced open even after a click", () => {
    render(
      <Tooltip content="Copied!" open>
        <button type="button">Copy</button>
      </Tooltip>,
    );

    const button = screen.getByRole("button", { name: "Copy" });
    fireEvent.click(button);

    expect(button.parentElement).toHaveClass("tooltip--visible");
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

    expect(wrapper).toHaveClass("tooltip--visible");

    rerender(
      <Tooltip content="Automation jobs">
        <button type="button" aria-expanded={true}>
          Open automation jobs
        </button>
      </Tooltip>,
    );

    expect(wrapper).not.toHaveClass("tooltip--visible");

    rerender(
      <Tooltip content="Automation jobs">
        <button type="button" aria-expanded={false}>
          Open automation jobs
        </button>
      </Tooltip>,
    );

    expect(wrapper).not.toHaveClass("tooltip--visible");
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

    expect(wrapper).toHaveClass("tooltip--visible");
    expect(screen.getByRole("tooltip")).toHaveTextContent("No backup available");
  });
});

describe("Tooltip edge shifting", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** jsdom reports zero-size rects, so the bubble's geometry is supplied here. */
  function showTooltipWithBubbleAt(left: number, width: number) {
    vi.useFakeTimers();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);

    render(
      <Tooltip content="Filter by media type and caption status">
        <button type="button">Filter</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole("button", { name: "Filter" }).parentElement!;
    const bubble = wrapper.querySelector(".tooltip__bubble") as HTMLElement;

    bubble.getBoundingClientRect = () =>
      ({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 0,
        height: 0,
        x: left,
        y: 0,
      }) as DOMRect;

    fireEvent.mouseEnter(wrapper);
    return { wrapper, bubble };
  }

  async function advancePastDelay() {
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
  }

  it("leaves a bubble that already fits where it is", async () => {
    const { bubble } = showTooltipWithBubbleAt(400, 200);
    await advancePastDelay();

    expect(bubble.style.getPropertyValue("--tooltip-shift")).toBe("0px");
    expect(bubble.style.getPropertyValue("--tooltip-arrow-shift")).toBe("0px");
  });

  it("slides a bubble back in from the right edge and moves the arrow the other way", async () => {
    // Right edge at 1050 overruns the 1000px window, leaving 8px of padding to recover.
    const { bubble } = showTooltipWithBubbleAt(850, 200);
    await advancePastDelay();

    expect(bubble.style.getPropertyValue("--tooltip-shift")).toBe("-58px");
    expect(bubble.style.getPropertyValue("--tooltip-arrow-shift")).toBe("58px");
  });

  it("slides a bubble back in from the left edge", async () => {
    const { bubble } = showTooltipWithBubbleAt(-30, 200);
    await advancePastDelay();

    expect(bubble.style.getPropertyValue("--tooltip-shift")).toBe("38px");
    expect(bubble.style.getPropertyValue("--tooltip-arrow-shift")).toBe("-38px");
  });

  it("keeps the arrow inside the bubble when the shift exceeds its half width", async () => {
    // A 60px bubble can only carry its arrow 18px from centre (30 - 12 padding),
    // even though the bubble itself has to travel much further to fit.
    const { bubble } = showTooltipWithBubbleAt(1200, 60);
    await advancePastDelay();

    expect(bubble.style.getPropertyValue("--tooltip-shift")).toBe("-268px");
    expect(bubble.style.getPropertyValue("--tooltip-arrow-shift")).toBe("18px");
  });
});
