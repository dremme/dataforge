/** Caption sidecar extensions in precedence order: a .json sidecar always beats a .txt one. */
export const CAPTION_SIDECAR_EXTENSIONS = [".json", ".txt"] as const;

/** The pair as it reads in prose about files on disk. */
export const CAPTION_SIDECAR_EXTENSION_LIST = CAPTION_SIDECAR_EXTENSIONS.join("/");

/**
 * Display names for the format itself, as opposed to the filename suffix. The backend
 * declares `caption_file_type` as a bare string, so unknown values fall back rather than throw.
 */
const CAPTION_FILE_TYPE_LABELS: Record<string, string> = {
  json: "JSON",
  txt: "TXT",
};

export function captionFileTypeLabel(type: string): string {
  return CAPTION_FILE_TYPE_LABELS[type] ?? type.toUpperCase();
}
