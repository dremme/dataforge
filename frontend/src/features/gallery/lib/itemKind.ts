import { GIF_EXTENSION, VIDEO_EDIT_EXTENSIONS, VIDEO_EXTENSIONS } from "@/shared/constants";
import type { GalleryItem } from "@/shared/types";

const VIDEO_EXTENSION_SET = new Set<string>(VIDEO_EXTENSIONS);
const VIDEO_EDIT_EXTENSION_SET = new Set<string>(VIDEO_EDIT_EXTENSIONS);

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
  return extension !== null && VIDEO_EXTENSION_SET.has(extension);
}

/**
 * Whether the item can be trimmed, cropped, retimed and rescaled in place.
 *
 * Narrower than `isVideo`: the render writes h264/aac with `-movflags`, which the asf
 * and flv muxers reject outright and which avi cannot be relied on to take. The backend
 * refuses the rest by container, and this keeps the toggle from offering what it would.
 */
export function isEditableVideo(item: GalleryItem): boolean {
  if (!isVideo(item)) return false;

  const extension = extensionOf(item);
  return extension !== null && VIDEO_EDIT_EXTENSION_SET.has(extension);
}

export function isGif(item: GalleryItem): boolean {
  if (item.media_type) {
    return item.media_type === "gif";
  }

  return extensionOf(item) === GIF_EXTENSION;
}

/**
 * Whether the item carries a frame sequence, which is how LoRA training groups it
 * and how the gallery filters it.
 *
 * Not how it is captioned: the AI jobs describe a GIF from its opening frame, like
 * any other still. That split is deliberate - do not "align" this with the backend's
 * `MediaKind` or the Videos filter stops finding GIFs.
 */
export function isMotion(item: GalleryItem): boolean {
  return isVideo(item) || isGif(item);
}

/** What to call the item in user-facing copy, e.g. "No caption available for this GIF." */
export function mediaLabelFor(item: GalleryItem): string {
  if (isGif(item)) return "GIF";
  if (isVideo(item)) return "video";
  return "image";
}
