import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEditPanel } from "./VideoEditPanel";
import { emptyDraft, type VideoEditDraft } from "@/features/gallery/lib/videoEdit";
import {
  DEFAULT_MASK_MODE,
  DEFAULT_MASK_STRENGTH,
  newMaskDraft,
} from "@/features/gallery/lib/mask";
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
    maskActive: false,
    selectedMaskId: null,
    selectedMask: null,
    maskMode: DEFAULT_MASK_MODE,
    maskStrength: DEFAULT_MASK_STRENGTH,
    maskLimitReached: false,
    aspectId: "free",
    aspectRatio: null,
    muted: true,
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
    setMaskActive: vi.fn(),
    selectMask: vi.fn(),
    addMask: vi.fn(),
    setMaskRect: vi.fn(),
    setMaskMode: vi.fn(),
    setMaskStrength: vi.fn(),
    removeMask: vi.fn(),
    clearMasks: vi.fn(),
    selectAspect: vi.fn(),
    toggleMuted: vi.fn(),
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
    onRevertRequested: vi.fn(),
    ...overrides,
  };

  render(<VideoEditPanel {...props} />);
  return props;
}

/** Matches on the prefix: a tool holding a value reads "Speed, changed". */
const tool = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("VideoEditPanel", () => {
  describe("tools", () => {
    it("opens on the trim tool with the others collapsed", () => {
      renderPanel(makeEdit());

      expect(tool("Trim")).toHaveAttribute("aria-pressed", "true");
      expect(tool("Speed")).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByRole("button", { name: "2x" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Set in" })).toBeInTheDocument();
    });

    it("shows one tool at a time", () => {
      renderPanel(makeEdit());

      fireEvent.click(tool("Speed"));

      expect(screen.getByRole("button", { name: "2x" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Set in" })).not.toBeInTheDocument();
    });

    it("brings the crop handles out with the crop tool, and puts them away after", () => {
      const edit = makeEdit();
      renderPanel(edit);

      fireEvent.click(tool("Crop"));
      expect(edit.setCropActive).toHaveBeenLastCalledWith(true);

      fireEvent.click(tool("Size"));
      expect(edit.setCropActive).toHaveBeenLastCalledWith(false);
    });

    it("arms the tool it opens on, rather than waiting to be switched away and back", () => {
      const edit = makeEdit();

      renderPanel(edit);

      // Trim owns no gizmo, so opening on it stows both.
      expect(edit.setCropActive).toHaveBeenLastCalledWith(false);
      expect(edit.setMaskActive).toHaveBeenLastCalledWith(false);
    });

    it("brings the region handles out with the blur tool", () => {
      const edit = makeEdit();
      renderPanel(edit);

      fireEvent.click(tool("Blur"));
      expect(edit.setMaskActive).toHaveBeenLastCalledWith(true);
      expect(edit.setCropActive).toHaveBeenLastCalledWith(false);

      fireEvent.click(tool("Crop"));
      expect(edit.setMaskActive).toHaveBeenLastCalledWith(false);
    });

    it("marks a tool whose value is no longer the default", () => {
      // The whole point of collapsing them: nothing may hide behind a closed tool.
      const draft = { ...emptyDraft(12), speed: 2 };
      renderPanel(makeEdit({ draft }));

      expect(screen.getByRole("button", { name: "Speed, changed" })).toBeInTheDocument();
      expect(tool("Size")).toBeInTheDocument();
    });

    it.each([
      ["Trim", { trimEnd: 8 }],
      ["Crop", { crop: { x: 0, y: 0, width: 0.5, height: 1 } }],
      ["Speed", { speed: 2 }],
      ["Size", { scale: 0.5 }],
      ["Blur", { masks: [newMaskDraft("blur", 0.12, 0)] }],
    ])("marks %s when it holds a value", (label, overrides) => {
      renderPanel(makeEdit({ draft: { ...emptyDraft(12), ...overrides } }));

      expect(screen.getByRole("button", { name: `${label}, changed` })).toBeInTheDocument();
    });
  });

  describe("the output readout", () => {
    it("stays visible whichever tool is open", () => {
      renderPanel(makeEdit({ outputWidth: 960, outputHeight: 540, outputSeconds: 4 }));

      const shown = () => screen.getByText(/960 x 540/);
      expect(shown()).toBeInTheDocument();
      fireEvent.click(tool("Crop"));
      expect(shown()).toBeInTheDocument();
    });

    it("reports the source and what it will become", () => {
      renderPanel(makeEdit({ outputWidth: 960, outputHeight: 540, outputSeconds: 4 }));

      expect(screen.getByText(/1920 x 1080/)).toBeInTheDocument();
      expect(screen.getByText(/960 x 540/)).toBeInTheDocument();
      expect(screen.getByText(/0:04.000/)).toBeInTheDocument();
    });

    it("says the timeline is still loading before metadata lands", () => {
      renderPanel(makeEdit({ ready: false }));

      expect(screen.getByText("The timeline loads with the video.")).toBeInTheDocument();
    });
  });

  describe("controls", () => {
    it("takes the in and out points from the playhead", () => {
      const edit = makeEdit();
      renderPanel(edit);

      fireEvent.click(screen.getByRole("button", { name: "Set in" }));
      fireEvent.click(screen.getByRole("button", { name: "Set out" }));

      expect(edit.setTrimStartAtPlayhead).toHaveBeenCalled();
      expect(edit.setTrimEndAtPlayhead).toHaveBeenCalled();
    });

    it("changes the speed from a preset", () => {
      const edit = makeEdit();
      renderPanel(edit);

      fireEvent.click(tool("Speed"));
      fireEvent.click(screen.getByRole("button", { name: "0.5x" }));

      expect(edit.setSpeed).toHaveBeenCalledWith(0.5);
    });

    it("marks the active speed and scale presets", () => {
      const draft = { ...emptyDraft(12), speed: 2, scale: 0.5 };
      renderPanel(makeEdit({ draft }));

      fireEvent.click(tool("Speed"));
      expect(screen.getByRole("button", { name: "2x" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(tool("Size"));
      expect(screen.getByRole("button", { name: "50%" })).toHaveAttribute("aria-pressed", "true");
    });

    it("offers a free rectangle and a shape for each orientation, and no fields", () => {
      renderPanel(makeEdit());

      fireEvent.click(tool("Crop"));

      const shapes = within(screen.getByRole("group", { name: "Aspect" }))
        .getAllByRole("button")
        .map((b) => b.textContent?.trim());
      expect(shapes).toEqual(["Free", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"]);
      expect(screen.queryByLabelText("X")).not.toBeInTheDocument();
    });

    it("starts free and locks to the shape that is picked", () => {
      const edit = makeEdit();
      renderPanel(edit);

      fireEvent.click(tool("Crop"));
      expect(screen.getByRole("button", { name: "Free" })).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(screen.getByRole("button", { name: "1:1" }));

      expect(edit.selectAspect).toHaveBeenCalledWith("1:1");
    });

    it("shows the shape the editor holds, so a restored crop is not read as free", () => {
      renderPanel(makeEdit({ aspectId: "16:9", aspectRatio: 16 / 9 }));

      fireEvent.click(tool("Crop"));

      expect(screen.getByRole("button", { name: "16:9" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Free" })).toHaveAttribute("aria-pressed", "false");
    });

    it("sets both output dimensions, either one moving the other", () => {
      const edit = makeEdit({ outputWidth: 1920, outputHeight: 1080 });
      renderPanel(edit);

      fireEvent.click(tool("Size"));
      expect(screen.getByLabelText("W")).toHaveValue(1920);
      expect(screen.getByLabelText("H")).toHaveValue(1080);

      fireEvent.change(screen.getByLabelText("H"), { target: { value: "540" } });

      expect(edit.setScale).toHaveBeenCalledWith(0.5);
    });

    it("lets a width be typed without snapping back to the last output size", () => {
      const edit = makeEdit({ outputWidth: 1920, outputHeight: 1080 });
      renderPanel(edit);
      fireEvent.click(tool("Size"));

      fireEvent.change(screen.getByLabelText("W"), { target: { value: "9" } });

      expect(screen.getByLabelText("W")).toHaveValue(9);
    });

    it("does not treat a cleared field as a scale of zero", () => {
      const edit = makeEdit({ outputWidth: 1920, outputHeight: 1080 });
      renderPanel(edit);
      fireEvent.click(tool("Size"));

      fireEvent.change(screen.getByLabelText("W"), { target: { value: "" } });

      expect(edit.setScale).not.toHaveBeenCalled();
    });

    it("offers every speed from a quarter to double", () => {
      renderPanel(makeEdit());

      fireEvent.click(tool("Speed"));

      const speeds = within(screen.getByRole("group", { name: "Playback" }))
        .getAllByRole("button")
        .map((b) => b.textContent?.trim());
      expect(speeds).toEqual(["0.25x", "0.5x", "0.75x", "1x", "1.25x", "1.5x", "1.75x", "2x"]);
    });
  });

  describe("blur regions", () => {
    function openBlur(edit: VideoEdit) {
      renderPanel(edit);
      fireEvent.click(tool("Blur"));
    }

    it("adds a region", () => {
      const edit = makeEdit();
      openBlur(edit);

      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(edit.addMask).toHaveBeenCalled();
    });

    it("stops offering to add one past the cap", () => {
      const edit = makeEdit({ maskLimitReached: true });
      openBlur(edit);

      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    });

    it("switches the selected region between blurred and pixelated", () => {
      const edit = makeEdit();
      openBlur(edit);

      const styles = within(screen.getByRole("group", { name: "Blur style" }));
      fireEvent.click(styles.getByRole("button", { name: "Pixelate" }));

      expect(edit.setMaskMode).toHaveBeenCalledWith("pixelate");
    });

    it("blacks a region out, and stops offering a strength that would do nothing", () => {
      const edit = makeEdit({ maskMode: "blackout" });
      openBlur(edit);

      const styles = within(screen.getByRole("group", { name: "Blur style" }));
      fireEvent.click(styles.getByRole("button", { name: "Blackout" }));
      expect(edit.setMaskMode).toHaveBeenCalledWith("blackout");

      const strengths = within(screen.getByRole("group", { name: "Strength" }));
      expect(strengths.getByRole("button", { name: "Medium" })).toBeDisabled();
    });

    it("sets the strength", () => {
      const edit = makeEdit();
      openBlur(edit);

      const strengths = within(screen.getByRole("group", { name: "Strength" }));
      fireEvent.click(strengths.getByRole("button", { name: "Max" }));

      expect(edit.setMaskStrength).toHaveBeenCalledWith(0.4);
    });

    it("has nothing to clear until a region is there", () => {
      openBlur(makeEdit());

      expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    });

    it("clears every region at once", () => {
      const mask = newMaskDraft("blur", 0.12, 0);
      const edit = makeEdit({
        draft: { ...emptyDraft(12), masks: [mask] },
        selectedMaskId: mask.id,
        selectedMask: mask,
      });
      openBlur(edit);

      fireEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(edit.clearMasks).toHaveBeenCalled();
    });

    it("counts the regions in the readout", () => {
      renderPanel(
        makeEdit({ draft: { ...emptyDraft(12), masks: [newMaskDraft("blur", 0.12, 0)] } }),
      );

      expect(screen.getByText("1 masked region")).toBeInTheDocument();
    });
  });

  describe("actions", () => {
    it("cannot apply an edit that would change nothing", () => {
      renderPanel(makeEdit({ dirty: false }));

      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    });

    it("offers Apply once the draft differs from the file", () => {
      renderPanel(makeEdit({ dirty: true }));

      expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    });

    it("hands the only reset there is back to the saved state", () => {
      const edit = makeEdit({ dirty: true });
      renderPanel(edit);

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));

      expect(edit.resetDraft).toHaveBeenCalled();
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

    it("stays in place when the tool changes", () => {
      renderPanel(makeEdit({ dirty: true }));

      fireEvent.click(tool("Crop"));

      expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
    });

    it("counts the render down as a percentage, with a cancel beside it", () => {
      const edit = makeEdit({ applying: true, progress: 0.4 });
      renderPanel(edit);

      const readout = screen.getByRole("progressbar", { name: "Rendering" });
      expect(readout).toHaveAttribute("aria-valuenow", "40");
      expect(readout).toHaveTextContent("40%");
      expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(edit.cancel).toHaveBeenCalled();
    });

    it("names no number when the output length could not be predicted", () => {
      // The spinner carries it alone rather than inventing a position.
      renderPanel(makeEdit({ applying: true, progress: null }));

      const readout = screen.getByRole("progressbar", { name: "Rendering" });
      expect(readout).not.toHaveAttribute("aria-valuenow");
      expect(readout).toHaveTextContent("Rendering");
      expect(readout.textContent).not.toMatch(/%/);
    });

    it("locks every control while other modal work is in flight", () => {
      renderPanel(makeEdit({ dirty: true }), { busy: true });

      expect(tool("Speed")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Set in" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    });
  });
});
