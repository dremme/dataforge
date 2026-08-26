import { describe, expect, it } from "vitest";
import {
  CARD_BORDER_PX,
  LARGE_CARD_BODY_PX,
  galleryColumnWidth,
  largeCardBodyHeight,
  largeCardBox,
  largeCardHeight,
  mediaAspectRatio,
} from "./cardGeometry";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";

function makeItem(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name: "sunset.png",
    path: `${HOME_PATH}\\sunset.png`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "none",
    media_type: "image",
    width: 1600,
    height: 1200,
    ...overrides,
  };
}

describe("mediaAspectRatio", () => {
  it("uses the file's pixel size when both sides are present", () => {
    expect(mediaAspectRatio({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9);
  });

  it("falls back to 4:3 when a side is missing", () => {
    // Video outside the ISOBMFF containers comes back without dimensions.
    expect(mediaAspectRatio({ width: 1920, height: null })).toBeCloseTo(4 / 3);
    expect(mediaAspectRatio({})).toBeCloseTo(4 / 3);
  });
});

describe("galleryColumnWidth", () => {
  it("splits the container into equal columns after gaps", () => {
    expect(galleryColumnWidth(1000, 3, 20)).toBeCloseTo((1000 - 40) / 3);
  });

  it("never reports a negative width", () => {
    expect(galleryColumnWidth(10, 4, 20)).toBe(0);
  });
});

describe("largeCardBodyHeight", () => {
  it("reserves the caption lines when the file has a description", () => {
    expect(
      largeCardBodyHeight(makeItem({ description: "Golden hour", has_description: true })),
    ).toBe(LARGE_CARD_BODY_PX.titleAndCaption);
  });

  it("reserves the status pill when the card shows one instead", () => {
    expect(largeCardBodyHeight(makeItem({ caption_status: "none" }))).toBe(
      LARGE_CARD_BODY_PX.titleAndPill,
    );
    expect(largeCardBodyHeight(makeItem({ caption_status: "empty" }))).toBe(
      LARGE_CARD_BODY_PX.titleAndPill,
    );
  });

  it("reserves the title alone when the card renders nothing under it", () => {
    // `text` with no description resolves to no pill, so the body is the title.
    expect(largeCardBodyHeight(makeItem({ caption_status: "text" }))).toBe(
      LARGE_CARD_BODY_PX.title,
    );
  });
});

describe("largeCardBox", () => {
  it("measures the media inside the card's borders, not across them", () => {
    const box = largeCardBox(makeItem({ width: 1000, height: 1000 }), 300);

    expect(box.media).toBeCloseTo(300 - 2 * CARD_BORDER_PX);
    expect(box.body).toBe(LARGE_CARD_BODY_PX.titleAndPill);
    expect(box.total).toBeCloseTo(2 * CARD_BORDER_PX + box.media + box.body);
  });

  it("makes portraits taller and landscapes shorter at the same column width", () => {
    const landscape = largeCardHeight(makeItem({ width: 1600, height: 900 }), 300);
    const square = largeCardHeight(makeItem({ width: 1000, height: 1000 }), 300);
    const portrait = largeCardHeight(makeItem({ width: 900, height: 1600 }), 300);

    expect(landscape).toBeLessThan(square);
    expect(square).toBeLessThan(portrait);
  });

  it("keeps a dimensionless file at the 4:3 fallback the card also draws", () => {
    const box = largeCardBox(makeItem({ width: null, height: null }), 300);

    expect(box.media).toBeCloseTo((300 - 2 * CARD_BORDER_PX) / (4 / 3));
  });
});
