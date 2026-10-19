import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { collectAdjacentDialogMediaTargets } from "./dialogMediaPrefetch";

function item(name: string, mediaType: GalleryItem["media_type"] = "image"): GalleryItem {
  return {
    path: `C:\\Photos\\${name}`,
    name,
    media_type: mediaType,
    has_description: false,
  } as GalleryItem;
}

describe("collectAdjacentDialogMediaTargets", () => {
  const items = [item("a.jpg"), item("b.mp4", "video"), item("c.jpg"), item("d.jpg")];

  it("returns previous and next media around the current index", () => {
    expect(collectAdjacentDialogMediaTargets(items, 1)).toEqual([
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

  it("skips audio: an <audio> loads its metadata on open, and decoding ahead buys nothing", () => {
    const withAudio = [item("a.wav", "audio"), item("b.jpg"), item("c.mp3", "audio")];

    expect(collectAdjacentDialogMediaTargets(withAudio, 1)).toEqual([]);
  });

  it("can collect only the next item for forward-only flows", () => {
    expect(collectAdjacentDialogMediaTargets(items, 1, { offsets: [1] })).toEqual([
      {
        path: "C:\\Photos\\c.jpg",
        url: "/api/media?path=C%3A%5CPhotos%5Cc.jpg",
        kind: "image",
      },
    ]);
  });

  it("only includes existing neighbors", () => {
    expect(collectAdjacentDialogMediaTargets(items, 0)).toEqual([
      {
        path: "C:\\Photos\\b.mp4",
        url: "/api/media?path=C%3A%5CPhotos%5Cb.mp4",
        kind: "video",
      },
    ]);
    expect(collectAdjacentDialogMediaTargets(items, 3, { offsets: [1] })).toEqual([]);
  });
});
