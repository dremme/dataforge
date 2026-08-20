import {
  GIF_EXTENSION,
  IMAGE_EDIT_EXTENSIONS,
  VIDEO_EDIT_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "@/shared/constants";
import type { GalleryItem } from "@/shared/types";

const VIDEO_EXTENSION_SET = new Set<string>(VIDEO_EXTENSIONS);
const VIDEO_EDIT_EXTENSION_SET = new Set<string>(VIDEO_EDIT_EXTENSIONS);
const IMAGE_EDIT_EXTENSION_SET = new Set<string>(IMAGE_EDIT_EXTENSIONS);

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
 * Narrower than `isVideo`, and for the same reason playback is: the editor reads its
 * duration and frame size off the `<video>` element and previews the trim, speed and
 * crop through it, so a container the browser cannot decode would give a toggle onto a
 * panel that never becomes usable. Matroska is the trap here - ffmpeg renders it fine.
 */
export function isEditableVideo(item: GalleryItem): boolean {
  if (!isVideo(item)) return false;

  const extension = extensionOf(item);
  return extension !== null && VIDEO_EDIT_EXTENSION_SET.has(extension);
}

/**
 * Whether the item can be cropped, mirrored, turned and rescaled in place.
 *
 * Guarded on `isMotion` as well as the extension list, because the two questions can
 * disagree: a `.png` that the backend has typed as something else is not a still, and a
 * GIF is excluded on both counts - a Pillow round-trip would flatten its animation, and
 * the affordance a GIF gets in this modal is frame capture, which writes a new file.
 */
export function isEditableImage(item: GalleryItem): boolean {
  if (isMotion(item) || isSysPrompt(item)) return false;

  const extension = extensionOf(item);
  return extension !== null && IMAGE_EDIT_EXTENSION_SET.has(extension);
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
