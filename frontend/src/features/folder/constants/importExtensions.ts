import { CAPTION_SIDECAR_EXTENSIONS } from "@/shared/lib/captionSidecar";

// Mirrored by hand from `backend/constants.py`; the server re-validates every drop.
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"] as const;
const GIF_EXTENSIONS = [".gif"] as const;
const VIDEO_EXTENSIONS = [".mp4"] as const;
export const SYSPROMPT_FILENAME = ".sysprompt";

const IMPORT_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...GIF_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...CAPTION_SIDECAR_EXTENSIONS,
] as const;

export const IMPORT_EXTENSION_SET = new Set<string>(IMPORT_EXTENSIONS);
