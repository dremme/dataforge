import { useEffect, useState } from "react";
import { fetchCandidateState } from "@/features/gallery/api/comfyCandidates";
import type { CandidateReviewEntry } from "@/features/gallery/lib/candidateReview";
import type { ComfyCandidateStateResponse } from "@/shared/types";

/** Per-entry details. Orphans skip the request: candidate routes resolve the source and 404. */
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
