import { useCallback, useState } from "react";
import { act, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useColorAdjust, type AdjustDraft } from "./useColorAdjust";
import { RESTING_ADJUST } from "@/features/gallery/lib/colorAdjust";
import { AppProviders } from "@/test/AppProviders";
import type { ColorAdjust } from "@/shared/types";

const wrapper = AppProviders;

function renderAdjust() {
  let resolve!: (suggestion: ColorAdjust) => void;
  let reject!: (error: Error) => void;
  const requestSuggestion = vi.fn(
    () =>
      new Promise<ColorAdjust>((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );
  const view = renderHook(
    () => {
      const [draft, setDraft] = useState<AdjustDraft>({
        adjust: { ...RESTING_ADJUST },
        autoAdjust: null,
      });
      const update = useCallback(
        (change: (current: AdjustDraft) => AdjustDraft) => setDraft(change),
        [],
      );
      return useColorAdjust({
        draft,
        update,
        path: "photo.png",
        name: "photo.png",
        requestSuggestion,
      });
    },
    { wrapper },
  );
  return {
    ...view,
    resolve: (suggestion: ColorAdjust) => resolve(suggestion),
    reject: (error: Error) => reject(error),
  };
}

describe("useColorAdjust", () => {
  it("adds the wand's reading to the tools", async () => {
    const view = renderAdjust();
    act(() => view.result.current.activateAuto());
    expect(view.result.current.autoPending).toBe(true);
    await act(async () => view.resolve({ ...RESTING_ADJUST, exposure: 0.3 }));
    expect(view.result.current.autoPending).toBe(false);
    expect(view.result.current.values.exposure).toBeCloseTo(0.3);
    expect(view.result.current.auto?.amount).toBe(0.5);
  });

  it("says why the wand could not read the file and leaves the tools alone", async () => {
    const view = renderAdjust();
    act(() => view.result.current.activateAuto());
    await act(async () => view.reject(new Error("Nothing left to analyse")));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not analyse photo.png");
    expect(view.result.current.autoPending).toBe(false);
    expect(view.result.current.values).toEqual(RESTING_ADJUST);
    expect(view.result.current.auto).toBeNull();
  });

  it("drops a wand reading that arrives after resetting the adjustments", async () => {
    const view = renderAdjust();
    act(() => view.result.current.activateAuto());
    act(() => view.result.current.reset());
    expect(view.result.current.autoPending).toBe(false);
    await act(async () => view.resolve({ ...RESTING_ADJUST, exposure: 0.3 }));
    expect(view.result.current.values).toEqual(RESTING_ADJUST);
    expect(view.result.current.auto).toBeNull();
  });

  it("releases compare and zoom when leaving the Adjust tab", () => {
    const view = renderAdjust();
    act(() => view.result.current.setActive(true));
    act(() => {
      view.result.current.setComparing(true);
      view.result.current.setZoomed(true);
    });
    act(() => view.result.current.setActive(false));
    expect(view.result.current.comparing).toBe(false);
    expect(view.result.current.zoomed).toBe(false);
  });
});
