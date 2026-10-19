import {
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type KeyboardEventHandler,
} from "react";
import { iconLoader2, iconX } from "@/shared/icons";
import { DialogScope, type DialogScopeInfo } from "./DialogScope";
import { Icon } from "./Icon";
import { DialogShell } from "./DialogShell";
import type { GuardedAction } from "@/shared/hooks/useDiscardChanges";
import { DialogSubmissionContext } from "./dialogSubmissionContext";
import { DialogCancelContext } from "./dialogCancelContext";
import { DialogSuspendedContext } from "./dialogSuspendedContext";

/** Ignore Enter still in flight from the keypress that opened the dialog. */
export const OPEN_GRACE_MS = 100;

function entersNewline(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export interface DialogProps {
  title: string;
  scope?: DialogScopeInfo;
  description?: ReactNode;
  role?: "alertdialog" | "dialog";
  panelClassName?: string;
  busy?: boolean;
  suspended?: boolean;
  confirmDisabled?: boolean;
  onCancelAction?: (action: GuardedAction) => Promise<void>;
  onConfirm?: () => void;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  describedById?: string;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Dialog({
  title,
  scope,
  description,
  role = "dialog",
  panelClassName,
  busy = false,
  suspended = false,
  confirmDisabled = false,
  onCancelAction,
  onConfirm,
  onClose,
  initialFocusRef,
  describedById,
  footer,
  children,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const openedAtRef = useRef(0);
  const parentSuspended = useContext(DialogSuspendedContext);
  const confirm = () => {
    if (!busy && !confirmDisabled && !suspended && !parentSuspended) onConfirm?.();
  };

  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
  }, []);

  return (
    <DialogShell
      block="dialog"
      role={role}
      panelClassName={panelClassName}
      labelledById={titleId}
      describedById={describedById ?? (description ? descriptionId : undefined)}
      onClose={onClose}
      onCancelAction={onCancelAction}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.key !== "Enter" ||
          event.shiftKey
        )
          return;
        if (entersNewline(event.target)) return;
        if (
          event.target instanceof Element &&
          event.target.closest("button, a[href], select, [role='button'], [role='combobox']")
        )
          return;
        if (performance.now() - openedAtRef.current < OPEN_GRACE_MS) return;
        event.preventDefault();
        confirm();
      }}
      busy={busy}
      suspended={suspended}
      scrollLock="dialog-open"
      backdropLabel="Close dialog"
      initialFocusRef={initialFocusRef}
    >
      <DialogSubmissionContext.Provider value={{ confirm, busy, disabled: confirmDisabled }}>
        <header className="dialog__header">
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="dialog__close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <Icon icon={iconX} />
          </button>
        </header>

        {scope && <DialogScope {...scope} />}

        {description && (
          <p id={descriptionId} className="dialog__description">
            {description}
          </p>
        )}

        {children}

        {footer && <footer className="dialog__actions">{footer}</footer>}
      </DialogSubmissionContext.Provider>
    </DialogShell>
  );
}

interface DialogButtonProps {
  label: string;
  variant: "primary" | "secondary" | "danger" | "warning";
  icon?: typeof iconLoader2;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}

export function DialogButton({
  label,
  variant,
  icon,
  busy = false,
  disabled = false,
  onClick,
  onKeyDown,
}: DialogButtonProps) {
  const displayIcon = busy ? iconLoader2 : icon;

  return (
    <button
      type="button"
      className={`dialog__btn dialog__btn--${variant}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {displayIcon && <Icon icon={displayIcon} spin={busy} className="dialog__btn-icon" />}
      {label}
    </button>
  );
}

interface DialogActionsProps {
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "warning" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
}

export function DialogActions({
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  busy: standaloneBusy = false,
  confirmDisabled: standaloneDisabled = false,
  onConfirm,
  onCancel,
}: DialogActionsProps) {
  const request = useContext(DialogCancelContext);
  const submission = useContext(DialogSubmissionContext);
  const busy = submission?.busy ?? standaloneBusy;
  const confirmDisabled = submission?.disabled ?? standaloneDisabled;
  return (
    <>
      <DialogButton
        label={cancelLabel}
        variant="secondary"
        disabled={busy}
        onClick={() => {
          if (request) void request(onCancel);
          else onCancel();
        }}
      />
      <DialogButton
        label={busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        variant={confirmVariant}
        busy={busy}
        disabled={confirmDisabled}
        onClick={submission?.confirm ?? (() => onConfirm?.())}
      />
    </>
  );
}
