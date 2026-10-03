import { useCallback, useMemo, useState } from "react";
import { acceptCandidates, rejectCandidates } from "@/features/gallery/api/comfyCandidates";
import { useKeepCandidateMetadata } from "@/features/gallery/hooks/useKeepCandidateMetadata";
import {
  settleAllCandidatesOutcome,
  type SettleAllCandidatesAction,
} from "@/features/gallery/lib/settleAllCandidates";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { ComfyCandidateBatchResponse } from "@/shared/types";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export interface UseSettleAllCandidatesOptions {
  folderLabel: string;
  folderItemCount: number;
  /** Dataset files, never their staged candidates: the settle endpoints are keyed by source. */
  candidatePaths: readonly string[];
  /** Null when nothing is selected, so the whole folder is in scope. */
  selectedPaths: ReadonlySet<string> | null;
  onSettled: () => void | Promise<void>;
}

interface PendingSettle {
  action: SettleAllCandidatesAction;
  paths: readonly string[];
  scope: DialogScopeInfo;
}

const SETTLE_REQUESTS: Record<
  SettleAllCandidatesAction,
  (paths: string[], keepMetadata: boolean) => Promise<ComfyCandidateBatchResponse>
> = {
  accept: acceptCandidates,
  delete: (paths) => rejectCandidates(paths),
};

export function useSettleAllCandidates({
  folderLabel,
  folderItemCount,
  candidatePaths,
  selectedPaths,
  onSettled,
}: UseSettleAllCandidatesOptions) {
  const notify = useNotify();
  const { keepMetadata, setKeepMetadata } = useKeepCandidateMetadata();
  // Snapshotted on open, so a candidate staged while the dialog is up is not settled unseen.
  const [pending, setPending] = useState<PendingSettle | null>(null);
  const [busy, setBusy] = useState(false);

  const fromSelection = selectedPaths !== null;

  const scopedPaths = useMemo(
    () =>
      selectedPaths ? candidatePaths.filter((path) => selectedPaths.has(path)) : candidatePaths,
    [candidatePaths, selectedPaths],
  );

  const scope = useMemo<DialogScopeInfo>(() => {
    const itemCount = selectedPaths ? selectedPaths.size : folderItemCount;
    const candidates = scopedPaths.length;
    return {
      itemCount,
      folderLabel,
      fromSelection,
      note:
        candidates === itemCount
          ? undefined
          : `${candidates} of them ${candidates === 1 ? "has" : "have"} a staged candidate.`,
    };
  }, [folderItemCount, folderLabel, fromSelection, scopedPaths.length, selectedPaths]);

  const openConfirm = useCallback(
    (action: SettleAllCandidatesAction) => {
      if (busy || scopedPaths.length === 0) return;
      setPending({ action, paths: scopedPaths, scope });
    },
    [busy, scope, scopedPaths],
  );

  const cancelConfirm = useCallback(() => {
    if (busy) return;
    setPending(null);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (!pending || busy) return;

    setBusy(true);

    try {
      const result = await SETTLE_REQUESTS[pending.action]([...pending.paths], keepMetadata);
      setPending(null);
      await onSettled();
      notify(settleAllCandidatesOutcome(pending.action, result));
    } catch (error: unknown) {
      setPending(null);
      notify({ variant: "danger", message: formatApiError(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, keepMetadata, notify, onSettled, pending]);

  return useMemo(
    () => ({
      busy,
      count: scopedPaths.length,
      fromSelection,
      openConfirm,
      overlay: {
        action: pending?.action ?? null,
        scope: pending?.scope ?? scope,
        busy,
        keepMetadata,
        onKeepMetadataChange: setKeepMetadata,
        onConfirm: confirm,
        onCancel: cancelConfirm,
      },
    }),
    [
      busy,
      cancelConfirm,
      confirm,
      fromSelection,
      keepMetadata,
      openConfirm,
      pending,
      scope,
      scopedPaths.length,
      setKeepMetadata,
    ],
  );
}

export type SettleAllCandidatesActions = ReturnType<typeof useSettleAllCandidates>;
