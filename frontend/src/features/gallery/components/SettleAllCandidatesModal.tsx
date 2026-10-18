import type { SettleAllCandidatesAction } from "@/features/gallery/lib/settleAllCandidates";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";

export interface SettleAllCandidatesModalProps {
  action: SettleAllCandidatesAction | null;
  scope: ModalScopeInfo;
  busy: boolean;
  /** Accept only: give each file its original's metadata instead of ComfyUI's. */
  keepMetadata: boolean;
  onKeepMetadataChange: (keep: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SettleAllCandidatesModal({
  action,
  scope,
  busy,
  keepMetadata,
  onKeepMetadataChange,
  onConfirm,
  onCancel,
}: SettleAllCandidatesModalProps) {
  if (!action) return null;

  const confirm = () => {
    void onConfirm();
  };

  if (action === "delete") {
    return (
      <ConfirmModal
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
    <Modal
      title={
        scope.kind === "selected" ? "Accept selected candidates?" : "Accept all staged candidates?"
      }
      scope={scope}
      description="Replaces each file with its staged candidate, without comparing them first. An unreverted edit is discarded too, making the candidate the new original. No backup is kept, so this cannot be undone."
      busy={busy}
      onConfirm={confirm}
      onClose={onCancel}
      footer={
        <ModalActions
          confirmLabel={busy ? "Accepting..." : "Accept"}
          busy={busy}
          onConfirm={confirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="modal__field">
        <label className="modal__checkbox">
          <input
            type="checkbox"
            className="modal__checkbox-input"
            checked={keepMetadata}
            onChange={(event) => onKeepMetadataChange(event.target.checked)}
            disabled={busy}
          />
          <span className="modal__checkbox-box" aria-hidden="true" />
          <span className="modal__checkbox-label">Keep original metadata</span>
        </label>
        <p className="modal__hint">
          Each file keeps its original's EXIF, XMP and text metadata in place of what ComfyUI wrote.
          A file whose metadata cannot be carried over is left staged.
        </p>
      </div>
    </Modal>
  );
}
