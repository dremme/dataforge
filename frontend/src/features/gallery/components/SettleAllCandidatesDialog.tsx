import type { SettleAllCandidatesAction } from "@/features/gallery/lib/settleAllCandidates";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export interface SettleAllCandidatesDialogProps {
  action: SettleAllCandidatesAction | null;
  scope: DialogScopeInfo;
  busy: boolean;
  /** Accept only: give each file its original's metadata instead of ComfyUI's. */
  keepMetadata: boolean;
  onKeepMetadataChange: (keep: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SettleAllCandidatesDialog({
  action,
  scope,
  busy,
  keepMetadata,
  onKeepMetadataChange,
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
          scope.kind === "selected"
            ? "Delete selected candidates?"
            : "Delete all staged candidates?"
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
    <Dialog
      title={
        scope.kind === "selected" ? "Accept selected candidates?" : "Accept all staged candidates?"
      }
      scope={scope}
      description="Replaces each file with its staged candidate, without comparing them first. An unreverted edit is discarded too, making the candidate the new original. No backup is kept, so this cannot be undone."
      busy={busy}
      onConfirm={confirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel={busy ? "Accepting..." : "Accept"}
          busy={busy}
          onConfirm={confirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label className="dialog__checkbox">
          <input
            type="checkbox"
            className="dialog__checkbox-input"
            checked={keepMetadata}
            onChange={(event) => onKeepMetadataChange(event.target.checked)}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Keep original metadata</span>
        </label>
        <p className="dialog__hint">
          Each file keeps its original's EXIF, XMP and text metadata in place of what ComfyUI wrote.
          A file whose metadata cannot be carried over is left staged.
        </p>
      </div>
    </Dialog>
  );
}
