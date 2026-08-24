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
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export type VerifyCaptionsMode = AutomationMode;

interface VerifyCaptionsDialogProps {
  /** Files this run will touch and the folder they are in; rendered above the copy. */
  scope: DialogScopeInfo;
  /** What the last run of this job used; every dialog starts from it. */
  initialSettings: JobSettingsByType["verify_captions"];
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
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: VerifyCaptionsDialogProps) {
  const [mode, setMode] = useState<AutomationMode>(initialSettings.mode);
  const [context, setContext] = useState(initialSettings.context);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialSettings.reasoning_effort,
  );
  const [preserveThinking, setPreserveThinking] = useState(initialSettings.preserve_thinking);
  const contextId = useId();
  const preserveThinkingId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    // Starting the job is what stores these, exactly as it is for every other dialog.
    onConfirm(mode, context, reasoningEffort, preserveThinking);
  }, [busy, context, mode, onConfirm, preserveThinking, reasoningEffort]);

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
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Start verify captions"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <AutomationModeSelector
        value={mode}
        name="verify-captions-mode"
        groupLabel="Verification mode"
        disabled={busy}
        onChange={setMode}
      />

      <ReasoningEffortSelector
        value={reasoningEffort}
        name="verify-captions-reasoning-effort"
        groupLabel="Verification reasoning effort"
        disabled={mode === "instruct" || busy}
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
            disabled={mode === "instruct" || busy}
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
          disabled={busy}
          data-scroll-lock-allow
        />
      </div>
    </Dialog>
  );
}
