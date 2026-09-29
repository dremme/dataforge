import type { SettleAllCandidatesAction } from "@/features/gallery/lib/settleAllCandidates";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export interface SettleAllCandidatesDialogProps {
  action: SettleAllCandidatesAction | null;
  scope: DialogScopeInfo;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SettleAllCandidatesDialog({
  action,
  scope,
  busy,
  onConfirm,
  onCancel,
}: SettleAllCandidatesDialogProps) {
  if (!action) return null;

  const confirm = () => {
    void onConfirm();
  };

  if (action === "delete") {
    return (
      <ConfirmDialog
        title={
          scope.fromSelection ? "Delete selected candidates?" : "Delete all staged candidates?"
        }
        scope={scope}
        description="Deletes each staged candidate and keeps the files they were made from. On Windows, candidates are moved to the Recycle Bin."
        confirmLabel={busy ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        busy={busy}
        onConfirm={confirm}
        onCancel={onCancel}
      />
    );
  }

  return (
    <ConfirmDialog
      title={scope.fromSelection ? "Accept selected candidates?" : "Accept all staged candidates?"}
      scope={scope}
      description="Replaces each file with its staged candidate, without comparing them first. An unreverted edit is discarded too, making the candidate the new original. No backup is kept, so this cannot be undone."
      confirmLabel={busy ? "Accepting..." : "Accept"}
      busy={busy}
      onConfirm={confirm}
      onCancel={onCancel}
    />
  );
}
