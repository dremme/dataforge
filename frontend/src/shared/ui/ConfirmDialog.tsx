import type { ReactNode } from "react";
import { Dialog, DialogActions } from "./Dialog";
import type { DialogScopeInfo } from "./DialogScope";

interface ConfirmDialogProps {
  title: string;
  /** What the confirmed action will run on; see `Dialog`. */
  scope?: DialogScopeInfo;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  scope,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      scope={scope}
      description={description}
      busy={busy}
      onConfirm={onConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          confirmVariant={confirmVariant}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      }
    />
  );
}
