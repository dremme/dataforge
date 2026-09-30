export interface KeyChord {
  /** A `KeyboardEvent.key` value; `"Arrows"` stands for all four arrow keys in listings. */
  key: string;
  /** Ctrl, or Cmd on macOS. */
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export const SHORTCUT_GROUPS = [
  { id: "global", label: "Global" },
  { id: "folders", label: "Folders" },
  { id: "selection", label: "Gallery & selection" },
  { id: "viewer", label: "Item viewer" },
  { id: "review", label: "Review queues" },
  { id: "editors", label: "Editors" },
] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]["id"];

export interface ShortcutDefinition {
  group: ShortcutGroup;
  label: string;
  chords: readonly KeyChord[];
}

export const SHORTCUTS = {
  commandPalette: {
    group: "global",
    label: "Open the command palette",
    chords: [{ key: "p", mod: true }],
  },
  search: {
    group: "global",
    label: "Search the gallery",
    chords: [{ key: "f", mod: true }, { key: "/" }],
  },
  settings: { group: "global", label: "Open settings", chords: [{ key: ",", mod: true }] },
  shortcuts: { group: "global", label: "Show keyboard shortcuts", chords: [{ key: "?" }] },
  confirm: { group: "global", label: "Confirm a dialog", chords: [{ key: "Enter" }] },
  close: { group: "global", label: "Close a dialog or viewer", chords: [{ key: "Escape" }] },

  openFolder: { group: "folders", label: "Open a folder", chords: [{ key: "o", mod: true }] },
  parentFolder: {
    group: "folders",
    label: "Go to the parent folder",
    chords: [{ key: "ArrowUp", alt: true }],
  },
  homeFolder: {
    group: "folders",
    label: "Go to the home folder",
    chords: [{ key: "Home", alt: true }],
  },
  newFolder: { group: "folders", label: "New folder", chords: [{ key: "n", alt: true }] },

  selectAll: {
    group: "selection",
    label: "Select every file in view",
    chords: [{ key: "a", mod: true }],
  },
  deleteSelection: {
    group: "selection",
    label: "Delete the selected files",
    chords: [{ key: "Delete" }, { key: "Backspace" }],
  },
  clearSelection: {
    group: "selection",
    label: "Clear the selection, then leave selection mode",
    chords: [{ key: "Escape" }],
  },

  previousItem: { group: "viewer", label: "Previous item", chords: [{ key: "ArrowLeft" }] },
  nextItem: { group: "viewer", label: "Next item", chords: [{ key: "ArrowRight" }] },
  firstItem: { group: "viewer", label: "First item", chords: [{ key: "Home" }] },
  lastItem: { group: "viewer", label: "Last item", chords: [{ key: "End" }] },
  saveAndNext: {
    group: "viewer",
    label: "Save the caption and go to the next item",
    chords: [{ key: "Enter", mod: true }],
  },
  deleteItem: {
    group: "viewer",
    label: "Delete the item",
    chords: [{ key: "Delete" }, { key: "Backspace" }],
  },

  resolveOrAccept: {
    group: "review",
    label: "Resolve the issue or accept the candidate",
    chords: [{ key: "Enter", mod: true }],
  },
  rejectCandidate: {
    group: "review",
    label: "Reject the candidate",
    chords: [{ key: "Backspace", mod: true }],
  },
  reviewPreviousNext: {
    group: "review",
    label: "Previous or next in the queue",
    chords: [{ key: "ArrowLeft" }, { key: "ArrowRight" }],
  },
  reviewFirstLast: {
    group: "review",
    label: "First or last in the queue",
    chords: [{ key: "Home" }, { key: "End" }],
  },

  findInEditor: {
    group: "editors",
    label: "Find in a text editor",
    chords: [{ key: "f", mod: true }],
  },
  nudgeHandle: {
    group: "editors",
    label: "Nudge a crop, mask or trim handle, or an Adjust ruler",
    chords: [{ key: "Arrows" }],
  },
  nudgeHandleCoarse: {
    group: "editors",
    label: "Nudge it in bigger steps",
    chords: [{ key: "Arrows", shift: true }],
  },
  removeMask: { group: "editors", label: "Remove the focused mask", chords: [{ key: "Delete" }] },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof SHORTCUTS;

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Delete: "Del",
  " ": "Space",
};

