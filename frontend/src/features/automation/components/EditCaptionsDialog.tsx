import { useCallback, useId, useRef, useState } from "react";
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

interface EditCaptionsDialogProps {
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["edit_captions"];
  busy?: boolean;
  onConfirm: (
    mode: AutomationMode,
    instruction: string,
    reasoningEffort: ReasoningEffort,
    preserveThinking: boolean,
    backup: boolean,
  ) => void;
  onCancel: () => void;
}

export function EditCaptionsDialog({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: EditCaptionsDialogProps) {
  const [mode, setMode] = useState<AutomationMode>(initialSettings.mode);
  const [instruction, setInstruction] = useState(initialSettings.instruction);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialSettings.reasoning_effort,
  );
  const [preserveThinking, setPreserveThinking] = useState(initialSettings.preserve_thinking);
  // Never restored: this is the safety net, and the dangerous state is the unticked one.
  // A remembered "no backup" would be both sticky and invisible.
  const [backup, setBackup] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const instructionId = useId();
  const preserveThinkingId = useId();
  const backupId = useId();
  const errorId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;

    if (!instruction.trim()) {
      setError("Enter an instruction for the edit.");
      instructionRef.current?.focus();
      return;
    }

    setError(null);
    // Starting the job is what stores these, exactly as it is for every other dialog.
    onConfirm(mode, instruction.trim(), reasoningEffort, preserveThinking, backup);
  }, [backup, busy, instruction, mode, onConfirm, preserveThinking, reasoningEffort]);

  return (
    <Dialog
      scope={scope}
      title="Start edit captions?"
      description={
        <>
          Rewrites each caption with <VisionModelBadge /> from your instruction. Only the caption
          text is sent, never the media.
        </>
      }
      panelClassName="edit-captions-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={instructionRef}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Start edit captions"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <AutomationModeSelector
        value={mode}
        name="edit-captions-mode"
        groupLabel="Edit mode"
        disabled={busy}
        onChange={setMode}
      />

      <ReasoningEffortSelector
        value={reasoningEffort}
        name="edit-captions-reasoning-effort"
        groupLabel="Edit reasoning effort"
        disabled={mode === "instruct" || busy}
        onChange={setReasoningEffort}
      />

      <div className="dialog__field">
        <label htmlFor={instructionId} className="dialog__label">
          Edit instruction
        </label>
        <textarea
          id={instructionId}
          ref={instructionRef}
          className="dialog__input dialog__input--multiline"
          value={instruction}
          onChange={(event) => {
            setInstruction(event.target.value);
            setError(null);
          }}
          placeholder="e.g. Rewrite each caption in present tense"
          rows={2}
          disabled={busy}
          data-scroll-lock-allow
        />
      </div>

      <div className="dialog__field edit-captions-dialog__toggles">
        <div>
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
          <p className="dialog__hint">Keeps earlier reasoning in the prompt.</p>
        </div>

        <div>
          <label className="dialog__checkbox" htmlFor={backupId}>
            <input
              id={backupId}
              type="checkbox"
              className="dialog__checkbox-input"
              checked={backup}
              onChange={(event) => setBackup(event.target.checked)}
              disabled={busy}
            />
            <span className="dialog__checkbox-box" aria-hidden="true" />
            <span className="dialog__checkbox-label">Back up captions first</span>
          </label>
          <p className="dialog__hint">
            Originals go to <strong>.backup</strong>, ready for Restore captions.
          </p>
        </div>
      </div>

      {error && (
        <p id={errorId} className="dialog__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
