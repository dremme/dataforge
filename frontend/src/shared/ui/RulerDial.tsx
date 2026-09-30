import {
  useCallback,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { classNames } from "@/shared/lib/classNames";

export const DIAL_PIXELS_PER_STEP = 1.2;
export const DIAL_DETENT_STEPS = 2;
const COARSE_STEPS = 10;

interface RulerDialProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  rest?: number;
  format: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function snapped(value: number, min: number, max: number, step: number): number {
  const steps = Math.round((value - min) / step);
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Math.min(max, Math.max(min, Number((min + steps * step).toFixed(decimals))));
}

export function RulerDial({
  label,
  value,
  min,
  max,
  step,
  rest = 0,
  format,
  disabled = false,
  onChange,
}: RulerDialProps) {
  const dragRef = useRef<{ x: number; value: number } | null>(null);

  const commit = useCallback(
    (next: number) => {
      const settled = snapped(next, min, max, step);
      if (settled !== value) onChange(settled);
    },
    [max, min, onChange, step, value],
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    // The dial must hold focus, or the arrow keys page the gallery instead.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, value };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = drag.value - ((event.clientX - drag.x) / DIAL_PIXELS_PER_STEP) * step;
    commit(Math.abs(next - rest) < DIAL_DETENT_STEPS * step ? rest : next);
  };

  const handlePointerEnd = () => {
    dragRef.current = null;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const amount = (event.shiftKey ? COARSE_STEPS : 1) * step;
    const targets: Record<string, number> = {
      ArrowLeft: value - amount,
      ArrowDown: value - amount,
      ArrowRight: value + amount,
      ArrowUp: value + amount,
      PageDown: value - COARSE_STEPS * step,
      PageUp: value + COARSE_STEPS * step,
      Home: min,
      End: max,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    commit(target);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (disabled) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta !== 0) commit(value - Math.sign(delta) * step);
  };

  const dialStyle = {
    "--dial-length": `${((max - min) / step) * DIAL_PIXELS_PER_STEP}px`,
    "--dial-offset": `${-((value - min) / step) * DIAL_PIXELS_PER_STEP}px`,
    "--dial-rest": `${((rest - min) / step) * DIAL_PIXELS_PER_STEP}px`,
    "--dial-tick": `${5 * DIAL_PIXELS_PER_STEP}px`,
    "--dial-major": `${25 * DIAL_PIXELS_PER_STEP}px`,
  } as CSSProperties;

  return (
    <div
      className={classNames("ruler-dial", disabled && "ruler-dial--disabled")}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      style={dialStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onDoubleClick={() => !disabled && commit(rest)}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <span className="ruler-dial__caption" aria-hidden="true">
        <span className="ruler-dial__label">{label}</span>
        <span className="ruler-dial__value">{format(value)}</span>
      </span>
      <span className="ruler-dial__track" aria-hidden="true">
        <span className="ruler-dial__ticks">
          <span className="ruler-dial__rest" />
        </span>
        <span className="ruler-dial__needle" />
      </span>
    </div>
  );
}
