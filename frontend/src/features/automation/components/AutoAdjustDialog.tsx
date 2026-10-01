import { useCallback, useId, useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

interface AutoAdjustDialogProps {
  scope: DialogScopeInfo;
  busy?: boolean;
  onConfirm: (replaceAdjustments: boolean, resetAdjustments: boolean) => void;
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
  const [reset, setReset] = useState(false);
  const replaceId = useId();
  const resetId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(!reset && replace, reset);
  }, [busy, onConfirm, replace, reset]);

  return (
    <Dialog
      scope={scope}
      title={reset ? "Reset color adjustments?" : "Auto-adjust media?"}
      description={
        reset ? (
          <>Resets color adjustments on each image and video. All other edits are kept.</>
        ) : (
          <>
            Applies the Adjust wand to each image and MP4. Crops, masks and trims are kept, and each
            original is stored so the editor can revert it.
          </>
        )
      }
      panelClassName="auto-adjust-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel={reset ? "Reset color adjustments" : "Start auto-adjust"}
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
            disabled={busy || reset}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Replace earlier adjustments</span>
        </label>
        <p className="dialog__hint">
          When ticked, every adjust tool goes back to zero first, discarding changes made by hand.
          When unticked, those changes stay and the wand's result is added on top.
        </p>
      </div>
      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={resetId}>
          <input
            id={resetId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={reset}
            onChange={(event) => setReset(event.target.checked)}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Reset all color adjustments to zero</span>
        </label>
        <p className="dialog__hint">
          Clears manual and automatic color adjustments without applying the wand. Crops, masks and
          all other edits are kept.
        </p>
      </div>
    </Dialog>
  );
}
