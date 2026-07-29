import type { ReactNode } from "react";
import { Dialog, DialogActions } from "./Dialog";

interface ConfirmDialogProps {
  title: string;
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
