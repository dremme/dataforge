import { describe, expect, it } from "vitest";
import { computeDatasetStats } from "./datasetStats";
import { HOME_PATH, mediaItem } from "@/test/fixtures";

function captioned(name: string, description: string) {
  return mediaItem(name, HOME_PATH, { description, has_description: true, caption_status: "text" });
}

describe("computeDatasetStats", () => {
  it("counts caption coverage against the gallery's own filters", () => {
    const stats = computeDatasetStats([
      captioned("one.png", "a dog"),
      mediaItem("two.png", HOME_PATH),
      mediaItem("three.png", HOME_PATH, { has_issue_file: true }),
    ]);

    expect(stats.total).toBe(3);
    expect(stats.coverage).toEqual([
      { filter: "captioned", label: "Captioned", count: 1 },
      { filter: "uncaptioned", label: "Missing caption", count: 2 },
      { filter: "issue", label: "With issues", count: 1 },
    ]);
  });

  it("excludes the sysprompt, whose description is instructions rather than a caption", () => {
    const stats = computeDatasetStats([
      captioned("one.png", "a dog"),
      mediaItem(".sysprompt", HOME_PATH, {
        media_type: "sysprompt",
        description: "Describe every photograph in detail.",
        caption_status: "text",
      }),
    ]);

    expect(stats.total).toBe(1);
    expect(stats.topWords.map((entry) => entry.word)).not.toContain("describe");
  });

  it("summarizes caption length", () => {
    const stats = computeDatasetStats([
      captioned("one.png", "a".repeat(10)),
      captioned("two.png", "a".repeat(100)),
      captioned("three.png", "a".repeat(400)),
    ]);

    expect(stats.captionLength).toMatchObject({ min: 10, median: 100, max: 400 });
    expect(stats.captionLength?.buckets).toEqual([
      { label: "< 50", count: 1 },
      { label: "50 – 150", count: 1 },
      { label: "150 – 300", count: 0 },
      { label: "300 – 600", count: 1 },
      { label: "600 +", count: 0 },
    ]);
  });

  it("has no caption length stats when nothing is captioned", () => {
    const stats = computeDatasetStats([mediaItem("one.png", HOME_PATH)]);

    expect(stats.captionLength).toBeNull();
  });

  it("ranks words, ignoring stop words and case", () => {
    const stats = computeDatasetStats([
      captioned("one.png", "A brown dog in the park"),
      captioned("two.png", "a brown dog, running"),
      captioned("three.png", "The park at dawn"),
    ]);

    expect(stats.topWords.slice(0, 3)).toEqual([
      { word: "brown", count: 2 },
      { word: "dog", count: 2 },
      { word: "park", count: 2 },
    ]);
    expect(stats.topWords.map((entry) => entry.word)).not.toContain("the");
  });

  it("counts media types with GIFs separate from videos", () => {
    const stats = computeDatasetStats([
      mediaItem("one.png", HOME_PATH),
      mediaItem("clip.mp4", HOME_PATH),
      mediaItem("loop.gif", HOME_PATH),
    ]);

    expect(stats.mediaTypes).toEqual([
      { label: "Images", count: 1 },
      { label: "Videos", count: 1 },
      { label: "GIFs", count: 1 },
    ]);
  });

  it("keeps files with unknown dimensions out of the megapixel buckets", () => {
    // Every non-MP4-family video reports null dimensions, which is not zero megapixels.
    const stats = computeDatasetStats([
      mediaItem("one.png", HOME_PATH, { width: 1920, height: 1080 }),
      mediaItem("clip.mkv", HOME_PATH, { width: null, height: null }),
    ]);

    expect(stats.unknownResolution).toBe(1);
    // 1920x1080 is 2.07 MP.
    expect(stats.megapixels).toEqual([
      { label: "< 0.5 MP", count: 0 },
      { label: "0.5 – 1 MP", count: 0 },
      { label: "1 – 2 MP", count: 0 },
      { label: "2 – 4 MP", count: 1 },
      { label: "4 MP +", count: 0 },
    ]);
  });

  it("handles an empty folder", () => {
    const stats = computeDatasetStats([]);

    expect(stats.total).toBe(0);
    expect(stats.topWords).toEqual([]);
    expect(stats.captionLength).toBeNull();
  });
});
