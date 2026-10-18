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
import { ModalScope, type ModalScopeInfo } from "./ModalScope";
import { Icon } from "./Icon";
import { ModalShell } from "./ModalShell";
import { useLatestRef } from "@/shared/hooks/useLatestRef";
import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
import { ModalCancelContext } from "./modalCancelContext";
import { ModalNavigationPendingContext } from "./modalNavigationContext";

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
  unsavedChanges?: boolean;
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
  unsavedChanges = false,
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
  const navigationPending = useContext(ModalNavigationPendingContext);
  const discard = useDiscardChanges(unsavedChanges, busy || suspended, busy, onClose);
  const requestClose = () => {
    void discard.request(onClose);
  };

  useLayoutEffect(() => {
    openedAtRef.current = performance.now();
  }, []);

  const confirmRef = useLatestRef(onConfirm);

  useEffect(() => {
    if (busy || suspended || navigationPending || discard.confirming || !onConfirm) return;

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
  }, [busy, confirmRef, discard.confirming, navigationPending, onConfirm, suspended]);

  return (
    <>
      <ModalShell
        block="confirm-modal"
        role={role}
        panelClassName={panelClassName}
        labelledById={titleId}
        describedById={describedById ?? (description ? descriptionId : undefined)}
        onClose={requestClose}
        onCancelAction={discard.request}
        busy={busy}
        suspended={suspended || discard.confirming}
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
            onClick={requestClose}
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
      {discard.confirming && (
        <DiscardChangesModal onDiscard={discard.discard} onKeepEditing={discard.keepEditing} />
      )}
    </>
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
  const request = useContext(ModalCancelContext);
  return (
    <>
      <ModalButton
        label={cancelLabel}
        variant="secondary"
        disabled={busy}
        onClick={() => {
          if (request) void request(onCancel);
          else onCancel();
        }}
      />
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

export function DiscardChangesModal({
  onDiscard,
  onKeepEditing,
  description = "Your unsaved changes will be lost. This cannot be undone.",
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  description?: string;
}) {
  return (
    <Modal
      title="Discard changes?"
      description={description}
      onClose={onKeepEditing}
      onConfirm={onDiscard}
      footer={
        <ModalActions
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
