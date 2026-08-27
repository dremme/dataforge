import { HOME_PATH } from "./fixtures";
import type { GalleryItem } from "@/shared/types";

export function makeItem(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `${HOME_PATH}\\${name}`,
    description: "Golden hour over the lake",
    has_description: true,
    has_caption_file: true,
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "text",
    media_type: "image",
    modified_at: "2026-03-15T14:30:00.000Z",
    width: 1920,
    height: 1080,
    ...overrides,
  };
}
