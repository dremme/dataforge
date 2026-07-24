export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"] as const;
export const VIDEO_EXTENSIONS = [".mp4"] as const;
export const SIDECAR_EXTENSIONS = [".txt", ".json"] as const;
export const SYSPROMPT_FILENAME = ".sysprompt";

export const IMPORT_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...SIDECAR_EXTENSIONS,
] as const;

export const IMPORT_EXTENSION_SET = new Set<string>(IMPORT_EXTENSIONS);
