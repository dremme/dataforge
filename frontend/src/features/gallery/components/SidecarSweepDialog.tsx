import { SIDECAR_SWEEP_COPY } from "@/features/gallery/lib/sidecarSweep";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import type { SidecarKind } from "@/shared/types";

export interface SidecarSweepDialogProps {
  pending: SidecarKind | null;
  count: number;
  folderLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SidecarSweepDialog({
  pending,
  count,
  folderLabel,
  busy,
  onConfirm,
  onCancel,
}: SidecarSweepDialogProps) {
  if (!pending) return null;

  const copy = SIDECAR_SWEEP_COPY[pending];

  return (
    <ConfirmDialog
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
