import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkTrainingTemplate } from "@/features/automation/api/jobs";
import { trainingModelLabel } from "@/features/automation/lib/training";
import { formatApiError, isAbortError } from "@/shared/api/http";
import { iconRotateCcw, iconX } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { TrainingModel } from "@/shared/types";
import { DialogActions } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { YamlEditor } from "@/shared/ui/YamlEditor";

interface TrainingTemplateEditorDialogProps {
  model: TrainingModel;
  /** The draft to open with — the stock template unless this run already edited it. */
  initialContent: string;
  /** The stock template, for the reset action to fall back to. */
  stockContent: string;
  onClose: () => void;
  /** Receives the edited YAML, or null when it matches the stock template again. */
  onApply: (template: string | null) => void;
}

export function TrainingTemplateEditorDialog({
  model,
  initialContent,
  stockContent,
  onClose,
  onApply,
}: TrainingTemplateEditorDialogProps) {
  const [draft, setDraft] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const modelLabel = trainingModelLabel(model);
  const edited = draft !== stockContent;
  const lineCount = useMemo(() => (draft.length === 0 ? 0 : draft.split("\n").length), [draft]);

  const handleApply = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChecking(true);
    try {
      // The backend runs the same parse the job start does, so a draft that passes
      // here cannot fail later for a reason the editor never showed.
      const result = await checkTrainingTemplate(draft, controller.signal);
      if (!result.ok) {
        setError(result.error ?? "This template cannot be used.");
        return;
      }
      onApply(draft === stockContent ? null : draft);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(formatApiError(cause));
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }, [draft, onApply, stockContent]);

  const handleReset = useCallback(() => {
    setDraft(stockContent);
    setError(null);
  }, [stockContent]);

  const close = useCallback(() => {
    if (checking) return;
    onClose();
  }, [checking, onClose]);

  return (
    <ModalShell
      block="training-template-editor"
      label={`Edit the ${modelLabel} training template`}
      onClose={close}
      busy={checking}
      escape="editor"
      panelRef={panelRef}
    >
      <header className="training-template-editor__header">
        <div className="training-template-editor__header-copy">
          <h2 className="training-template-editor__title">{modelLabel} template</h2>
          <p className="training-template-editor__subtitle">
            Applies to this training run only — the template on disk is left alone. The LoRA name,
            trigger word, dataset folder and sample prompts are filled in from the dialog
            afterwards, so the blanks here stay blank.
          </p>
        </div>
        <div className="training-template-editor__header-actions">
          <button
            type="button"
            className="training-template-editor__close"
            onClick={close}
            aria-label="Close"
            disabled={checking}
          >
            <Icon icon={iconX} />
          </button>
        </div>
      </header>

      <div className="training-template-editor__body">
        <YamlEditor
          id="training-template-editor"
          className={classNames(error && "code-editor--error")}
          value={draft}
          aria-label={`${modelLabel} training template`}
          aria-invalid={error != null}
          onChange={(value) => {
            setDraft(value);
            if (error) setError(null);
          }}
        />
      </div>

      {error && (
        <p className="training-template-editor__error" role="alert">
          {error}
        </p>
      )}

      <footer className="training-template-editor__footer">
        <div className="training-template-editor__footer-meta" aria-label="Template statistics">
          <div className="training-template-editor__meta-item">
            <span className="training-template-editor__meta-value">
              {lineCount.toLocaleString()}
            </span>
            <span className="training-template-editor__meta-label">Lines</span>
          </div>
          <span className="training-template-editor__meta-divider" aria-hidden="true" />
          <div className="training-template-editor__meta-item">
            <span className="training-template-editor__meta-value">
              {edited ? "Edited" : "Unchanged"}
            </span>
            <span className="training-template-editor__meta-label">Status</span>
          </div>
        </div>
        <div className="confirm-dialog__actions training-template-editor__footer-actions">
          <button
            type="button"
            className="training-template-editor__reset"
            onClick={handleReset}
            disabled={checking || !edited}
          >
            <Icon icon={iconRotateCcw} className="training-template-editor__reset-icon" />
            Reset
          </button>
          <DialogActions
            confirmLabel="Use for this run"
            busyLabel="Checking..."
            busy={checking}
            onConfirm={() => void handleApply()}
            onCancel={close}
          />
        </div>
      </footer>
    </ModalShell>
  );
}
