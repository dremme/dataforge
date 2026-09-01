import { describe, expect, it } from "vitest";
import { readFolderExpanded, writeFolderExpanded } from "./folderExpansion";

const STORAGE_KEY = "folder-grid-expanded";

describe("folderExpansion", () => {
  it("reads a folder nobody has expanded as collapsed", () => {
    expect(readFolderExpanded("C:\\Photos\\Album")).toBe(false);
  });

  it("remembers an expansion and forgets it again on collapse", () => {
    writeFolderExpanded("C:\\Photos\\Album", true);
    expect(readFolderExpanded("C:\\Photos\\Album")).toBe(true);

    writeFolderExpanded("C:\\Photos\\Album", false);
    expect(readFolderExpanded("C:\\Photos\\Album")).toBe(false);
  });

  it("keeps each folder's choice to itself", () => {
    writeFolderExpanded("C:\\Photos\\Album", true);

    expect(readFolderExpanded("C:\\Photos\\Other")).toBe(false);
  });

  it("matches the same folder written with different case or separators", () => {
    writeFolderExpanded("C:/Photos/Album", true);

    expect(readFolderExpanded("c:\\photos\\album")).toBe(true);
    expect(readFolderExpanded("C:\\Photos\\Album\\\\")).toBe(true);
  });

  it("stores one entry per folder however often it is toggled", () => {
    writeFolderExpanded("C:\\Photos\\Album", true);
    writeFolderExpanded("C:\\Photos\\Album", true);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(1);
  });

  it("sheds the least recently expanded folder past the cache limit", () => {
    for (let index = 0; index < 60; index += 1) {
      writeFolderExpanded(`C:\\Photos\\${index}`, true);
    }

    expect(readFolderExpanded("C:\\Photos\\0")).toBe(false);
    expect(readFolderExpanded("C:\\Photos\\9")).toBe(false);
    expect(readFolderExpanded("C:\\Photos\\10")).toBe(true);
    expect(readFolderExpanded("C:\\Photos\\59")).toBe(true);
  });

  it("re-expanding an old folder saves it from the next trim", () => {
    for (let index = 0; index < 50; index += 1) {
      writeFolderExpanded(`C:\\Photos\\${index}`, true);
    }
    writeFolderExpanded("C:\\Photos\\0", true);
    writeFolderExpanded("C:\\Photos\\fresh", true);

    expect(readFolderExpanded("C:\\Photos\\0")).toBe(true);
    expect(readFolderExpanded("C:\\Photos\\1")).toBe(false);
  });

  it("ignores a cache that is not a list of paths", () => {
    localStorage.setItem(STORAGE_KEY, '{"C:\\\\Photos":true}');

    expect(readFolderExpanded("C:\\Photos")).toBe(false);
  });

  it("does nothing without a folder path", () => {
    expect(readFolderExpanded(undefined)).toBe(false);
    writeFolderExpanded(undefined, true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
