import { useCallback, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewCaptionEdits } from "@/features/automation/api/jobs";
import { CaptionPreviewSample } from "@/features/automation/components/CaptionPreviewSample";
import { CaptionBackupOption } from "@/features/automation/components/CaptionBackupOption";
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
import { formatApiError } from "@/shared/api/http";
import { CAPTION_EDIT_PREVIEW_LIMIT } from "@/shared/constants";
import { iconInfo } from "@/shared/icons";
import { Modal, ModalActions, ModalButton } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
import { Icon } from "@/shared/ui/Icon";

interface EditCaptionsModalProps {
  scope: ModalScopeInfo;
  initialSettings: JobSettingsByType["edit_captions"];
  folderPath: string;
  selectedPaths?: string[];
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

export function EditCaptionsModal({
  scope,
  initialSettings,
  folderPath,
  selectedPaths,
  busy = false,
  onConfirm,
  onCancel,
}: EditCaptionsModalProps) {
  const [mode, setMode] = useState<AutomationMode>(initialSettings.mode);
  const [instruction, setInstruction] = useState(initialSettings.instruction);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialSettings.reasoning_effort,
  );
  const [preserveThinking, setPreserveThinking] = useState(initialSettings.preserve_thinking);
  // Reset on every open so opting out only applies to the current run.
  const [backup, setBackup] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const instructionId = useId();
  const preserveThinkingId = useId();
  const errorId = useId();

  const request = {
    instruction: instruction.trim(),
    mode,
    reasoning_effort: reasoningEffort,
    preserve_thinking: preserveThinking,
    paths: selectedPaths,
  };
  const preview = useQuery({
    queryKey: ["edit-captions-preview", folderPath, request],
    queryFn: ({ signal }) => previewCaptionEdits(folderPath, request, signal),
    enabled: false,
    retry: false,
    gcTime: 0,
  });
  const controlsBusy = busy || preview.isFetching;

  const handlePreview = () => {
    if (controlsBusy) return;
    if (!instruction.trim()) {
      setError("Enter an instruction for the edit.");
      instructionRef.current?.focus();
      return;
    }
    setError(null);
    void preview.refetch();
  };

  const handleConfirm = useCallback(() => {
    if (controlsBusy) return;

    if (!instruction.trim()) {
      setError("Enter an instruction for the edit.");
      instructionRef.current?.focus();
      return;
    }

    setError(null);
    // Starting the job is what stores these, exactly as it is for every other modal.
    onConfirm(mode, instruction.trim(), reasoningEffort, preserveThinking, backup);
  }, [backup, controlsBusy, instruction, mode, onConfirm, preserveThinking, reasoningEffort]);

  return (
    <Modal
      unsavedChanges={
        mode !== initialSettings.mode ||
        instruction !== initialSettings.instruction ||
        reasoningEffort !== initialSettings.reasoning_effort ||
        preserveThinking !== initialSettings.preserve_thinking ||
        !backup
      }
      scope={scope}
      title="Start edit captions?"
      description={
        <>
          Rewrites each caption with <VisionModelBadge /> from your instruction. Only the caption
          text is sent, never the media.
        </>
      }
      panelClassName="edit-captions-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={instructionRef}
      describedById={error ? errorId : undefined}
      footer={
        <>
          <div className="edit-captions-modal__dry-run-action">
            <ModalButton
              label={preview.isFetching ? "Running..." : "Dry run"}
              variant="secondary"
              busy={preview.isFetching}
              disabled={busy}
              onClick={handlePreview}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.stopPropagation();
              }}
            />
          </div>
          <ModalActions
            confirmLabel="Start edit captions"
            busyLabel="Starting..."
            busy={busy}
            confirmDisabled={preview.isFetching}
            onConfirm={handleConfirm}
            onCancel={onCancel}
          />
        </>
      }
    >
      <div className="edit-captions-modal__body">
        <AutomationModeSelector
          value={mode}
          name="edit-captions-mode"
          groupLabel="Edit mode"
          disabled={controlsBusy}
          onChange={setMode}
        />

        <ReasoningEffortSelector
          value={reasoningEffort}
          name="edit-captions-reasoning-effort"
          groupLabel="Edit reasoning effort"
          disabled={mode === "instruct" || controlsBusy}
          onChange={setReasoningEffort}
        />

        <div className="modal__field edit-captions-modal__toggles">
          <div>
            <label className="modal__checkbox" htmlFor={preserveThinkingId}>
              <input
                id={preserveThinkingId}
                type="checkbox"
                className="modal__checkbox-input"
                checked={preserveThinking}
                onChange={(event) => setPreserveThinking(event.target.checked)}
                disabled={mode === "instruct" || controlsBusy}
              />
              <span className="modal__checkbox-box" aria-hidden="true" />
              <span className="modal__checkbox-label">Preserve thinking</span>
            </label>
            <p className="modal__hint">Keeps earlier reasoning in the prompt.</p>
          </div>

          <CaptionBackupOption checked={backup} disabled={controlsBusy} onChange={setBackup} />
        </div>

        <div className="modal__field">
          <label htmlFor={instructionId} className="modal__label">
            Edit instruction
          </label>
          <textarea
            id={instructionId}
            ref={instructionRef}
            className="modal__input modal__input--multiline"
            value={instruction}
            onChange={(event) => {
              setInstruction(event.target.value);
              setError(null);
            }}
            placeholder="e.g. Rewrite each caption in present tense"
            rows={2}
            disabled={controlsBusy}
            data-scroll-lock-allow
          />
        </div>

        <div className="modal__field edit-captions-modal__preview">
          <p className="modal__hint edit-captions-modal__dry-run-hint">
            <Icon icon={iconInfo} className="edit-captions-modal__dry-run-hint-icon" />
            <span>
              Dry run tests up to {CAPTION_EDIT_PREVIEW_LIMIT} readable captions in filename order.
              It leaves files unchanged; the full job generates fresh results.
            </span>
          </p>
          <div role="status" aria-busy={preview.isFetching || undefined}>
            {preview.isFetching ? (
              <p className="modal__hint">Generating sample edits...</p>
            ) : preview.isError ? (
              <p className="modal__error">{formatApiError(preview.error)}</p>
            ) : preview.data ? (
              preview.data.samples.length > 0 ? (
                <ul className="edit-captions-modal__samples">
                  {preview.data.samples.map((sample) => (
                    <CaptionPreviewSample key={sample.name} {...sample} />
                  ))}
                </ul>
              ) : (
                <p className="modal__hint">No readable captions found in this scope.</p>
              )
            ) : null}
          </div>
        </div>

        {error && (
          <p id={errorId} className="modal__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
