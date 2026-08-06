import type { GalleryItem } from "@/shared/types";

const VIDEO_EXTENSIONS = new Set([".mp4"]);
const GIF_EXTENSIONS = new Set([".gif"]);

export function isSysPrompt(item: GalleryItem): boolean {
  return item.media_type === "sysprompt";
}

function extensionOf(item: GalleryItem): string | null {
  const dot = item.name.lastIndexOf(".");
  if (dot === -1) return null;
  return item.name.slice(dot).toLowerCase();
}

/**
 * Whether the item needs a `<video>` element.
 *
 * Deliberately narrower than "has motion" - a GIF animates but renders in an
 * `<img>`, and handing one to a `<video>` shows nothing at all. Reach for
 * `isMotion` when the question is about the content rather than the element.
 */
export function isVideo(item: GalleryItem): boolean {
  if (item.media_type) {
    return item.media_type === "video";
  }

  const extension = extensionOf(item);
  return extension !== null && VIDEO_EXTENSIONS.has(extension);
}

export function isGif(item: GalleryItem): boolean {
  if (item.media_type) {
    return item.media_type === "gif";
  }

  const extension = extensionOf(item);
  return extension !== null && GIF_EXTENSIONS.has(extension);
}

/** Whether the item carries a frame sequence, which is how LoRA training groups it. */
export function isMotion(item: GalleryItem): boolean {
  return isVideo(item) || isGif(item);
}

/** What to call the item in user-facing copy, e.g. "No caption available for this GIF." */
export function mediaLabelFor(item: GalleryItem): string {
  if (isGif(item)) return "GIF";
  if (isVideo(item)) return "video";
  return "image";
}
