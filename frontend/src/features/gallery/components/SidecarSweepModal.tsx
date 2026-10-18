import { SIDECAR_SWEEP_COPY } from "@/features/gallery/lib/sidecarSweep";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import type { SidecarKind } from "@/shared/types";

export interface SidecarSweepModalProps {
  pending: SidecarKind | null;
  count: number;
  folderLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SidecarSweepModal({
  pending,
  count,
  folderLabel,
  busy,
  onConfirm,
  onCancel,
}: SidecarSweepModalProps) {
  if (!pending) return null;

  const copy = SIDECAR_SWEEP_COPY[pending];

  return (
    <ConfirmModal
      title={copy.title}
      description={copy.description(count, folderLabel)}
      confirmLabel={busy ? "Deleting..." : "Delete"}
      confirmVariant="danger"
      busy={busy}
      onConfirm={() => {
        void onConfirm();
      }}
      onCancel={onCancel}
    />
  );
}
