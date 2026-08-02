import { beforeEach, describe, expect, it } from "vitest";
import type { BrowseResponse } from "@/shared/types";
import {
  clearBrowseCache,
  evictCachedBrowse,
  readCachedBrowse,
  writeCachedBrowse,
} from "./browseCache";

function makeBrowse(folder: string): BrowseResponse {
  return {
    folder,
    home: "C:\\Users\\dev",
    parent: null,
    breadcrumbs: [],
    subfolders: [],
    items: [],
    sysprompt: null,
    has_caption_backup: false,
    item_count: 0,
    subfolder_count: 0,
    fingerprint: `${folder}-fp`,
  };
}

describe("browseCache", () => {
  beforeEach(() => {
    clearBrowseCache();
  });

  it("returns nothing for a folder that was never cached", () => {
    expect(readCachedBrowse("C:\\Photos")).toBeNull();
    expect(readCachedBrowse(undefined)).toBeNull();
  });

  it("reads back a cached folder", () => {
    const data = makeBrowse("C:\\Photos");
    writeCachedBrowse(data);

    expect(readCachedBrowse("C:\\Photos")).toBe(data);
  });

  it("matches regardless of separators, trailing slash, or case", () => {
    writeCachedBrowse(makeBrowse("C:\\Photos\\Album"));

    expect(readCachedBrowse("C:/Photos/Album")).not.toBeNull();
    expect(readCachedBrowse("C:\\Photos\\Album\\")).not.toBeNull();
    expect(readCachedBrowse("c:\\photos\\album")).not.toBeNull();
  });

  it("replaces an earlier payload for the same folder", () => {
    writeCachedBrowse(makeBrowse("C:\\Photos"));
    const fresh = { ...makeBrowse("C:\\Photos"), fingerprint: "updated" };
    writeCachedBrowse(fresh);

    expect(readCachedBrowse("C:\\Photos")?.fingerprint).toBe("updated");
  });

  it("evicts the least recently used folder past the cap", () => {
    for (let index = 0; index < 10; index++) {
      writeCachedBrowse(makeBrowse(`C:\\Folder${index}`));
    }

    // Touching the oldest entry should keep it alive through the next write.
    expect(readCachedBrowse("C:\\Folder0")).not.toBeNull();
    writeCachedBrowse(makeBrowse("C:\\Folder10"));

    expect(readCachedBrowse("C:\\Folder0")).not.toBeNull();
    expect(readCachedBrowse("C:\\Folder1")).toBeNull();
  });

  it("forgets a folder that was evicted explicitly", () => {
    writeCachedBrowse(makeBrowse("C:\\Photos"));
    evictCachedBrowse("C:\\Photos");

    expect(readCachedBrowse("C:\\Photos")).toBeNull();
  });
});
