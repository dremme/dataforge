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
