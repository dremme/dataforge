import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { countResolvableIssues, flaggedCaptionPhrases, listResolvableIssueItems } from "./issues";

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name: "photo.png",
    path: "C:\\Photos\\photo.png",
    description: "A caption",
    has_description: true,
    has_caption_file: true,
    issue_fixes: ['Replace "a blue lake" with "a snow-covered mountain peak".'],
    has_issue_file: true,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "text",
    media_type: "image",
    ...overrides,
  };
}

describe("listResolvableIssueItems", () => {
  it("includes every media type with an issue file", () => {
    const items = [
      item(),
      item({ name: "clip.mp4", path: "C:\\Photos\\clip.mp4", media_type: "video" }),
      item({ name: "loop.gif", path: "C:\\Photos\\loop.gif", media_type: "gif" }),
      item({
        name: ".sysprompt",
        media_type: "sysprompt",
        has_issue_file: false,
        has_duplicate_file: false,
        has_backup: false,
        has_candidate: false,
      }),
      item({
        name: "plain.png",
        has_issue_file: false,
        has_duplicate_file: false,
        has_backup: false,
        has_candidate: false,
        issue_fixes: [],
      }),
    ];

    expect(listResolvableIssueItems(items)).toHaveLength(3);
    expect(countResolvableIssues(items)).toBe(3);
  });

  it("keeps a sysprompt out even when it carries an issue file", () => {
    const items = [item({ name: ".sysprompt", media_type: "sysprompt" })];

    expect(listResolvableIssueItems(items)).toHaveLength(0);
  });
});

describe("flaggedCaptionPhrases", () => {
  it("takes the flagged wording only, never the suggested replacement", () => {
    expect(flaggedCaptionPhrases(['Replace "a blue car" with "a red car".'])).toEqual([
      "a blue car",
    ]);
  });

  it("reads typographic quotes from older sidecars", () => {
    expect(flaggedCaptionPhrases(["Remove “parked at the curb” - the car is moving."])).toEqual([
      "parked at the curb",
    ]);
  });

  it("contributes nothing for a fix about something the caption omits", () => {
    expect(flaggedCaptionPhrases(["The caption does not mention the rain."])).toEqual([]);
  });

  it("collapses phrases repeated across fixes", () => {
    expect(
      flaggedCaptionPhrases([
        'Replace "a blue car" with "a red car".',
        'The phrase "A Blue Car" also contradicts the image.',
      ]),
    ).toEqual(["a blue car"]);
  });
});
