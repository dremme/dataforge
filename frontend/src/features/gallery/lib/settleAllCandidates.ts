import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import type { NotifyOptions } from "@/shared/notifications/notifications";
import type { ComfyCandidateBatchResponse } from "@/shared/types";

export type SettleAllCandidatesAction = "accept" | "delete";

const SETTLE_VERBS: Record<SettleAllCandidatesAction, { present: string; past: string }> = {
  accept: { present: "accept", past: "Accepted" },
  delete: { present: "delete", past: "Deleted" },
};

export function candidateCountPhrase(count: number): string {
  return count === 1 ? "1 candidate" : `${count} candidates`;
}

/** Built from the response: the palette count is a listing, and a file can fail on its own. */
export function settleAllCandidatesOutcome(
  action: SettleAllCandidatesAction,
  result: ComfyCandidateBatchResponse,
): NotifyOptions {
  const { present, past } = SETTLE_VERBS[action];
  const settled = result.settled.length;
  const failed = result.failed.length;

  if (failed > 0) {
    const [first] = result.failed;
    const name = pathBaseName(first.path);
    const failPart =
      failed === 1
        ? `Could not ${present} ${name}: ${first.detail}`
        : `Could not ${present} ${name} and ${failed - 1} more; they are still waiting in Review candidates.`;
    return {
      variant: "danger",
      message: `${past} ${settled} of ${settled + failed} candidates. ${failPart}`,
    };
  }

  if (settled === 0) {
    return { variant: "warning", message: "No candidates were waiting in this folder." };
  }

  return { variant: "success", message: `${past} ${candidateCountPhrase(settled)}.` };
}
