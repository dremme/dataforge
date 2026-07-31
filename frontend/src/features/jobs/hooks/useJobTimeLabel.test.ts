import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalOstrisJob, Job } from "@/shared/types";
import { useJobTimeLabel } from "./useJobTimeLabel";

const START_MS = Date.parse("2026-01-01T12:00:00.000Z");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    folder: "C:\\Photos",
    folder_name: "Photos",
    job_type: "auto_caption",
    status: "running",
    total: 10,
    processed: 2,
    current_file: null,
    current_name: null,
    stats: { success: 2 },
    results: [],
    error: null,
    created_at: "2026-01-01T12:00:00.000Z",
    started_at: "2026-01-01T12:00:00.000Z",
    finished_at: null,
    ...overrides,
  };
}

describe("useJobTimeLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null without a job", () => {
    const { result } = renderHook(() => useJobTimeLabel(null));
    expect(result.current).toBeNull();
  });

  it("re-estimates the remaining time as the clock advances", () => {
    const job = makeJob();
    const { result } = renderHook(() => useJobTimeLabel(job));

    const initialLabel = result.current;
    expect(initialLabel).toMatch(/left$/);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // The estimate tracks wall-clock time even though the job payload never changed.
    expect(result.current).toBe("~4 min left");
    expect(result.current).not.toBe(initialLabel);
  });

  it("shows a placeholder while nothing has been processed yet", () => {
    const { result } = renderHook(() => useJobTimeLabel(makeJob({ processed: 0, stats: {} })));
    expect(result.current).toBe("Estimating...");
  });

  it("shows nothing for a queued job that has not started", () => {
    const { result } = renderHook(() =>
      useJobTimeLabel(makeJob({ status: "queued", processed: 0, stats: {}, started_at: null })),
    );
    expect(result.current).toBeNull();
  });

  it("switches to the time taken once the job finishes", () => {
    const { result, rerender } = renderHook((job: Job) => useJobTimeLabel(job), {
      initialProps: makeJob(),
    });

    rerender(
      makeJob({
        status: "completed",
        processed: 10,
        finished_at: "2026-01-01T12:01:30.000Z",
      }),
    );

    expect(result.current).toBe("Took 1 min 30s");
  });

  it("stops ticking once the job is no longer active", () => {
    const clearInterval = vi.spyOn(window, "clearInterval");

    const { rerender } = renderHook((job: Job) => useJobTimeLabel(job), {
      initialProps: makeJob(),
    });

    rerender(makeJob({ status: "cancelled", finished_at: "2026-01-01T12:00:10.000Z" }));

    expect(clearInterval).toHaveBeenCalled();

    const callsBefore = clearInterval.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // A settled job schedules no further intervals, so nothing new gets torn down.
    expect(clearInterval.mock.calls.length).toBe(callsBefore);

    clearInterval.mockRestore();
  });

  it("uses the co-tracked Ostris remaining estimate for train_lora jobs", () => {
    const trainingJob = makeJob({
      job_type: "train_lora",
      external_ref: "sample_train_v1",
      processed: 50,
      total: 1000,
      stats: { step: 50, total_steps: 1000, speed_ms_per_step: 9999 },
    });
    const externalJob: ExternalOstrisJob = {
      id: "ostris-1",
      name: "sample_train_v1",
      status: "running",
      step: 100,
      total_steps: 200,
      info: "Training",
      speed_string: "2.00 sec/iter",
      job_type: "train",
      dataset_folder: "C:\\datasets\\landscapes",
      dataset_folder_name: "landscapes",
      model: "krea/Krea-2-Turbo",
      created_at: "2026-01-01T00:00:00.000Z",
      save_now: false,
      stop_requested: false,
    };

    const { result } = renderHook(() => useJobTimeLabel(trainingJob, [externalJob]));

    // Prefer the external card's step/speed (100 remaining * 2s = ~4 min), not the DF stats.
    expect(result.current).toBe("~4 min left");
  });
});
