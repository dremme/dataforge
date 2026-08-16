import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatsDrawer } from "./StatsDrawer";
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

function renderDrawer(overrides: Partial<Parameters<typeof StatsDrawer>[0]> = {}) {
  const onClose = vi.fn();
  render(<StatsDrawer open items={items} onClose={onClose} {...overrides} />);
  return onClose;
}

describe("StatsDrawer", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<StatsDrawer open={false} items={items} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leads with caption coverage as a meter", () => {
    renderDrawer();

    expect(screen.getByRole("dialog", { name: "Dataset statistics" })).toBeInTheDocument();

    // One captioned file of three.
    const meter = screen.getByRole("meter", { name: "Caption coverage" });
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByText("33")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 files captioned")).toBeInTheDocument();
  });

  it("states each warning in words, never by colour alone", () => {
    renderDrawer();

    expect(screen.getByText("2 files are missing a caption")).toBeInTheDocument();
    expect(screen.getByText("1 file has a caption issue")).toBeInTheDocument();
  });

  it("congratulates a folder with full coverage and no issues", () => {
    renderDrawer({
      items: [
        mediaItem("one.png", HOME_PATH, {
          description: "a brown dog",
          has_description: true,
          caption_status: "text",
        }),
      ],
    });

    expect(screen.getByText("Every file is captioned and clear of issues")).toBeInTheDocument();
    expect(screen.queryByText(/missing a caption/)).not.toBeInTheDocument();
  });

  it("offers no filter buttons - the toolbar owns filtering", () => {
    renderDrawer();

    expect(screen.queryByRole("button", { name: /Missing caption/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Captioned/ })).not.toBeInTheDocument();
  });

  it("ranks the most frequent caption words as a bar chart", () => {
    renderDrawer();

    const chart = screen.getByRole("figure", {
      name: "Distribution by how often each word appears",
    });
    expect(within(chart).getByText("brown")).toBeInTheDocument();
    expect(within(chart).getByText("dog")).toBeInTheDocument();
  });

  it("closes from the header button", async () => {
    const user = userEvent.setup();
    const onClose = renderDrawer();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("draws no mark for an empty bucket", () => {
    renderDrawer();

    const chart = screen.getByRole("figure", { name: /caption length/ });
    const rows = within(chart).getAllByRole("term");
    const bars = chart.querySelectorAll(".stats-drawer__bar-fill");

    // Every bucket gets a row; only the non-empty ones get a bar.
    expect(rows.length).toBeGreaterThan(bars.length);
  });

  it("says so when the folder holds no media", () => {
    renderDrawer({ items: [] });

    expect(screen.getByText("No media in this folder.")).toBeInTheDocument();
  });
});
