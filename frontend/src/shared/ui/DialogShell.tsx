import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import type { ScrollLockClass } from "@/shared/hooks/scrollLockManager";
import { classNames } from "@/shared/lib/classNames";
import { closeCodeEditorSearchPanel } from "@/shared/lib/codeEditorSearch";
import { registerModalDialog } from "@/shared/lib/modalDialogs";
import { useLatestRef } from "@/shared/hooks/useLatestRef";
import type { GuardedAction } from "@/shared/hooks/useDiscardChanges";
import { DialogCancelContext } from "./dialogCancelContext";
import { DialogHostContext } from "./dialogHostContext";
import { DialogSuspendedContext } from "./dialogSuspendedContext";
import { DialogSubmissionContext } from "./dialogSubmissionContext";

export type DialogEscape = "close" | "editor" | "none";

/** Backstop if `animationend` never fires, such as in a hidden tab. */
const EXIT_FALLBACK_MS = 400;

interface DialogShellProps {
  block: string;
  role?: "dialog" | "alertdialog";
  panelId?: string;
  panelClassName?: string;
  label?: string;
  labelledById?: string;
  describedById?: string;
  onClose: () => void;
  onCancelAction?: (action: GuardedAction) => Promise<void>;
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>;
  busy?: boolean;
  suspended?: boolean;
  escape?: DialogEscape;
  scrollLock?: ScrollLockClass;
  enterAnimation?: "fade-lift" | "none";
  closing?: boolean;
  onExited?: () => void;
  backdropLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  style?: CSSProperties;
}

export function DialogShell({
  block,
  role = "dialog",
  panelId,
  panelClassName,
  label,
  labelledById,
  describedById,
  onClose,
  onCancelAction,
  onKeyDown,
  busy = false,
  suspended: locallySuspended = false,
  escape = "close",
  scrollLock = "dialog-open",
  enterAnimation = "fade-lift",
  closing = false,
  onExited,
  backdropLabel = "Close",
  initialFocusRef,
  panelRef,
  children,
  style,
}: DialogShellProps) {
  const parentSuspended = useContext(DialogSuspendedContext);
  const parentDialog = useContext(DialogHostContext);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const suspended = parentSuspended || locallySuspended;
  const dismissible = !busy && !suspended && !closing;
  const initialFocus = useLatestRef(initialFocusRef);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const wasSuspendedRef = useRef(suspended);

  useScrollLock(true, scrollLock);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let active = true;
    let unregister: (() => void) | undefined;
    const open = () => {
      if (!active || dialog.open) return;
      // Descendant effects run first, including when several dialog levels mount together.
      if (parentDialog && !parentDialog.current?.open) {
        queueMicrotask(open);
        return;
      }
      dialog.showModal();
      unregister = registerModalDialog(dialog);
      (initialFocus.current?.current ?? dialog).focus({ preventScroll: true });
    };
    open();
    return () => {
      active = false;
      dialog.close();
      unregister?.();
    };
  }, [initialFocus, parentDialog]);

  useLayoutEffect(() => {
    const resumed = wasSuspendedRef.current && !suspended;
    wasSuspendedRef.current = suspended;
    if (!resumed) return;
    let active = true;
    // Native close runs before React removes the parent's inert attribute during the commit.
    queueMicrotask(() => {
      const dialog = dialogRef.current;
      if (!active || !dialog?.open || dialog.contains(document.activeElement)) return;
      const previous = lastFocusedRef.current;
      (previous?.isConnected ? previous : dialog).focus({ preventScroll: true });
    });
    return () => {
      active = false;
    };
  }, [suspended]);

  const exitedRef = useLatestRef(onExited);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => exitedRef.current?.(), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing, exitedRef]);

  return createPortal(
    <dialog
      ref={dialogRef}
      id={panelId}
      className={classNames("dialog-surface", block)}
      role={role}
      aria-label={label}
      aria-labelledby={labelledById}
      aria-describedby={describedById}
      aria-hidden={suspended || undefined}
      inert={suspended}
      style={style}
      onFocusCapture={(event) => {
        if (event.currentTarget.contains(event.target)) lastFocusedRef.current = event.target;
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        if (dismissible && escape !== "none") onClose();
      }}
      onKeyDown={(event) => {
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        // Reverse tab from the initially focused dialog should enter its final control.
        if (event.key === "Tab" && event.shiftKey && event.target === event.currentTarget) {
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "button, input, select, textarea, a[href], [tabindex], [contenteditable='true']",
            ),
          ].filter(
            (control) =>
              control.tabIndex >= 0 &&
              !control.matches(":disabled") &&
              control.getClientRects().length > 0,
          );
          event.preventDefault();
          controls.at(-1)?.focus();
          return;
        }
        if (event.key === "Escape" && escape === "editor") {
          if (closeCodeEditorSearchPanel(event.currentTarget)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
        onKeyDown?.(event);
      }}
    >
      <button
        type="button"
        className={classNames(
          "dialog-backdrop",
          `${block}__backdrop`,
          closing && "dialog-backdrop--exit",
        )}
        onClick={onClose}
        aria-label={backdropLabel}
        aria-hidden="true"
        disabled={!dismissible}
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        className={classNames(
          "dialog-panel",
          `${block}__panel`,
          !closing && enterAnimation === "fade-lift" && "dialog-panel--enter",
          closing && "dialog-panel--exit",
          panelClassName,
        )}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && closing) onExited?.();
        }}
        data-scroll-lock-allow
      >
        <DialogHostContext.Provider value={dialogRef}>
          <DialogSubmissionContext.Provider value={null}>
            <DialogCancelContext.Provider value={onCancelAction ?? null}>
              {children}
            </DialogCancelContext.Provider>
          </DialogSubmissionContext.Provider>
        </DialogHostContext.Provider>
      </div>
    </dialog>,
    document.body,
  );
}
