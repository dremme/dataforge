import { useCallback, useId, useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

interface BackupCaptionsDialogProps {
  folderLabel: string;
  busy?: boolean;
  onConfirm: (overwrite: boolean) => void;
  onCancel: () => void;
}

export function BackupCaptionsDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: BackupCaptionsDialogProps) {
  const [overwrite, setOverwrite] = useState(false);
  const overwriteId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(overwrite);
  }, [busy, onConfirm, overwrite]);

  return (
    <Dialog
      title="Back up captions?"
      description={
        <>
          This copies captions and caption issues in <strong>{folderLabel}</strong> into{" "}
          <strong>.backup</strong>. Copies already in the backup are kept, and other files there are
          left untouched.
        </>
      }
      panelClassName="backup-captions-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Back up captions"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={overwriteId}>
          <input
            id={overwriteId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Overwrite captions already in the backup</span>
        </label>
        <p className="dialog__hint">
          Replaces the stored copies with the current captions, so an earlier backup of the same
          files is lost.
        </p>
      </div>
    </Dialog>
  );
}
