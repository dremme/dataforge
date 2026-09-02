import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImageEditPanel } from "./ImageEditPanel";
import {
  emptyDraft,
  orientationOf,
  outputDimensions,
  type ImageEditDraft,
} from "@/features/gallery/lib/imageEdit";
import {
  DEFAULT_MASK_MODE,
  DEFAULT_MASK_STRENGTH,
  newMaskDraft,
} from "@/features/gallery/lib/mask";
import type { ImageEdit } from "@/features/gallery/hooks/useImageEdit";

const SOURCE = { width: 1920, height: 1080 };

function makeEdit(overrides: Partial<ImageEdit> = {}): ImageEdit {
  const draft: ImageEditDraft = overrides.draft ?? emptyDraft();
  const output = outputDimensions(SOURCE, draft.crop, draft.rotate, draft.scale);

  return {
    editMode: true,
    ready: true,
    applying: false,
    draft,
    sourceWidth: SOURCE.width,
    sourceHeight: SOURCE.height,
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
    orientation: orientationOf(draft),
    outputWidth: output.width,
    outputHeight: output.height,
    toggleEditMode: vi.fn(),
    exitEditMode: vi.fn(),
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
    rotateClockwise: vi.fn(),
    rotateCounterClockwise: vi.fn(),
    toggleMirrorH: vi.fn(),
    toggleMirrorV: vi.fn(),
    setScale: vi.fn(),
    setBrightness: vi.fn(),
    setContrast: vi.fn(),
    setSaturation: vi.fn(),
    setWarmth: vi.fn(),
    setHue: vi.fn(),
    resetColor: vi.fn(),
    resetDraft: vi.fn(),
    apply: vi.fn(),
    revert: vi.fn(),
    handleLoad: vi.fn(),
    ...overrides,
  };
}

function renderPanel(
  edit: ImageEdit,
  overrides: Partial<Parameters<typeof ImageEditPanel>[0]> = {},
) {
  const props = {
    edit,
    busy: false,
    onRevertRequested: vi.fn(),
    ...overrides,
  };

  render(<ImageEditPanel {...props} />);
  return props;
}

/** The hover delay Tooltip defaults to. */
const TOOLTIP_DELAY_MS = 400;

function draftWith(overrides: Partial<ImageEditDraft>): ImageEditDraft {
  return { ...emptyDraft(), ...overrides };
}

function tools() {
  return within(screen.getByRole("group", { name: "Editing tool" }));
}

