import { useCallback, useMemo, useState } from "react";
import { acceptCandidates } from "@/features/gallery/api/comfyCandidates";
import { acceptAllCandidatesOutcome } from "@/features/gallery/lib/acceptAllCandidates";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export interface UseAcceptAllCandidatesOptions {
  folderLabel: string;
  folderItemCount: number;
  /** Dataset files, never their staged candidates: the settle endpoints are keyed by source. */
  candidatePaths: readonly string[];
  /** Null when nothing is selected, so the whole folder is in scope. */
  selectedPaths: ReadonlySet<string> | null;
  onAccepted: () => void | Promise<void>;
}

interface PendingAccept {
  paths: readonly string[];
  scope: DialogScopeInfo;
}

export function useAcceptAllCandidates({
  folderLabel,
  folderItemCount,
  candidatePaths,
  selectedPaths,
  onAccepted,
}: UseAcceptAllCandidatesOptions) {
  const notify = useNotify();
  // Snapshotted on open, so a candidate staged while the dialog is up is not accepted unseen.
  const [pending, setPending] = useState<PendingAccept | null>(null);
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

  const openConfirm = useCallback(() => {
    if (busy || scopedPaths.length === 0) return;
    setPending({ paths: scopedPaths, scope });
  }, [busy, scope, scopedPaths]);

  const cancelConfirm = useCallback(() => {
    if (busy) return;
    setPending(null);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (!pending || busy) return;

    setBusy(true);

    try {
      const result = await acceptCandidates([...pending.paths]);
      setPending(null);
      await onAccepted();
      notify(acceptAllCandidatesOutcome(result));
    } catch (error: unknown) {
      setPending(null);
      notify({ variant: "danger", message: formatApiError(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, notify, onAccepted, pending]);

  return useMemo(
    () => ({
      busy,
      count: scopedPaths.length,
      fromSelection,
      openConfirm,
      overlay: {
        open: pending !== null,
        scope: pending?.scope ?? scope,
        busy,
        onConfirm: confirm,
        onCancel: cancelConfirm,
      },
    }),
    [busy, cancelConfirm, confirm, fromSelection, openConfirm, pending, scope, scopedPaths.length],
  );
}

export type AcceptAllCandidatesActions = ReturnType<typeof useAcceptAllCandidates>;
