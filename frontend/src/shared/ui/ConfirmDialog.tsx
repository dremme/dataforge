import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconLoader2, iconX } from "@/shared/icons";
import { Icon } from "./Icon";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  useScrollLock(true, "confirm-dialog-open");

  const panelRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(performance.now());
  useFocusTrap(panelRef, true);

  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
    panelRef.current?.focus();
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
        onConfirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, onConfirm]);

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
        className="confirm-dialog__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        tabIndex={-1}
      >
        <header className="confirm-dialog__header">
          <h2 id="confirm-dialog-title" className="confirm-dialog__title">
            {title}
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

        <p id="confirm-dialog-description" className="confirm-dialog__description">
          {description}
        </p>

        <footer className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog__btn confirm-dialog__btn--${confirmVariant}`}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <>
                <Icon icon={iconLoader2} spin className="confirm-dialog__btn-icon" />
                {confirmLabel}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
