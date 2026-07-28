import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { collectAdjacentModalMediaTargets } from "./modalMediaPrefetch";

function item(name: string, mediaType: GalleryItem["media_type"] = "image"): GalleryItem {
  return {
    path: `C:\\Photos\\${name}`,
    name,
    media_type: mediaType,
    has_description: false,
  } as GalleryItem;
}

describe("collectAdjacentModalMediaTargets", () => {
  const items = [
    item("a.jpg"),
    item("b.mp4", "video"),
    item("c.jpg"),
    item("sysprompt.txt", "sysprompt"),
    item("d.jpg"),
  ];

  it("returns previous and next media around the current index", () => {
    expect(collectAdjacentModalMediaTargets(items, 1)).toEqual([
      {
        path: "C:\\Photos\\a.jpg",
        url: "/api/media?path=C%3A%5CPhotos%5Ca.jpg",
        kind: "image",
      },
      {
        path: "C:\\Photos\\c.jpg",
        url: "/api/media?path=C%3A%5CPhotos%5Cc.jpg",
        kind: "image",
      },
    ]);
  });

  it("can collect only the next item for forward-only flows", () => {
    expect(collectAdjacentModalMediaTargets(items, 1, { offsets: [1] })).toEqual([
      {
        path: "C:\\Photos\\c.jpg",
        url: "/api/media?path=C%3A%5CPhotos%5Cc.jpg",
        kind: "image",
      },
    ]);
  });

  it("skips system prompts and only includes existing neighbors", () => {
    expect(collectAdjacentModalMediaTargets(items, 0)).toEqual([
      {
        path: "C:\\Photos\\b.mp4",
        url: "/api/media?path=C%3A%5CPhotos%5Cb.mp4",
        kind: "video",
      },
    ]);
    expect(collectAdjacentModalMediaTargets(items, 4)).toEqual([]);
    expect(collectAdjacentModalMediaTargets(items, 2, { offsets: [1] })).toEqual([]);
  });
});
