import { vi } from "vitest";
import { OPEN_GRACE_MS } from "@/shared/ui/Dialog";

/**
 * Controls the clock Dialog measures its Enter grace period against.
 *
 * Dialog stamps `performance.now()` on open and ignores Enter until
 * OPEN_GRACE_MS has elapsed, so tests used to sleep for real. Jumping the clock
 * instead keeps both halves of that behaviour honest — Enter is still rejected
 * before the jump and accepted after, against the comparison the component
 * ships — without spending the wall clock.
 *
 * Real time still flows underneath the offset: freezing `performance.now()`
 * outright would also stop the clock React's scheduler reads.
 *
 * Install before rendering, so the dialog's layout effect stamps the stub.
 * Teardown is handled by the global `vi.restoreAllMocks()` in `setup.ts`.
 */
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
