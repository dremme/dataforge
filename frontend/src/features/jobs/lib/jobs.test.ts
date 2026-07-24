import { describe, expect, it } from "vitest";
import type { Job } from "@/shared/types";
import {
  classifyProcessedBatch,
  createJobTimingTracker,
  formatDuration,
  jobCompletionNotification,
  jobErrorMessage,
  jobIsCancelled,
  jobRemainingSeconds,
  jobRemainingTimeLabel,
  jobShowsWarningState,
  jobStatusTone,
  jobWarningMessage,
  progressPercent,
  selectFolderJob,
  statusLabel,
  statusTone,
  updateJobTimingTracker,
} from "./jobs";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    folder: "C:\\Photos",
    folder_name: "Photos",
    status: "running",
    processed: 0,
    total: 10,
    current_name: null,
    error: null,
    stats: {},
    results: [],
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("progressPercent", () => {
  it("reflects partial progress for cancelled jobs", () => {
    const job = makeJob({ status: "cancelled", processed: 3, total: 10 });
    expect(progressPercent(job)).toBe(30);
  });

  it("returns 100 for completed jobs when all items were processed", () => {
    const job = makeJob({ status: "completed", processed: 10, total: 10 });
    expect(progressPercent(job)).toBe(100);
  });

  it("reflects partial progress for failed jobs", () => {
    const job = makeJob({ status: "failed", processed: 2, total: 8 });
    expect(progressPercent(job)).toBe(25);
  });
});

describe("remaining time", () => {
  it("formats durations for display", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(3720)).toBe("1 hr 2 min");
  });

  it("estimates remaining seconds from processed items and elapsed time", () => {
    const startedAt = new Date("2026-01-01T12:00:00.000Z").toISOString();
    const job = makeJob({
      status: "running",
      processed: 2,
      total: 10,
      started_at: startedAt,
      stats: { success: 2 },
    });

    const nowMs = Date.parse("2026-01-01T12:01:00.000Z");
    expect(jobRemainingSeconds(job, nowMs)).toBe(240);
    expect(jobRemainingTimeLabel(job, nowMs)).toBe("~4 min left");
  });

  it("does not let skipped images drag the estimate down", () => {
    const startedAt = new Date("2026-01-01T12:00:00.000Z").toISOString();
    const job = makeJob({
      status: "running",
      processed: 9,
      total: 10,
      started_at: startedAt,
      stats: {
        skipped_long: 8,
        success: 1,
      },
    });

    const nowMs = Date.parse("2026-01-01T12:01:02.000Z");
    expect(jobRemainingSeconds(job, nowMs)).toBe(60);
    expect(jobRemainingTimeLabel(job, nowMs)).toBe("~1 min left");
  });

  it("classifies quick batches as skipped work", () => {
    expect(classifyProcessedBatch(8, 1200)).toEqual({ slow: 0, fast: 8 });
    expect(classifyProcessedBatch(1, 45000)).toEqual({ slow: 1, fast: 0 });
  });

  it("uses tracker samples when live stats are not available yet", () => {
    const startedAt = new Date("2026-01-01T12:00:00.000Z").toISOString();
    const job = makeJob({
      status: "running",
      processed: 9,
      total: 10,
      started_at: startedAt,
      stats: {},
    });

    let tracker = createJobTimingTracker(job.id);
    tracker = updateJobTimingTracker(
      tracker,
      makeJob({ ...job, processed: 8 }),
      Date.parse("2026-01-01T12:00:02.000Z"),
    );
    tracker = updateJobTimingTracker(tracker, job, Date.parse("2026-01-01T12:01:02.000Z"));

    const nowMs = Date.parse("2026-01-01T12:01:02.000Z");
    expect(jobRemainingSeconds(job, nowMs, tracker)).toBe(60);
  });

  it("shows estimating while the first file is still processing", () => {
    const job = makeJob({
      status: "running",
      processed: 0,
      total: 10,
      started_at: new Date("2026-01-01T12:00:00.000Z").toISOString(),
    });

    expect(jobRemainingTimeLabel(job, Date.parse("2026-01-01T12:00:30.000Z"))).toBe(
      "Estimating...",
    );
  });

  it("returns null for completed jobs", () => {
    expect(
      jobRemainingTimeLabel(makeJob({ status: "completed", processed: 10, total: 10 })),
    ).toBeNull();
  });
});

describe("statusLabel", () => {
  it("uses a short running label without the current file name", () => {
    const job = makeJob({ status: "running", current_name: "very-long-image-filename.png" });
    expect(statusLabel(job)).toBe("Running");
  });
});

