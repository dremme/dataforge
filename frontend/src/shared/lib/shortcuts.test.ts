import { describe, expect, it } from "vitest";
import {
  ariaKeyShortcuts,
  formatChord,
  formatShortcut,
  matchesChord,
  matchesShortcut,
  SHORTCUTS,
} from "./shortcuts";

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("matchesChord", () => {
  it("treats Ctrl and Cmd as the same modifier", () => {
    const chord = { key: "p", mod: true };

    expect(matchesChord(keydown({ key: "p", ctrlKey: true }), chord)).toBe(true);
    expect(matchesChord(keydown({ key: "p", metaKey: true }), chord)).toBe(true);
    expect(matchesChord(keydown({ key: "p" }), chord)).toBe(false);
  });

  it("requires the other modifiers to match exactly", () => {
    const chord = { key: "p", mod: true };

    expect(matchesChord(keydown({ key: "p", ctrlKey: true, altKey: true }), chord)).toBe(false);
    expect(matchesChord(keydown({ key: "P", ctrlKey: true, shiftKey: true }), chord)).toBe(false);
  });

  it("matches letters by physical key on a non-Latin layout", () => {
    expect(
      matchesChord(keydown({ key: "з", code: "KeyP", ctrlKey: true }), { key: "p", mod: true }),
    ).toBe(true);
  });

  it("leaves Shift to the layout for printable symbols", () => {
    expect(matchesChord(keydown({ key: "?", shiftKey: true }), { key: "?" })).toBe(true);
    expect(matchesChord(keydown({ key: "/", shiftKey: true }), { key: "/" })).toBe(true);
  });

  it("still holds Shift to account for named keys", () => {
    expect(
      matchesChord(keydown({ key: "ArrowUp", altKey: true, shiftKey: true }), {
        key: "ArrowUp",
        alt: true,
      }),
    ).toBe(false);
  });
});

describe("matchesShortcut", () => {
  it("accepts any of the shortcut's chords", () => {
    expect(matchesShortcut(keydown({ key: "f", ctrlKey: true }), SHORTCUTS.search)).toBe(true);
    expect(matchesShortcut(keydown({ key: "/" }), SHORTCUTS.search)).toBe(true);
    expect(matchesShortcut(keydown({ key: "k", ctrlKey: true }), SHORTCUTS.search)).toBe(false);
  });
});

describe("formatChord", () => {
  it("spells modifiers and keys for Windows and Linux", () => {
    expect(formatChord({ key: "p", mod: true }, false)).toEqual(["Ctrl", "P"]);
    expect(formatChord({ key: "ArrowUp", alt: true }, false)).toEqual(["Alt", "↑"]);
    expect(formatChord({ key: "Escape" }, false)).toEqual(["Esc"]);
  });

  it("uses the macOS symbols there", () => {
    expect(formatChord({ key: "p", mod: true }, true)).toEqual(["⌘", "P"]);
    expect(formatChord({ key: "Backspace", mod: true }, true)).toEqual(["⌘", "⌫"]);
  });

  it("expands the arrow-key placeholder", () => {
    expect(formatChord({ key: "Arrows", shift: true }, false)).toEqual([
      "Shift",
      "↑",
      "↓",
      "←",
      "→",
    ]);
  });
});

describe("formatShortcut", () => {
  it("joins chords for plain-text hints", () => {
    expect(formatShortcut(SHORTCUTS.search, false)).toBe("Ctrl+F / /");
    expect(formatShortcut(SHORTCUTS.commandPalette, true)).toBe("⌘P");
  });
});

describe("ariaKeyShortcuts", () => {
  it("lists Control and Meta for a mod chord", () => {
    expect(ariaKeyShortcuts(SHORTCUTS.commandPalette)).toBe("Control+P Meta+P");
  });

  it("lists every chord", () => {
    expect(ariaKeyShortcuts(SHORTCUTS.deleteSelection)).toBe("Delete Backspace");
    expect(ariaKeyShortcuts(SHORTCUTS.parentFolder)).toBe("Alt+ArrowUp");
  });
});
