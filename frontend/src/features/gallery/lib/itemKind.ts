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

function extensionOfName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  return name.slice(dot).toLowerCase();
}

function extensionOf(item: GalleryItem): string | null {
  return extensionOfName(item.name);
}

export function isVideoName(name: string): boolean {
  const extension = extensionOfName(name);
  return extension !== null && VIDEO_EXTENSION_SET.has(extension);
}

/** Narrower than isMotion: a GIF animates in an <img>, and a <video> would show nothing. */
export function isVideo(item: GalleryItem): boolean {
  if (item.media_type) {
    return item.media_type === "video";
  }

  return isVideoName(item.name);
}

/** Narrower than isVideo: the editor reads duration off <video>, which never decodes matroska. */
export function isEditableVideo(item: GalleryItem): boolean {
  if (!isVideo(item)) return false;

  const extension = extensionOf(item);
  return extension !== null && VIDEO_EDIT_EXTENSION_SET.has(extension);
}

/** Guarded on isMotion too: a Pillow round-trip would flatten a GIF's animation. */
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

/** Do not align this with the backend MediaKind or the Videos filter stops finding GIFs. */
export function isMotion(item: GalleryItem): boolean {
  return isVideo(item) || isGif(item);
}

export function mediaLabelFor(item: GalleryItem): string {
  if (isGif(item)) return "GIF";
  if (isVideo(item)) return "video";
  return "image";
}
