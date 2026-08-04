import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FRAME_STEP_SECONDS } from "@/features/gallery/lib/videoFrameCapture";
import { VideoFrameCaptureBar } from "./VideoFrameCaptureBar";

function renderBar(overrides: Partial<Parameters<typeof VideoFrameCaptureBar>[0]> = {}) {
  const props = {
    duration: 10,
    ready: true,
    sliderTime: 2.5,
    displayTime: 2.5,
    saving: false,
    busy: false,
    onSliderTimeChange: vi.fn(),
    onStepFrame: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };

  render(<VideoFrameCaptureBar {...props} />);
  return props;
}

const slider = () => screen.getByRole("slider", { name: "Frame position" });
const saveButton = () => screen.getByRole("button", { name: /save frame|saving/i });

describe("VideoFrameCaptureBar", () => {
  it("spans the video duration and shows both ends of the readout", () => {
    renderBar();

    expect(slider()).toHaveAttribute("max", "10");
    expect(slider()).toHaveAttribute("step", String(FRAME_STEP_SECONDS));
    expect(screen.getByText("0:02.500")).toBeInTheDocument();
    expect(screen.getByText("0:10.000")).toBeInTheDocument();
  });

  it("reports the scrubbed time as a number", () => {
    const props = renderBar();

    // `userEvent` cannot drag a range input, so the value is set directly. Do not
    // "fix" this into a pointer interaction — it silently stops asserting anything.
    fireEvent.change(slider(), { target: { value: "4.5" } });

    expect(props.onSliderTimeChange).toHaveBeenCalledWith(4.5);
  });

  it("nudges a frame in each direction", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Previous frame" }));
    await user.click(screen.getByRole("button", { name: "Next frame" }));

    expect(props.onStepFrame).toHaveBeenNthCalledWith(1, -1);
    expect(props.onStepFrame).toHaveBeenNthCalledWith(2, 1);
  });

  it("fills the track up to the scrubbed position", () => {
    renderBar({ duration: 8, sliderTime: 2 });

    expect(slider().style.getPropertyValue("--frame-progress")).toBe("25%");
  });

  it("waits for metadata before offering the controls", () => {
    renderBar({ ready: false, duration: Number.NaN });

    expect(slider()).toBeDisabled();
    expect(slider()).toHaveAttribute("max", "1");
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Frame times load with the video.")).toBeInTheDocument();
  });

  it("locks the controls while other modal work runs", () => {
    renderBar({ busy: true });

    expect(slider()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeDisabled();
  });

  it("marks itself busy while saving", () => {
    renderBar({ saving: true });

    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute("aria-busy", "true");
    expect(saveButton()).toHaveTextContent("Saving");
  });

  it("saves once per click", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(saveButton());

    expect(props.onSave).toHaveBeenCalledTimes(1);
  });
});
