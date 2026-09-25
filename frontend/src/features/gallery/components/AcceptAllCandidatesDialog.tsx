import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export interface AcceptAllCandidatesDialogProps {
  open: boolean;
  scope: DialogScopeInfo;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AcceptAllCandidatesDialog({
  open,
  scope,
  busy,
  onConfirm,
  onCancel,
}: AcceptAllCandidatesDialogProps) {
  if (!open) return null;

  const confirm = () => {
    void onConfirm();
  };

  return (
    <Dialog
      scope={scope}
      title={scope.fromSelection ? "Accept selected candidates?" : "Accept all staged candidates?"}
      description={
        <>
          Replaces each file with its staged candidate, without comparing them first. An unreverted
          edit is discarded too, making the candidate the new original. No backup is kept, so this
          cannot be undone.
        </>
      }
      busy={busy}
      onConfirm={confirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Accept"
          busyLabel="Accepting..."
          busy={busy}
          onConfirm={confirm}
          onCancel={onCancel}
        />
      }
    />
  );
}
