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
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";

export type AutoCaptionMode = AutomationMode;

interface AutoCaptionDialogProps {
  /** Files this run will touch and the folder they are in; rendered above the copy. */
  scope: DialogScopeInfo;
  /** What the last run of this job used; every dialog starts from it. */
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

export function AutoCaptionDialog({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: AutoCaptionDialogProps) {
  const [mode, setMode] = useState<AutoCaptionMode>(initialSettings.mode);
  const [captionAudio, setCaptionAudio] = useState(initialSettings.caption_audio);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialSettings.reasoning_effort,
  );
  const [preserveThinking, setPreserveThinking] = useState(initialSettings.preserve_thinking);
  const captionAudioId = useId();
  const preserveThinkingId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(mode, captionAudio, reasoningEffort, preserveThinking);
  }, [busy, captionAudio, mode, onConfirm, preserveThinking, reasoningEffort]);

  return (
    <Dialog
      scope={scope}
      title="Start auto-caption?"
      description={
        <>
          Auto-completes the captions using <VisionModelBadge />.
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

      <ReasoningEffortSelector
        value={reasoningEffort}
        name="auto-caption-reasoning-effort"
        groupLabel="Caption reasoning effort"
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
