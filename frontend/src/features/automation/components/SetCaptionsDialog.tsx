import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface SetCaptionsDialogProps {
  folderLabel: string;
  busy?: boolean;
  onConfirm: (caption: string, overwrite: boolean) => void;
  onCancel: () => void;
}

export function SetCaptionsDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: SetCaptionsDialogProps) {
  const [caption, setCaption] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const captionId = useId();
  const overwriteId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(caption, overwrite);
  }, [busy, caption, onConfirm, overwrite]);

  useScrollLock(true, "confirm-dialog-open");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        // allow Enter in textarea with shift for newline
        if ((event.target as HTMLElement)?.tagName === "TEXTAREA") {
          return;
        }
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
        className="confirm-dialog__panel set-captions-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="set-captions-dialog-title"
        aria-describedby="set-captions-dialog-description"
      >
        <header className="confirm-dialog__header">
          <h2 id="set-captions-dialog-title" className="confirm-dialog__title">
            Set captions?
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

        <p id="set-captions-dialog-description" className="confirm-dialog__description">
          Write the provided caption text to images and videos in <strong>{folderLabel}</strong>.
          New captions are written as .txt sidecars (existing .json sidecars are updated in place).
          This action cannot be undone.
        </p>

        <div className="set-captions-dialog__field">
          <label htmlFor={captionId} className="set-captions-dialog__label">
            Caption text
          </label>
          <textarea
            id={captionId}
            className="set-captions-dialog__input"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="e.g. a scenic mountain landscape at sunset"
            rows={3}
            disabled={busy}
          />
        </div>

        <div className="set-captions-dialog__field">
          <label className="set-captions-dialog__checkbox" htmlFor={overwriteId}>
            <input
              id={overwriteId}
              type="checkbox"
              className="set-captions-dialog__checkbox-input"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              disabled={busy}
            />
            <span className="set-captions-dialog__checkbox-box" aria-hidden="true" />
            <span className="set-captions-dialog__checkbox-label">Overwrite existing captions</span>
          </label>
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
            {busy ? "Starting..." : "Set captions"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
