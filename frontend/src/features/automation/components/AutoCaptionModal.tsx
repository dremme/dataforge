import { useCallback, useId, useState } from "react";
import {
  AutomationModeSelector,
  type AutomationMode,
} from "@/features/automation/components/AutomationModeSelector";
import { InstructionFileSource } from "@/features/automation/components/InstructionFileSource";
import {
  ReasoningEffortSelector,
  type ReasoningEffort,
} from "@/features/automation/components/ReasoningEffortSelector";
import { VisionModelBadge } from "@/features/automation/components/VisionModelBadge";
import { useFolderInstructions } from "@/shared/hooks/useFolderInstructions";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";

export type AutoCaptionMode = AutomationMode;

interface AutoCaptionModalProps {
  scope: ModalScopeInfo;
  folderPath: string;
  initialSettings: JobSettingsByType["auto_caption"];
  busy?: boolean;
  onConfirm: (
    mode: AutoCaptionMode,
    captionAudio: boolean,
    reasoningEffort: ReasoningEffort,
    preserveThinking: boolean,
  ) => void;
  onCancel: () => void;
}

export function AutoCaptionModal({
  scope,
  folderPath,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: AutoCaptionModalProps) {
  const [mode, setMode] = useState<AutoCaptionMode>(initialSettings.mode);
  const [captionAudio, setCaptionAudio] = useState(initialSettings.caption_audio);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialSettings.reasoning_effort,
  );
  const [preserveThinking, setPreserveThinking] = useState(initialSettings.preserve_thinking);
  const { state } = useFolderInstructions(folderPath);
  const captionAudioId = useId();
  const preserveThinkingId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(mode, captionAudio, reasoningEffort, preserveThinking);
  }, [busy, captionAudio, mode, onConfirm, preserveThinking, reasoningEffort]);

  return (
    <Modal
      unsavedChanges={
        mode !== initialSettings.mode ||
        captionAudio !== initialSettings.caption_audio ||
        reasoningEffort !== initialSettings.reasoning_effort ||
        preserveThinking !== initialSettings.preserve_thinking
      }
      scope={scope}
      title="Start auto-caption?"
      description={
        <>
          Auto-completes the captions using <VisionModelBadge />.
        </>
      }
      panelClassName="auto-caption-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <>
          <InstructionFileSource state={state} kind="sysprompt" />
          <ModalActions
            confirmLabel="Start auto-caption"
            busyLabel="Starting..."
            busy={busy}
            onConfirm={handleConfirm}
            onCancel={onCancel}
          />
        </>
      }
    >
      <AutomationModeSelector
        value={mode}
        name="auto-caption-mode"
        groupLabel="Caption mode"
        disabled={busy}
        onChange={setMode}
      />

      <ReasoningEffortSelector
        value={reasoningEffort}
        name="auto-caption-reasoning-effort"
        groupLabel="Caption reasoning effort"
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
        <label className="modal__checkbox" htmlFor={captionAudioId}>
          <input
            id={captionAudioId}
            type="checkbox"
            className="modal__checkbox-input"
            checked={captionAudio}
            onChange={(event) => setCaptionAudio(event.target.checked)}
            disabled={busy}
          />
          <span className="modal__checkbox-box" aria-hidden="true" />
          <span className="modal__checkbox-label">Caption audio</span>
        </label>
        <p className="modal__hint">
          Describes what is heard as well as what is seen. Needs a model with audio support.
        </p>
      </div>

      {state.status === "error" && (
        <p className="modal__error" role="alert">
          Could not load the system prompt. {state.message}
        </p>
      )}
    </Modal>
  );
}
