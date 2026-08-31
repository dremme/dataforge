import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMaskRegions } from "./useMaskRegions";
import { MAX_MASK_REGIONS, type MaskDraft } from "@/features/gallery/lib/mask";

/** Stands in for the draft each editor keeps its regions inside. */
function renderMasks() {
  return renderHook(() => {
    const [masks, setMasks] = useState<MaskDraft[]>([]);
    return { masks, controls: useMaskRegions(masks, setMasks) };
  });
}

describe("useMaskRegions", () => {
  it("starts with no regions and nothing selected", () => {
    const { result } = renderMasks();

    expect(result.current.masks).toEqual([]);
    expect(result.current.controls.selectedMask).toBeNull();
    expect(result.current.controls.maskActive).toBe(false);
  });

  it("selects a region as it is added, so the controls act on it", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());

    expect(result.current.masks).toHaveLength(1);
    expect(result.current.controls.selectedMaskId).toBe(result.current.masks[0].id);
  });

  it("moves only the region the rectangle belongs to", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    act(() => result.current.controls.addMask());
    const [first, second] = result.current.masks;

    act(() =>
      result.current.controls.setMaskRect(first.id, { x: 0, y: 0, width: 0.2, height: 0.2 }),
    );

    expect(result.current.masks[0].rect).toEqual({ x: 0, y: 0, width: 0.2, height: 0.2 });
    expect(result.current.masks[1].rect).toEqual(second.rect);
  });

  it("points the style and strength at the selected region", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    act(() => result.current.controls.addMask());
    const [first] = result.current.masks;

    act(() => result.current.controls.setMaskMode("pixelate"));

    expect(result.current.masks[1].mode).toBe("pixelate");
    expect(result.current.masks[0].mode).toBe(first.mode);
  });

  it("carries the last style and strength into the next region", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    act(() => result.current.controls.setMaskMode("pixelate"));
    act(() => result.current.controls.setMaskStrength(0.4));
    act(() => result.current.controls.addMask());

    expect(result.current.masks[1]).toMatchObject({ mode: "pixelate", strength: 0.4 });
  });

  it("reports the defaults while nothing is selected", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    act(() => result.current.controls.setMaskStrength(0.4));
    act(() => result.current.controls.selectMask(null));

    expect(result.current.controls.selectedMask).toBeNull();
    expect(result.current.controls.maskStrength).toBe(0.4);
  });

  it("drops the selection with the region it pointed at", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    const [only] = result.current.masks;

    act(() => result.current.controls.removeMask(only.id));

    expect(result.current.masks).toEqual([]);
    expect(result.current.controls.selectedMaskId).toBeNull();
  });

  it("keeps a selection that points at some other region", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    act(() => result.current.controls.addMask());
    const [first, second] = result.current.masks;

    act(() => result.current.controls.removeMask(first.id));

    expect(result.current.controls.selectedMaskId).toBe(second.id);
  });

  it("clears every region at once", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    act(() => result.current.controls.addMask());
    act(() => result.current.controls.clearMasks());

    expect(result.current.masks).toEqual([]);
    expect(result.current.controls.selectedMaskId).toBeNull();
  });

  it("stops adding at the cap the server would refuse past", () => {
    const { result } = renderMasks();

    for (let placed = 0; placed < MAX_MASK_REGIONS + 3; placed += 1) {
      act(() => result.current.controls.addMask());
    }

    expect(result.current.masks).toHaveLength(MAX_MASK_REGIONS);
    expect(result.current.controls.maskLimitReached).toBe(true);
  });

  it("drops the selection but keeps the regions when the item is swapped", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.addMask());
    act(() => result.current.controls.clearSelection());

    expect(result.current.masks).toHaveLength(1);
    expect(result.current.controls.selectedMaskId).toBeNull();
  });

  it("stows the gizmo when the editor closes", () => {
    const { result } = renderMasks();

    act(() => result.current.controls.setMaskActive(true));
    act(() => result.current.controls.addMask());
    act(() => result.current.controls.deactivate());

    expect(result.current.controls.maskActive).toBe(false);
    expect(result.current.controls.selectedMaskId).toBeNull();
    // The regions belong to the draft, which Reset and Revert own instead.
    expect(result.current.masks).toHaveLength(1);
  });
});
