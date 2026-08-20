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
      { label: "< 256", count: 2 },
      { label: "256 – 400", count: 0 },
      { label: "400 – 600", count: 1 },
      { label: "600 – 800", count: 0 },
      { label: "800 – 1000", count: 0 },
      { label: "1000 – 1200", count: 0 },
      { label: "1200 – 1400", count: 0 },
      { label: "> 1400", count: 0 },
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

    expect(stats.mediaTypes).toEqual({
      images: 1,
      videos: 1,
      gifs: 1,
      extensions: { images: [".png"], videos: [".mp4"], gifs: [".gif"] },
      byExtension: [
        { label: ".gif", count: 1 },
        { label: ".mp4", count: 1 },
        { label: ".png", count: 1 },
      ],
    });
  });

  it("ranks extensions inside a media type by how often they appear", () => {
    const stats = computeDatasetStats([
      mediaItem("one.png", HOME_PATH),
      mediaItem("two.png", HOME_PATH),
      mediaItem("three.jpg", HOME_PATH),
      mediaItem("clip.mp4", HOME_PATH),
      mediaItem("take.mp4", HOME_PATH),
      mediaItem("other.mov", HOME_PATH),
    ]);

    expect(stats.mediaTypes.extensions).toEqual({
      images: [".png", ".jpg"],
      videos: [".mp4", ".mov"],
      gifs: [],
    });
    expect(stats.mediaTypes.byExtension).toEqual([
      { label: ".mp4", count: 2 },
      { label: ".png", count: 2 },
      { label: ".jpg", count: 1 },
      { label: ".mov", count: 1 },
    ]);
  });

  it("keeps files with unknown dimensions out of the megapixel buckets", () => {
    // Every non-MP4-family video reports null dimensions, which is not zero megapixels.
    const stats = computeDatasetStats([
      mediaItem("one.png", HOME_PATH, { width: 1920, height: 1080 }),
      mediaItem("clip.mkv", HOME_PATH, { width: null, height: null }),
    ]);

    expect(stats.unknownResolution).toBe(1);
    // 1920x1080 is 2.07 MP, just over the 2 MP boundary.
    expect(stats.megapixels).toEqual([
      { label: "< 0.3 MP", count: 0 },
      { label: "0.3 – 0.5 MP", count: 0 },
      { label: "0.5 – 1 MP", count: 0 },
      { label: "1 – 2 MP", count: 0 },
      { label: "2 – 4 MP", count: 1 },
      { label: "4 – 20 MP", count: 0 },
      { label: "20 – 48 MP", count: 0 },
      { label: "> 48 MP", count: 0 },
    ]);
  });

  it("splits high-resolution files across the upper megapixel buckets", () => {
    const stats = computeDatasetStats([
      mediaItem("six.png", HOME_PATH, { width: 3000, height: 2000 }),
      mediaItem("twenty-four.png", HOME_PATH, { width: 6000, height: 4000 }),
      mediaItem("fifty-six.png", HOME_PATH, { width: 8000, height: 7000 }),
    ]);

    expect(stats.megapixels).toEqual([
      { label: "< 0.3 MP", count: 0 },
      { label: "0.3 – 0.5 MP", count: 0 },
      { label: "0.5 – 1 MP", count: 0 },
      { label: "1 – 2 MP", count: 0 },
      { label: "2 – 4 MP", count: 0 },
      { label: "4 – 20 MP", count: 1 },
      { label: "20 – 48 MP", count: 1 },
      { label: "> 48 MP", count: 1 },
    ]);
  });

  it("splits long captions across the upper length buckets", () => {
    const stats = computeDatasetStats([
      captioned("short.png", "a".repeat(1100)),
      captioned("mid.png", "a".repeat(1300)),
      captioned("long.png", "a".repeat(1500)),
    ]);

    expect(stats.captionLength?.buckets).toEqual([
      { label: "< 256", count: 0 },
      { label: "256 – 400", count: 0 },
      { label: "400 – 600", count: 0 },
      { label: "600 – 800", count: 0 },
      { label: "800 – 1000", count: 0 },
      { label: "1000 – 1200", count: 1 },
      { label: "1200 – 1400", count: 1 },
      { label: "> 1400", count: 1 },
    ]);
  });

  it("buckets known aspect ratios and leaves unknown dimensions out", () => {
    const stats = computeDatasetStats([
      mediaItem("square.png", HOME_PATH, { width: 1024, height: 1024 }),
      mediaItem("four-three.png", HOME_PATH, { width: 1440, height: 1080 }),
      mediaItem("three-two.png", HOME_PATH, { width: 1500, height: 1000 }),
      mediaItem("wide.png", HOME_PATH, { width: 1920, height: 1080 }),
      mediaItem("three-four.png", HOME_PATH, { width: 1080, height: 1440 }),
      mediaItem("two-three.png", HOME_PATH, { width: 1000, height: 1500 }),
      mediaItem("tall.png", HOME_PATH, { width: 1080, height: 1920 }),
      mediaItem("ultrawide.png", HOME_PATH, { width: 2560, height: 1080 }),
      mediaItem("clip.mkv", HOME_PATH, { width: null, height: null }),
    ]);

    expect(stats.aspectRatios).toEqual([
      { label: "1:1", count: 1 },
      { label: "4:3", count: 1 },
      { label: "3:4", count: 1 },
      { label: "3:2", count: 1 },
      { label: "2:3", count: 1 },
      { label: "16:9", count: 1 },
      { label: "9:16", count: 1 },
      { label: "Other", count: 1 },
    ]);
  });

  it("snaps near-square images to 1:1 rather than inventing a fourth-odd ratio", () => {
    const stats = computeDatasetStats([
      mediaItem("almost.png", HOME_PATH, { width: 1024, height: 1000 }),
    ]);

    expect(stats.aspectRatios.find((bucket) => bucket.label === "1:1")?.count).toBe(1);
    expect(stats.aspectRatios.find((bucket) => bucket.label === "Other")?.count).toBe(0);
  });

  it("handles an empty folder", () => {
    const stats = computeDatasetStats([]);

    expect(stats.total).toBe(0);
    expect(stats.topWords).toEqual([]);
    expect(stats.captionLength).toBeNull();
    expect(stats.unknownDuration).toBe(0);
  });

  it("buckets video duration into two-second steps, then 10-15 and over 15", () => {
    const stats = computeDatasetStats([
      mediaItem("half.mp4", HOME_PATH, { duration: 0.5 }),
      mediaItem("two.mp4", HOME_PATH, { duration: 2 }),
      mediaItem("five.mp4", HOME_PATH, { duration: 5.4 }),
      mediaItem("eight.mp4", HOME_PATH, { duration: 8 }),
      mediaItem("twelve.mp4", HOME_PATH, { duration: 12 }),
      mediaItem("twenty.mp4", HOME_PATH, { duration: 20 }),
    ]);

    expect(stats.durations).toEqual([
      { label: "0 – 2 s", count: 1 },
      { label: "2 – 4 s", count: 1 },
      { label: "4 – 6 s", count: 1 },
      { label: "6 – 8 s", count: 0 },
      { label: "8 – 10 s", count: 1 },
      { label: "10 – 15 s", count: 1 },
      { label: "> 15 s", count: 1 },
    ]);
    expect(stats.unknownDuration).toBe(0);
  });

  it("keeps videos without a duration out of the length buckets", () => {
    const stats = computeDatasetStats([
      mediaItem("clip.mp4", HOME_PATH, { duration: 5.4 }),
      mediaItem("other.mkv", HOME_PATH, { duration: null }),
      mediaItem("still.png", HOME_PATH),
    ]);

    expect(stats.unknownDuration).toBe(1);
    expect(stats.durations).toEqual([
      { label: "0 – 2 s", count: 0 },
      { label: "2 – 4 s", count: 0 },
      { label: "4 – 6 s", count: 1 },
      { label: "6 – 8 s", count: 0 },
      { label: "8 – 10 s", count: 0 },
      { label: "10 – 15 s", count: 0 },
      { label: "> 15 s", count: 0 },
    ]);
  });

  it("does not treat stills or GIFs as videos when counting duration", () => {
    const stats = computeDatasetStats([
      mediaItem("photo.png", HOME_PATH, { duration: 3 }),
      mediaItem("loop.gif", HOME_PATH, { duration: 4 }),
    ]);

    expect(stats.unknownDuration).toBe(0);
    expect(stats.durations.every((bucket) => bucket.count === 0)).toBe(true);
  });
});
