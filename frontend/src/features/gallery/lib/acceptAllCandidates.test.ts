import { describe, expect, it } from "vitest";
import type { ComfyCandidateBatchResponse } from "@/shared/types";
import { acceptAllCandidatesOutcome, candidateCountPhrase } from "./acceptAllCandidates";

function batchResult(
  overrides: Partial<ComfyCandidateBatchResponse> = {},
): ComfyCandidateBatchResponse {
  return {
    settled: ["C:\\Photos\\lake.png", "C:\\Photos\\ridge.png"],
    skipped: [],
    failed: [],
    ...overrides,
  };
}

describe("candidateCountPhrase", () => {
  it("counts in the singular and the plural", () => {
    expect(candidateCountPhrase(1)).toBe("1 candidate");
    expect(candidateCountPhrase(4)).toBe("4 candidates");
  });
});

describe("acceptAllCandidatesOutcome", () => {
  it("reports a clean run as a success", () => {
    expect(acceptAllCandidatesOutcome(batchResult())).toEqual({
      variant: "success",
      message: "Accepted 2 candidates.",
    });
  });

  it("names the one file it could not accept, with the reason", () => {
    const outcome = acceptAllCandidatesOutcome(
      batchResult({
        failed: [
          { path: "C:\\Photos\\locked.png", detail: "The file is in use by another program." },
        ],
      }),
    );

    expect(outcome).toEqual({
      variant: "danger",
      message:
        "Accepted 2 of 3 candidates. Could not accept locked.png: The file is in use by another program.",
    });
  });

  it("points several failures back at the review queue", () => {
    const outcome = acceptAllCandidatesOutcome(
      batchResult({
        settled: [],
        failed: [
          { path: "C:\\Photos\\locked.png", detail: "The file is in use by another program." },
          { path: "C:\\Photos\\ridge.png", detail: "This candidate is already being settled" },
        ],
      }),
    );

    expect(outcome).toEqual({
      variant: "danger",
      message:
        "Accepted 0 of 2 candidates. Could not accept locked.png and 1 more; they are still waiting in Review candidates.",
    });
  });

  it("warns when every candidate was already gone", () => {
    const outcome = acceptAllCandidatesOutcome(
      batchResult({ settled: [], skipped: ["C:\\Photos\\lake.png"] }),
    );

    expect(outcome).toEqual({
      variant: "warning",
      message: "No candidates were waiting in this folder.",
    });
  });
});
