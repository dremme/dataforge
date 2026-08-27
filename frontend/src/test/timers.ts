import { act } from "@testing-library/react";
import { vi } from "vitest";

/** Fake the clock around `schedule`, then restore before `waitFor` (RTL hangs on fakes). */
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
