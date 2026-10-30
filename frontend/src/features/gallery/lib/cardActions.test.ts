import { describe, expect, it } from "vitest";
import { makeItem } from "@/test/galleryItemDialog";
import type { GalleryCardAction, GalleryItem } from "@/shared/types";
import { CARD_ACTION_IDS, cardActionsFor, withCardAction } from "./cardActions";

const IMAGE = makeItem("photo.png", { media_type: "image" });
const VIDEO = makeItem("clip.mp4", { media_type: "video" });
const MATROSKA = makeItem("clip.mkv", { media_type: "video" });
const GIF = makeItem("loop.gif", { media_type: "gif" });
const AUDIO = makeItem("voice.wav", { media_type: "audio" });

function applies(item: GalleryItem, action: GalleryCardAction): boolean {
  return cardActionsFor(item, [action], false).includes(action);
}

describe("cardActionsFor", () => {
  it.each([
    ["open_in_video_editor", VIDEO, true],
    ["open_in_video_editor", MATROSKA, false],
    ["open_in_video_editor", GIF, false],
    ["open_in_image_preview", IMAGE, true],
    ["open_in_image_preview", GIF, false],
    ["open_in_image_preview", AUDIO, false],
    ["edit", IMAGE, true],
    ["edit", VIDEO, true],
    ["edit", AUDIO, true],
    ["edit", GIF, false],
    ["save_frame", VIDEO, true],
    ["save_frame", GIF, true],
    ["save_frame", IMAGE, false],
    ["save_frame", AUDIO, false],
  ] as const)("%s on %o is %s", (action, item, expected) => {
    expect(applies(item, action)).toBe(expected);
  });

  it("offers Copy caption only with a caption", () => {
    expect(applies(makeItem("a.png", { description: "A lake" }), "copy_caption")).toBe(true);
    expect(applies(makeItem("a.png", { description: "" }), "copy_caption")).toBe(false);
  });

  it("offers the review actions only on files that need them", () => {
    const flagged = makeItem("a.png", {
      has_issue_file: true,
      issue_fixes: ["A fix"],
      has_candidate: true,
      has_duplicate_file: true,
    });

    expect(applies(flagged, "resolve_issue")).toBe(true);
    expect(applies(flagged, "review_candidate")).toBe(true);
    expect(applies(flagged, "resolve_duplicate")).toBe(true);
    expect(applies(IMAGE, "resolve_issue")).toBe(false);
    expect(applies(IMAGE, "review_candidate")).toBe(false);
    expect(applies(IMAGE, "resolve_duplicate")).toBe(false);
  });

  it("follows the catalog's order, not the saved list's", () => {
    expect(cardActionsFor(IMAGE, ["delete", "move_file", "open"], false)).toEqual([
      "open",
      "move_file",
      "delete",
    ]);
  });

  it("is only Open while selecting, whatever is saved", () => {
    expect(cardActionsFor(IMAGE, CARD_ACTION_IDS, true)).toEqual(["open"]);
    expect(cardActionsFor(IMAGE, [], true)).toEqual(["open"]);
  });

  it("is empty when nothing is saved", () => {
    expect(cardActionsFor(IMAGE, [], false)).toEqual([]);
  });
});

describe("withCardAction", () => {
  it("adds an action at its catalog place and removes one", () => {
    const added = withCardAction(["open", "delete"], "rename_file", true);

    expect(added).toEqual(["open", "rename_file", "delete"]);
    expect(withCardAction(added, "open", false)).toEqual(["rename_file", "delete"]);
  });
});
