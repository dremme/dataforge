import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { iconLoader2, iconX } from "@/shared/icons";
import { DialogScope, type DialogScopeInfo } from "./DialogScope";
import { Icon } from "./Icon";
import { ModalShell } from "./ModalShell";

/** Ignore Enter still in flight from the keypress that opened the dialog. */
export const OPEN_GRACE_MS = 100;

function entersNewline(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

interface DialogProps {
  title: string;
  scope?: DialogScopeInfo;
  description?: ReactNode;
  role?: "alertdialog" | "dialog";
  panelClassName?: string;
  busy?: boolean;
  suspended?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  describedById?: string;
  footer: ReactNode;
  children?: ReactNode;
}

export function Dialog({
  title,
  scope,
  description,
  role = "alertdialog",
  panelClassName,
  busy = false,
  suspended = false,
  onConfirm,
  onClose,
  initialFocusRef,
  describedById,
  footer,
  children,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(0);

  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
  }, []);

  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  useEffect(() => {
    if (busy || suspended || !onConfirm) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (entersNewline(event.target)) return;
      if (performance.now() - openedAtRef.current < OPEN_GRACE_MS) return;

      event.preventDefault();
      confirmRef.current?.();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onConfirm, suspended]);

  return (
    <ModalShell
      block="confirm-dialog"
      role={role}
      panelClassName={panelClassName}
      labelledById={titleId}
      describedById={describedById ?? (description ? descriptionId : undefined)}
      onClose={onClose}
      busy={busy}
      suspended={suspended}
      scrollLock="confirm-dialog-open"
      backdropLabel="Close dialog"
      initialFocusRef={initialFocusRef}
      panelRef={panelRef}
    >
      <header className="confirm-dialog__header">
        <h2 id={titleId} className="confirm-dialog__title">
          {title}
        </h2>
        <button
          type="button"
          className="confirm-dialog__close"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
        >
          <Icon icon={iconX} />
        </button>
      </header>

      {scope && <DialogScope {...scope} />}

      {description && (
        <p id={descriptionId} className="confirm-dialog__description">
          {description}
        </p>
      )}

      {children}

      <footer className="confirm-dialog__actions">{footer}</footer>
    </ModalShell>
  );
}

interface DialogButtonProps {
  label: string;
  variant: "primary" | "secondary" | "danger" | "warning";
  icon?: typeof iconLoader2;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function DialogButton({
  label,
  variant,
  icon,
  busy = false,
  disabled = false,
  onClick,
}: DialogButtonProps) {
  const displayIcon = busy ? iconLoader2 : icon;

  return (
    <button
      type="button"
      className={`confirm-dialog__btn confirm-dialog__btn--${variant}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {displayIcon && <Icon icon={displayIcon} spin={busy} className="confirm-dialog__btn-icon" />}
      {label}
    </button>
  );
}

interface DialogActionsProps {
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DialogActions({
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: DialogActionsProps) {
  return (
    <>
      <DialogButton label={cancelLabel} variant="secondary" disabled={busy} onClick={onCancel} />
      <DialogButton
        label={busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        variant={confirmVariant}
        busy={busy}
        disabled={confirmDisabled}
        onClick={onConfirm}
      />
    </>
  );
}
