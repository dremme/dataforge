import { beforeEach, describe, expect, it } from "vitest";
import {
  getCurrentEntryKey,
  getEntryKeyFromHistoryEvent,
  getFolderFromHistoryEvent,
  getFolderFromUrl,
  syncFolderHistory,
} from "./folderHistory";

const HOME_PATH = "C:\\Users\\dev\\Photos";
const VACATION_PATH = "C:\\Users\\dev\\Photos\\Vacation";

describe("folderHistory", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  it("pushes the folder into the query string and mints an entry key", () => {
    const entryKey = syncFolderHistory(HOME_PATH, "push");

    expect(entryKey).toBeTypeOf("string");
    expect(getFolderFromUrl()).toBe(HOME_PATH);
    expect(history.state).toEqual({ folderPath: HOME_PATH, entryKey });
    expect(getCurrentEntryKey()).toBe(entryKey);
  });

  it("mints a distinct key for every push", () => {
    const first = syncFolderHistory(HOME_PATH, "push");
    const second = syncFolderHistory(VACATION_PATH, "push");
    const third = syncFolderHistory(HOME_PATH, "push");

    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("keeps the current key when replacing an entry", () => {
    const pushed = syncFolderHistory(HOME_PATH, "push");
    const replaced = syncFolderHistory(VACATION_PATH, "replace");

    expect(replaced).toBe(pushed);
    expect(history.state).toEqual({ folderPath: VACATION_PATH, entryKey: pushed });
  });

  it("mints a key when replacing an entry that was never stamped", () => {
    const entryKey = syncFolderHistory(HOME_PATH, "replace");

    expect(entryKey).toBeTypeOf("string");
    expect(getCurrentEntryKey()).toBe(entryKey);
  });

  it("clears the query string for the default folder", () => {
    syncFolderHistory(HOME_PATH, "push");
    syncFolderHistory(undefined, "push");

    expect(getFolderFromUrl()).toBeUndefined();
    expect(history.state.folderPath).toBeNull();
  });

  it("writes nothing for mode none", () => {
    syncFolderHistory(HOME_PATH, "push");
    const before = history.state;

    expect(syncFolderHistory(VACATION_PATH, "none")).toBeUndefined();
    expect(history.state).toBe(before);
    expect(getFolderFromUrl()).toBe(HOME_PATH);
  });

  it("reads the entry key off a popstate event", () => {
    const event = new PopStateEvent("popstate", {
      state: { folderPath: HOME_PATH, entryKey: "fs-abc-1" },
    });

    expect(getEntryKeyFromHistoryEvent(event)).toBe("fs-abc-1");
  });

  it("reports no entry key for state written before entry keys existed", () => {
    const legacy = new PopStateEvent("popstate", { state: { folderPath: HOME_PATH } });
    const foreign = new PopStateEvent("popstate", { state: null });

    expect(getEntryKeyFromHistoryEvent(legacy)).toBeUndefined();
    expect(getEntryKeyFromHistoryEvent(foreign)).toBeUndefined();
  });

  it("resolves the folder from popstate state, falling back to the url", () => {
    expect(
      getFolderFromHistoryEvent(
        new PopStateEvent("popstate", { state: { folderPath: HOME_PATH } }),
      ),
    ).toBe(HOME_PATH);

    expect(
      getFolderFromHistoryEvent(new PopStateEvent("popstate", { state: { folderPath: null } })),
    ).toBeUndefined();

    syncFolderHistory(VACATION_PATH, "replace");
    expect(getFolderFromHistoryEvent(new PopStateEvent("popstate", { state: null }))).toBe(
      VACATION_PATH,
    );
  });
});