describe("ImageEditPanel", () => {
  describe("tools", () => {
    it("opens on the crop tool", () => {
      renderPanel(makeEdit());

      expect(tools().getByRole("button", { name: "Crop" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("group", { name: "Aspect" })).toBeInTheDocument();
    });

    it("shows one tool's controls at a time", async () => {
      const user = userEvent.setup();
      renderPanel(makeEdit());

      await user.click(tools().getByRole("button", { name: "Size" }));

      expect(screen.getByRole("group", { name: "Scale" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Aspect" })).not.toBeInTheDocument();
    });

    it("arms the tool it opens on, rather than waiting to be switched away and back", () => {
      const edit = makeEdit();

      renderPanel(edit);

      expect(edit.setCropActive).toHaveBeenLastCalledWith(true);
      expect(edit.setMaskActive).toHaveBeenLastCalledWith(false);
    });

    it("arms the crop handles when the crop tool is selected, and stows them otherwise", async () => {
      const user = userEvent.setup();
      const edit = makeEdit();
      renderPanel(edit);

      await user.click(tools().getByRole("button", { name: "Rotate" }));
      expect(edit.setCropActive).toHaveBeenLastCalledWith(false);

      await user.click(tools().getByRole("button", { name: "Crop" }));
      expect(edit.setCropActive).toHaveBeenLastCalledWith(true);
    });

    it("arms the region handles the same way", async () => {
      const user = userEvent.setup();
      const edit = makeEdit();
      renderPanel(edit);

      await user.click(tools().getByRole("button", { name: "Blur" }));
      expect(edit.setMaskActive).toHaveBeenLastCalledWith(true);
      expect(edit.setCropActive).toHaveBeenLastCalledWith(false);

      await user.click(tools().getByRole("button", { name: "Crop" }));
      expect(edit.setMaskActive).toHaveBeenLastCalledWith(false);
    });

    it.each([
      ["Crop", draftWith({ crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } })],
      ["Rotate", draftWith({ rotate: 90 })],
      ["Rotate", draftWith({ mirrorH: true })],
      ["Rotate", draftWith({ mirrorV: true })],
      ["Size", draftWith({ scale: 0.5 })],
      ["Blur", draftWith({ masks: [newMaskDraft("blur", 0.12, 0)] })],
    ])("says %s holds a value once it is off its default", (label, draft) => {
      // Collapsed, the tool is the only thing that can say it carries a change.
      renderPanel(makeEdit({ draft }));

      expect(tools().getByRole("button", { name: `${label}, changed` })).toBeInTheDocument();
    });

    it("says nothing extra while every tool is at its default", () => {
      renderPanel(makeEdit());

      expect(tools().queryByRole("button", { name: /, changed$/ })).not.toBeInTheDocument();
    });
  });

  describe("rotate", () => {
    async function openRotate() {
      const user = userEvent.setup();
      await user.click(tools().getByRole("button", { name: /^Rotate/ }));
      return user;
    }

    it.each([
      ["Rotate left", "rotateCounterClockwise"],
      ["Rotate right", "rotateClockwise"],
    ] as const)("turns through %s", async (label, method) => {
      const edit = makeEdit();
      renderPanel(edit);
      const user = await openRotate();

      await user.click(screen.getByRole("button", { name: label }));

      expect(edit[method]).toHaveBeenCalled();
    });

    it("offers the quarter turns alone, since two of one are a half turn", async () => {
      renderPanel(makeEdit());
      await openRotate();

      expect(screen.queryByRole("button", { name: "180°" })).not.toBeInTheDocument();
    });

    it("leaves the quarter turns unpressed, because they compose rather than latch", async () => {
      renderPanel(makeEdit({ draft: draftWith({ rotate: 90 }) }));
      await openRotate();

      expect(screen.getByRole("button", { name: "Rotate right" })).not.toHaveAttribute(
        "aria-pressed",
      );
    });

    it.each([
      ["Flip hori.", "toggleMirrorH", { mirrorH: true }],
      ["Flip vert.", "toggleMirrorV", { mirrorV: true }],
    ] as const)("holds %s pressed while it is on", async (label, method, applied) => {
      const edit = makeEdit({ draft: draftWith(applied) });
      renderPanel(edit);
      const user = await openRotate();

      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-pressed", "true");

      await user.click(button);
      expect(edit[method]).toHaveBeenCalled();
    });
  });

  describe("crop", () => {
    it("locks the rectangle to a listed shape", async () => {
      const user = userEvent.setup();
      const edit = makeEdit();
      renderPanel(edit);

      await user.click(within(screen.getByRole("group", { name: "Aspect" })).getByText("1:1"));

      expect(edit.selectAspect).toHaveBeenCalledWith("1:1");
    });

    it("shows which shape the rectangle already has", () => {
      renderPanel(makeEdit({ aspectId: "16:9" }));

      const aspects = within(screen.getByRole("group", { name: "Aspect" }));
      expect(aspects.getByRole("button", { name: "16:9" })).toHaveAttribute("aria-pressed", "true");
      expect(aspects.getByRole("button", { name: "Free" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  describe("blur", () => {
    async function openBlur(edit: ImageEdit) {
      const user = userEvent.setup();
      renderPanel(edit);
      await user.click(tools().getByRole("button", { name: /^Blur/ }));
      return user;
    }

    it("adds a region", async () => {
      const edit = makeEdit();
      const user = await openBlur(edit);

      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(edit.addMask).toHaveBeenCalled();
    });

    it("stops offering to add one past the cap", async () => {
      const edit = makeEdit({ maskLimitReached: true });
      await openBlur(edit);

      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    });

    it("switches the selected region between blurred and pixelated", async () => {
      const edit = makeEdit();
      const user = await openBlur(edit);

      const styles = within(screen.getByRole("group", { name: "Blur style" }));
      await user.click(styles.getByRole("button", { name: "Pixelate" }));

      expect(edit.setMaskMode).toHaveBeenCalledWith("pixelate");
    });

    it("blacks a region out, and stops offering a strength that would do nothing", async () => {
      const edit = makeEdit({ maskMode: "blackout" });
      const user = await openBlur(edit);

      const styles = within(screen.getByRole("group", { name: "Blur style" }));
      await user.click(styles.getByRole("button", { name: "Blackout" }));
      expect(edit.setMaskMode).toHaveBeenCalledWith("blackout");

      const strengths = within(screen.getByRole("group", { name: "Strength" }));
      expect(strengths.getByRole("button", { name: "Medium" })).toBeDisabled();
    });

    it("leaves the strengths alive for a mode that measures one", async () => {
      await openBlur(makeEdit({ maskMode: "pixelate" }));

      const strengths = within(screen.getByRole("group", { name: "Strength" }));
      expect(strengths.getByRole("button", { name: "Medium" })).toBeEnabled();
    });

    it("shows which style and strength the selected region carries", async () => {
      const mask = { ...newMaskDraft("pixelate", 0.22, 0) };
      const edit = makeEdit({
        draft: draftWith({ masks: [mask] }),
        selectedMaskId: mask.id,
        selectedMask: mask,
        maskMode: "pixelate",
        maskStrength: 0.22,
      });
      await openBlur(edit);

      const styles = within(screen.getByRole("group", { name: "Blur style" }));
      expect(styles.getByRole("button", { name: "Pixelate" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const strengths = within(screen.getByRole("group", { name: "Strength" }));
      expect(strengths.getByRole("button", { name: "Strong" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("sets the strength", async () => {
      const edit = makeEdit();
      const user = await openBlur(edit);

      const strengths = within(screen.getByRole("group", { name: "Strength" }));
      await user.click(strengths.getByRole("button", { name: "Max" }));

      expect(edit.setMaskStrength).toHaveBeenCalledWith(0.4);
    });

    it("has nothing to clear until a region is there", async () => {
      await openBlur(makeEdit());

      expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    });

    it("clears every region at once", async () => {
      const mask = newMaskDraft("blur", 0.12, 0);
      const edit = makeEdit({
        draft: draftWith({ masks: [mask] }),
        selectedMaskId: mask.id,
        selectedMask: mask,
      });
      const user = await openBlur(edit);

      await user.click(screen.getByRole("button", { name: "Clear" }));

      expect(edit.clearMasks).toHaveBeenCalled();
    });
  });

  describe("color", () => {
    async function openColor() {
      const user = userEvent.setup();
      await user.click(tools().getByRole("button", { name: /^Color/ }));
      return user;
    }

    it("moves a color from its slider", async () => {
      const edit = makeEdit();
      renderPanel(edit);
      await openColor();

      fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
        target: { value: "1.3" },
      });
      expect(edit.setBrightness).toHaveBeenCalledWith(1.3);

      fireEvent.change(screen.getByRole("slider", { name: "Warmth" }), {
        target: { value: "-0.5" },
      });
      expect(edit.setWarmth).toHaveBeenCalledWith(-0.5);
    });

    it("offers every color control the tool carries", async () => {
      renderPanel(makeEdit());
      await openColor();

      for (const name of ["Brightness", "Contrast", "Saturation", "Warmth", "Hue"]) {
        expect(screen.getByRole("slider", { name })).toBeInTheDocument();
      }
    });

    it("explains what a control does on hover, since its only label is an icon", async () => {
      renderPanel(makeEdit());
      await openColor();
      const slider = screen.getByRole("slider", { name: "Saturation" });

      vi.useFakeTimers();
      fireEvent.mouseEnter(slider.closest(".tooltip")!);
      await act(async () => {
        vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
      });

      expect(screen.getByRole("tooltip")).toHaveTextContent("Saturation");
      vi.useRealTimers();
    });

    it("resets the colors when something is off default", async () => {
      const edit = makeEdit({ draft: draftWith({ hue: 90 }) });
      renderPanel(edit);
      const user = await openColor();

      await user.click(screen.getByRole("button", { name: "Reset colors" }));
      expect(edit.resetColor).toHaveBeenCalled();
    });

    it("leaves nothing to reset while the colors are untouched", async () => {
      renderPanel(makeEdit());
      await openColor();

      expect(screen.getByRole("button", { name: "Reset colors" })).toBeDisabled();
    });
  });

  describe("size", () => {
    async function openSize() {
      const user = userEvent.setup();
      await user.click(tools().getByRole("button", { name: /^Size/ }));
      return user;
    }

    it("sets a scale from a preset", async () => {
      const edit = makeEdit();
      renderPanel(edit);
      const user = await openSize();

      await user.click(within(screen.getByRole("group", { name: "Scale" })).getByText("50%"));

      expect(edit.setScale).toHaveBeenCalledWith(0.5);
    });

    it("shows the output size in both fields", async () => {
      renderPanel(makeEdit({ draft: draftWith({ scale: 0.5 }) }));
      await openSize();

      expect(screen.getByLabelText("W")).toHaveValue(960);
      expect(screen.getByLabelText("H")).toHaveValue(540);
    });

    it("resolves a typed width into the one scale the spec carries", async () => {
      const edit = makeEdit();
      renderPanel(edit);
      await openSize();

      fireEvent.change(screen.getByLabelText("W"), { target: { value: "960" } });

      expect(vi.mocked(edit.setScale).mock.calls[0][0]).toBeCloseTo(0.5);
    });

    it("measures a typed width against the turned frame", async () => {
      // Sideways, 1080 is the whole width; resolving 540 against unrotated 1920 would shrink it by half.
      const edit = makeEdit({ draft: draftWith({ rotate: 90 }) });
      renderPanel(edit);
      await openSize();

      fireEvent.change(screen.getByLabelText("W"), { target: { value: "540" } });

      expect(vi.mocked(edit.setScale).mock.calls[0][0]).toBeCloseTo(0.5);
    });

    it("lets a width be typed without snapping back to the last output size", async () => {
      const edit = makeEdit();
      renderPanel(edit);
      await openSize();

      fireEvent.change(screen.getByLabelText("W"), { target: { value: "9" } });

      expect(screen.getByLabelText("W")).toHaveValue(9);
    });

    it("does not treat a cleared field as a scale of zero", async () => {
      const edit = makeEdit();
      renderPanel(edit);
      await openSize();

      fireEvent.change(screen.getByLabelText("W"), { target: { value: "" } });

      expect(edit.setScale).not.toHaveBeenCalled();
    });
  });

  describe("the output readout", () => {
    it("says what the file measures now and what it will measure", () => {
      renderPanel(makeEdit({ draft: draftWith({ scale: 0.5 }) }));

      expect(screen.getByText(/1920 x 1080/)).toBeInTheDocument();
      expect(screen.getByText("960 x 540")).toBeInTheDocument();
    });

    it("swaps the axes under a quarter turn", () => {
      renderPanel(makeEdit({ draft: draftWith({ rotate: 90 }) }));

      expect(screen.getByText("1080 x 1920")).toBeInTheDocument();
    });

    it("names the angle only once there is one", () => {
      renderPanel(makeEdit());
      expect(screen.queryByText(/°/)).not.toBeInTheDocument();
    });

    it("spells out the turn and the mirrors together", () => {
      renderPanel(makeEdit({ draft: draftWith({ rotate: 270, mirrorH: true }) }));

      expect(screen.getByText(/270°/)).toHaveTextContent("mirrored");
    });

    it("says the tools are still loading before the image has decoded", () => {
      renderPanel(makeEdit({ ready: false }));

      expect(screen.getByText("The tools load with the image.")).toBeInTheDocument();
    });
  });

  describe("the actions", () => {
    it("keeps Apply and Reset away until something has changed", () => {
      renderPanel(makeEdit({ dirty: false }));

      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    });

    it("writes on Apply and goes back on Reset", async () => {
      const user = userEvent.setup();
      const edit = makeEdit({ dirty: true });
      renderPanel(edit);

      await user.click(screen.getByRole("button", { name: "Apply" }));
      await user.click(screen.getByRole("button", { name: "Reset" }));

      expect(edit.apply).toHaveBeenCalled();
      expect(edit.resetDraft).toHaveBeenCalled();
    });

    it("offers Revert only when an original is stored", () => {
      renderPanel(makeEdit({ hasBackup: false }));
      expect(screen.queryByRole("button", { name: /Revert/ })).not.toBeInTheDocument();
    });

    it("asks the modal to confirm a revert rather than doing it", async () => {
      const user = userEvent.setup();
      const edit = makeEdit({ hasBackup: true });
      const props = renderPanel(edit);

      await user.click(screen.getByRole("button", { name: "Revert original" }));

      expect(props.onRevertRequested).toHaveBeenCalled();
      expect(edit.revert).not.toHaveBeenCalled();
    });

    it("locks every control until the image has decoded", () => {
      renderPanel(makeEdit({ ready: false, dirty: true, hasBackup: true }));

      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Revert original" })).toBeDisabled();
    });

    it("locks the panel while it is busy elsewhere in the modal", () => {
      renderPanel(makeEdit({ dirty: true, hasBackup: true }), { busy: true });

      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Revert original" })).toBeDisabled();
      expect(tools().getByRole("button", { name: "Rotate" })).toBeDisabled();
    });

    it("says it is saving instead of offering the actions, with nothing to cancel", () => {
      // Unlike the video panel, a Pillow pass finishes in the request: no progress or cancel.
      renderPanel(makeEdit({ applying: true, dirty: true, hasBackup: true }));

      expect(screen.getByRole("status")).toHaveTextContent("Saving");
      expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    });
  });
});
