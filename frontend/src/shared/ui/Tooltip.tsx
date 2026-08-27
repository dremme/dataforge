import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { classNames } from "@/shared/lib/classNames";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";

/** Gap kept between a bubble and the window edge. Tighter than a menu's, by design. */
const VIEWPORT_GUTTER = 8;
/** Matches the bubble's fade in `_tooltip.scss`; it stays mounted until that ends. */
const FADE_MS = 150;

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
  /** Extra classes on the hover wrapper, e.g. when it has to be a flex item. */
  className?: string;
  style?: CSSProperties;
}

export function Tooltip({
  content,
  children,
  delay = 400,
  disabled = false,
  open = false,
  trigger = "hover-focus",
  className,
  style,
}: TooltipProps) {
  const id = useId();
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const childExpanded = isValidElement(children) && children.props["aria-expanded"] === true;

  const clearShowTimeout = useCallback(() => {
    if (showTimeoutRef.current !== undefined) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = undefined;
    }
  }, []);

  const show = useCallback(() => {
    if (disabled || childExpanded || content == null || content === "") return;
    clearShowTimeout();
    showTimeoutRef.current = setTimeout(() => setVisible(true), delay);
  }, [childExpanded, clearShowTimeout, content, delay, disabled]);

  const hide = useCallback(() => {
    clearShowTimeout();
    setVisible(false);
  }, [clearShowTimeout]);

  useEffect(() => clearShowTimeout, [clearShowTimeout]);

  useEffect(() => {
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
  // Hover must not cover a menu/drawer this trigger just opened; forced `open` still wins.
  const shown =
    !disabled && content != null && content !== "" && (open || (visible && !childExpanded));
  const describedBy = shown && !tooltipDuplicatesLabel ? id : undefined;
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

  return (
    <span
      ref={wrapperRef}
      className={classNames("tooltip", childDisabled && "tooltip--disabled-wrap", className)}
      style={style}
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
      onClick={hide}
    >
      {triggerElement}
      <AnchoredLayer
        anchorRef={wrapperRef}
        open={shown}
        placement="bottom-center"
        offset={8}
        gutter={VIEWPORT_GUTTER}
        exitDuration={FADE_MS}
        className="tooltip__bubble"
        id={id}
        role="tooltip"
      >
        {content}
        <span className="tooltip__arrow" aria-hidden="true" />
      </AnchoredLayer>
    </span>
  );
}
