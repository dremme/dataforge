import { describe, expect, it } from "vitest";
import { createTestRouter } from "@/test/router";
import { entryKeyOf, folderOfLocation, syncFolderHistory } from "./folderHistory";

const HOME_PATH = "C:\\Users\\dev\\Photos";
const VACATION_PATH = "C:\\Users\\dev\\Photos\\Vacation";

const query = (path: string) => `?${new URLSearchParams({ path })}`;

describe("folderHistory", () => {
  it("pushes the folder into the query string and mints an entry key", () => {
    const router = createTestRouter();
    const entryKey = syncFolderHistory(router, HOME_PATH, "push");

    expect(entryKey).toBeTypeOf("string");
    expect(folderOfLocation(router)).toBe(HOME_PATH);
    expect(entryKeyOf(router.history.location)).toBe(entryKey);
    expect(router.history.length).toBe(2);
  });

  it("mints a distinct key for every push", () => {
    const router = createTestRouter();
    const first = syncFolderHistory(router, HOME_PATH, "push");
    const second = syncFolderHistory(router, VACATION_PATH, "push");
    const third = syncFolderHistory(router, HOME_PATH, "push");

    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("keeps the current key when replacing an entry", () => {
    const router = createTestRouter();
    const pushed = syncFolderHistory(router, HOME_PATH, "push");
    const replaced = syncFolderHistory(router, VACATION_PATH, "replace");

    expect(replaced).toBe(pushed);
    expect(folderOfLocation(router)).toBe(VACATION_PATH);
    expect(router.history.length).toBe(2);
  });

  it("mints a key when replacing an entry that was never stamped", () => {
    const router = createTestRouter();
    const entryKey = syncFolderHistory(router, HOME_PATH, "replace");

    expect(entryKey).toBeTypeOf("string");
    expect(entryKeyOf(router.history.location)).toBe(entryKey);
  });

  it("clears the query string for the default folder", () => {
    const router = createTestRouter();
    syncFolderHistory(router, HOME_PATH, "push");
    syncFolderHistory(router, undefined, "push");

    expect(folderOfLocation(router)).toBeUndefined();
    expect(router.history.location.search).toBe("");
  });

  it("writes nothing for mode none", () => {
    const router = createTestRouter();
    syncFolderHistory(router, HOME_PATH, "push");
    const before = router.history.location;

    expect(syncFolderHistory(router, VACATION_PATH, "none")).toBeUndefined();
    expect(router.history.location).toBe(before);
  });

  it("reads the folder under the video editor from what it opens", () => {
    const video = `${VACATION_PATH}\\clip.mp4`;
    expect(folderOfLocation(createTestRouter(`/editor/video${query(video)}`))).toBe(VACATION_PATH);
    expect(folderOfLocation(createTestRouter(`/editor/new${query(HOME_PATH)}`))).toBe(HOME_PATH);
  });

  it("stamps a key on the editor's entry without leaving the editor", () => {
    const address = `/editor/project${query(`${HOME_PATH}\\a.video-project.json`)}`;
    const router = createTestRouter(address);

    const entryKey = syncFolderHistory(router, HOME_PATH, "replace");

    expect(entryKeyOf(router.history.location)).toBe(entryKey);
    expect(router.history.location.href).toBe(address);
  });

  it("reports no entry key for an entry this app did not stamp", () => {
    expect(entryKeyOf(createTestRouter().history.location)).toBeUndefined();
  });
});
