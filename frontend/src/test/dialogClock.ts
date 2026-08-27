import { vi } from "vitest";
import { OPEN_GRACE_MS } from "@/shared/ui/Dialog";

/** Offset `performance.now()`; do not freeze it, or React's scheduler stops too. */
export function stubDialogClock() {
  const realNow = performance.now.bind(performance);
  let offset = 0;

  vi.spyOn(performance, "now").mockImplementation(() => realNow() + offset);

  return {
    /** Jumps past the grace period, so the next Enter is honoured. */
    passOpenGrace: () => {
      offset += OPEN_GRACE_MS;
    },
  };
}
