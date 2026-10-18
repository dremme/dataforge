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
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";

export type VerifyCaptionsMode = AutomationMode;

interface VerifyCaptionsModalProps {
  scope: ModalScopeInfo;
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

export function VerifyCaptionsModal({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: VerifyCaptionsModalProps) {
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
    // Starting the job is what stores these, exactly as it is for every other modal.
    onConfirm(mode, context, reasoningEffort, preserveThinking);
  }, [busy, context, mode, onConfirm, preserveThinking, reasoningEffort]);

  return (
    <Modal
      unsavedChanges={
        mode !== initialSettings.mode ||
        context !== initialSettings.context ||
        reasoningEffort !== initialSettings.reasoning_effort ||
        preserveThinking !== initialSettings.preserve_thinking
      }
      scope={scope}
      title="Start verify captions?"
      description={
        <>
          Verifies the captions using <VisionModelBadge />. Media with caption issues will be marked
          with an exclamation mark.
        </>
      }
      panelClassName="verify-captions-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <ModalActions
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

      <div className="modal__field">
        <label className="modal__checkbox" htmlFor={preserveThinkingId}>
          <input
            id={preserveThinkingId}
            type="checkbox"
            className="modal__checkbox-input"
            checked={preserveThinking}
            onChange={(event) => setPreserveThinking(event.target.checked)}
            disabled={mode === "instruct" || busy}
          />
          <span className="modal__checkbox-box" aria-hidden="true" />
          <span className="modal__checkbox-label">Preserve thinking</span>
        </label>
        <p className="modal__hint">Keeps earlier reasoning in the prompt instead of dropping it.</p>
      </div>

      <div className="modal__field">
        <label htmlFor={contextId} className="modal__label">
          Additional context
        </label>
        <textarea
          id={contextId}
          className="modal__input modal__input--multiline"
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder="Optional notes about the dataset, e.g. typical poses or recurring subjects"
          rows={2}
          disabled={busy}
          data-scroll-lock-allow
        />
      </div>
    </Modal>
  );
}
