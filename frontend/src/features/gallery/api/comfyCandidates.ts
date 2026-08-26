import { postJson, requestJson } from "@/shared/api/http";
import { mediaUrl } from "@/features/gallery/api/media";
import type {
  ComfyCandidateBatchResponse,
  ComfyCandidateResponse,
  ComfyCandidateStateResponse,
} from "@/shared/types";

/**
 * Every candidate call names the *source* image, never the staged file.
 *
 * One identifier for the pair, matching the backend: the staging path is derivable and
 * having two ways to name the same review item is how they drift apart.
 */
function candidateParams(mediaPath: string): URLSearchParams {
  return new URLSearchParams({ path: mediaPath });
}

/**
 * The file an accepted candidate replaced.
 *
 * Shares `&original=1` with the image editor's backup: the server serves whichever
 * archive exists, and the two can never both be there because accepting is refused
 * while an unreverted edit is. Unversioned for the same reason `imageOriginalUrl` is -
 * an archive's bytes never change once written.
 */
export function comfyOriginalUrl(mediaPath: string): string {
  return `${mediaUrl(mediaPath)}&original=1`;
}

export async function fetchCandidateState(
  mediaPath: string,
  signal?: AbortSignal,
): Promise<ComfyCandidateStateResponse> {
  return requestJson<ComfyCandidateStateResponse>(
    `/api/media/comfy-candidate?${candidateParams(mediaPath)}`,
    { signal },
  );
}

export async function acceptCandidate(mediaPath: string): Promise<ComfyCandidateResponse> {
  return postJson<ComfyCandidateResponse>(
    `/api/media/comfy-candidate/accept?${candidateParams(mediaPath)}`,
    undefined,
  );
}

export async function rejectCandidate(mediaPath: string): Promise<ComfyCandidateResponse> {
  return postJson<ComfyCandidateResponse>(
    `/api/media/comfy-candidate/reject?${candidateParams(mediaPath)}`,
    undefined,
  );
}

export async function rejectCandidates(paths: string[]): Promise<ComfyCandidateBatchResponse> {
  return postJson<ComfyCandidateBatchResponse>("/api/media/comfy-candidates/reject", { paths });
}
