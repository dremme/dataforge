import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconBrain, iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

export type AutoCaptionMode = "thinking" | "instruct";

interface AutoCaptionDialogProps {
  folderLabel: string;
  busy?: boolean;
  onConfirm: (mode: AutoCaptionMode) => void;
  onCancel: () => void;
}

export function AutoCaptionDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: AutoCaptionDialogProps) {
  const [mode, setMode] = useState<AutoCaptionMode>("thinking");
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const reasoningId = useId();
  const instructId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(mode);
  }, [busy, mode, onConfirm]);

  useScrollLock(true, "confirm-dialog-open");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, handleConfirm, onCancel]);

  return createPortal(
    <div className="confirm-dialog" role="presentation">
      <button
        type="button"
        className={backdropClass}
        aria-label="Close dialog"
        onClick={onCancel}
        disabled={busy}
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        className="confirm-dialog__panel auto-caption-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="auto-caption-dialog-title"
        aria-describedby="auto-caption-dialog-description"
      >
        <header className="confirm-dialog__header">
          <h2 id="auto-caption-dialog-title" className="confirm-dialog__title">
            Start auto-caption?
          </h2>
          <button
            type="button"
            className="confirm-dialog__close"
            onClick={onCancel}
            aria-label="Close"
            disabled={busy}
          >
            <Icon icon={iconX} />
          </button>
        </header>

        <p id="auto-caption-dialog-description" className="confirm-dialog__description">
          Auto-complete captions for images and videos in <strong>{folderLabel}</strong> using the
          local LLM model{" "}
          <span className="confirm-dialog__model-badge">
            <Icon icon={iconBrain} className="confirm-dialog__model-badge-icon" />
            Qwen3.6
          </span>
          .
        </p>

        <div className="auto-caption-dialog__field">
          <div className="auto-caption-dialog__label">Mode</div>
          <div className="auto-caption-dialog__options" role="radiogroup" aria-label="Caption mode">
            <label
              className={`auto-caption-dialog__option${mode === "thinking" ? " auto-caption-dialog__option--selected" : ""}`}
              htmlFor={reasoningId}
            >
              <input
                id={reasoningId}
                type="radio"
                name="auto-caption-mode"
                className="auto-caption-dialog__radio-input"
                value="thinking"
                checked={mode === "thinking"}
                onChange={() => setMode("thinking")}
                disabled={busy}
              />
              <span className="auto-caption-dialog__radio" aria-hidden="true" />
              <div className="auto-caption-dialog__option-content">
                <span className="auto-caption-dialog__option-title">Reasoning</span>
                <span className="auto-caption-dialog__option-desc">
                  Slower, but better overall outcome
                </span>
              </div>
            </label>

            <label
              className={`auto-caption-dialog__option${mode === "instruct" ? " auto-caption-dialog__option--selected" : ""}`}
              htmlFor={instructId}
            >
              <input
                id={instructId}
                type="radio"
                name="auto-caption-mode"
                className="auto-caption-dialog__radio-input"
                value="instruct"
                checked={mode === "instruct"}
                onChange={() => setMode("instruct")}
                disabled={busy}
              />
              <span className="auto-caption-dialog__radio" aria-hidden="true" />
              <div className="auto-caption-dialog__option-content">
                <span className="auto-caption-dialog__option-title">Instruct</span>
                <span className="auto-caption-dialog__option-desc">
                  Faster, but makes more mistakes
                </span>
              </div>
            </label>
          </div>
        </div>

        <footer className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--primary"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? "Starting..." : "Start auto-caption"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
