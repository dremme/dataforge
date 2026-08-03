import type { GalleryItem } from "@/shared/types";

export function buildSyspromptItem(folder: string, existing?: GalleryItem | null): GalleryItem {
  if (existing) return existing;

  const separator = folder.includes("\\") ? "\\" : "/";

  return {
    name: ".sysprompt",
    path: `${folder}${separator}.sysprompt`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: "sysprompt",
  };
}

export function isSyspromptPath(path: string): boolean {
  return (
    path.endsWith(".sysprompt") || path.endsWith("\\.sysprompt") || path.endsWith("/.sysprompt")
  );
}
