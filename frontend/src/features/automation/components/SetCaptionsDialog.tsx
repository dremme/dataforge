import { useCallback, useId, useRef, useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

interface SetCaptionsDialogProps {
  /** Files this run will touch and the folder they are in; rendered above the copy. */
  scope: DialogScopeInfo;
  busy?: boolean;
  onConfirm: (caption: string, overwrite: boolean) => void;
  onCancel: () => void;
}

export function SetCaptionsDialog({
  scope,
  busy = false,
  onConfirm,
  onCancel,
}: SetCaptionsDialogProps) {
  const [caption, setCaption] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const captionId = useId();
  const overwriteId = useId();
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(caption, overwrite);
  }, [busy, caption, onConfirm, overwrite]);

  return (
    <Dialog
      scope={scope}
      title="Set captions?"
      description={
        <>
          Writes the provided caption text to each image and video as .txt sidecars. This action
          cannot be undone.
        </>
      }
      panelClassName="set-captions-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={captionRef}
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
          ref={captionRef}
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
          <span className="dialog__checkbox-label">Overwrite existing captions</span>
        </label>
      </div>
    </Dialog>
  );
}
