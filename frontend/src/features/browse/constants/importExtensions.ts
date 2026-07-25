const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"] as const;
const VIDEO_EXTENSIONS = [".mp4"] as const;
const SIDECAR_EXTENSIONS = [".txt", ".json"] as const;
export const SYSPROMPT_FILENAME = ".sysprompt";

const IMPORT_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...SIDECAR_EXTENSIONS,
] as const;

export const IMPORT_EXTENSION_SET = new Set<string>(IMPORT_EXTENSIONS);
