import { useCallback, useId, useRef, useState } from "react";
import type { TrainLoraSettings } from "@/features/automation/api/jobs";
import {
  DEFAULT_TRAINING_PROMPTS,
  cleanTrainingPrompts,
  validateLoraName,
} from "@/features/automation/lib/training";
import { iconPlus, iconTrash2 } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

interface PromptRow {
  id: number;
  text: string;
}

interface TrainLoraDialogProps {
  folderLabel: string;
  itemCount: number;
  busy?: boolean;
  onConfirm: (settings: TrainLoraSettings) => void;
  onCancel: () => void;
}

export function TrainLoraDialog({
  folderLabel,
  itemCount,
  busy = false,
  onConfirm,
  onCancel,
}: TrainLoraDialogProps) {
  const [loraName, setLoraName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [prompts, setPrompts] = useState<PromptRow[]>(() =>
    DEFAULT_TRAINING_PROMPTS.map((text, index) => ({ id: index, text })),
  );
  const [error, setError] = useState<string | null>(null);

  // Rows keep their identity across edits so removing one cannot move focus.
  const nextPromptId = useRef(DEFAULT_TRAINING_PROMPTS.length);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const triggerWordId = useId();
  const promptsId = useId();
  const errorId = useId();

  const updatePrompt = useCallback((id: number, text: string) => {
    setPrompts((current) => current.map((row) => (row.id === id ? { ...row, text } : row)));
    setError(null);
  }, []);

  const removePrompt = useCallback((id: number) => {
    setPrompts((current) => current.filter((row) => row.id !== id));
    setError(null);
  }, []);

  const addPrompt = useCallback(() => {
    setPrompts((current) => [...current, { id: nextPromptId.current++, text: "" }]);
    setError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (busy) return;

    const nameError = validateLoraName(loraName);
    if (nameError) {
      setError(nameError);
      nameRef.current?.focus();
      return;
    }

    const cleanedPrompts = cleanTrainingPrompts(prompts.map((row) => row.text));
    if (cleanedPrompts.length === 0) {
      setError("Add at least one example prompt.");
      return;
    }

    setError(null);
    onConfirm({
      loraName: loraName.trim(),
      triggerWord: triggerWord.trim(),
      prompts: cleanedPrompts,
    });
  }, [busy, loraName, onConfirm, prompts, triggerWord]);

  return (
    <Dialog
      title="Start LoRA training?"
      description={
        <>
          Train a Krea 2 Turbo LoRA on the <strong>{itemCount}</strong>{" "}
          {itemCount === 1 ? "file" : "files"} in <strong>{folderLabel}</strong>. AI-Toolkit runs
          the training and saves it in its own training folder.
        </>
      }
      panelClassName="train-lora-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={nameRef}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Start training"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="train-lora-dialog__body" data-scroll-lock-allow>
        <div className="dialog__field">
          <label htmlFor={nameId} className="dialog__label">
            LoRA name
          </label>
          <input
            id={nameId}
            ref={nameRef}
            type="text"
            className="dialog__input"
            value={loraName}
            onChange={(event) => {
              setLoraName(event.target.value);
              setError(null);
            }}
            placeholder="e.g. mountain_style_v1"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
          <p className="dialog__hint">
            Names the training run and its output folder. It has to be new to AI-Toolkit.
          </p>
        </div>

        <div className="dialog__field">
          <label htmlFor={triggerWordId} className="dialog__label">
            Trigger word (optional)
          </label>
          <input
            id={triggerWordId}
            type="text"
            className="dialog__input"
            value={triggerWord}
            onChange={(event) => setTriggerWord(event.target.value)}
            placeholder="e.g. mtnstyle"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
          <p className="dialog__hint">
            Left empty, the LoRA trains without one. Otherwise it is added to the training captions.
            Example prompts stay as written — put <code>[trigger]</code> in one to render that
            sample with it.
          </p>
        </div>

        <div className="dialog__field">
          <span id={promptsId} className="dialog__label">
            Example prompts
          </span>
          <p className="dialog__hint">
            AI-Toolkit renders these every 250 steps so you can watch the LoRA take shape.
          </p>
          <ul className="train-lora-dialog__prompts" aria-labelledby={promptsId}>
            {prompts.map((row, index) => (
              <li key={row.id} className="train-lora-dialog__prompt">
                <input
                  type="text"
                  className="dialog__input train-lora-dialog__prompt-input"
                  value={row.text}
                  onChange={(event) => updatePrompt(row.id, event.target.value)}
                  placeholder="Describe an image to generate while training"
                  aria-label={`Example prompt ${index + 1}`}
                  autoComplete="off"
                  disabled={busy}
                />
                <button
                  type="button"
                  className="train-lora-dialog__prompt-remove"
                  onClick={() => removePrompt(row.id)}
                  aria-label={`Remove example prompt ${index + 1}`}
                  disabled={busy}
                >
                  <Icon icon={iconTrash2} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="train-lora-dialog__add-prompt"
            onClick={addPrompt}
            disabled={busy}
          >
            <Icon icon={iconPlus} className="train-lora-dialog__add-prompt-icon" />
            Add prompt
          </button>
        </div>

        {error && (
          <p id={errorId} className="dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
