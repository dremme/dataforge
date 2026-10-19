import {
  useContext,
  useEffect,
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
import { useLatestRef } from "@/shared/hooks/useLatestRef";
import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
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

interface DialogProps {
  title: string;
  scope?: DialogScopeInfo;
  description?: ReactNode;
  role?: "alertdialog" | "dialog";
  panelClassName?: string;
  busy?: boolean;
  suspended?: boolean;
  unsavedChanges?: boolean;
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
  role = "alertdialog",
  panelClassName,
  busy = false,
  suspended = false,
  unsavedChanges = false,
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
  const parentSuspended = useContext(DialogSuspendedContext);
  const discard = useDiscardChanges({
    unsavedChanges,
    busy,
    suspended,
    onNavigationDiscard: onClose,
  });
  const requestClose = () => {
    void discard.request(onClose);
  };

  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
  }, []);

  const confirmRef = useLatestRef(onConfirm);

  useEffect(() => {
    if (busy || suspended || parentSuspended || discard.confirming || !onConfirm) return;

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
  }, [busy, confirmRef, discard.confirming, parentSuspended, onConfirm, suspended]);

  return (
    <>
      <DialogShell
        block="confirm-dialog"
        role={role}
        panelClassName={panelClassName}
        labelledById={titleId}
        describedById={describedById ?? (description ? descriptionId : undefined)}
        onClose={requestClose}
        onCancelAction={discard.request}
        busy={busy}
        suspended={suspended || discard.confirming}
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
            onClick={requestClose}
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

        {footer && <footer className="confirm-dialog__actions">{footer}</footer>}
      </DialogShell>
      {discard.prompt}
    </>
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
      className={`confirm-dialog__btn confirm-dialog__btn--${variant}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
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
  confirmVariant?: "primary" | "warning" | "danger";
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
  const request = useContext(DialogCancelContext);
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
        onClick={onConfirm}
      />
    </>
  );
}

export function DiscardChangesDialog({
  onDiscard,
  onKeepEditing,
  description = "Your unsaved changes will be lost. This cannot be undone.",
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  description?: string;
}) {
  return (
    <Dialog
      title="Discard changes?"
      description={description}
      onClose={onKeepEditing}
      onConfirm={onDiscard}
      footer={
        <DialogActions
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          confirmVariant="danger"
          onConfirm={onDiscard}
          onCancel={onKeepEditing}
        />
      }
    />
  );
}
