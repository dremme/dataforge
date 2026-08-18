import { SIDECAR_SWEEP_COPY } from "@/features/gallery/lib/sidecarSweep";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import type { SidecarKind } from "@/shared/types";

export interface SidecarSweepOverlayProps {
  pending: SidecarKind | null;
  count: number;
  folderLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The confirmation for deleting every finding sidecar of one kind in the folder.
 *
 * Mounted with the app's other overlays rather than inside the palette: the bar
 * closes as soon as the action runs, and a dialog that went with it would abandon
 * a sweep already in flight.
 */
export function SidecarSweepOverlay({
  pending,
  count,
  folderLabel,
  busy,
  onConfirm,
  onCancel,
}: SidecarSweepOverlayProps) {
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
