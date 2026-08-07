import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Runs `schedule`, then advances a fake clock over `ms`.
 *
 * The clock is installed before `schedule` so the timers it starts are fakeable,
 * and torn down before the caller's next `waitFor`: RTL's `waitFor` decides
 * whether to drive fake timers by looking for a `jest` global, which Vitest never
 * defines, so on a faked clock its poll and its timeout are both frozen and it
 * hangs until the test times out. Assert synchronously after this returns.
 */
export async function advanceFakeClock(ms: number, schedule?: () => void) {
  vi.useFakeTimers();

  try {
    if (schedule) {
      act(schedule);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  } finally {
    vi.useRealTimers();
  }
}
