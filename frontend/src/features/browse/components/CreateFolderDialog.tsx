import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconLoader2, iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface CreateFolderDialogProps {
  parentLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function CreateFolderDialog({
  parentLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const nameId = useId();
  const errorId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedAtRef = useRef(performance.now());
  useFocusTrap(panelRef, true);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const handleConfirm = useCallback(() => {
    if (busy || !canSubmit) return;
    onConfirm(trimmedName);
  }, [busy, canSubmit, onConfirm, trimmedName]);

  useScrollLock(true, "confirm-dialog-open");

  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
    panelRef.current?.focus();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === "Enter") {
        if (performance.now() - openedAtRef.current < 100) {
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
        className="confirm-dialog__panel create-folder-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="create-folder-dialog-title"
        aria-describedby={error ? errorId : "create-folder-dialog-description"}
        tabIndex={-1}
      >
        <header className="confirm-dialog__header">
          <h2 id="create-folder-dialog-title" className="confirm-dialog__title">
            New folder
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

        <p id="create-folder-dialog-description" className="confirm-dialog__description">
          Create a subfolder in <strong>{parentLabel}</strong>.
        </p>

        <div className="create-folder-dialog__field">
          <label htmlFor={nameId} className="create-folder-dialog__label">
            Folder name
          </label>
          <input
            ref={inputRef}
            id={nameId}
            type="text"
            className="create-folder-dialog__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Landscapes"
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <p id={errorId} className="create-folder-dialog__error" role="alert">
            {error}
          </p>
        )}

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
            disabled={busy || !canSubmit}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <>
                <Icon icon={iconLoader2} spin className="confirm-dialog__btn-icon" />
                Creating...
              </>
            ) : (
              "Create folder"
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
