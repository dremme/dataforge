import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from "react";

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
}

export function Tooltip({
  content,
  children,
  delay = 400,
  disabled = false,
  trigger = "hover-focus",
}: TooltipProps) {
  const id = useId();
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      className={`tooltip${visible ? " tooltip--visible" : ""}${childDisabled ? " tooltip--disabled-wrap" : ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {triggerElement}
      {showBubble && (
        <span
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
