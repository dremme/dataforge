import type { GalleryItem } from "./types";

const VIDEO_EXTENSIONS = new Set([".mp4"]);

export function isSysPrompt(item: GalleryItem): boolean {
  return item.media_type === "sysprompt";
}

export function isVideo(item: GalleryItem): boolean {
  if (item.media_type) {
    return item.media_type === "video";
  }

  const dot = item.name.lastIndexOf(".");
  if (dot === -1) return false;
  return VIDEO_EXTENSIONS.has(item.name.slice(dot).toLowerCase());
}
