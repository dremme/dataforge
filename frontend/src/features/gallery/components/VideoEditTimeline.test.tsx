import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditTimeline } from "./VideoEditTimeline";
import { FRAME_STEP_SECONDS } from "@/features/gallery/lib/videoFrameCapture";

type Props = Parameters<typeof VideoEditTimeline>[0];

function renderTimeline(overrides: Partial<Props> = {}) {
  const props: Props = {
    duration: 12,
    trimStart: 2,
    trimEnd: 8,
    playheadTime: 3,
    playing: false,
    ready: true,
    disabled: false,
    onTrimStartChange: vi.fn(),
    onTrimEndChange: vi.fn(),
    onSeek: vi.fn(),
    onTogglePlay: vi.fn(),
    onSetStartAtPlayhead: vi.fn(),
    onSetEndAtPlayhead: vi.fn(),
    ...overrides,
  };

  render(<VideoEditTimeline {...props} />);
  return props;
}

const startHandle = () => screen.getByRole("slider", { name: "Trim start" });
const endHandle = () => screen.getByRole("slider", { name: "Trim end" });

describe("VideoEditTimeline", () => {
  it("exposes both handles as sliders reading their own timestamps", () => {
    renderTimeline();

    expect(startHandle()).toHaveAttribute("aria-valuenow", "2");
    expect(startHandle()).toHaveAttribute("aria-valuetext", "0:02.000");
    expect(endHandle()).toHaveAttribute("aria-valuenow", "8");
    expect(endHandle()).toHaveAttribute("aria-valuemax", "12");
  });

  it("steps one frame per arrow press", () => {
    const props = renderTimeline();

    fireEvent.keyDown(startHandle(), { key: "ArrowRight" });

    expect(props.onTrimStartChange).toHaveBeenCalledWith(2 + FRAME_STEP_SECONDS);
  });

  it("steps a whole second with Shift held", () => {
    const props = renderTimeline();

    fireEvent.keyDown(endHandle(), { key: "ArrowLeft", shiftKey: true });

    expect(props.onTrimEndChange).toHaveBeenCalledWith(7);
  });

  it("jumps to the bounds with Home and End", () => {
    const props = renderTimeline();

    fireEvent.keyDown(startHandle(), { key: "Home" });
    fireEvent.keyDown(endHandle(), { key: "End" });

    expect(props.onTrimStartChange).toHaveBeenCalledWith(0);
    expect(props.onTrimEndChange).toHaveBeenCalledWith(12);
  });

  it("ignores keys it does not own", () => {
    const props = renderTimeline();

    fireEvent.keyDown(startHandle(), { key: "a" });

    expect(props.onTrimStartChange).not.toHaveBeenCalled();
  });

  it("takes the in and out points from the playhead", () => {
    const props = renderTimeline();

    fireEvent.click(screen.getByRole("button", { name: "Set in" }));
    fireEvent.click(screen.getByRole("button", { name: "Set out" }));

    expect(props.onSetStartAtPlayhead).toHaveBeenCalled();
    expect(props.onSetEndAtPlayhead).toHaveBeenCalled();
  });

  it("shows the transport as play or pause", () => {
    renderTimeline({ playing: true });

    expect(screen.getByRole("button", { name: "Pause preview" })).toBeInTheDocument();
  });

  it("positions the band and the playhead from the values it is given", () => {
    renderTimeline();

    const track = screen.getByRole("group", { name: "Trim range" });
    expect(track).toHaveStyle({
      "--trim-start": "16.666666666666664%",
      "--trim-end": "66.66666666666666%",
    });
  });

  it("locks every control while the source is still loading", () => {
    renderTimeline({ ready: false });

    expect(startHandle()).toBeDisabled();
    expect(endHandle()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play preview" })).toBeDisabled();
  });

  it("locks itself rather than racing other modal work", () => {
    const props = renderTimeline({ disabled: true });

    fireEvent.keyDown(startHandle(), { key: "ArrowRight" });

    expect(props.onTrimStartChange).not.toHaveBeenCalled();
  });
});
