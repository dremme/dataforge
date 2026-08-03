import { useEffect, useRef, type ReactNode, type RefObject } from "react";
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

/**
 * `bubble` — window-level Escape. The default.
 * `editor` — capture-phase and CodeMirror-aware, so the editor's find panel gets
 *            first refusal and a parent overlay does not close alongside this one.
 * `none`   — the caller owns Escape entirely.
 */
export type ModalEscape = "bubble" | "editor" | "none";

/**
 * Backstop for the exit. `animationend` is the normal signal, but it never
 * arrives if the animation is cancelled or the tab is hidden mid-exit — frames
 * stop compositing, so the animation freezes at 0 and the overlay would stay
 * mounted holding its scroll lock. Comfortably longer than any exit we declare.
 */
const EXIT_FALLBACK_MS = 400;

interface ModalShellProps {
  /** BEM block driving the shell and backdrop classes, e.g. `gallery-item-modal`. */
  block: string;
  role?: "dialog" | "alertdialog";
  /** The jobs drawer's panel is an `<aside>`. */
  panelAs?: "div" | "aside";
  /** Only needed where something outside the overlay points at it (`aria-controls`). */
  panelId?: string;
  panelClassName?: string;

  /** Accessible name. Pass exactly one of these. */
  label?: string;
  labelledById?: string;
  describedById?: string;

  onClose: () => void;
  /** Work is in flight: disables the backdrop and Escape. */
  busy?: boolean;
  /**
   * A child overlay is on top. Suspends the focus trap and Escape and marks the
   * panel inert.
   *
   * The trap has to be suspended explicitly — `inert` alone will not do it.
   * `useFocusTrap` decides visibility from `aria-hidden` on each candidate
   * element itself, not on its ancestors, so an inert panel still yields
   * focusables and its capture-phase Tab handler would swallow the child
   * overlay's Tab.
   */
  suspended?: boolean;

  escape?: ModalEscape;
  /** Acquire a scroll lock. Omit when a parent hook already owns one. */
  scrollLock?: ScrollLockClass;
  /**
   * Overrides the depth-based `--nested` backdrop decision. Overlays whose lock
   * is held by a parent for the whole session (the gallery family) must pass
   * `false`, or they read as nested on their own and lose their blur.
   */
  nested?: boolean;
  /** Panel entrance. `none` for surfaces with an animation of their own. */
  enterAnimation?: "fade-lift" | "none";
  /**
   * Play the exit animation instead of vanishing. The owner keeps rendering the
   * overlay while this is set and unmounts it from `onExited`.
   */
  closing?: boolean;
  /** Fires when the exit animation ends. Required for `closing` to terminate. */
  onExited?: () => void;

  backdropLabel?: string;
  /** Focused on open instead of the panel — use for a dialog's primary field. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Supply when the caller also needs to read or measure the panel. */
  panelRef?: RefObject<HTMLDivElement | null>;

  /** Panel content: the caller brings its own header, body and footer. */
  children: ReactNode;
}

/**
 * The portal, backdrop, focus and scroll-lock plumbing every overlay needs.
 *
 * Deliberately owns no chrome — no header, footer, close button or confirm
 * shortcut. Those differ between the confirm dialogs (`Dialog`) and the editor
 * overlays (`modal-editor-*`), and keeping them out is what lets both families
 * share this without a mode flag.
 */
export function ModalShell({
  block,
  role = "dialog",
  panelAs = "div",
  panelId,
  panelClassName,
  label,
  labelledById,
  describedById,
  onClose,
  busy = false,
  suspended = false,
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
}: ModalShellProps) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef ?? fallbackRef;

  // Must precede the scroll lock below: nesting is read from the lock depth, so
  // acquiring first would count this overlay's own lock.
  const depthBackdropClass = useOverlayBackdropClass(`${block}__backdrop`);
  const backdropClass =
    nested === undefined ? depthBackdropClass : overlayBackdropClass(`${block}__backdrop`, nested);

  useScrollLock(scrollLock !== undefined, scrollLock ?? "confirm-dialog-open");
  useFocusTrap(resolvedPanelRef, !suspended);
  useDialogFocus(resolvedPanelRef, initialFocusRef);

  // A closing overlay is on its way out: it must not be dismissable again, or a
  // second Escape would re-run the owner's close path mid-animation.
  const dismissible = !busy && !suspended && !closing;

  // Read through a ref so an inline `onExited` arrow does not restart the timer
  // on every render.
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;

  useEffect(() => {
    if (!closing) return;

    const timer = window.setTimeout(() => exitedRef.current?.(), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);
  // Both are called unconditionally to keep hook order stable; `escape` picks
  // which one actually listens. The editor variant must stay detached in bubble
  // mode — it stops propagation in the capture phase, which would starve the
  // window-level handler below.
  useEscapeKey(onClose, escape === "bubble" && dismissible);
  useEditorOverlayEscape(resolvedPanelRef, onClose, dismissible, escape === "editor");

  // `aside` and `div` differ only in the tag name here, and narrowing the type
  // to one of them keeps the ref assignable without a generic element prop.
  const Panel = panelAs as "div";

  return createPortal(
    <div className={block} role="presentation">
      <button
        type="button"
        className={classNames(backdropClass, closing && "modal-backdrop--exit")}
        onClick={onClose}
        aria-label={backdropLabel}
        disabled={!dismissible}
        tabIndex={-1}
      />

      <Panel
        ref={resolvedPanelRef}
        id={panelId}
        className={classNames(
          "modal-panel",
          `${block}__panel`,
          // The exit class wins over the entrance in CSS, but dropping the
          // entrance here too keeps the two from ever being declared at once.
          !closing && enterAnimation === "fade-lift" && "modal-panel--enter",
          closing && "modal-panel--exit",
          panelClassName,
        )}
        onAnimationEnd={(event) => {
          // Only this element's own animation ends the exit — a child finishing
          // its spinner or entrance must not unmount the overlay.
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
        // Scrolling inside an overlay is always allowed; the lock exists to stop
        // the page behind it. Inner scrollers no longer have to opt in one by one.
        data-scroll-lock-allow
      >
        {children}
      </Panel>
    </div>,
    document.body,
  );
}
