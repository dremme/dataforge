import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { countResolvableIssues, listResolvableIssueItems } from "./issues";

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name: "photo.png",
    path: "C:\\Photos\\photo.png",
    description: "A caption",
    has_description: true,
    has_caption_file: true,
    issue_fixes: ['Replace "a blue lake" with "a snow-covered mountain peak".'],
    has_issue_file: true,
    has_bboxes: false,
    caption_status: "text",
    caption_file_type: "txt",
    media_type: "image",
    ...overrides,
  };
}

describe("listResolvableIssueItems", () => {
  it("includes image and video items with issue files", () => {
    const items = [
      item(),
      item({ name: "clip.mp4", path: "C:\\Photos\\clip.mp4", media_type: "video" }),
      item({ name: ".sysprompt", media_type: "sysprompt", has_issue_file: false }),
      item({ name: "plain.png", has_issue_file: false, issue_fixes: [] }),
    ];

    expect(listResolvableIssueItems(items)).toHaveLength(2);
    expect(countResolvableIssues(items)).toBe(2);
  });
});
