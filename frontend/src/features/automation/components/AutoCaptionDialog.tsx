import { useCallback, useId, useState } from "react";
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
  onConfirm: (mode: AutoCaptionMode, captionAudio: boolean) => void;
  onCancel: () => void;
}

export function AutoCaptionDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: AutoCaptionDialogProps) {
  const [mode, setMode] = useState<AutoCaptionMode>("thinking");
  const [captionAudio, setCaptionAudio] = useState(false);
  const captionAudioId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(mode, captionAudio);
  }, [busy, captionAudio, mode, onConfirm]);

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

      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={captionAudioId}>
          <input
            id={captionAudioId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={captionAudio}
            onChange={(event) => setCaptionAudio(event.target.checked)}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Caption audio</span>
        </label>
        <p className="dialog__hint">
          Describes what is heard as well as what is seen. Needs a model with audio support.
        </p>
      </div>
    </Dialog>
  );
}