const MAC_KEY_LABELS: Record<string, string> = {
  Backspace: "⌫",
  Enter: "↩",
};

const ARROW_KEYS = ["↑", "↓", "←", "→"];

export function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

function isLetter(key: string): boolean {
  return /^[a-z]$/i.test(key);
}

/** A printable symbol whose Shift state belongs to the keyboard layout, not the chord. */
function isLayoutSymbol(key: string): boolean {
  return key.length === 1 && !isLetter(key) && key !== " ";
}

function keyMatches(event: KeyboardEvent, key: string): boolean {
  if (isLetter(key)) {
    // `code` keeps letter chords working on non-Latin layouts.
    return event.key.toLowerCase() === key || event.code === `Key${key.toUpperCase()}`;
  }
  return event.key === key;
}

export function matchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  if (!keyMatches(event, chord.key)) return false;
  if ((event.ctrlKey || event.metaKey) !== Boolean(chord.mod)) return false;
  if (event.altKey !== Boolean(chord.alt)) return false;
  if (isLayoutSymbol(chord.key)) return true;
  return event.shiftKey === Boolean(chord.shift);
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
  return shortcut.chords.some((chord) => matchesChord(event, chord));
}

/** The labels of one chord, one `<kbd>` each. */
export function formatChord(chord: KeyChord, apple = isApplePlatform()): string[] {
  const parts: string[] = [];
  if (chord.mod) parts.push(apple ? "⌘" : "Ctrl");
  if (chord.alt) parts.push(apple ? "⌥" : "Alt");
  if (chord.shift) parts.push(apple ? "⇧" : "Shift");

  if (chord.key === "Arrows") return [...parts, ...ARROW_KEYS];

  const label =
    (apple ? MAC_KEY_LABELS[chord.key] : undefined) ??
    KEY_LABELS[chord.key] ??
    (isLetter(chord.key) ? chord.key.toUpperCase() : chord.key);
  return [...parts, label];
}

/** Plain text for tooltips and titles, e.g. `Ctrl+P`. */
export function formatShortcut(shortcut: ShortcutDefinition, apple = isApplePlatform()): string {
  return shortcut.chords
    .map((chord) => formatChord(chord, apple).join(apple ? "" : "+"))
    .join(" / ");
}

function ariaKey(key: string): string {
  if (key === " ") return "Space";
  return isLetter(key) ? key.toUpperCase() : key;
}

export function ariaKeyShortcuts(shortcut: ShortcutDefinition): string {
  return shortcut.chords
    .flatMap((chord) => {
      const tail = [chord.alt && "Alt", chord.shift && "Shift", ariaKey(chord.key)].filter(
        (part): part is string => Boolean(part),
      );
      if (!chord.mod) return [tail.join("+")];
      return [["Control", ...tail].join("+"), ["Meta", ...tail].join("+")];
    })
    .join(" ");
}

export type QueueStep = "previous" | "next" | "first" | "last";

/** The paging step a key asks for in a modal that walks a list, if any. */
export function queueStepFor(event: KeyboardEvent): QueueStep | null {
  if (matchesShortcut(event, SHORTCUTS.previousItem)) return "previous";
  if (matchesShortcut(event, SHORTCUTS.nextItem)) return "next";
  if (matchesShortcut(event, SHORTCUTS.firstItem)) return "first";
  if (matchesShortcut(event, SHORTCUTS.lastItem)) return "last";
  return null;
}

/** Where a step lands in a list of `length`, clamped at both ends. */
export function queueIndexAfter(step: QueueStep, index: number, length: number): number {
  if (step === "first") return 0;
  if (step === "last") return length - 1;
  const next = index + (step === "next" ? 1 : -1);
  return Math.min(Math.max(next, 0), length - 1);
}
