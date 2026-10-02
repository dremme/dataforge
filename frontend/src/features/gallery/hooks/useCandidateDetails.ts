import { useQuery } from "@tanstack/react-query";
import { fetchCandidateState } from "@/features/gallery/api/comfyCandidates";
import type { CandidateReviewEntry } from "@/features/gallery/lib/candidateReview";
import type { ComfyCandidateStateResponse } from "@/shared/types";

/** Per-entry details. Orphans skip the request: candidate routes resolve the source and 404. */
export function useCandidateDetails(
  entry: CandidateReviewEntry | undefined,
): ComfyCandidateStateResponse | null {
  const path = entry && entry.source !== null ? entry.path : null;

  const { data } = useQuery({
    queryKey: ["candidate-state", path],
    queryFn: ({ signal }) => fetchCandidateState(path!, signal),
    enabled: path !== null,
    retry: false,
  });

  return (path !== null && data) || null;
}
