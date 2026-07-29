import { useCallback, useId, useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

interface SetCaptionsDialogProps {
  folderLabel: string;
  busy?: boolean;
  onConfirm: (caption: string, overwrite: boolean) => void;
  onCancel: () => void;
}

export function SetCaptionsDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: SetCaptionsDialogProps) {
  const [caption, setCaption] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const captionId = useId();
  const overwriteId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(caption, overwrite);
  }, [busy, caption, onConfirm, overwrite]);

  return (
    <Dialog
      title="Set captions?"
      description={
        <>
          Write the provided caption text to images and videos in <strong>{folderLabel}</strong>.
          New captions are written as .txt sidecars (existing .json sidecars are updated in place).
          This action cannot be undone.
        </>
      }
      panelClassName="set-captions-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Set captions"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label htmlFor={captionId} className="dialog__label">
          Caption text
        </label>
        <textarea
          id={captionId}
          className="dialog__input dialog__input--multiline"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="e.g. a scenic mountain landscape at sunset"
          rows={3}
          disabled={busy}
        />
      </div>

      <div className="dialog__field">
        <label className="set-captions-dialog__checkbox" htmlFor={overwriteId}>
          <input
            id={overwriteId}
            type="checkbox"
            className="set-captions-dialog__checkbox-input"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
            disabled={busy}
          />
          <span className="set-captions-dialog__checkbox-box" aria-hidden="true" />
          <span className="set-captions-dialog__checkbox-label">Overwrite existing captions</span>
        </label>
      </div>
    </Dialog>
  );
}
