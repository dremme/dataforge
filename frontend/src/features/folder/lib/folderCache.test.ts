import { beforeEach, describe, expect, it } from "vitest";
import type { FolderResponse } from "@/shared/types";
import {
  clearFolderCache,
  evictCachedFolder,
  readCachedFolder,
  writeCachedFolder,
} from "./folderCache";

function makeFolder(path: string): FolderResponse {
  return {
    path,
    home: "C:\\Users\\dev",
    parent: null,
    breadcrumbs: [],
    subfolders: [],
    items: [],
    sysprompt: null,
    has_caption_backup: false,
    item_count: 0,
    subfolder_count: 0,
    fingerprint: `${path}-fp`,
  };
}

describe("folderCache", () => {
  beforeEach(() => {
    clearFolderCache();
  });

  it("returns nothing for a folder that was never cached", () => {
    expect(readCachedFolder("C:\\Photos")).toBeNull();
    expect(readCachedFolder(undefined)).toBeNull();
  });

  it("reads back a cached folder", () => {
    const data = makeFolder("C:\\Photos");
    writeCachedFolder(data);

    expect(readCachedFolder("C:\\Photos")).toBe(data);
  });

  it("matches regardless of separators, trailing slash, or case", () => {
    writeCachedFolder(makeFolder("C:\\Photos\\Album"));

    expect(readCachedFolder("C:/Photos/Album")).not.toBeNull();
    expect(readCachedFolder("C:\\Photos\\Album\\")).not.toBeNull();
    expect(readCachedFolder("c:\\photos\\album")).not.toBeNull();
  });

  it("replaces an earlier payload for the same folder", () => {
    writeCachedFolder(makeFolder("C:\\Photos"));
    const fresh = { ...makeFolder("C:\\Photos"), fingerprint: "updated" };
    writeCachedFolder(fresh);

    expect(readCachedFolder("C:\\Photos")?.fingerprint).toBe("updated");
  });

  it("evicts the least recently used folder past the cap", () => {
    for (let index = 0; index < 10; index++) {
      writeCachedFolder(makeFolder(`C:\\Folder${index}`));
    }

    // Touching the oldest entry should keep it alive through the next write.
    expect(readCachedFolder("C:\\Folder0")).not.toBeNull();
    writeCachedFolder(makeFolder("C:\\Folder10"));

    expect(readCachedFolder("C:\\Folder0")).not.toBeNull();
    expect(readCachedFolder("C:\\Folder1")).toBeNull();
  });

  it("forgets a folder that was evicted explicitly", () => {
    writeCachedFolder(makeFolder("C:\\Photos"));
    evictCachedFolder("C:\\Photos");

    expect(readCachedFolder("C:\\Photos")).toBeNull();
  });
});
