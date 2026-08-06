import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FRAME_STEP_SECONDS, formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import { FrameCaptureBar } from "./FrameCaptureBar";

/** The video wiring: seconds on the slider, timestamps in the readout. */
function renderTimeBar(overrides: Partial<Parameters<typeof FrameCaptureBar>[0]> = {}) {
  const duration = overrides.max ?? 10;
  const value = overrides.value ?? 2.5;
  const props = {
    min: 0,
    max: duration,
    step: FRAME_STEP_SECONDS,
    value,
    ready: true,
    saving: false,
    busy: false,
    currentLabel: formatFrameTime(value),
    totalLabel: formatFrameTime(duration),
    hint: "Frame times load with the video.",
    onValueChange: vi.fn(),
    onStepFrame: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };

  render(<FrameCaptureBar {...props} />);
  return props;
}

/** The GIF wiring: whole frame indices, one-based ordinals in the readout. */
function renderIndexBar(overrides: Partial<Parameters<typeof FrameCaptureBar>[0]> = {}) {
  const props = {
    min: 0,
    max: 23,
    step: 1,
    value: 6,
    ready: true,
    saving: false,
    busy: false,
    currentLabel: "7",
    totalLabel: "24",
    hint: "Frame count loads with the GIF.",
    onValueChange: vi.fn(),
    onStepFrame: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };

  render(<FrameCaptureBar {...props} />);
  return props;
}

const slider = () => screen.getByRole("slider", { name: "Frame position" });
const saveButton = () => screen.getByRole("button", { name: /save frame|saving/i });

describe("FrameCaptureBar in time mode", () => {
  it("spans the video duration and shows both ends of the readout", () => {
    renderTimeBar();

    expect(slider()).toHaveAttribute("max", "10");
    expect(slider()).toHaveAttribute("step", String(FRAME_STEP_SECONDS));
    expect(screen.getByText("0:02.500")).toBeInTheDocument();
    expect(screen.getByText("0:10.000")).toBeInTheDocument();
  });

  it("reports the scrubbed time as a number", () => {
    const props = renderTimeBar();

    // `userEvent` cannot drag a range input, so the value is set directly. Do not
    // "fix" this into a pointer interaction — it silently stops asserting anything.
    fireEvent.change(slider(), { target: { value: "4.5" } });

    expect(props.onValueChange).toHaveBeenCalledWith(4.5);
  });

  it("nudges a frame in each direction", async () => {
    const user = userEvent.setup();
    const props = renderTimeBar();

    await user.click(screen.getByRole("button", { name: "Previous frame" }));
    await user.click(screen.getByRole("button", { name: "Next frame" }));

    expect(props.onStepFrame).toHaveBeenNthCalledWith(1, -1);
    expect(props.onStepFrame).toHaveBeenNthCalledWith(2, 1);
  });

  it("fills the track up to the scrubbed position", () => {
    renderTimeBar({ max: 8, value: 2 });

    expect(slider().style.getPropertyValue("--frame-progress")).toBe("25%");
  });

  it("waits for metadata before offering the controls", () => {
    renderTimeBar({ ready: false, max: Number.NaN });

    expect(slider()).toBeDisabled();
    expect(slider()).toHaveAttribute("max", "1");
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Frame times load with the video.")).toBeInTheDocument();
  });

  it("locks the controls while other modal work runs", () => {
    renderTimeBar({ busy: true });

    expect(slider()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeDisabled();
  });

  it("marks itself busy while saving", () => {
    renderTimeBar({ saving: true });

    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute("aria-busy", "true");
    expect(saveButton()).toHaveTextContent("Saving");
  });

  it("saves once per click", async () => {
    const user = userEvent.setup();
    const props = renderTimeBar();

    await user.click(saveButton());

    expect(props.onSave).toHaveBeenCalledTimes(1);
  });
});

describe("FrameCaptureBar in index mode", () => {
  it("steps whole frames and reads out one-based ordinals", () => {
    renderIndexBar();

    expect(slider()).toHaveAttribute("max", "23");
    // A step of one is what makes a focused slider's arrow keys move exactly one frame.
    expect(slider()).toHaveAttribute("step", "1");
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("reports the scrubbed index", () => {
    const props = renderIndexBar();

    fireEvent.change(slider(), { target: { value: "11" } });

    expect(props.onValueChange).toHaveBeenCalledWith(11);
  });

  it("fills the track across the frame range", () => {
    renderIndexBar({ max: 20, value: 5 });

    expect(slider().style.getPropertyValue("--frame-progress")).toBe("25%");
  });

  it("still allows saving a single-frame source", () => {
    renderIndexBar({ max: 0, value: 0, currentLabel: "1", totalLabel: "1" });

    // No span to scrub, but the one frame it has is still worth writing out.
    expect(slider()).toHaveAttribute("max", "1");
    expect(saveButton()).toBeEnabled();
  });

  it("shows the GIF hint before the frame count lands", () => {
    renderIndexBar({ ready: false, max: 0 });

    expect(slider()).toBeDisabled();
    expect(screen.getByText("Frame count loads with the GIF.")).toBeInTheDocument();
  });
});
