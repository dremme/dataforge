import { HOME_PATH } from "./fixtures";
import type { GalleryItem } from "@/shared/types";

/**
 * A captioned gallery item for GalleryItemModal's suites.
 *
 * Deliberately not `mediaItem` from fixtures: that one defaults to uncaptioned,
 * while the modal's tests start from a file that already has a description and a
 * sidecar, and assert against a fixed `modified_at` in the meta strip.
 */
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
