import {
  useCallback,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { classNames } from "@/shared/lib/classNames";

/** A drag this close to the resting value, in steps, lands on it. */
const DIAL_DETENT_STEPS = 2;
/** Grabbing the knob within this many pixels drags it from where it is, rather than jumping. */
const KNOB_GRAB_PX = 8;
const COARSE_STEPS = 10;
const TICK_SHARES = [0, 0.25, 0.5, 0.75, 1];

interface RulerDialProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  rest?: number;
  /** Where the fill starts; the resting value unless the dial measures an amount from `min`. */
  origin?: number;
  format: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function snapped(value: number, min: number, max: number, step: number): number {
  const steps = Math.round((value - min) / step);
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Math.min(max, Math.max(min, Number((min + steps * step).toFixed(decimals))));
}

function percent(share: number): string {
  return `${Math.min(1, Math.max(0, share)) * 100}%`;
}

export function RulerDial({
  label,
  value,
  min,
  max,
  step,
  rest = 0,
  origin = rest,
  format,
  disabled = false,
  onChange,
}: RulerDialProps) {
  const trackRef = useRef<HTMLSpanElement>(null);
  const grabRef = useRef<number | null>(null);

  const share = (next: number) => (next - min) / (max - min);

  const commit = useCallback(
    (next: number) => {
      const settled = snapped(next, min, max, step);
      if (settled !== value) onChange(settled);
    },
    [max, min, onChange, step, value],
  );

  const valueAt = (clientX: number): number => {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return value;
    const next =
      min + ((clientX - bounds.left - (grabRef.current ?? 0)) / bounds.width) * (max - min);
    return Math.abs(next - rest) < DIAL_DETENT_STEPS * step ? rest : next;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    // The dial must hold focus, or the arrow keys page the gallery instead.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);

    const bounds = trackRef.current?.getBoundingClientRect();
    const knobX = bounds ? bounds.left + share(value) * bounds.width : event.clientX;
    grabRef.current = Math.abs(event.clientX - knobX) <= KNOB_GRAB_PX ? event.clientX - knobX : 0;
    commit(valueAt(event.clientX));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (grabRef.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    commit(valueAt(event.clientX));
  };

  const handlePointerEnd = () => {
    grabRef.current = null;
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
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : -event.deltaY;
    if (delta !== 0) commit(value + Math.sign(delta) * step);
  };

  const from = share(Math.min(origin, value));
  const to = share(Math.max(origin, value));
  const dialStyle = {
    "--dial-value": percent(share(value)),
    "--dial-fill-start": percent(from),
    "--dial-fill-end": percent(to),
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
      <span ref={trackRef} className="ruler-dial__track" aria-hidden="true">
        {TICK_SHARES.map((tick) => (
          <span
            key={tick}
            className={classNames(
              "ruler-dial__tick",
              Math.abs(min + tick * (max - min) - rest) < step / 2 && "ruler-dial__tick--rest",
            )}
            style={{ left: percent(tick) }}
          />
        ))}
        <span className="ruler-dial__fill" />
        <span className="ruler-dial__knob" />
      </span>
    </div>
  );
}
