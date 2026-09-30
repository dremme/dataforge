import { useCallback, useId, useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

interface AutoAdjustDialogProps {
  scope: DialogScopeInfo;
  busy?: boolean;
  onConfirm: (replaceAdjustments: boolean) => void;
  onCancel: () => void;
}

export function AutoAdjustDialog({
  scope,
  busy = false,
  onConfirm,
  onCancel,
}: AutoAdjustDialogProps) {
  // Never restored: discarding earlier adjustments is destructive, so it is re-chosen every run.
  const [replace, setReplace] = useState(false);
  const replaceId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(replace);
  }, [busy, onConfirm, replace]);

  return (
    <Dialog
      scope={scope}
      title="Auto-adjust media?"
      description={
        <>
          Applies the Adjust wand to each image and MP4. Crops, masks and trims are kept, and each
          original is stored so the editor can revert it.
        </>
      }
      panelClassName="auto-adjust-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Start auto-adjust"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={replaceId}>
          <input
            id={replaceId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Replace earlier adjustments</span>
        </label>
        <p className="dialog__hint">
          When ticked, every adjust tool goes back to zero first, discarding changes made by hand.
          When unticked, those changes stay and the wand's result is added on top.
        </p>
      </div>
    </Dialog>
  );
}
