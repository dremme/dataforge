import { describe, expect, it } from "vitest";
import { computeDatasetStats } from "./datasetStats";
import { HOME_PATH, mediaItem } from "@/test/fixtures";

function captioned(name: string, description: string) {
  return mediaItem(name, HOME_PATH, { description, has_description: true, caption_status: "text" });
}

describe("computeDatasetStats", () => {
  it("counts caption coverage and issues", () => {
    const stats = computeDatasetStats([
      captioned("one.png", "a dog"),
      mediaItem("two.png", HOME_PATH),
      mediaItem("three.png", HOME_PATH, { has_issue_file: true }),
    ]);

    expect(stats.total).toBe(3);
    expect(stats.findings).toMatchObject({
      captioned: 1,
      missingCaption: 2,
      captionIssues: 1,
      duplicates: 0,
      duplicateGroups: 0,
    });
  });

  it("counts duplicate files and the groups they span", () => {
    const inGroup = (name: string, group: string) =>
      mediaItem(name, HOME_PATH, { has_duplicate_file: true, duplicate_group: group });

    const stats = computeDatasetStats([
      inGroup("a.png", "g1"),
      inGroup("b.png", "g1"),
      inGroup("c.png", "g2"),
      inGroup("d.png", "g2"),
      mediaItem("e.png", HOME_PATH),
    ]);

    expect(stats.findings.duplicates).toBe(4);
    expect(stats.findings.duplicateGroups).toBe(2);
  });

  it("counts a flagged file with no group id as a group of its own", () => {
    // The safe direction: a group is never under-reported.
    const stats = computeDatasetStats([
      mediaItem("a.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g1" }),
      mediaItem("b.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: "g1" }),
      mediaItem("c.png", HOME_PATH, { has_duplicate_file: true, duplicate_group: null }),
    ]);

    expect(stats.findings.duplicates).toBe(3);
    expect(stats.findings.duplicateGroups).toBe(2);
  });

  it("never counts the sysprompt as a duplicate", () => {
    const stats = computeDatasetStats([
      mediaItem("a.png", HOME_PATH),
      mediaItem(".sysprompt", HOME_PATH, {
        media_type: "sysprompt",
        has_duplicate_file: true,
        duplicate_group: "g1",
      }),
    ]);

    expect(stats.findings.duplicates).toBe(0);
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
      { label: "< 250", count: 2 },
      { label: "250 – 400", count: 0 },
      { label: "400 – 600", count: 1 },
      { label: "600 – 800", count: 0 },
      { label: "800 – 1000", count: 0 },
      { label: "> 1000", count: 0 },
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
    // 1920x1080 is 2.07 MP, past the top bucket's lower bound.
    expect(stats.megapixels).toEqual([
      { label: "< 0.3 MP", count: 0 },
      { label: "0.3 – 0.5 MP", count: 0 },
      { label: "0.5 – 1 MP", count: 0 },
      { label: "1 – 2 MP", count: 0 },
      { label: "> 2 MP", count: 1 },
    ]);
  });

  it("handles an empty folder", () => {
    const stats = computeDatasetStats([]);

    expect(stats.total).toBe(0);
    expect(stats.topWords).toEqual([]);
    expect(stats.captionLength).toBeNull();
  });
});
