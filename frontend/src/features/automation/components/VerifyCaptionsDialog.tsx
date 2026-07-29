import { useCallback, useId, useState } from "react";
import {
  AutomationModeSelector,
  type AutomationMode,
} from "@/features/automation/components/AutomationModeSelector";
import { VisionModelBadge } from "@/features/automation/components/VisionModelBadge";
import {
  updateVerifyCaptionsSettings,
  type VerifyCaptionsMode,
  type VerifyCaptionsSettings,
} from "@/features/automation/preferences/verifyCaptionsPreferences";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

export type { VerifyCaptionsMode };

interface VerifyCaptionsDialogProps {
  folderPath: string;
  folderLabel: string;
  initialSettings: VerifyCaptionsSettings;
  busy?: boolean;
  onConfirm: (mode: VerifyCaptionsMode, context: string) => void;
  onCancel: () => void;
}

export function VerifyCaptionsDialog({
  folderPath,
  folderLabel,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: VerifyCaptionsDialogProps) {
  const [mode, setMode] = useState<AutomationMode>(initialSettings.mode);
  const [context, setContext] = useState(initialSettings.context);
  const [saving, setSaving] = useState(false);
  const contextId = useId();

  const handleConfirm = useCallback(() => {
    if (busy || saving) return;

    setSaving(true);
    void updateVerifyCaptionsSettings(folderPath, { mode, context })
      .then((settings) => {
        onConfirm(settings.mode, settings.context);
      })
      .catch(() => {
        // Job start also persists settings.
        onConfirm(mode, context);
      })
      .finally(() => {
        setSaving(false);
      });
  }, [busy, context, folderPath, mode, onConfirm, saving]);

  const pending = busy || saving;

  return (
    <Dialog
      title="Start verify captions?"
      description={
        <>
          Verify captions for images in <strong>{folderLabel}</strong> using <VisionModelBadge />.
          Images with caption issues will be marked with an exclamation mark.
        </>
      }
      panelClassName="verify-captions-dialog"
      busy={pending}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Start verify captions"
          busyLabel={busy ? "Starting..." : "Saving..."}
          busy={pending}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <AutomationModeSelector
        value={mode}
        name="verify-captions-mode"
        groupLabel="Verification mode"
        disabled={pending}
        onChange={setMode}
      />

      <div className="dialog__field">
        <label htmlFor={contextId} className="dialog__label">
          Additional context
        </label>
        <textarea
          id={contextId}
          className="dialog__input dialog__input--multiline"
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder="Optional notes about the dataset, e.g. typical poses or recurring subjects"
          rows={3}
          disabled={pending}
          data-scroll-lock-allow
        />
      </div>
    </Dialog>
  );
}
