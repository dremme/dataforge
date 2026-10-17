import { useState } from "react";

/**
 * True on the render where `value` differs from the previous render's. State reset behind it
 * lands in that same render, where an effect would first commit a frame with the stale state.
 * Call it unconditionally: `useChanged(a) || useChanged(b)` would skip the second hook.
 */
export function useChanged(value: unknown): boolean {
  const [previous, setPrevious] = useState(() => value);
  if (Object.is(previous, value)) return false;
  setPrevious(() => value);
  return true;
}
