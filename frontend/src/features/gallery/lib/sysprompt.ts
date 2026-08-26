import { SYSPROMPT_FILENAME } from "@/shared/constants";
import type { GalleryItem } from "@/shared/types";

export function buildSyspromptItem(folder: string, existing?: GalleryItem | null): GalleryItem {
  if (existing) return existing;

  const separator = folder.includes("\\") ? "\\" : "/";

  return {
    name: SYSPROMPT_FILENAME,
    path: `${folder}${separator}${SYSPROMPT_FILENAME}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "none",
    media_type: "sysprompt",
  };
}

export function isSyspromptPath(path: string): boolean {
  return path.endsWith(SYSPROMPT_FILENAME);
}
