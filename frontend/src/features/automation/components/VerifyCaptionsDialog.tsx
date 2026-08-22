import { useCallback, useId, useState } from "react";
import {
  AutomationModeSelector,
  type AutomationMode,
} from "@/features/automation/components/AutomationModeSelector";
import {
  ReasoningEffortSelector,
  type ReasoningEffort,
} from "@/features/automation/components/ReasoningEffortSelector";
import { VisionModelBadge } from "@/features/automation/components/VisionModelBadge";
import {
  updateVerifyCaptionsSettings,
  type VerifyCaptionsMode,
  type VerifyCaptionsSettings,
} from "@/features/automation/preferences/verifyCaptionsPreferences";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export type { VerifyCaptionsMode };

interface VerifyCaptionsDialogProps {
  folderPath: string;
  /** Files this run will touch and the folder they are in; rendered above the copy. */
  scope: DialogScopeInfo;
  initialSettings: VerifyCaptionsSettings;
  busy?: boolean;
  onConfirm: (
    mode: VerifyCaptionsMode,
    context: string,
    reasoningEffort: ReasoningEffort,
    preserveThinking: boolean,
  ) => void;
  onCancel: () => void;
}

export function VerifyCaptionsDialog({
  folderPath,
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: VerifyCaptionsDialogProps) {
  const [mode, setMode] = useState<AutomationMode>(initialSettings.mode);
  const [context, setContext] = useState(initialSettings.context);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialSettings.reasoningEffort,
  );
  const [preserveThinking, setPreserveThinking] = useState(initialSettings.preserveThinking);
  const [saving, setSaving] = useState(false);
  const contextId = useId();
  const preserveThinkingId = useId();

  const handleConfirm = useCallback(() => {
    if (busy || saving) return;

    setSaving(true);
    void updateVerifyCaptionsSettings(folderPath, {
      mode,
      context,
      reasoningEffort,
      preserveThinking,
    })
      .then((settings) => {
        onConfirm(
          settings.mode,
          settings.context,
          settings.reasoningEffort,
          settings.preserveThinking,
        );
      })
      .catch(() => {
        // Job start also persists settings.
        onConfirm(mode, context, reasoningEffort, preserveThinking);
      })
      .finally(() => {
        setSaving(false);
      });
  }, [busy, context, folderPath, mode, onConfirm, preserveThinking, reasoningEffort, saving]);

  const pending = busy || saving;

  return (
    <Dialog
      scope={scope}
      title="Start verify captions?"
      description={
        <>
          Verifies the captions using <VisionModelBadge />. Media with caption issues will be marked
          with an exclamation mark.
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

      <ReasoningEffortSelector
        value={reasoningEffort}
        name="verify-captions-reasoning-effort"
        groupLabel="Verification reasoning effort"
        disabled={mode === "instruct" || pending}
        onChange={setReasoningEffort}
      />

      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={preserveThinkingId}>
          <input
            id={preserveThinkingId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={preserveThinking}
            onChange={(event) => setPreserveThinking(event.target.checked)}
            disabled={mode === "instruct" || pending}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Preserve thinking</span>
        </label>
        <p className="dialog__hint">
          Keeps earlier reasoning in the prompt instead of dropping it.
        </p>
      </div>

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
          rows={2}
          disabled={pending}
          data-scroll-lock-allow
        />
      </div>
    </Dialog>
  );
}
