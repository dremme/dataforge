import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "@/shared/hooks/scrollLockManager";
import { useQuickAction } from "./useQuickAction";

function pressQuickAction(init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: " ",
    code: "Space",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });

  act(() => {
    window.dispatchEvent(event);
  });

  return event;
}

afterEach(() => {
  resetScrollLockManagerForTests();
});

describe("useQuickAction", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useQuickAction());
    expect(result.current.open).toBe(false);
  });

  it("opens on Ctrl+Space and swallows the keypress", () => {
    const { result } = renderHook(() => useQuickAction());

    const event = pressQuickAction();

    expect(result.current.open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens on Cmd+Space too", () => {
    const { result } = renderHook(() => useQuickAction());

    pressQuickAction({ ctrlKey: false, metaKey: true });

    expect(result.current.open).toBe(true);
  });

  it("toggles closed on a second press", () => {
    const { result } = renderHook(() => useQuickAction());

    pressQuickAction();
    pressQuickAction();

    expect(result.current.open).toBe(false);
  });

  it("does not open while a dialog, modal or drawer is up", () => {
    const { result } = renderHook(() => useQuickAction());
    const handle = acquireScrollLock("confirm-dialog-open");

    try {
      const event = pressQuickAction();

      expect(result.current.open).toBe(false);
      // The overlay owns the keyboard here, so the chord must pass through untouched.
      expect(event.defaultPrevented).toBe(false);
    } finally {
      releaseScrollLock(handle);
    }
  });

  it("opens once the overlay that blocked it is gone", () => {
    const { result } = renderHook(() => useQuickAction());

    const handle = acquireScrollLock("confirm-dialog-open");
    pressQuickAction();
    expect(result.current.open).toBe(false);

    releaseScrollLock(handle);
    pressQuickAction();
    expect(result.current.open).toBe(true);
  });

  it("ignores the chord with Alt or Shift held, and plain Space", () => {
    const { result } = renderHook(() => useQuickAction());

    pressQuickAction({ altKey: true });
    pressQuickAction({ shiftKey: true });
    pressQuickAction({ ctrlKey: false });

    expect(result.current.open).toBe(false);
  });

  it("closes on demand", () => {
    const { result } = renderHook(() => useQuickAction());

    pressQuickAction();
    act(() => result.current.close());

    expect(result.current.open).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() => useQuickAction());

    unmount();
    const event = pressQuickAction();

    expect(event.defaultPrevented).toBe(false);
    expect(result.current.open).toBe(false);
  });
});
