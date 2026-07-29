import { useCallback, useState } from "react";
import {
  AutomationModeSelector,
  type AutomationMode,
} from "@/features/automation/components/AutomationModeSelector";
import { VisionModelBadge } from "@/features/automation/components/VisionModelBadge";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

export type AutoCaptionMode = AutomationMode;

interface AutoCaptionDialogProps {
  folderLabel: string;
  busy?: boolean;
  onConfirm: (mode: AutoCaptionMode) => void;
  onCancel: () => void;
}

export function AutoCaptionDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: AutoCaptionDialogProps) {
  const [mode, setMode] = useState<AutoCaptionMode>("thinking");

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(mode);
  }, [busy, mode, onConfirm]);

  return (
    <Dialog
      title="Start auto-caption?"
      description={
        <>
          Auto-complete captions for images and videos in <strong>{folderLabel}</strong> using{" "}
          <VisionModelBadge />.
        </>
      }
      panelClassName="auto-caption-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Start auto-caption"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <AutomationModeSelector
        value={mode}
        name="auto-caption-mode"
        groupLabel="Caption mode"
        disabled={busy}
        onChange={setMode}
      />
    </Dialog>
  );
}
