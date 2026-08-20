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
  type ReactElement,
  type ReactNode,
} from "react";
import { classNames } from "@/shared/lib/classNames";

/** Gap kept between a shifted bubble and the window edge. */
const VIEWPORT_PADDING = 8;
/** Keeps the arrow off the bubble's rounded corners when the bubble is shifted. */
const ARROW_EDGE_PADDING = 12;

interface TooltipChildProps {
  disabled?: boolean;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

interface TooltipProps {
  content: ReactNode;
  children: ReactElement<TooltipChildProps>;
  delay?: number;
  disabled?: boolean;
  trigger?: "hover-focus";
  /** Extra classes on the hover wrapper, e.g. when it has to be a flex item. */
  className?: string;
  style?: CSSProperties;
}

export function Tooltip({
  content,
  children,
  delay = 400,
  disabled = false,
  trigger = "hover-focus",
  className,
  style,
}: TooltipProps) {
  const id = useId();
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  const clearShowTimeout = useCallback(() => {
    if (showTimeoutRef.current !== undefined) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = undefined;
    }
  }, []);

  const show = useCallback(() => {
    if (disabled || content == null || content === "") return;
    clearShowTimeout();
    showTimeoutRef.current = setTimeout(() => setVisible(true), delay);
  }, [clearShowTimeout, content, delay, disabled]);

  const hide = useCallback(() => {
    clearShowTimeout();
    setVisible(false);
  }, [clearShowTimeout]);

  useEffect(() => clearShowTimeout, [clearShowTimeout]);

  // A bubble centred on a trigger near the window edge would hang off it, so it
  // slides back into view and the arrow slides the opposite way to keep pointing
  // at the trigger — the "shift" behaviour Popper/Floating UI provide.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!visible || !bubble) return;

    // Measure unshifted, so a re-show does not compound the previous correction.
    bubble.style.setProperty("--tooltip-shift", "0px");
    const { left, right, width } = bubble.getBoundingClientRect();

    const overflowRight = right - (window.innerWidth - VIEWPORT_PADDING);
    const overflowLeft = VIEWPORT_PADDING - left;
    let shift = 0;
    if (overflowRight > 0) shift = -overflowRight;
    else if (overflowLeft > 0) shift = overflowLeft;

    // The arrow travels back by the same amount, but never past the bubble's ends.
    const arrowLimit = Math.max(0, width / 2 - ARROW_EDGE_PADDING);
    const arrowShift = Math.min(arrowLimit, Math.max(-arrowLimit, -shift));

    bubble.style.setProperty("--tooltip-shift", `${shift}px`);
    bubble.style.setProperty("--tooltip-arrow-shift", `${arrowShift}px`);
  }, [visible, content]);

  if (!isValidElement(children)) {
    return children;
  }

  const childProps = children.props;
  const childDisabled = Boolean(childProps.disabled);
  const childAriaLabel = childProps["aria-label"];
  const tooltipDuplicatesLabel =
    typeof childAriaLabel === "string" && typeof content === "string" && childAriaLabel === content;
  const describedBy = visible && !tooltipDuplicatesLabel ? id : undefined;
  const ariaDescribedBy =
    [childProps["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined;

  const focusHandlers =
    trigger === "hover-focus" && !childDisabled
      ? {
          onFocus: (event: FocusEvent) => {
            childProps.onFocus?.(event);
            show();
          },
          onBlur: (event: FocusEvent) => {
            childProps.onBlur?.(event);
            hide();
          },
        }
      : {};

  const triggerElement = cloneElement(children, {
    "aria-describedby": ariaDescribedBy,
    ...focusHandlers,
  });

  const showBubble = !disabled && content != null && content !== "";

  return (
    <span
      className={classNames(
        "tooltip",
        visible && "tooltip--visible",
        childDisabled && "tooltip--disabled-wrap",
        className,
      )}
      style={style}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {triggerElement}
      {showBubble && (
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className="tooltip__bubble"
          aria-hidden={visible ? undefined : true}
        >
          {content}
          <span className="tooltip__arrow" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
