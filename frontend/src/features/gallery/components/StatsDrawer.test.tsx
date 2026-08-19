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

  it("reports duplicates as files and groups, in words", () => {
    renderDrawer({
      items: [
        mediaItem("a.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g1" }),
        mediaItem("b.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g1" }),
        mediaItem("c.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g2" }),
        mediaItem("d.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g2" }),
      ],
    });

    expect(screen.getByText("4 files are in 2 duplicate groups")).toBeInTheDocument();
  });

  it("says nothing about duplicates when there are none", () => {
    renderDrawer();

    expect(screen.queryByText(/duplicate group/)).not.toBeInTheDocument();
  });

  it("puts a single duplicate pair in the singular", () => {
    renderDrawer({
      items: [
        mediaItem("a.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g1" }),
        mediaItem("b.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g1" }),
      ],
    });

    expect(screen.getByText("2 files are in 1 duplicate group")).toBeInTheDocument();
  });

  it("withholds the all-clear while duplicates remain", () => {
    renderDrawer({
      items: [
        mediaItem("a.png", HOME_PATH, {
          description: "a brown dog",
          has_description: true,
          caption_status: "text",
          has_duplicate_file: true,
          duplicate_group: "g1",
        }),
        mediaItem("b.png", HOME_PATH, {
          description: "a brown dog",
          has_description: true,
          caption_status: "text",
          has_duplicate_file: true,
          duplicate_group: "g1",
        }),
      ],
    });

    // Fully captioned and issue-free, but not yet clean.
    expect(screen.getByText("2 of 2 files captioned")).toBeInTheDocument();
    expect(screen.queryByText(/Every file is captioned/)).not.toBeInTheDocument();
    expect(screen.getByText("2 files are in 1 duplicate group")).toBeInTheDocument();
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

    expect(
      screen.getByText("Every file is captioned, with no issues or duplicates"),
    ).toBeInTheDocument();
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

  it("charts aspect ratios from the files that have dimensions", () => {
    renderDrawer({
      items: [
        mediaItem("square.png", HOME_PATH, { width: 1024, height: 1024 }),
        mediaItem("wide.png", HOME_PATH, { width: 1920, height: 1080 }),
        mediaItem("tall.png", HOME_PATH, { width: 1080, height: 1920 }),
      ],
    });

    const chart = screen.getByRole("figure", { name: "Distribution by aspect ratio" });
    expect(within(chart).getByText("1:1")).toBeInTheDocument();
    expect(within(chart).getByText("16:9")).toBeInTheDocument();
    expect(within(chart).getByText("9:16")).toBeInTheDocument();
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
