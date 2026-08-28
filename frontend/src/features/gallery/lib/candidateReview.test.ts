import { describe, expect, it } from "vitest";
import {
  buildCandidateReviewQueue,
  candidateStageAspect,
  differenceLabel,
} from "./candidateReview";
import { HOME_PATH, mediaItem } from "@/test/fixtures";

const STAGING_PATH = `${HOME_PATH}\\staging`;

function entry(candidate: { width: number | null; height: number | null }) {
  const [item] = buildCandidateReviewQueue(
    HOME_PATH,
    [],
    [mediaItem("a.png", STAGING_PATH, candidate)],
  );
  return item;
}

describe("candidateStageAspect", () => {
  it("shapes the stage like the candidate", () => {
    expect(candidateStageAspect(entry({ width: 1920, height: 1080 }), null)).toBeCloseTo(16 / 9);
  });

  it("prefers the size the browser measured over the listing's", () => {
    // Listing can be stale; what decoded is on screen, and any other stage stretches it.
    const aspect = candidateStageAspect(entry({ width: 1000, height: 1000 }), {
      width: 800,
      height: 1600,
    });

    expect(aspect).toBeCloseTo(0.5);
  });

  it("falls back to square only while nothing has reported a size", () => {
    expect(candidateStageAspect(entry({ width: null, height: null }), null)).toBe(1);
  });
});

describe("buildCandidateReviewQueue", () => {
  it("pairs a PNG candidate with the JPEG it was made from", () => {
    const source = mediaItem("holiday.jpg", HOME_PATH, {
      has_candidate: true,
      candidate_name: "holiday.png",
    });

    const [item] = buildCandidateReviewQueue(
      HOME_PATH,
      [source],
      [mediaItem("holiday.png", STAGING_PATH)],
    );

    expect(item.source).toBe(source);
    // Accept and reject are keyed by the dataset image, so a staging path here would 404.
    expect(item.path).toBe(source.path);
    expect(item.name).toBe("holiday.jpg");
  });

  it("leaves a candidate no source claims orphaned", () => {
    const [item] = buildCandidateReviewQueue(
      HOME_PATH,
      [mediaItem("other.jpg", HOME_PATH)],
      [mediaItem("gone.png", STAGING_PATH)],
    );

    expect(item.source).toBeNull();
    expect(item.name).toBe("gone.png");
  });
});

describe("differenceLabel", () => {
  it("calls a low score composition kept", () => {
    expect(differenceLabel(0)).toBe("composition kept");
    expect(differenceLabel(4.9)).toBe("composition kept");
  });

  // Both edges of the middle band: an off-by-one silently reclassifies borderline results.
  it("spans the middle band from its lower edge to just under its upper one", () => {
    expect(differenceLabel(5)).toBe("noticeably changed");
    expect(differenceLabel(11.9)).toBe("noticeably changed");
  });

  it("calls anything above the top threshold reframed", () => {
    expect(differenceLabel(12)).toBe("reframed");
    expect(differenceLabel(55)).toBe("reframed");
  });
});
