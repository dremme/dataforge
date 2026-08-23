import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { iconLoader2, iconX } from "@/shared/icons";
import { DialogScope, type DialogScopeInfo } from "./DialogScope";
import { Icon } from "./Icon";
import { ModalShell } from "./ModalShell";

/**
 * Enter must not confirm a dialog that only just opened: the keypress that
 * opened it can still be in flight, which would confirm before the user reads
 * anything.
 */
export const OPEN_GRACE_MS = 100;

/** Enter inserts a newline in a multiline field instead of confirming. */
function entersNewline(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

interface DialogProps {
  title: string;
  /**
   * What the dialog will act on, rendered above the description so every job
   * and batch action states its scope in the same place and the same words.
   */
  scope?: DialogScopeInfo;
  description?: ReactNode;
  /** `alertdialog` interrupts the user; use `dialog` for pickers and folder trees. */
  role?: "alertdialog" | "dialog";
  /** Extra class on the panel, e.g. `batch-rename-dialog`. */
  panelClassName?: string;
  /** Disables every dismiss affordance and the Enter shortcut. */
  busy?: boolean;
  /**
   * A child overlay is on top: suspends the focus trap, Escape and the backdrop, and
   * releases Enter so the overlay above owns the keyboard. See `ModalShell.suspended`.
   */
  suspended?: boolean;
  /** When set, Enter confirms (outside multiline fields, after a short grace period). */
  onConfirm?: () => void;
  onClose: () => void;
  /** Focused on open instead of the panel — use for a dialog's primary field. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Overrides `aria-describedby`, e.g. to point at a validation error. */
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

  // Stamped once, on open: the Enter grace period below measures from here.
  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
  }, []);

  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  useEffect(() => {
    // While a child overlay is up, Enter belongs to it - confirming underneath would
    // start the job with whatever the user was still editing above.
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
      // Long-standing label; several tests reach for the backdrop by this name.
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
  /** Shown next to the spinner while busy. Defaults to `confirmLabel`. */
  busyLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The Cancel + confirm pair every form dialog ends with. */
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
