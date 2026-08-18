import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditPanel } from "./VideoEditPanel";
import { emptyDraft, type VideoEditDraft } from "@/features/gallery/lib/videoEdit";
import type { VideoEdit } from "@/features/gallery/hooks/useVideoEdit";

function makeEdit(overrides: Partial<VideoEdit> = {}): VideoEdit {
  const draft: VideoEditDraft = overrides.draft ?? emptyDraft(12);

  return {
    editMode: true,
    ready: true,
    applying: false,
    progress: null,
    draft,
    duration: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    hasBackup: false,
    dirty: false,
    cropActive: false,
    playing: false,
    playheadTime: 0,
    outputWidth: 1920,
    outputHeight: 1080,
    outputSeconds: 12,
    toggleEditMode: vi.fn(),
    exitEditMode: vi.fn(),
    setTrimStart: vi.fn(),
    setTrimEnd: vi.fn(),
    setTrimStartAtPlayhead: vi.fn(),
    setTrimEndAtPlayhead: vi.fn(),
    setCrop: vi.fn(),
    setCropActive: vi.fn(),
    setSpeed: vi.fn(),
    setScale: vi.fn(),
    seekTo: vi.fn(),
    togglePlay: vi.fn(),
    resetDraft: vi.fn(),
    apply: vi.fn(),
    cancel: vi.fn(),
    revert: vi.fn(),
    handleLoadedMetadata: vi.fn(),
    ...overrides,
  };
}

function renderPanel(
  edit: VideoEdit,
  overrides: Partial<Parameters<typeof VideoEditPanel>[0]> = {},
) {
  const props = {
    edit,
    busy: false,
    aspectId: "free",
    onAspectChange: vi.fn(),
    onRevertRequested: vi.fn(),
    ...overrides,
  };

  render(<VideoEditPanel {...props} />);
  return props;
}

describe("VideoEditPanel", () => {
  it("cannot apply an edit that would change nothing", () => {
    renderPanel(makeEdit({ dirty: false }));

    expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled();
  });

  it("offers Apply once the draft differs from the file", () => {
    renderPanel(makeEdit({ dirty: true }));

    expect(screen.getByRole("button", { name: /Apply/ })).toBeEnabled();
  });

  it("marks the active speed and scale presets", () => {
    const draft = { ...emptyDraft(12), speed: 2, scale: 0.5 };
    renderPanel(makeEdit({ draft }));

    expect(screen.getByRole("button", { name: "2x" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "50%" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "false");
  });

  it("changes the speed from a preset", () => {
    const edit = makeEdit();
    renderPanel(edit);

    fireEvent.click(screen.getByRole("button", { name: "0.5x" }));

    expect(edit.setSpeed).toHaveBeenCalledWith(0.5);
  });

  it("reports the source and the predicted output", () => {
    renderPanel(makeEdit({ outputWidth: 960, outputHeight: 540, outputSeconds: 4, duration: 12 }));

    expect(screen.getByText(/1920 x 1080 to 960 x 540/)).toBeInTheDocument();
    expect(screen.getByText(/0:12.000 to 0:04.000/)).toBeInTheDocument();
  });

  it("says the timeline is still loading before metadata lands", () => {
    renderPanel(makeEdit({ ready: false }));

    expect(screen.getByText("The timeline loads with the video.")).toBeInTheDocument();
  });

  it("hides Revert until an original has been stored", () => {
    renderPanel(makeEdit({ hasBackup: false }));

    expect(screen.queryByRole("button", { name: /Revert original/ })).not.toBeInTheDocument();
  });

  it("asks before reverting rather than doing it outright", () => {
    const edit = makeEdit({ hasBackup: true });
    const props = renderPanel(edit);

    fireEvent.click(screen.getByRole("button", { name: /Revert original/ }));

    expect(props.onRevertRequested).toHaveBeenCalled();
    expect(edit.revert).not.toHaveBeenCalled();
  });

  it("shows a progress bar and a cancel while rendering", () => {
    const edit = makeEdit({ applying: true, progress: 0.4 });
    renderPanel(edit);

    const bar = screen.getByRole("progressbar", { name: "Rendering" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveStyle({ "--edit-progress": "40%" });
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(edit.cancel).toHaveBeenCalled();
  });

  it("leaves the bar unpositioned when the output length is unknown", () => {
    renderPanel(makeEdit({ applying: true, progress: null }));

    expect(screen.getByRole("progressbar", { name: "Rendering" })).not.toHaveAttribute(
      "aria-valuenow",
    );
  });

  it("shows the crop rectangle in source pixels", () => {
    const draft = { ...emptyDraft(12), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };
    renderPanel(makeEdit({ draft }));

    expect(screen.getByLabelText("X")).toHaveValue(480);
    expect(screen.getByLabelText("W")).toHaveValue(960);
  });

  it("resets the crop back to the whole frame", () => {
    const edit = makeEdit();
    const props = renderPanel(edit);

    fireEvent.click(screen.getByRole("button", { name: "Reset crop" }));

    expect(edit.setCrop).toHaveBeenCalledWith({ x: 0, y: 0, width: 1, height: 1 });
    expect(props.onAspectChange).toHaveBeenCalledWith("free");
  });

  it("locks every control while other modal work is in flight", () => {
    renderPanel(makeEdit({ dirty: true }), { busy: true });

    expect(screen.getByRole("button", { name: "2x" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled();
  });
});
