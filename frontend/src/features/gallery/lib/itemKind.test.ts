import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { isGif, isMotion, isVideo, mediaLabelFor } from "./itemKind";

/**
 * `media_type` is required on the wire, so the extension fallback is only ever
 * reachable at runtime - a cached item from before the field existed, or a
 * partial the server never sent. Passing `undefined` here is how that state is
 * reproduced, and the cast is what lets the test describe it.
 */
function item(name: string, mediaType: GalleryItem["media_type"] | undefined): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: mediaType,
  } as GalleryItem;
}

describe("isVideo", () => {
  it("trusts the server's media_type over the extension", () => {
    expect(isVideo(item("clip.mkv", "image"))).toBe(false);
    expect(isVideo(item("still.png", "video"))).toBe(true);
  });

  it("falls back to the extension for every supported container", () => {
    const names = [
      "clip.mp4",
      "clip.avi",
      "clip.mov",
      "clip.mkv",
      "clip.wmv",
      "clip.m4v",
      "clip.flv",
      "CLIP.MKV",
    ];

    expect(names.filter((name) => !isVideo(item(name, undefined)))).toEqual([]);
  });

  it("does not claim images or GIFs", () => {
    const names = ["photo.jpg", "photo.webp", "photo.bmp", "loop.gif"];

    expect(names.filter((name) => isVideo(item(name, undefined)))).toEqual([]);
  });
});

describe("isGif", () => {
  it("falls back to the extension", () => {
    expect(isGif(item("loop.gif", undefined))).toBe(true);
    expect(isGif(item("clip.mkv", undefined))).toBe(false);
  });
});

describe("isMotion", () => {
  it("covers GIFs and every video container", () => {
    expect(isMotion(item("loop.gif", "gif"))).toBe(true);
    expect(isMotion(item("clip.mkv", undefined))).toBe(true);
    expect(isMotion(item("photo.webp", undefined))).toBe(false);
  });
});

describe("mediaLabelFor", () => {
  it("names the new types", () => {
    expect(mediaLabelFor(item("clip.mov", undefined))).toBe("video");
    expect(mediaLabelFor(item("photo.bmp", undefined))).toBe("image");
    expect(mediaLabelFor(item("loop.gif", "gif"))).toBe("GIF");
  });
});
