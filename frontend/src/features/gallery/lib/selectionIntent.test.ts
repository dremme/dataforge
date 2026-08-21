import { describe, expect, it } from "vitest";
import { pathRangeBetween, selectionIntentFor } from "./selectionIntent";

const click = (modifiers: Partial<MouseEvent> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("selectionIntentFor", () => {
  it("opens the item on a plain click outside selection mode", () => {
    expect(selectionIntentFor(click(), false)).toBe("open");
  });

  it("toggles on a plain click inside selection mode", () => {
    expect(selectionIntentFor(click(), true)).toBe("toggle");
  });

  it("toggles on Ctrl+click without needing selection mode first", () => {
    expect(selectionIntentFor(click({ ctrlKey: true }), false)).toBe("toggle");
  });

  it("treats Cmd+click the same, for macOS", () => {
    expect(selectionIntentFor(click({ metaKey: true }), false)).toBe("toggle");
  });

  it("extends on Shift+click without needing selection mode first", () => {
    expect(selectionIntentFor(click({ shiftKey: true }), false)).toBe("range");
  });

  it("lets Shift win over Ctrl", () => {
    expect(selectionIntentFor(click({ shiftKey: true, ctrlKey: true }), true)).toBe("range");
  });
});

describe("pathRangeBetween", () => {
  const ordered = ["a", "b", "c", "d", "e"];

  it("returns the run from the anchor down to the target", () => {
    expect(pathRangeBetween(ordered, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("returns the same run when the click is above the anchor", () => {
    expect(pathRangeBetween(ordered, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("returns just the item when it is its own anchor", () => {
    expect(pathRangeBetween(ordered, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the clicked item when there is no anchor yet", () => {
    expect(pathRangeBetween(ordered, null, "c")).toEqual(["c"]);
  });

  // The selection survives filtering, so the anchor can name a hidden item.
  it("falls back to the clicked item when the anchor is filtered out", () => {
    expect(pathRangeBetween(ordered, "zz", "c")).toEqual(["c"]);
  });
});
