import { CAPTION_SIDECAR_EXTENSIONS } from "@/shared/constants";

/** The pair as it reads in prose about files on disk, in backend precedence order. */
export const CAPTION_SIDECAR_EXTENSION_LIST = CAPTION_SIDECAR_EXTENSIONS.join("/");

/**
 * Display names for the format itself, as opposed to the filename suffix. The value
 * arrives as unvalidated JSON, so unknown ones fall back rather than throw.
 */
const CAPTION_FILE_TYPE_LABELS: Record<string, string> = {
  json: "JSON",
  txt: "TXT",
};

export function captionFileTypeLabel(type: string): string {
  return CAPTION_FILE_TYPE_LABELS[type] ?? type.toUpperCase();
}
