import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type KeyboardEventHandler,
} from "react";
import { iconLoader2, iconX } from "@/shared/icons";
import { ModalScope, type ModalScopeInfo } from "./ModalScope";
import { Icon } from "./Icon";
import { ModalShell } from "./ModalShell";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

/** Ignore Enter still in flight from the keypress that opened the modal. */
export const OPEN_GRACE_MS = 100;

function entersNewline(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

interface ModalProps {
  title: string;
  scope?: ModalScopeInfo;
  description?: ReactNode;
  role?: "alertdialog" | "dialog";
  panelClassName?: string;
  busy?: boolean;
  suspended?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  describedById?: string;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Modal({
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
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(0);

  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
  }, []);

  const confirmRef = useLatestRef(onConfirm);

  useEffect(() => {
    if (busy || suspended || !onConfirm) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Enter" || event.shiftKey)
        return;
      if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) return;
      if (entersNewline(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("button, a[href], select, [role='button'], [role='combobox']")
      )
        return;
      if (performance.now() - openedAtRef.current < OPEN_GRACE_MS) return;

      event.preventDefault();
      confirmRef.current?.();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, confirmRef, onConfirm, suspended]);

  return (
    <ModalShell
      block="confirm-modal"
      role={role}
      panelClassName={panelClassName}
      labelledById={titleId}
      describedById={describedById ?? (description ? descriptionId : undefined)}
      onClose={onClose}
      busy={busy}
      suspended={suspended}
      scrollLock="confirm-modal-open"
      backdropLabel="Close modal"
      initialFocusRef={initialFocusRef}
      panelRef={panelRef}
    >
      <header className="confirm-modal__header">
        <h2 id={titleId} className="confirm-modal__title">
          {title}
        </h2>
        <button
          type="button"
          className="confirm-modal__close"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
        >
          <Icon icon={iconX} />
        </button>
      </header>

      {scope && <ModalScope {...scope} />}

      {description && (
        <p id={descriptionId} className="confirm-modal__description">
          {description}
        </p>
      )}

      {children}

      {footer && <footer className="confirm-modal__actions">{footer}</footer>}
    </ModalShell>
  );
}

interface ModalButtonProps {
  label: string;
  variant: "primary" | "secondary" | "danger" | "warning";
  icon?: typeof iconLoader2;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}

export function ModalButton({
  label,
  variant,
  icon,
  busy = false,
  disabled = false,
  onClick,
  onKeyDown,
}: ModalButtonProps) {
  const displayIcon = busy ? iconLoader2 : icon;

  return (
    <button
      type="button"
      className={`confirm-modal__btn confirm-modal__btn--${variant}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {displayIcon && <Icon icon={displayIcon} spin={busy} className="confirm-modal__btn-icon" />}
      {label}
    </button>
  );
}

interface ModalActionsProps {
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "warning" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ModalActions({
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ModalActionsProps) {
  return (
    <>
      <ModalButton label={cancelLabel} variant="secondary" disabled={busy} onClick={onCancel} />
      <ModalButton
        label={busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        variant={confirmVariant}
        busy={busy}
        disabled={confirmDisabled}
        onClick={onConfirm}
      />
    </>
  );
}
