import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { VideoProjectClip } from "@/shared/types";
import {
  makeClip as clip,
  makeProject as project,
  makeSource,
  makeTrack as track,
} from "@/test/videoProject";
import { PreviewEngine, type SourceLocation } from "@/features/videoEditor/lib/previewEngine";
import type { Project } from "@/features/videoEditor/lib/timeline";
import {
  SOURCE_DRAG_TYPE,
  Timeline,
  TIMELINE_ORIGIN_PX,
  TRACK_HEADER_PX,
  type TimelineTool,
} from "./Timeline";

// 100 px per second: a pointer at ORIGIN + 100 * t is at t seconds, since jsdom lays nothing out.
const PPS = 100;
const at = (seconds: number) => TIMELINE_ORIGIN_PX + seconds * PPS;
// Lanes top to bottom: V2 0-60, V1 60-120, A1 120-168, A2 168-216.
const V1_Y = 90;

const SOURCES = new Map<string, SourceLocation>([
  ["still", { path: "/media/still.png", version: "1-1", missing: false }],
  ["film", { path: "/media/film.mp4", version: "1-1", missing: false }],
]);

function renderTimeline(
  options: {
    project?: Project;
    tool?: TimelineTool;
    snapping?: boolean;
    selection?: string[];
  } = {},
) {
  const doc = options.project ?? project();
  const engine = new PreviewEngine();
  engine.setProject(doc, SOURCES);
  const props = {
    onSelect: vi.fn(),
    onRange: vi.fn(),
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    onError: vi.fn(),
    onSeek: vi.fn(),
    onDropSource: vi.fn(),
    onTracks: vi.fn(),
    onZoom: vi.fn(),
  };
  const view = render(
    <Timeline
      project={doc}
      engine={engine}
      sources={SOURCES}
      selection={new Set(options.selection ?? [])}
      selectedTransition={null}
      range={null}
      tool={options.tool ?? "select"}
      snapping={options.snapping ?? false}
      pxPerSecond={PPS}
      {...props}
    />,
  );
  const lanes = view.container.querySelector(".video-timeline__lanes") as HTMLElement;
  const scroller = view.container.querySelector(".video-timeline__scroll") as HTMLElement;
  return { ...props, engine, view, lanes, scroller };
}

const clipNamed = (start: string) =>
  screen.getByRole("button", { name: new RegExp(`^still\\.png, ${start} to`) });

/** The clip moved by the last call of a preview or commit callback. */
function placed(callback: ReturnType<typeof vi.fn>, id: string): VideoProjectClip | undefined {
  const next = callback.mock.lastCall?.[0] as Project | undefined;
  return next?.clips.find((item) => item.id === id);
}

