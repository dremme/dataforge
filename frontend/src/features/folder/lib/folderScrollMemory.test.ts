import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFolderScrollMemory,
  forgetFolderScroll,
  recallFolderScroll,
  rememberFolderScroll,
} from "./folderScrollMemory";

describe("folderScrollMemory", () => {
  beforeEach(() => {
    clearFolderScrollMemory();
  });

  it("reads back a remembered offset", () => {
    rememberFolderScroll("entry-1", 940);

    expect(recallFolderScroll("entry-1")).toBe(940);
  });

  it("returns nothing for an entry that was never remembered", () => {
    expect(recallFolderScroll("entry-unknown")).toBeUndefined();
  });

  it("remembers a zero offset rather than treating it as missing", () => {
    rememberFolderScroll("entry-1", 0);

    expect(recallFolderScroll("entry-1")).toBe(0);
  });

  it("no-ops on an undefined key", () => {
    rememberFolderScroll(undefined, 500);
    forgetFolderScroll(undefined);

    expect(recallFolderScroll(undefined)).toBeUndefined();
  });

  it("replaces an earlier offset for the same entry", () => {
    rememberFolderScroll("entry-1", 100);
    rememberFolderScroll("entry-1", 250);

    expect(recallFolderScroll("entry-1")).toBe(250);
  });

  it("evicts the least recently used entry past the cap", () => {
    for (let index = 0; index < 30; index++) {
      rememberFolderScroll(`entry-${index}`, index);
    }

    // Touching the oldest entry should keep it alive through the next write.
    expect(recallFolderScroll("entry-0")).toBe(0);
    rememberFolderScroll("entry-30", 30);

    expect(recallFolderScroll("entry-0")).toBe(0);
    expect(recallFolderScroll("entry-1")).toBeUndefined();
  });

  it("forgets an entry explicitly", () => {
    rememberFolderScroll("entry-1", 100);
    forgetFolderScroll("entry-1");

    expect(recallFolderScroll("entry-1")).toBeUndefined();
  });

  it("empties on clear", () => {
    rememberFolderScroll("entry-1", 100);
    clearFolderScrollMemory();

    expect(recallFolderScroll("entry-1")).toBeUndefined();
  });
});
