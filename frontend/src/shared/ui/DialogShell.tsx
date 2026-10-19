import {
  useContext,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { DialogSuspendedContext } from "./dialogSuspendedContext";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/shared/hooks/useDialogFocus";
import { useEditorOverlayEscape } from "@/shared/hooks/useEditorOverlayEscape";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import {
  overlayBackdropClass,
  useOverlayBackdropClass,
} from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import type { ScrollLockClass } from "@/shared/hooks/scrollLockManager";
import { classNames } from "@/shared/lib/classNames";
import { useLatestRef } from "@/shared/hooks/useLatestRef";
import type { GuardedAction } from "@/shared/hooks/useDiscardChanges";
import { DialogCancelContext } from "./dialogCancelContext";

/** `bubble` is window-level; `editor` is capture-phase so the find panel gets first refusal. */
export type DialogEscape = "bubble" | "editor" | "none";

/** Backstop if `animationend` never fires (cancelled animation or hidden tab). */
const EXIT_FALLBACK_MS = 400;

interface DialogShellProps {
  block: string;
  role?: "dialog" | "alertdialog";
  panelAs?: "div" | "aside";
  panelId?: string;
  panelClassName?: string;

  label?: string;
  labelledById?: string;
  describedById?: string;

  onClose: () => void;
  onCancelAction?: (action: GuardedAction) => Promise<void>;
  busy?: boolean;
  /** Suspends the focus trap; `inert` does not, as the trap keys off `aria-hidden`. */
  suspended?: boolean;

  escape?: DialogEscape;
  scrollLock?: ScrollLockClass;
  /** Overlays whose lock is held by a parent must pass `false` or they lose blur. */
  nested?: boolean;
  enterAnimation?: "fade-lift" | "none";
  closing?: boolean;
  onExited?: () => void;

  backdropLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;

  children: ReactNode;
  inline?: boolean;
  style?: CSSProperties;
}

export function DialogShell({
  block,
  role = "dialog",
  panelAs = "div",
  panelId,
  panelClassName,
  label,
  labelledById,
  describedById,
  onClose,
  onCancelAction,
  busy = false,
  suspended: locallySuspended = false,
  escape = "bubble",
  scrollLock,
  nested,
  enterAnimation = "fade-lift",
  closing = false,
  onExited,
  backdropLabel = "Close",
  initialFocusRef,
  panelRef,
  children,
  inline = false,
  style,
}: DialogShellProps) {
  const parentSuspended = useContext(DialogSuspendedContext);
  const suspended = parentSuspended || locallySuspended;
  const fallbackRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef ?? fallbackRef;

  // Nesting is read from lock depth, so this must run before acquiring a lock.
  const depthBackdropClass = useOverlayBackdropClass(`${block}__backdrop`);
  const backdropClass =
    nested === undefined ? depthBackdropClass : overlayBackdropClass(`${block}__backdrop`, nested);

  useScrollLock(!inline && scrollLock !== undefined, scrollLock ?? "confirm-dialog-open");
  useFocusTrap(resolvedPanelRef, !inline && !suspended);
  useDialogFocus(resolvedPanelRef, initialFocusRef, !inline);

  const dismissible = !busy && !suspended && !closing;

  // Keep `onExited` identity from restarting the fallback timer.
  const exitedRef = useLatestRef(onExited);

  useEffect(() => {
    if (!closing) return;

    const timer = window.setTimeout(() => exitedRef.current?.(), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing, exitedRef]);
  // Both hooks stay mounted for stable order; the editor listener stops capture-phase
  // propagation and must stay detached in bubble mode.
  useEscapeKey(onClose, !inline && escape === "bubble" && dismissible);
  useEditorOverlayEscape(
    resolvedPanelRef,
    onClose,
    dismissible,
    !inline && !suspended && escape === "editor",
  );

  const Panel = panelAs as "div";

  if (inline)
    return (
      <aside
        className={`${block} ${block}--inline`}
        aria-label={label}
        style={style}
        aria-hidden={parentSuspended || undefined}
        inert={parentSuspended}
      >
        <div ref={resolvedPanelRef} className={`${block}__panel`} tabIndex={-1}>
          {children}
        </div>
      </aside>
    );

  return createPortal(
    <div className={block} role="presentation">
      <button
        type="button"
        className={classNames(backdropClass, closing && "dialog-backdrop--exit")}
        onClick={onClose}
        aria-label={backdropLabel}
        disabled={!dismissible}
        tabIndex={-1}
      />

      <Panel
        ref={resolvedPanelRef}
        id={panelId}
        className={classNames(
          "dialog-panel",
          `${block}__panel`,
          !closing && enterAnimation === "fade-lift" && "dialog-panel--enter",
          closing && "dialog-panel--exit",
          panelClassName,
        )}
        onAnimationEnd={(event) => {
          // Ignore child animations; only this element's exit unmounts the overlay.
          if (event.target !== event.currentTarget) return;
          if (!closing) return;
          onExited?.();
        }}
        role={role}
        aria-modal={suspended ? undefined : true}
        aria-hidden={suspended ? true : undefined}
        aria-label={label}
        aria-labelledby={labelledById}
        aria-describedby={describedById}
        inert={suspended}
        tabIndex={-1}
        data-scroll-lock-allow
      >
        <DialogCancelContext.Provider value={onCancelAction ?? null}>
          {children}
        </DialogCancelContext.Provider>
      </Panel>
    </div>,
    document.body,
  );
}
