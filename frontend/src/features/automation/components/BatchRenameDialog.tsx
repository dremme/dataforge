import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

const INVALID_STEM_PATTERN = /[<>:"/\\|?*]/;

interface BatchRenameDialogProps {
  folderLabel: string;
  itemCount: number;
  busy?: boolean;
  onConfirm: (stem: string) => void;
  onCancel: () => void;
}

export function BatchRenameDialog({
  folderLabel,
  itemCount,
  busy = false,
  onConfirm,
  onCancel,
}: BatchRenameDialogProps) {
  const [stem, setStem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const stemId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const padding = Math.max(3, String(itemCount).length);
  const previewStem = stem.trim() || "mountain";
  const previewName = `${previewStem}_${"1".padStart(padding, "0")}.png`;

  const handleConfirm = useCallback(() => {
    if (busy) return;

    const trimmed = stem.trim();
    if (!trimmed) {
      setError("Enter a name stem.");
      return;
    }
    if (INVALID_STEM_PATTERN.test(trimmed)) {
      setError("Name stem contains invalid characters.");
      return;
    }

    setError(null);
    onConfirm(trimmed);
  }, [busy, onConfirm, stem]);

  useScrollLock(true, "confirm-dialog-open");
  useFocusTrap(panelRef, true);

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
        className="confirm-dialog__panel batch-rename-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="batch-rename-dialog-title"
        aria-describedby="batch-rename-dialog-description"
      >
        <header className="confirm-dialog__header">
          <h2 id="batch-rename-dialog-title" className="confirm-dialog__title">
            Batch rename?
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

        <p id="batch-rename-dialog-description" className="confirm-dialog__description">
          Rename <strong>{itemCount}</strong> supported media {itemCount === 1 ? "file" : "files"}{" "}
          in <strong>{folderLabel}</strong>. Caption sidecars (.txt/.json) move with each file. This
          action cannot be undone.
        </p>

        <div className="batch-rename-dialog__field">
          <label htmlFor={stemId} className="batch-rename-dialog__label">
            Name stem
          </label>
          <input
            id={stemId}
            type="text"
            className="batch-rename-dialog__input"
            value={stem}
            onChange={(event) => {
              setStem(event.target.value);
              setError(null);
            }}
            placeholder="e.g. mountain"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
          <p className="batch-rename-dialog__hint">
            Example: <code>{previewName}</code>
          </p>
          {error && (
            <p className="batch-rename-dialog__error" role="alert">
              {error}
            </p>
          )}
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
            {busy ? "Starting..." : "Batch rename"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
