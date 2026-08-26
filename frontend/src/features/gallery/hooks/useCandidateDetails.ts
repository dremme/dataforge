import { useEffect, useState } from "react";
import { fetchCandidateState } from "@/features/gallery/api/comfyCandidates";
import type { CandidateReviewEntry } from "@/features/gallery/lib/candidateReview";
import type { ComfyCandidateStateResponse } from "@/shared/types";

/**
 * What the backend knows about one candidate beyond what the listing carries.
 *
 * Fetched per entry rather than for the whole queue: three hundred requests to fill in a
 * number the reviewer sees one at a time is the wrong trade, and the queue is walked in
 * order, so all but the current one would be wasted. Prefetching just the *next* entry
 * would be a reasonable polish; it is deliberately not here yet.
 *
 * Returns null rather than throwing on a failed fetch. Everything this adds is
 * supplementary - the images, the accept and the reject all work without it - so a
 * backend that cannot answer costs a stat line, not the review.
 *
 * Skips the request entirely for an orphaned candidate. Every candidate route resolves
 * the *source* path, so a candidate whose source is gone would 404 on every step.
 */
export function useCandidateDetails(
  entry: CandidateReviewEntry | undefined,
): ComfyCandidateStateResponse | null {
  const [details, setDetails] = useState<ComfyCandidateStateResponse | null>(null);

  const path = entry && entry.source !== null ? entry.path : null;

  useEffect(() => {
    setDetails(null);
    if (path === null) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const state = await fetchCandidateState(path, controller.signal);
        if (!controller.signal.aborted) setDetails(state);
      } catch {
        if (!controller.signal.aborted) setDetails(null);
      }
    })();

    return () => controller.abort();
  }, [path]);

  return details;
}