describe("selectFolderJob", () => {
  it("prefers an active job over an older cancelled job for the same folder", () => {
    const folder = "C:\\Photos\\Dataset";
    const cancelled = makeJob({
      id: "job-cancelled",
      folder,
      status: "cancelled",
      processed: 5,
      total: 10,
      created_at: "2026-01-01T12:00:00.000Z",
    });
    const running = makeJob({
      id: "job-running",
      folder,
      status: "running",
      processed: 0,
      total: 10,
      created_at: "2026-01-01T12:05:00.000Z",
    });

    expect(selectFolderJob([cancelled, running], folder)).toBe(running);
    expect(selectFolderJob([running, cancelled], folder)).toBe(running);
  });

  it("returns the newest terminal job when no active job exists", () => {
    const folder = "C:\\Photos\\Dataset";
    const older = makeJob({
      id: "job-old",
      folder,
      status: "cancelled",
      processed: 2,
      total: 8,
      created_at: "2026-01-01T12:00:00.000Z",
    });
    const newer = makeJob({
      id: "job-new",
      folder,
      status: "completed",
      processed: 8,
      total: 8,
      created_at: "2026-01-01T13:00:00.000Z",
    });

    expect(selectFolderJob([older, newer], folder)).toBe(newer);
  });
});

describe("missing caption warnings", () => {
  it("flags completed jobs that skipped images without caption sidecars", () => {
    const job = makeJob({
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 2, no_txt: 1 },
    });

    expect(jobShowsWarningState(job)).toBe(true);
    expect(statusLabel(job)).toBe("Warnings");
    expect(jobStatusTone(job)).toBe("warning");
    expect(jobWarningMessage(job)).toBe("1 file had no caption sidecar (.txt) and was skipped.");
  });

  it("pluralizes the missing-caption warning", () => {
    const job = makeJob({
      status: "completed",
      processed: 5,
      total: 5,
      stats: { success: 2, no_txt: 3 },
    });

    expect(jobWarningMessage(job)).toBe("3 files had no caption sidecar (.txt) and were skipped.");
  });

  it("does not warn when every image was captioned", () => {
    const job = makeJob({
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 2 },
    });

    expect(jobShowsWarningState(job)).toBe(false);
    expect(statusLabel(job)).toBe("Completed");
  });
});

describe("verify captions jobs", () => {
  it("labels verify captions jobs and treats parse errors as failures", () => {
    const job = makeJob({
      job_type: "verify_captions",
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 1, parse_error: 1 },
    });

    expect(statusLabel(job)).toBe("Failed");
    expect(jobShowsWarningState(job)).toBe(false);
  });

  it("displays backend-provided failure messages without reconstructing them", () => {
    const backendError =
      "26 files had model responses that were not valid JSON. The model server may be running, but the vision model did not follow the required JSON output format.";
    const job = makeJob({
      job_type: "verify_captions",
      status: "failed",
      processed: 84,
      total: 84,
      stats: { success: 58, parse_error: 26 },
      error: backendError,
    });

    expect(jobErrorMessage(job)).toBe(backendError);
  });

  it("warns when verify captions skipped files without txt sidecars", () => {
    const job = makeJob({
      job_type: "verify_captions",
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 1, no_txt: 1 },
    });

    expect(jobShowsWarningState(job)).toBe(true);
    expect(jobWarningMessage(job)).toBe("1 file had no caption sidecar (.txt) and was skipped.");
  });
});

describe("jobCompletionNotification", () => {
  it("returns null for active jobs", () => {
    expect(jobCompletionNotification(makeJob({ status: "running" }))).toBeNull();
  });

  it("returns a success notification for a clean completion", () => {
    expect(
      jobCompletionNotification(makeJob({ status: "completed", processed: 5, total: 5 })),
    ).toEqual({
      variant: "success",
      message: 'Auto-caption completed in "Photos".',
    });
  });

  it("returns a warning notification when a job finishes with warnings", () => {
    expect(
      jobCompletionNotification(
        makeJob({
          job_type: "verify_captions",
          status: "completed",
          processed: 2,
          total: 2,
          stats: { success: 1, no_txt: 1 },
        }),
      ),
    ).toEqual({
      variant: "warning",
      message:
        'Verify captions finished with warnings in "Photos": 1 file had no caption sidecar (.txt) and was skipped.',
    });
  });

  it("returns a danger notification when a job fails", () => {
    expect(
      jobCompletionNotification(
        makeJob({
          status: "failed",
          error: "Model server unavailable",
        }),
      ),
    ).toEqual({
      variant: "danger",
      message: 'Auto-caption failed in "Photos": Model server unavailable',
    });
  });

  it("returns a warning notification when a job is cancelled", () => {
    expect(
      jobCompletionNotification(makeJob({ status: "cancelled", processed: 2, total: 10 })),
    ).toEqual({
      variant: "warning",
      message: 'Auto-caption cancelled in "Photos".',
    });
  });
});

describe("cancelled presentation", () => {
  it("identifies cancelled jobs and uses the warning tone", () => {
    expect(jobIsCancelled(makeJob({ status: "cancelled" }))).toBe(true);
    expect(jobIsCancelled(makeJob({ status: "completed" }))).toBe(false);
    expect(statusTone("cancelled")).toBe("warning");
    expect(jobStatusTone(makeJob({ status: "cancelled" }))).toBe("warning");
  });
});
