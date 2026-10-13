import type { CSSProperties } from "react";

/**
 * The painted part of a range input's track, as `--fill-from` and `--fill-to` percentages.
 * It runs from ``origin`` (the minimum unless given) to the value, so a centred control such as
 * Rotation fills outwards from its resting middle.
 */
export function rangeFill(value: number, min: number, max: number, origin = min): CSSProperties {
  const span = max - min || 1;
  const percent = (point: number) => (Math.min(max, Math.max(min, point)) - min) / span;
  const from = percent(Math.min(origin, value));
  const to = percent(Math.max(origin, value));
  return {
    "--fill-from": `${(from * 100).toFixed(2)}%`,
    "--fill-to": `${(to * 100).toFixed(2)}%`,
  } as CSSProperties;
}
