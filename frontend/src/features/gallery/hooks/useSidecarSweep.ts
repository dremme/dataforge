import { useCallback, useMemo, useState } from "react";
import { deleteSidecars } from "@/features/gallery/api/sidecars";
import { sidecarSweepOutcome } from "@/features/gallery/lib/sidecarSweep";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { SidecarKind } from "@/shared/types";

export interface UseSidecarSweepOptions {
  folderPath: string | undefined;
  folderLabel: string;
  issueCount: number;
  duplicateCount: number;
  onSwept: () => void | Promise<void>;
}

export function useSidecarSweep({
  folderPath,
  folderLabel,
  issueCount,
  duplicateCount,
  onSwept,
}: UseSidecarSweepOptions) {
  const notify = useNotify();
  const [pending, setPending] = useState<SidecarKind | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useMemo<Record<SidecarKind, number>>(
    () => ({ issue: issueCount, duplicate: duplicateCount }),
    [duplicateCount, issueCount],
  );

  const openSweep = useCallback(
    (kind: SidecarKind) => {
      if (busy || !folderPath || counts[kind] === 0) return;
      setPending(kind);
    },
    [busy, counts, folderPath],
  );

  const cancelSweep = useCallback(() => {
    if (busy) return;
    setPending(null);
  }, [busy]);

  const confirmSweep = useCallback(async () => {
    if (!folderPath || !pending || busy) return;

    setBusy(true);

    try {
      const result = await deleteSidecars(folderPath, pending);
      setPending(null);
      // Refreshed before notifying, so the toast and the grid never disagree about
      // what is left.
      await onSwept();
      notify(sidecarSweepOutcome(result));
    } catch (error: unknown) {
      // Closed even on failure: leaving it open hands back a button that will only
      // fail the same way again.
      setPending(null);
      notify({ variant: "danger", message: formatApiError(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, folderPath, notify, onSwept, pending]);

  return useMemo(
    () => ({
      busy,
      counts,
      openSweep,
      overlay: {
        pending,
        count: pending ? counts[pending] : 0,
        folderLabel,
        busy,
        onConfirm: confirmSweep,
        onCancel: cancelSweep,
      },
    }),
    [busy, cancelSweep, confirmSweep, counts, folderLabel, openSweep, pending],
  );
}

export type SidecarSweepActions = ReturnType<typeof useSidecarSweep>;