describe("Timeline", () => {
  const capture = Element.prototype.setPointerCapture;
  beforeAll(() => {
    Element.prototype.setPointerCapture = () => undefined;
  });
  afterAll(() => {
    Element.prototype.setPointerCapture = capture;
  });

  it("selects a clip on click and adds to the selection with Shift", () => {
    const { onSelect } = renderTimeline({ selection: ["second"] });

    fireEvent.pointerDown(clipNamed("00:00"), { button: 0, clientX: at(1), clientY: V1_Y });
    expect(onSelect).toHaveBeenLastCalledWith(new Set(["first"]), null);

    fireEvent.pointerDown(clipNamed("00:00"), {
      button: 0,
      shiftKey: true,
      clientX: at(1),
      clientY: V1_Y,
    });
    expect(onSelect).toHaveBeenLastCalledWith(new Set(["second", "first"]), null);
  });

  it("chooses a clip from the keyboard, Shift+Enter adding it", () => {
    const { onSelect } = renderTimeline({ selection: ["second"] });

    fireEvent.keyDown(clipNamed("00:00"), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(new Set(["first"]), null);

    fireEvent.keyDown(clipNamed("00:00"), { key: "Enter", shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(new Set(["second", "first"]), null);
  });

  it("drags a clip along its track, previewing it and recording one step on release", () => {
    const { onPreview, onCommit, scroller } = renderTimeline({ selection: ["first"] });

    fireEvent.pointerDown(clipNamed("00:00"), { button: 0, clientX: at(1), clientY: V1_Y });
    fireEvent.pointerMove(scroller, { clientX: at(1.5), clientY: V1_Y });

    expect(placed(onPreview, "first")?.start).toBeCloseTo(0.5);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(scroller);
    expect(placed(onCommit, "first")?.start).toBeCloseTo(0.5);
  });

  it("snaps a dragged edge onto its neighbour and shows where it landed", () => {
    const { onPreview, scroller, view } = renderTimeline({
      snapping: true,
      selection: ["first"],
    });

    fireEvent.pointerDown(clipNamed("00:00"), { button: 0, clientX: at(1), clientY: V1_Y });
    // 0.96 s puts the end 0.04 s short of the next clip, inside the 8 px snap distance.
    fireEvent.pointerMove(scroller, { clientX: at(1.96), clientY: V1_Y });

    expect(placed(onPreview, "first")?.start).toBeCloseTo(1);
    const line = view.container.querySelector<HTMLElement>(".video-timeline__snap");
    expect(line?.style.transform).toBe(`translateX(${at(3)}px)`);

    fireEvent.pointerUp(scroller);
    expect(view.container.querySelector(".video-timeline__snap")).toBeNull();
  });

  it("says why a clip cannot go where it is dragged and keeps it where it could", () => {
    const doc = project({ tracks: [track("v2", "video", { locked: true }), track("v1", "video")] });
    const { onCommit, onError, scroller } = renderTimeline({ project: doc, selection: ["first"] });

    fireEvent.pointerDown(clipNamed("00:00"), { button: 0, clientX: at(1), clientY: V1_Y });
    fireEvent.pointerMove(scroller, { clientX: at(1), clientY: 30 });

    expect(screen.getByRole("status")).toHaveTextContent(/V2/);
    fireEvent.pointerUp(scroller);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/V2/));
  });

  it("trims a clip's end with its handle", () => {
    const { onPreview, onCommit, scroller, view } = renderTimeline({ selection: ["first"] });
    const handle = view.container.querySelector(
      '[data-clip="first"] .video-timeline__trim--end',
    ) as HTMLElement;

    fireEvent.pointerDown(handle, { button: 0, clientX: at(2), clientY: V1_Y });
    fireEvent.pointerMove(scroller, { clientX: at(1.5), clientY: V1_Y });
    fireEvent.pointerUp(scroller);

    expect(placed(onPreview, "first")?.duration).toBeCloseTo(1.5);
    expect(placed(onCommit, "first")?.duration).toBeCloseTo(1.5);
  });

  it("ripples the rest of the track along with the Ripple trim tool", () => {
    const { onCommit, scroller, view } = renderTimeline({ tool: "ripple" });
    const handle = view.container.querySelector(
      '[data-clip="first"] .video-timeline__trim--end',
    ) as HTMLElement;

    fireEvent.pointerDown(handle, { button: 0, clientX: at(2), clientY: V1_Y });
    fireEvent.pointerMove(scroller, { clientX: at(1.5), clientY: V1_Y });
    fireEvent.pointerUp(scroller);

    expect(placed(onCommit, "first")?.duration).toBeCloseTo(1.5);
    expect(placed(onCommit, "second")?.start).toBeCloseTo(2.5);
  });

  it("selects the clips a marquee drawn over empty lane space touches", () => {
    const { onSelect, lanes, scroller } = renderTimeline({ selection: [] });

    fireEvent.pointerDown(lanes, { button: 0, clientX: at(2.5), clientY: 30 });
    fireEvent.pointerMove(scroller, { clientX: at(2.52), clientY: 31 });
    expect(onSelect).toHaveBeenLastCalledWith(new Set(), null);
    // From V2 down into V1, across the second clip only.
    fireEvent.pointerMove(scroller, { clientX: at(3.5), clientY: V1_Y });
    expect(onSelect).toHaveBeenLastCalledWith(new Set(["second"]), null);
    fireEvent.pointerUp(scroller);
  });

  it("seeks to a marker from its flag and turns sync lock off from a track header", async () => {
    const user = userEvent.setup();
    const doc = project({ markers: [{ id: "m", time: 1.5, name: "Drop", note: "" }] });
    const { onSeek, onTracks } = renderTimeline({ project: doc });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Drop, 00:00:01:15" }));
    expect(onSeek).toHaveBeenLastCalledWith(1.5);

    await user.click(screen.getByRole("button", { name: "Turn off sync lock on A1" }));
    const tracks = (onTracks.mock.lastCall?.[0] as Project).tracks;
    expect(tracks.find((item) => item.id === "a1")?.sync_lock).toBe(false);
  });

  it("fetches only the filmstrip tiles in view, and the ones it scrolls to", async () => {
    const doc = project({
      sources: [makeSource("film", "film.mp4", "video", { duration: 60 })],
      clips: [clip("long", "v1", 0, 60, { kind: "video", source_id: "film" })],
    });
    const { view, scroller } = renderTimeline({ project: doc });
    const starts = () =>
      [...view.container.querySelectorAll<HTMLElement>(".video-timeline__filmstrip")].map(
        (tile) => /start=([\d.]+)/.exec(tile.style.backgroundImage)?.[1],
      );
    // The test layout is 1000 px wide: 8.16 s of lanes beside the headers, and a view more is
    // fetched either side. The tiles are eight seconds long at this zoom.
    const lanes = (1000 - TRACK_HEADER_PX) / PPS;
    expect(lanes).toBeCloseTo(8.16);

    await waitFor(() => expect(starts()).toEqual(["0.00", "8.00", "16.00"]));

    scroller.scrollLeft = TIMELINE_ORIGIN_PX + 30 * PPS;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(starts()).toEqual(["16.00", "24.00", "32.00", "40.00"]));
  });

  it("cuts a clip where the blade is clicked and draws the cut line while hovering", () => {
    const { onCommit, scroller, view } = renderTimeline({ tool: "blade" });

    fireEvent.pointerMove(scroller, { clientX: at(1), clientY: V1_Y });
    const blade = view.container.querySelector<HTMLElement>(".video-timeline__blade");
    expect(blade?.style.display).toBe("block");
    expect(blade?.style.transform).toBe(`translateX(${at(1)}px)`);

    fireEvent.pointerDown(clipNamed("00:00"), { button: 0, clientX: at(1), clientY: V1_Y });

    const cut = onCommit.mock.lastCall?.[0] as Project;
    expect(cut.clips.filter((item) => item.track_id === "v1")).toHaveLength(3);
    fireEvent.pointerLeave(scroller);
    expect(blade?.style.display).toBe("none");
  });

  it("marks a range by dragging with the Range tool", () => {
    const { onRange, lanes, scroller } = renderTimeline({ tool: "range" });

    fireEvent.pointerDown(lanes, { button: 0, clientX: at(2), clientY: V1_Y });
    fireEvent.pointerMove(scroller, { clientX: at(1), clientY: V1_Y });

    expect(onRange).toHaveBeenLastCalledWith({ start: 1, end: 2 });
  });

  it("seeks from the ruler and from empty lane space, which also clears the selection", () => {
    const { onSeek, onSelect, lanes, scroller } = renderTimeline({ selection: ["first"] });

    fireEvent.pointerDown(screen.getByRole("slider", { name: "Timeline position" }), {
      button: 0,
      clientX: at(0.5),
    });
    fireEvent.pointerMove(scroller, { clientX: at(0.8) });
    fireEvent.pointerUp(scroller);
    expect(onSeek.mock.calls.map(([time]) => time)).toEqual([0.5, 0.8]);

    fireEvent.pointerDown(lanes, { button: 0, clientX: at(2.5), clientY: V1_Y });
    expect(onSelect).toHaveBeenLastCalledWith(new Set(), null);
    expect(onSeek).toHaveBeenLastCalledWith(2.5);
  });

  it("moves the playhead line with the clock", () => {
    const { engine, view } = renderTimeline();

    engine.seek(2);

    const line = view.container.querySelector<HTMLElement>(".video-timeline__playhead");
    expect(line?.style.transform).toBe(`translateX(${at(2)}px)`);
  });

  it("highlights the lane a file is dragged over and drops it there", () => {
    const { onDropSource, lanes, view } = renderTimeline();
    const dataTransfer = {
      types: [SOURCE_DRAG_TYPE],
      getData: (type: string) => (type === SOURCE_DRAG_TYPE ? "/media/new.png" : ""),
      dropEffect: "none",
    };

    const over = createEvent.dragOver(lanes, { dataTransfer });
    Object.defineProperties(over, { clientX: { value: at(1) }, clientY: { value: V1_Y } });
    fireEvent(lanes, over);
    expect(view.container.querySelector('[data-track="v1"]')).toHaveClass(
      "video-timeline__lane--drop",
    );

    const drop = createEvent.drop(lanes, { dataTransfer });
    Object.defineProperties(drop, { clientX: { value: at(1) }, clientY: { value: V1_Y } });
    fireEvent(lanes, drop);
    expect(onDropSource).toHaveBeenCalledWith("/media/new.png", 1, "v1");
    expect(view.container.querySelector(".video-timeline__lane--drop")).toBeNull();
  });

  it("refuses a drop below the last track", () => {
    const { onDropSource, onError, lanes } = renderTimeline();
    const drop = createEvent.drop(lanes, {
      dataTransfer: { types: [SOURCE_DRAG_TYPE], getData: () => "/media/new.png" },
    });
    Object.defineProperties(drop, { clientX: { value: at(1) }, clientY: { value: 900 } });

    fireEvent(lanes, drop);

    expect(onDropSource).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Drop the file on a track.");
  });

  it("zooms with Ctrl and the wheel, and scrolls sideways with a plain wheel", () => {
    const { onZoom, scroller } = renderTimeline();

    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true, clientX: 400 });
    expect(onZoom).toHaveBeenCalledWith(PPS * 1.25);

    fireEvent.wheel(scroller, { deltaY: 120 });
    expect(scroller.scrollLeft).toBe(120);
  });

  it("toggles, orders, renames and removes tracks from their headers", async () => {
    const user = userEvent.setup();
    const { onTracks } = renderTimeline();
    const lastTracks = () => (onTracks.mock.lastCall?.[0] as Project).tracks;

    await user.click(screen.getByRole("button", { name: "Mute A1" }));
    expect(lastTracks().find((item) => item.id === "a1")?.muted).toBe(true);
    await user.click(screen.getByRole("button", { name: "Solo A1" }));
    expect(lastTracks().find((item) => item.id === "a1")?.solo).toBe(true);
    await user.click(screen.getByRole("button", { name: "Hide V2" }));
    expect(lastTracks().find((item) => item.id === "v2")?.hidden).toBe(true);
    await user.click(screen.getByRole("button", { name: "Lock V1" }));
    expect(lastTracks().find((item) => item.id === "v1")?.locked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Move V1 up" }));
    expect(lastTracks().map((item) => item.id)).toEqual(["v1", "v2", "a1", "a2"]);

    expect(screen.getByRole("button", { name: "Remove V1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove A2" }));
    expect(lastTracks().map((item) => item.id)).toEqual(["v2", "v1", "a1"]);

    await user.dblClick(screen.getByRole("button", { name: "A1, double-click to rename" }));
    const name = screen.getByRole("textbox", { name: "Name of A1" });
    await user.clear(name);
    await user.type(name, "Music{Enter}");
    expect(lastTracks().find((item) => item.id === "a1")?.name).toBe("Music");
  });

  it("leaves a track's name alone when renaming is cancelled", async () => {
    const user = userEvent.setup();
    const { onTracks } = renderTimeline();

    await user.dblClick(screen.getByRole("button", { name: "V2, double-click to rename" }));
    await user.type(screen.getByRole("textbox", { name: "Name of V2" }), "x{Escape}");

    expect(onTracks).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "V2, double-click to rename" })).toBeInTheDocument();
  });

  it("selects a dissolve from its marker", () => {
    const doc = project({
      clips: [clip("first", "v1", 0, 2), clip("second", "v1", 1.5, 2)],
      transitions: [{ id: "mix", from_clip_id: "first", to_clip_id: "second" }],
    });
    const { onSelect } = renderTimeline({ project: doc });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Cross-dissolve, 0.50 seconds" }));

    expect(onSelect).toHaveBeenLastCalledWith(new Set(), "mix");
  });

  it("draws fades, speed and a missing source on the clip", () => {
    const doc = project({
      clips: [{ ...clip("first", "v1", 0, 2), fade_in: 0.5, speed: 2 }],
    });
    const engine = new PreviewEngine();
    const missing = new Map([["still", { path: "/media/still.png", version: "", missing: true }]]);
    const { container } = render(
      <Timeline
        project={doc}
        engine={engine}
        sources={missing}
        selection={new Set()}
        selectedTransition={null}
        range={{ start: 0.5, end: 1.5 }}
        tool="select"
        snapping={false}
        pxPerSecond={PPS}
        onSelect={vi.fn()}
        onRange={vi.fn()}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onError={vi.fn()}
        onSeek={vi.fn()}
        onDropSource={vi.fn()}
        onTracks={vi.fn()}
        onZoom={vi.fn()}
      />,
    );
    const shown = container.querySelector('[data-clip="first"]') as HTMLElement;

    expect(within(shown).getByText("still.png (missing)")).toBeInTheDocument();
    expect(within(shown).getByText("2×")).toBeInTheDocument();
    expect(shown.querySelector<HTMLElement>(".video-timeline__fade--in")?.style.width).toBe("50px");
    expect(container.querySelector<HTMLElement>(".video-timeline__range")?.style.left).toBe(
      `${at(0.5)}px`,
    );
  });

  it("invites a first drop on an empty timeline", () => {
    renderTimeline({ project: project({ clips: [] }) });

    expect(screen.getByText(/Drag media here from the browser/)).toBeInTheDocument();
  });
});
