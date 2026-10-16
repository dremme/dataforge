import { createRef, type ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeItem } from "@/test/galleryItemModal";
import { makeProject } from "@/test/videoProject";
import { PreviewEngine } from "@/features/videoEditor/lib/previewEngine";
import { PreviewPanel, type SourceTransport } from "./PreviewPanel";

function renderPanel(overrides: Partial<ComponentProps<typeof PreviewPanel>> = {}) {
  const project = overrides.project ?? makeProject();
  const engine = overrides.engine ?? new PreviewEngine();
  engine.setProject(project, new Map());
  const props: ComponentProps<typeof PreviewPanel> = {
    mode: "timeline",
    onModeChange: vi.fn(),
    engine,
    project,
    selectedClip: null,
    onTransform: vi.fn(),
    sourceItem: null,
    sourceRange: { start: 0, end: null },
    onSourceRange: vi.fn(),
    onAddSource: vi.fn(),
    onInsertSource: vi.fn(),
    onReplaceSource: vi.fn(),
    replaceLabel: null,
    sourceTransportRef: createRef<SourceTransport | null>(),
    hasMissing: false,
    guides: false,
    onGuides: vi.fn(),
    renderFrame: vi.fn(),
    ...overrides,
  };
  return { ...props, ...render(<PreviewPanel {...props} />) };
}

const clip = makeItem("clip.mp4", { media_type: "video", duration: 4 });

/** jsdom keeps no media clock; give the element one the panel can read and move. */
function mediaClock(element: HTMLMediaElement, seconds: number) {
  let time = seconds;
  Object.defineProperty(element, "currentTime", {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
}

describe("PreviewPanel", () => {
  const play = HTMLMediaElement.prototype.play;
  const capture = Element.prototype.setPointerCapture;
  beforeAll(() => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    Element.prototype.setPointerCapture = () => undefined;
  });
  afterAll(() => {
    HTMLMediaElement.prototype.play = play;
    Element.prototype.setPointerCapture = capture;
  });

  it("steps and jumps the timeline playhead from the transport", async () => {
    const user = userEvent.setup();
    const { engine } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Go to the end" }));
    expect(engine.currentTime).toBe(5);
    await user.click(screen.getByRole("button", { name: "Previous frame" }));
    expect(engine.currentTime).toBeCloseTo(5 - 1 / 30);
    await user.click(screen.getByRole("button", { name: "Go to the start" }));
    await user.click(screen.getByRole("button", { name: "Next frame" }));
    expect(engine.currentTime).toBeCloseTo(1 / 30);
  });

  it("starts and stops playback from the play button", async () => {
    const user = userEvent.setup();
    const { engine } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(engine.isPlaying).toBe(true);
    await user.click(await screen.findByRole("button", { name: "Pause" }));
    expect(engine.isPlaying).toBe(false);
  });

  it("asks for media on an empty timeline and cannot play it", () => {
    renderPanel({ project: makeProject({ clips: [] }) });

    expect(screen.getByText("Add media to the timeline to see it here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Playhead" })).toBeDisabled();
  });

  it("toggles the safe-area guides and warns about missing media", async () => {
    const user = userEvent.setup();
    const { onGuides, container } = renderPanel({ guides: true, hasMissing: true });

    expect(container.querySelectorAll(".video-editor__guide")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Some media is missing");
    await user.click(screen.getByRole("button", { name: "Safe-area guides" }));
    expect(onGuides).toHaveBeenCalled();
  });

  it("offers Source only once a file is picked, and switches between the two", async () => {
    const user = userEvent.setup();
    const { onModeChange, rerender, ...props } = renderPanel();
    expect(screen.getByRole("tab", { name: "Source" })).toBeDisabled();

    rerender(<PreviewPanel {...props} onModeChange={onModeChange} sourceItem={clip} />);
    await user.click(screen.getByRole("tab", { name: "Source" }));

    expect(onModeChange).toHaveBeenCalledWith("source");
  });

  it("moves the selected picture with its handles and scales it from a corner", () => {
    const project = makeProject();
    const { onTransform, container } = renderPanel({
      project,
      selectedClip: project.clips[0],
    });
    const box = container.querySelector(".video-editor__handles") as HTMLElement;

    fireEvent.pointerDown(box, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(box, { clientX: 1, clientY: 0 });
    fireEvent.pointerUp(box, { clientX: 1, clientY: 0 });
    expect(onTransform).toHaveBeenNthCalledWith(1, project.clips[0], expect.any(Object), false);
    expect(vi.mocked(onTransform).mock.lastCall?.[1].x).toBeGreaterThan(0);
    expect(vi.mocked(onTransform).mock.lastCall?.[2]).toBe(true);

    const corner = container.querySelector(".video-editor__handle--se") as HTMLElement;
    fireEvent.pointerDown(corner, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(box, { clientX: 20, clientY: 20 });
    expect(vi.mocked(onTransform).mock.lastCall?.[1].scale).toBeGreaterThan(1);
  });

  it("marks in and out on a source video and adds the marked part", async () => {
    const user = userEvent.setup();
    const { onSourceRange, onAddSource, container, rerender, ...props } = renderPanel({
      mode: "source",
      sourceItem: clip,
    });
    const video = container.querySelector("video") as HTMLVideoElement;

    mediaClock(video, 1);
    await user.click(screen.getByRole("button", { name: "Mark in" }));
    expect(onSourceRange).toHaveBeenLastCalledWith({ start: 1, end: null });

    rerender(
      <PreviewPanel
        {...props}
        onSourceRange={onSourceRange}
        onAddSource={onAddSource}
        sourceRange={{ start: 1, end: null }}
      />,
    );
    mediaClock(video, 3);
    await user.click(screen.getByRole("button", { name: "Mark out" }));
    expect(onSourceRange).toHaveBeenLastCalledWith({ start: 1, end: 3 });

    await user.click(screen.getByRole("button", { name: "Clear in and out" }));
    expect(onSourceRange).toHaveBeenLastCalledWith({ start: 0, end: null });
    await user.click(screen.getByRole("button", { name: /Add to timeline/ }));
    expect(onAddSource).toHaveBeenCalled();
  });

  it("plays a source and lets the editor's keys drive it through its transport", async () => {
    const user = userEvent.setup();
    const transport = createRef<SourceTransport | null>();
    const { container, onSourceRange } = renderPanel({
      mode: "source",
      sourceItem: clip,
      sourceTransportRef: transport,
    });
    const video = container.querySelector("video") as HTMLVideoElement;
    mediaClock(video, 0);

    await user.click(screen.getByRole("button", { name: "Play source" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: "Pause source" })).toBeInTheDocument();
    fireEvent.pause(video);

    act(() => transport.current?.step(30));
    expect(video.currentTime).toBeCloseTo(1);
    act(() => transport.current?.seekToEdge("end"));
    expect(video.currentTime).toBe(4);
    act(() => transport.current?.markIn());
    expect(onSourceRange).toHaveBeenLastCalledWith({ start: 4, end: null });
  });

  it("shows a sound file's waveform and a still without a transport", () => {
    const { rerender, ...props } = renderPanel({
      mode: "source",
      sourceItem: makeItem("tone.wav", { media_type: "audio", duration: 2 }),
    });
    expect(document.querySelector(".video-editor__source-waveform")).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Source position" })).toBeInTheDocument();

    rerender(<PreviewPanel {...props} sourceItem={makeItem("still.png")} />);

    expect(screen.getByText("Still image")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Source position" })).not.toBeInTheDocument();
  });
});
