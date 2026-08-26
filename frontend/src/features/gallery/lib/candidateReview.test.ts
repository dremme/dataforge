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
    // The listing can be stale or wrong; what decoded is what is on screen, and a stage
    // shaped from anything else stretches the image it is holding.
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

describe("differenceLabel", () => {
  it("calls a low score composition kept", () => {
    expect(differenceLabel(0)).toBe("composition kept");
    expect(differenceLabel(4.9)).toBe("composition kept");
  });

  // Both edges of the middle band, because an off-by-one there silently reclassifies
  // every borderline result rather than failing.
  it("spans the middle band from its lower edge to just under its upper one", () => {
    expect(differenceLabel(5)).toBe("noticeably changed");
    expect(differenceLabel(11.9)).toBe("noticeably changed");
  });

  it("calls anything above the top threshold reframed", () => {
    expect(differenceLabel(12)).toBe("reframed");
    expect(differenceLabel(55)).toBe("reframed");
  });
});
