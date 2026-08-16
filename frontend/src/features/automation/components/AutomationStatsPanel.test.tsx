import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutomationStatsPanel } from "./AutomationStatsPanel";
import { HOME_PATH, mediaItem } from "@/test/fixtures";

const items = [
  mediaItem("one.png", HOME_PATH, {
    description: "a brown dog",
    has_description: true,
    caption_status: "text",
  }),
  mediaItem("two.png", HOME_PATH),
  mediaItem("three.png", HOME_PATH, { has_issue_file: true }),
];

function renderPanel(overrides: Partial<Parameters<typeof AutomationStatsPanel>[0]> = {}) {
  const onFilterChange = vi.fn();
  render(
    <AutomationStatsPanel
      id="stats"
      open
      items={items}
      filter="all"
      onFilterChange={onFilterChange}
      {...overrides}
    />,
  );
  return onFilterChange;
}

describe("AutomationStatsPanel", () => {
  it("renders nothing for an empty folder", () => {
    const { container } = render(
      <AutomationStatsPanel id="stats" open items={[]} filter="all" onFilterChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("summarizes caption coverage", () => {
    renderPanel();

    expect(screen.getByRole("region", { name: "Dataset statistics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 Captioned/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 Missing caption/ })).toBeInTheDocument();
  });

  it("applies a caption filter when a coverage row is clicked", async () => {
    const user = userEvent.setup();
    const onFilterChange = renderPanel();

    await user.click(screen.getByRole("button", { name: /Missing caption/ }));

    expect(onFilterChange).toHaveBeenCalledWith("uncaptioned");
  });

  it("clears the filter when the applied row is clicked again", async () => {
    const user = userEvent.setup();
    const onFilterChange = renderPanel({ filter: "uncaptioned" });

    const row = screen.getByRole("button", { name: /Missing caption/ });
    expect(row).toHaveAttribute("aria-pressed", "true");

    await user.click(row);

    expect(onFilterChange).toHaveBeenCalledWith("all");
  });

  it("lists the most frequent caption words", () => {
    renderPanel();

    expect(screen.getByText("brown")).toBeInTheDocument();
    expect(screen.getByText("dog")).toBeInTheDocument();
  });
});
