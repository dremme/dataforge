import { afterEach, describe, expect, it } from "vitest";
import { MAX_RECENT_ACTIONS, readRecentActionIds, touchRecentAction } from "./quickActionHistory";

const KEY = "quick-action-recent";

afterEach(() => {
  localStorage.clear();
});

describe("quickActionHistory", () => {
  it("returns an empty list before anything has been run", () => {
    expect(readRecentActionIds()).toEqual([]);
  });

  it("puts the most recent action first", () => {
    touchRecentAction("run:watermark");
    touchRecentAction("cmd:new-folder");

    expect(readRecentActionIds()).toEqual(["cmd:new-folder", "run:watermark"]);
  });

  it("promotes an action already in the list instead of duplicating it", () => {
    touchRecentAction("run:watermark");
    touchRecentAction("cmd:new-folder");
    touchRecentAction("run:watermark");

    expect(readRecentActionIds()).toEqual(["run:watermark", "cmd:new-folder"]);
  });

  it("folds case when deduping, so a path's casing cannot split one folder in two", () => {
    touchRecentAction("folder:C:\\Data\\Shots");
    touchRecentAction("folder:c:\\data\\shots");

    expect(readRecentActionIds()).toEqual(["folder:c:\\data\\shots"]);
  });

  it(`keeps at most ${MAX_RECENT_ACTIONS} entries`, () => {
    for (let index = 0; index < MAX_RECENT_ACTIONS + 3; index += 1) {
      touchRecentAction(`cmd:action-${index}`);
    }

    const ids = readRecentActionIds();
    expect(ids).toHaveLength(MAX_RECENT_ACTIONS);
    expect(ids[0]).toBe(`cmd:action-${MAX_RECENT_ACTIONS + 2}`);
  });

  it("survives a reload", () => {
    touchRecentAction("run:watermark");

    // A fresh read is all a reload amounts to — nothing is cached in module state.
    expect(readRecentActionIds()).toEqual(["run:watermark"]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual(["run:watermark"]);
  });

  it("ignores a stored value that is not an array of ids", () => {
    localStorage.setItem(KEY, JSON.stringify({ nope: true }));
    expect(readRecentActionIds()).toEqual([]);

    localStorage.setItem(KEY, JSON.stringify(["run:watermark", 7, null, "  "]));
    expect(readRecentActionIds()).toEqual(["run:watermark"]);
  });

  it("ignores a blank id", () => {
    touchRecentAction("   ");
    expect(readRecentActionIds()).toEqual([]);
  });
});
