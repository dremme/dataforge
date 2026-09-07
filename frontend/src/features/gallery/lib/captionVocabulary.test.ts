import { describe, expect, it } from "vitest";
import { makeItem } from "@/test/galleryItemModal";
import { buildCaptionVocabulary } from "./captionVocabulary";
import type { GalleryItem } from "@/shared/types";

function captioned(name: string, description: string): GalleryItem {
  return makeItem(name, { description, has_description: true, caption_status: "text" });
}

function labels(entries: ReturnType<typeof buildCaptionVocabulary>): string[] {
  return entries.map((entry) => entry.label);
}

describe("buildCaptionVocabulary", () => {
  it("ranks the words captions use most", () => {
    const entries = buildCaptionVocabulary([
      captioned("a.png", "mountain lake at sunrise"),
      captioned("b.png", "mountain lake in fog"),
      captioned("c.png", "mountain ridge"),
    ]);

    expect(labels(entries).slice(0, 2)).toEqual(["mountain", "lake"]);
    expect(entries[0]).toMatchObject({ label: "mountain", count: 3, kind: "word" });
  });

  it("leaves stop words out", () => {
    const entries = buildCaptionVocabulary([
      captioned("a.png", "the harbour and the boats"),
      captioned("b.png", "the harbour at dawn"),
    ]);

    expect(labels(entries)).not.toContain("the");
    expect(labels(entries)).not.toContain("and");
    expect(labels(entries)).toContain("harbour");
  });

  it("offers comma tags that more than one caption uses", () => {
    const entries = buildCaptionVocabulary([
      captioned("a.png", "wide angle shot, golden hour, harbour"),
      captioned("b.png", "wide angle shot, blue hour, harbour"),
    ]);

    const tags = entries.filter((entry) => entry.kind === "tag").map((entry) => entry.label);
    expect(tags).toContain("wide angle shot");
    expect(tags).toContain("harbour");
    expect(tags).not.toContain("golden hour");
  });

  it("counts a repeated tag once per caption", () => {
    const entries = buildCaptionVocabulary([
      captioned("a.png", "harbour, harbour, boats"),
      captioned("b.png", "harbour, boats"),
    ]);

    const harbour = entries.find((entry) => entry.label === "harbour" && entry.kind === "tag");
    expect(harbour?.count).toBe(2);
  });

  it("ignores captioning instructions and uncaptioned files", () => {
    const entries = buildCaptionVocabulary([
      makeItem(".sysprompt", {
        media_type: "sysprompt",
        description: "Describe every image with rich detail",
        caption_status: "text",
      }),
      makeItem("blank.png", { description: null, has_description: false, caption_status: "none" }),
      captioned("a.png", "harbour"),
    ]);

    expect(labels(entries)).toEqual(["harbour"]);
  });

  it("returns nothing for a folder without captions", () => {
    expect(buildCaptionVocabulary([])).toEqual([]);
  });
});
