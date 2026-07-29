import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as systemApi from "@/features/automation/api/system";
import type { SystemSpecs } from "@/shared/types";
import { resetSystemSpecsCacheForTests, useSystemSpecs } from "./useSystemSpecs";

const sampleSpecs: SystemSpecs = {
  cpu_name: "Intel Core i7",
  cpu_cores: 8,
  memory_total_bytes: 32 * 1024 ** 3,
  memory_available_bytes: 16 * 1024 ** 3,
  gpu_name: "NVIDIA GeForce RTX 3080",
  gpu_memory_bytes: 10 * 1024 ** 3,
  gpu_memory_used_bytes: 4 * 1024 ** 3,
  gpu_memory_available_bytes: 6 * 1024 ** 3,
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
});
