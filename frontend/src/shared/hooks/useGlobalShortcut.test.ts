import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "@/shared/hooks/scrollLockManager";
import type { ShortcutDefinition } from "@/shared/lib/shortcuts";
import { useGlobalShortcut, type GlobalShortcutOptions } from "./useGlobalShortcut";

const SHORTCUT: ShortcutDefinition = {
  group: "global",
  label: "Sample",
  chords: [{ key: "o", mod: true }],
};

function press(init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "o",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function renderShortcut(
  handler: (event: KeyboardEvent) => void | boolean,
  options?: GlobalShortcutOptions,
) {
  return renderHook(() => useGlobalShortcut(SHORTCUT, handler, options), { wrapper: StrictMode });
}

afterEach(() => {
  resetScrollLockManagerForTests();
  document.body.innerHTML = "";
});

describe("useGlobalShortcut", () => {
  it("runs the handler once under StrictMode and swallows the key", () => {
    const handler = vi.fn();
    renderShortcut(handler);

    const event = press();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores other chords", () => {
    const handler = vi.fn();
    renderShortcut(handler);

    press({ key: "p" });
    press({ ctrlKey: false });

    expect(handler).not.toHaveBeenCalled();
  });

  it("stands down while an overlay holds the scroll lock, unless asked not to", () => {
    const handler = vi.fn();
    const { rerender } = renderHook(
      ({ whenLocked }: { whenLocked: boolean }) =>
        useGlobalShortcut(SHORTCUT, handler, { whenLocked }),
      { initialProps: { whenLocked: false } },
    );
    const lock = acquireScrollLock("confirm-dialog-open");

    try {
      expect(press().defaultPrevented).toBe(false);
      expect(handler).not.toHaveBeenCalled();

      rerender({ whenLocked: true });
      press();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      releaseScrollLock(lock);
    }
  });

  it("stands down in a text field, unless asked not to", () => {
    const handler = vi.fn();
    const { rerender } = renderHook(
      ({ inEditable }: { inEditable: boolean }) =>
        useGlobalShortcut(SHORTCUT, handler, { inEditable }),
      { initialProps: { inEditable: false } },
    );
    const input = document.body.appendChild(document.createElement("input"));

    press({}, input);
    expect(handler).not.toHaveBeenCalled();

    rerender({ inEditable: true });
    press({}, input);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    const handler = vi.fn();
    renderShortcut(handler, { enabled: false });

    expect(press().defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves a key another handler already claimed", () => {
    const handler = vi.fn();
    renderShortcut(handler);
    const editor = document.body.appendChild(document.createElement("div"));
    editor.addEventListener("keydown", (event) => event.preventDefault());

    press({}, editor);

    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves the key to the browser when the handler declines it", () => {
    renderShortcut(() => false);

    expect(press().defaultPrevented).toBe(false);
  });

  it("calls the latest handler without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: () => void }) => useGlobalShortcut(SHORTCUT, handler),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    press();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
