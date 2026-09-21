import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as systemApi from "@/features/automation/api/system";
import type { SystemSpecs } from "@/shared/types";
import {
  ACTIVE_REFRESH_INTERVAL_MS,
  resetSystemSpecsCacheForTests,
  useSystemSpecs,
} from "./useSystemSpecs";

const sampleSpecs: SystemSpecs = {
  cpu_name: "Intel Core i7",
  cpu_cores: 8,
  cpu_load_percent: 12.5,
  cpu_temperature_celsius: 48,
  memory_total_bytes: 32 * 1024 ** 3,
  memory_used_bytes: 16 * 1024 ** 3,
  gpu_name: "NVIDIA GeForce RTX 3080",
  gpu_memory_bytes: 10 * 1024 ** 3,
  gpu_memory_used_bytes: 4 * 1024 ** 3,
  gpu_load_percent: 30,
  gpu_temperature_celsius: 66,
  gpu_available: true,
};

describe("useSystemSpecs", () => {
  beforeEach(() => {
    resetSystemSpecsCacheForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetSystemSpecsCacheForTests();
  });

  it("returns cached specs immediately on remount without waiting for fetch", async () => {
    const fetchMock = vi.spyOn(systemApi, "fetchSystemSpecs").mockResolvedValue(sampleSpecs);

    const first = renderHook(() => useSystemSpecs());
    await waitFor(() => {
      expect(first.result.current).toEqual(sampleSpecs);
    });
    first.unmount();

    // Hang the next fetch so remount cannot populate from the network.
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const second = renderHook(() => useSystemSpecs());
    expect(second.result.current).toEqual(sampleSpecs);
    second.unmount();
  });

  it("keeps cached specs when a refresh fails", async () => {
    const fetchMock = vi.spyOn(systemApi, "fetchSystemSpecs").mockResolvedValueOnce(sampleSpecs);

    const first = renderHook(() => useSystemSpecs());
    await waitFor(() => {
      expect(first.result.current).toEqual(sampleSpecs);
    });
    first.unmount();

    fetchMock.mockRejectedValue(new Error("offline"));

    const second = renderHook(() => useSystemSpecs());
    expect(second.result.current).toEqual(sampleSpecs);

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });
    expect(second.result.current).toEqual(sampleSpecs);
    second.unmount();
  });

  it("polls at the fast cadence only while live", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.spyOn(systemApi, "fetchSystemSpecs").mockResolvedValue(sampleSpecs);

      const { rerender, unmount } = renderHook(({ live }) => useSystemSpecs(live), {
        initialProps: { live: false },
      });
      await vi.advanceTimersByTimeAsync(ACTIVE_REFRESH_INTERVAL_MS * 3);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Going live refreshes immediately, then keeps up with the job.
      rerender({ live: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(ACTIVE_REFRESH_INTERVAL_MS * 3);
      expect(fetchMock).toHaveBeenCalledTimes(5);

      rerender({ live: false });
      const callsWhenIdle = fetchMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(ACTIVE_REFRESH_INTERVAL_MS * 3);
      expect(fetchMock).toHaveBeenCalledTimes(callsWhenIdle);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
