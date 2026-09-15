import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as jobsApi from "@/features/automation/api/jobs";
import { advanceFakeClock } from "@/test/timers";
import { job } from "@/test/fixtures";
import { COMFY_LOG_POLL_MS as POLL_MS, useComfyProcessLogs } from "./useComfyProcessLogs";

function logs(lines: string[]) {
  return { lines, available: true };
}

function comfyJob(overrides = {}) {
  return job({ job_type: "comfy_process", status: "running", ...overrides });
}

/**
 * One fake-clock window per test. `advanceFakeClock` restores real timers when it returns, which
 * discards any poll still pending, so mounting and advancing have to happen under the same clock.
 */
async function withFakeClock(run: (tick: (ms: number) => Promise<void>) => Promise<void>) {
  vi.useFakeTimers();
  try {
    await run(async (ms) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    });
  } finally {
    vi.useRealTimers();
  }
}

describe("useComfyProcessLogs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads ComfyUI's output while its own job runs", async () => {
    const fetchMock = vi.spyOn(jobsApi, "fetchComfyLogs").mockResolvedValue(logs(["Phase 3"]));
    const { result } = renderHook(() => useComfyProcessLogs(comfyJob()));

    await waitFor(() => expect(result.current?.lines).toEqual(["Phase 3"]));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("stays quiet for a job ComfyUI is not running", async () => {
    const fetchMock = vi.spyOn(jobsApi, "fetchComfyLogs").mockResolvedValue(logs(["x"]));
    const { result } = renderHook(() => useComfyProcessLogs(job({ job_type: "train_lora" })));

    await advanceFakeClock(POLL_MS * 2);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("stops once the job is no longer active", async () => {
    const fetchMock = vi.spyOn(jobsApi, "fetchComfyLogs").mockResolvedValue(logs(["x"]));
    renderHook(() => useComfyProcessLogs(comfyJob({ status: "completed" })));

    await advanceFakeClock(POLL_MS * 2);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never runs two reads at once", async () => {
    // Chained off the response, so a slow ComfyUI backs the poll off instead of queueing at it.
    const fetchMock = vi.spyOn(jobsApi, "fetchComfyLogs").mockReturnValue(new Promise(() => {}));
    renderHook(() => useComfyProcessLogs(comfyJob()));

    await advanceFakeClock(POLL_MS * 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("replaces the output rather than appending to it", async () => {
    const fetchMock = vi
      .spyOn(jobsApi, "fetchComfyLogs")
      .mockResolvedValueOnce(logs(["first"]))
      .mockResolvedValue(logs(["second"]));

    await withFakeClock(async (tick) => {
      const { result } = renderHook(() => useComfyProcessLogs(comfyJob()));
      await tick(POLL_MS);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current?.lines).toEqual(["second"]);
    });
  });

  it("keeps reading for as long as the job runs", async () => {
    const fetchMock = vi.spyOn(jobsApi, "fetchComfyLogs").mockResolvedValue(logs(["x"]));

    await withFakeClock(async (tick) => {
      renderHook(() => useComfyProcessLogs(comfyJob()));
      await tick(POLL_MS * 3);

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  it("keeps the last output when a read fails", async () => {
    const fetchMock = vi
      .spyOn(jobsApi, "fetchComfyLogs")
      .mockResolvedValueOnce(logs(["kept"]))
      .mockRejectedValue(new Error("offline"));

    await withFakeClock(async (tick) => {
      const { result } = renderHook(() => useComfyProcessLogs(comfyJob()));
      await tick(POLL_MS);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current?.lines).toEqual(["kept"]);
    });
  });

  it("drops the previous run's output when the job changes", async () => {
    // Stale text under a fresh job would read as progress.
    vi.spyOn(jobsApi, "fetchComfyLogs").mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderHook((current) => useComfyProcessLogs(current), {
      initialProps: comfyJob({ id: "job-1" }),
    });

    rerender(comfyJob({ id: "job-2" }));

    expect(result.current).toBeNull();
  });

  it("stops reading once unmounted", async () => {
    const fetchMock = vi.spyOn(jobsApi, "fetchComfyLogs").mockResolvedValue(logs(["x"]));

    await withFakeClock(async (tick) => {
      const { unmount } = renderHook(() => useComfyProcessLogs(comfyJob()));
      await tick(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      unmount();
      await tick(POLL_MS * 3);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
