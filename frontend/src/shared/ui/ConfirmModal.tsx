import type { ReactNode } from "react";
import { Modal, ModalActions } from "./Modal";
import type { ModalScopeInfo } from "./ModalScope";

interface ConfirmModalProps {
  title: string;
  /** What the confirmed action will run on; see `Modal`. */
  scope?: ModalScopeInfo;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "warning" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  scope,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      title={title}
      scope={scope}
      description={description}
      busy={busy}
      onConfirm={onConfirm}
      onClose={onCancel}
      footer={
        <ModalActions
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
