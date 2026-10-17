import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { AnchoredSide } from "@/shared/lib/anchoredPosition";
import { classNames } from "@/shared/lib/classNames";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";

/** Gap kept between a bubble and the window edge. Tighter than a menu's, by design. */
const VIEWPORT_GUTTER = 8;
/** Matches the bubble's fade in `_tooltip.scss`; it stays mounted until that ends. */
const FADE_MS = 150;

let dismissShownTooltip: (() => void) | null = null;

function claimShownTooltip(dismiss: () => void) {
  if (dismissShownTooltip !== dismiss) dismissShownTooltip?.();
  dismissShownTooltip = dismiss;
}

function releaseShownTooltip(dismiss: () => void) {
  if (dismissShownTooltip === dismiss) dismissShownTooltip = null;
}

interface TooltipChildProps {
  disabled?: boolean;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-expanded"?: boolean;
}

interface TooltipProps {
  content: ReactNode;
  children: ReactElement<TooltipChildProps>;
  delay?: number;
  disabled?: boolean;
  /** Show the bubble immediately, e.g. after a click, without waiting for hover. */
  open?: boolean;
  trigger?: "hover-focus";
  /** Preferred side of the trigger; the bubble flips only when that side cannot hold it. */
  placement?: AnchoredSide;
  /** Extra classes on the hover wrapper, e.g. when it has to be a flex item. */
  className?: string;
  /** Extra classes on the bubble, for content richer than a line of text. */
  bubbleClassName?: string;
  style?: CSSProperties;
}

export function Tooltip({
  content,
  children,
  delay = 400,
  disabled = false,
  open = false,
  trigger = "hover-focus",
  placement = "bottom",
  className,
  bubbleClassName,
  style,
}: TooltipProps) {
  const id = useId();
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [openDismissed, setOpenDismissed] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setOpenDismissed(false);
  }
  const childExpanded = isValidElement(children) && children.props["aria-expanded"] === true;

  const clearShowTimeout = useCallback(() => {
    if (showTimeoutRef.current !== undefined) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = undefined;
    }
  }, []);

  const stopScrollWatchRef = useRef<(() => void) | undefined>(undefined);

  const stopScrollWatch = useCallback(() => {
    stopScrollWatchRef.current?.();
    stopScrollWatchRef.current = undefined;
  }, []);

  const show = useCallback((): boolean => {
    if (disabled || childExpanded || content == null || content === "") return false;
    clearShowTimeout();
    showTimeoutRef.current = setTimeout(() => setVisible(true), delay);
    return true;
  }, [childExpanded, clearShowTimeout, content, delay, disabled]);

  const hide = useCallback(() => {
    clearShowTimeout();
    stopScrollWatch();
    setVisible(false);
  }, [clearShowTimeout, stopScrollWatch]);

  // Scrolling moves the content out from under a resting pointer, so a hover bubble would point
  // at the wrong thing; close it instead of tracking. Focus has not moved, so a focus bubble stays.
  const showOnHover = useCallback(() => {
    if (!show() || stopScrollWatchRef.current) return;
    const onScroll = () => hide();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    stopScrollWatchRef.current = () =>
      document.removeEventListener("scroll", onScroll, { capture: true });
  }, [hide, show]);

  // A trigger nested inside this one, like a card's "+N more", owns the hover while the pointer
  // is over it. This one steps aside, and comes back when the pointer returns to its own part:
  // that move stays inside the wrapper, so no second mouseenter would bring it back.
  const steppedAsideRef = useRef(false);
  const handleMouseOver = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      const wrapper = wrapperRef.current;
      // The bubble is portalled, so its events arrive here too; it is no part of the trigger.
      if (!wrapper || !(event.target instanceof Element) || !wrapper.contains(event.target)) {
        return;
      }
      const owner = event.target.closest(".tooltip");
      if (owner !== wrapper) {
        steppedAsideRef.current = true;
        hide();
      } else if (steppedAsideRef.current) {
        steppedAsideRef.current = false;
        showOnHover();
      }
    },
    [hide, showOnHover],
  );

  const handleMouseLeave = useCallback(() => {
    steppedAsideRef.current = false;
    hide();
  }, [hide]);

  const showOnFocus = useCallback(() => {
    stopScrollWatch();
    show();
  }, [show, stopScrollWatch]);

  const dismiss = useCallback(() => {
    hide();
    setOpenDismissed(true);
  }, [hide]);

  // Hover must not cover a menu/drawer this trigger just opened; forced `open` still wins.
  const shown =
    !disabled &&
    content != null &&
    content !== "" &&
    ((open && !openDismissed) || (visible && !childExpanded));

  useLayoutEffect(() => {
    if (!shown) return;
    claimShownTooltip(dismiss);
    return () => releaseShownTooltip(dismiss);
  }, [dismiss, shown]);

  useEffect(
    () => () => {
      clearShowTimeout();
      stopScrollWatch();
    },
    [clearShowTimeout, stopScrollWatch],
  );

  useEffect(() => {
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- hide also clears timers
    if (childExpanded) hide();
  }, [childExpanded, hide]);

  if (!isValidElement(children)) {
    return children;
  }

  const childProps = children.props;
  const childDisabled = Boolean(childProps.disabled);
  const childAriaLabel = childProps["aria-label"];
  const tooltipDuplicatesLabel =
    typeof childAriaLabel === "string" && typeof content === "string" && childAriaLabel === content;
  const describedBy = shown && !tooltipDuplicatesLabel ? id : undefined;
  const ariaDescribedBy =
    [childProps["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined;

  const focusHandlers =
    trigger === "hover-focus" && !childDisabled
      ? {
          onFocus: (event: FocusEvent) => {
            childProps.onFocus?.(event);
            showOnFocus();
          },
          onBlur: (event: FocusEvent) => {
            childProps.onBlur?.(event);
            hide();
          },
        }
      : {};

  // The handlers are only attached here; the refs they read are touched when focus moves.
  // oxlint-disable-next-line react-hooks/refs
  const triggerElement = cloneElement(children, {
    "aria-describedby": ariaDescribedBy,
    ...focusHandlers,
  });

  return (
    <span
      ref={wrapperRef}
      className={classNames("tooltip", childDisabled && "tooltip--disabled-wrap", className)}
      style={style}
      onMouseEnter={showOnHover}
      onMouseOver={handleMouseOver}
      onMouseLeave={handleMouseLeave}
      onPointerDown={hide}
      onClick={hide}
    >
      {triggerElement}
      <AnchoredLayer
        anchorRef={wrapperRef}
        open={shown}
        placement={`${placement}-center`}
        offset={8}
        gutter={VIEWPORT_GUTTER}
        exitDuration={FADE_MS}
        className={classNames("tooltip__bubble", bubbleClassName)}
        id={id}
        role="tooltip"
      >
        {content}
        <span className="tooltip__arrow" aria-hidden="true" />
      </AnchoredLayer>
    </span>
  );
}
