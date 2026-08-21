import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COUNT_UP_MS } from "@/features/gallery/lib/countUp";
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

function tileFigure(label: string): HTMLElement {
  const value = screen.getByText(label).previousElementSibling;
  if (!(value instanceof HTMLElement)) {
    throw new Error(`No figure next to ${label}`);
  }
  return value;
}

function stubCountUpFrames() {
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
    playTo(elapsed: number) {
      act(() => {
        if (now === 0) {
          const priming = callbacks.splice(0, callbacks.length);
          for (const callback of priming) callback(0);
        }
        now = elapsed;
        const pending = callbacks.splice(0, callbacks.length);
        for (const callback of pending) callback(elapsed);
      });
    },
  };
}

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("StatsDrawer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing while closed", () => {
    const { container } = render(<StatsDrawer open={false} items={items} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leads with caption coverage as a meter", () => {
    const frames = stubCountUpFrames();
    renderDrawer();
    frames.playTo(COUNT_UP_MS);

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
    expect(within(chart).queryByText("4:3")).not.toBeInTheDocument();
  });

  it("closes from the header button", async () => {
    const user = userEvent.setup();
    const onClose = renderDrawer();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("omits empty buckets from the charts", () => {
    renderDrawer();

    const chart = screen.getByRole("figure", { name: /caption length/ });
    const rows = within(chart).getAllByRole("term");
    const bars = chart.querySelectorAll(".stats-drawer__bar-fill");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("< 256");
    expect(bars).toHaveLength(1);
  });

  it("counts media types as tiles", () => {
    const frames = stubCountUpFrames();
    renderDrawer({
      items: [
        mediaItem("one.png", HOME_PATH),
        mediaItem("clip.mp4", HOME_PATH),
        mediaItem("loop.gif", HOME_PATH),
      ],
    });
    frames.playTo(COUNT_UP_MS);

    expect(tileFigure("Images")).toHaveTextContent("1");
    expect(tileFigure("Videos")).toHaveTextContent("1");
    expect(tileFigure("GIFs")).toHaveTextContent("1");
  });

  it("counts a tile up once it is on screen", () => {
    const frames = stubCountUpFrames();
    const photos = Array.from({ length: 40 }, (_, index) =>
      mediaItem(`photo-${index}.png`, HOME_PATH),
    );
    renderDrawer({ items: photos });

    expect(tileFigure("Images")).toHaveTextContent("0");

    frames.playTo(COUNT_UP_MS / 2);
    const midway = Number(tileFigure("Images").textContent);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(40);

    frames.playTo(COUNT_UP_MS);
    expect(tileFigure("Images")).toHaveTextContent("40");
  });

  it("shows the final figure immediately when motion is reduced", () => {
    stubReducedMotion(true);
    stubCountUpFrames();
    const photos = Array.from({ length: 40 }, (_, index) =>
      mediaItem(`photo-${index}.png`, HOME_PATH),
    );
    renderDrawer({ items: photos });

    expect(tileFigure("Images")).toHaveTextContent("40");
  });

  it("draws a mix bar whose segments follow each extension's share of the folder", () => {
    renderDrawer({
      items: [
        mediaItem("one.png", HOME_PATH),
        mediaItem("two.png", HOME_PATH),
        mediaItem("clip.mp4", HOME_PATH),
        mediaItem("loop.gif", HOME_PATH),
      ],
    });

    const mix = screen.getByRole("figure", { name: /file extensions/i });
    expect(mix).toHaveAccessibleName("File extensions: PNG 50%, GIF 25%, MP4 25%");

    const cells = mix.querySelectorAll(".stats-drawer__mix-cell");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveStyle({ flexGrow: 2 });
    expect(cells[1]).toHaveStyle({ flexGrow: 1 });
    expect(cells[2]).toHaveStyle({ flexGrow: 1 });
  });

  it("omits missing extensions from the mix bar", () => {
    renderDrawer();

    const mix = screen.getByRole("figure", { name: /file extensions/i });
    expect(mix).toHaveAccessibleName("File extensions: PNG 100%");
    expect(mix.querySelectorAll(".stats-drawer__mix-cell")).toHaveLength(1);
  });

  it("names the extension in a mix segment's tooltip", async () => {
    vi.useFakeTimers();
    renderDrawer({
      items: [
        mediaItem("one.png", HOME_PATH),
        mediaItem("two.png", HOME_PATH),
        mediaItem("three.jpeg", HOME_PATH),
        mediaItem("clip.mp4", HOME_PATH),
      ],
    });

    const jpeg = document.querySelector(`.stats-drawer__mix-segment[data-extension=".jpeg"]`);
    expect(jpeg).not.toBeNull();
    fireEvent.mouseEnter(jpeg!.closest(".tooltip")!);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent("JPEG");
  });

  it("says so when the folder holds no media", () => {
    renderDrawer({ items: [] });

    expect(screen.getByText("No media in this folder.")).toBeInTheDocument();
  });

  it("withholds video duration until the folder holds a video", () => {
    renderDrawer();

    expect(screen.queryByRole("heading", { name: "Video duration" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("figure", { name: "Distribution by video duration in seconds" }),
    ).not.toBeInTheDocument();
  });

  it("charts video duration when the folder holds clips", () => {
    renderDrawer({
      items: [
        mediaItem("short.mp4", HOME_PATH, { duration: 1.2 }),
        mediaItem("mid.mp4", HOME_PATH, { duration: 5.4 }),
        mediaItem("long.mp4", HOME_PATH, { duration: 20 }),
        mediaItem("still.png", HOME_PATH),
      ],
    });

    const chart = screen.getByRole("figure", { name: "Distribution by video duration in seconds" });
    expect(within(chart).getByText("0 – 2 s")).toBeInTheDocument();
    expect(within(chart).getByText("4 – 6 s")).toBeInTheDocument();
    expect(within(chart).getByText("> 15 s")).toBeInTheDocument();
    expect(within(chart).queryByText("2 – 4 s")).not.toBeInTheDocument();
  });

  it("says so when a video has no duration", () => {
    renderDrawer({
      items: [
        mediaItem("clip.mp4", HOME_PATH, { duration: 5.4 }),
        mediaItem("other.mkv", HOME_PATH, { duration: null }),
      ],
    });

    expect(screen.getByText("1 video has an unknown duration.")).toBeInTheDocument();
  });
});
