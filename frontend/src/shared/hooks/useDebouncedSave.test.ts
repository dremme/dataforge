import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedSave } from "./useDebouncedSave";

interface Payload {
  path: string;
  text: string;
}

describe("useDebouncedSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupHook(options: Partial<Parameters<typeof useDebouncedSave>[0]> = {}) {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDebouncedSave<Payload>({
        debounceMs: 500,
        save,
        isUnchanged: (pending, lastSaved) => pending.text === lastSaved.text,
        ...options,
      }),
    );
    return { result, save };
  }

  it("debounces rapid edits into a single save", async () => {
    const { result, save } = setupHook();

    act(() => {
      result.current.setBaseline({ path: "a.png", text: "" });
      result.current.scheduleSave({ path: "a.png", text: "A" });
      result.current.scheduleSave({ path: "a.png", text: "AB" });
      result.current.scheduleSave({ path: "a.png", text: "ABC" });
    });

    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ path: "a.png", text: "ABC" });
  });

  it("flushes a pending save immediately", async () => {
    const { result, save } = setupHook();

    act(() => {
      result.current.setBaseline({ path: "a.png", text: "" });
      result.current.scheduleSave({ path: "a.png", text: "Pending" });
      result.current.flushPendingSave();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ path: "a.png", text: "Pending" });
  });

  it("ignores stale save responses after invalidateInFlight", async () => {
    const completionOrder: string[] = [];
    let resolveFirst: (() => void) | undefined;

    const customSave = vi.fn().mockImplementation((payload: Payload) => {
      if (payload.text === "First") {
        return new Promise<void>((resolve) => {
          resolveFirst = () => {
            completionOrder.push("First");
            resolve();
          };
        });
      }

      return Promise.resolve().then(() => {
        completionOrder.push("Second");
      });
    });

    const { result } = setupHook({ debounceMs: 10, feedbackClearMs: 10_000, save: customSave });

    act(() => {
      result.current.setBaseline({ path: "a.png", text: "" });
      result.current.scheduleSave({ path: "a.png", text: "First" });
    });

    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });

    act(() => {
      result.current.invalidateInFlight();
      result.current.setBaseline({ path: "b.png", text: "" });
      result.current.scheduleSave({ path: "b.png", text: "Second" });
    });

    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });

    expect(completionOrder).toEqual(["Second"]);
    expect(result.current.saveState).toBe("saved");

    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
    });

    expect(result.current.saveState).toBe("saved");
    expect(customSave).toHaveBeenCalledTimes(2);
  });

  it("skips scheduling when the payload matches the baseline", () => {
    const { result, save } = setupHook();

    act(() => {
      result.current.setBaseline({ path: "a.png", text: "Same" });
      result.current.scheduleSave({ path: "a.png", text: "Same" });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(save).not.toHaveBeenCalled();
  });
});
