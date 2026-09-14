import { postJson, requestJson } from "@/shared/api/http";
import { mediaUrl } from "@/features/gallery/api/media";
import type {
  ComfyCandidateBatchResponse,
  ComfyCandidateResponse,
  ComfyCandidateStateResponse,
} from "@/shared/types";

/** Every candidate call names the source image, never the staged file. */
function candidateParams(mediaPath: string): URLSearchParams {
  return new URLSearchParams({ path: mediaPath });
}

/** Unversioned archive of the file an accepted candidate replaced. */
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

export async function acceptCandidate(
  mediaPath: string,
  /** Recycles the file's edit backup and spec, making the candidate the new base. */
  discardEdit = false,
): Promise<ComfyCandidateResponse> {
  const params = candidateParams(mediaPath);
  if (discardEdit) params.set("discard_edit", "true");

  return postJson<ComfyCandidateResponse>(`/api/media/comfy-candidate/accept?${params}`, undefined);
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
