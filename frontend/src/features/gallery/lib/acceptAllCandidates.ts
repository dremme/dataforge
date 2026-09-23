import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import type { NotifyOptions } from "@/shared/notifications/notifications";
import type { ComfyCandidateBatchResponse } from "@/shared/types";

export function candidateCountPhrase(count: number): string {
  return count === 1 ? "1 candidate" : `${count} candidates`;
}

/** Built from the response: the palette count is a listing, and a file can fail on its own. */
export function acceptAllCandidatesOutcome(result: ComfyCandidateBatchResponse): NotifyOptions {
  const accepted = result.settled.length;
  const failed = result.failed.length;

  if (failed > 0) {
    const [first] = result.failed;
    const name = pathBaseName(first.path);
    const failPart =
      failed === 1
        ? `Could not accept ${name}: ${first.detail}`
        : `Could not accept ${name} and ${failed - 1} more; they are still waiting in Review candidates.`;
    return {
      variant: "danger",
      message: `Accepted ${accepted} of ${accepted + failed} candidates. ${failPart}`,
    };
  }

  if (accepted === 0) {
    return { variant: "warning", message: "No candidates were waiting in this folder." };
  }

  return { variant: "success", message: `Accepted ${candidateCountPhrase(accepted)}.` };
}
