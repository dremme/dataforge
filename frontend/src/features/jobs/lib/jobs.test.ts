import { describe, expect, it } from "vitest";
import type { Job } from "@/shared/types";
import {
  classifyProcessedBatch,
  createJobTimingTracker,
  jobTimingCounts,
  formatDuration,
  formatElapsed,
  isTrainLoraCoTrackedByExternal,
  jobElapsedSeconds,
  jobErrorMessage,
  jobIcon,
  jobIsCancelled,
  jobRemainingSeconds,
  jobRemainingTimeLabel,
  jobShowsErrorState,
  jobShowsWarningState,
  jobStatusTone,
  jobTimeLabel,
  jobTypeLabel,
  jobTypeOf,
  jobWarningMessage,
  progressPercent,
  selectFolderJob,
  statusLabel,
  statusTone,
  updateJobTimingTracker,
  upsertJob,
} from "./jobs";
import type { ExternalOstrisJob } from "@/shared/types";
import { job } from "@/test/fixtures";
import { iconCircleQuestionMark, iconSparkles } from "@/shared/icons";

function makeJob(overrides: Partial<Job> = {}): Job {
  return job({
    status: "running",
    total: 10,
    current_name: null,
    error: null,
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  });
}

describe("upsertJob", () => {
  it("replaces a known job in place so the server's ordering survives", () => {
    const first = makeJob({ id: "job-1" });
    const second = makeJob({ id: "job-2", folder: "C:\\Other" });
    const updated = makeJob({ id: "job-2", folder: "C:\\Other", processed: 7 });

    const merged = upsertJob([first, second], updated);

    expect(merged.map((job) => job.id)).toEqual(["job-1", "job-2"]);
    expect(merged[1].processed).toBe(7);
  });

  it("puts an unseen job at the front", () => {
    const existing = makeJob({ id: "job-1", folder: "C:\\Other" });
    const fresh = makeJob({ id: "job-2" });

    expect(upsertJob([existing], fresh).map((job) => job.id)).toEqual(["job-2", "job-1"]);
  });

  it("keeps the previous run for the same folder and type, as the server does", () => {
    const previous = makeJob({ id: "job-1", job_type: "auto_caption", status: "completed" });
    const other = makeJob({ id: "job-2", job_type: "strip_metadata" });
    const rerun = makeJob({ id: "job-3", job_type: "auto_caption" });

    const merged = upsertJob([previous, other], rerun);

    expect(merged.map((job) => job.id)).toEqual(["job-3", "job-1", "job-2"]);
  });
});

describe("job type display", () => {
  it("uses registry metadata for known job types", () => {
    const job = makeJob({ job_type: "auto_caption" });
    expect(jobTypeOf(job)).toBe("auto_caption");
    expect(jobTypeLabel(job)).toBe("Auto-caption");
    expect(jobIcon(job)).toBe(iconSparkles);
  });

  it("tolerates a job type retired since the row was written", () => {
    const retired = makeJob({ job_type: "legacy_job" as Job["job_type"] });
    expect(jobTypeOf(retired)).toBe("auto_caption");
    expect(jobTypeLabel(retired)).toBe("legacy_job");
    expect(jobIcon(retired)).toBe(iconCircleQuestionMark);
  });
});

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

  it("carries rounded-up minutes into hours instead of reporting 60 min", () => {
    expect(formatDuration(3540)).toBe("59 min");
    expect(formatDuration(3599)).toBe("1 hr");
    expect(formatDuration(3600)).toBe("1 hr");
    expect(formatDuration(7199)).toBe("2 hr");
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

  it.each([
    "check_caption_rules",
    "backup_captions",
    "restore_captions",
    "set_captions",
    "batch_rename",
    "replace_captions",
    "find_duplicates",
  ] as const)("estimates %s from its steady per-file rate", (jobType) => {
    const job = makeJob({
      job_type: jobType,
      processed: 4,
      total: 10,
      started_at: "2026-01-01T12:00:00.000Z",
      stats: { success: 4, issues_found: 1 },
    });
    const tracker = { ...createJobTimingTracker(job.id), slowItems: 0, recentFastStreak: 4 };
    const nowMs = Date.parse("2026-01-01T12:00:20.000Z");

    expect(jobRemainingSeconds(job, nowMs)).toBe(30);
    expect(jobRemainingSeconds(job, nowMs, tracker)).toBe(30);
    expect(jobRemainingTimeLabel(job, nowMs)).toBe("~30s left");
  });

  it.each([
    [
      "strip_metadata",
      { success: 3, image_success: 2, video_success: 1, read_error: 1, cancelled: 4 },
      { slow: 1, fast: 3 },
    ],
    [
      "watermark",
      { success: 3, image_success: 2, video_success: 1, ffmpeg_error: 1, write_error: 1 },
      { slow: 2, fast: 3 },
    ],
    [
      "comfy_process",
      { success: 2, comfy_error: 1, write_error: 1, skipped: 3, read_error: 1 },
      { slow: 4, fast: 4 },
    ],
    [
      "verify_captions",
      { success: 2, issues_found: 1, api_error: 1, parse_error: 1, no_caption: 2 },
      { slow: 4, fast: 2 },
    ],
    [
      "auto_caption",
      { success: 2, too_short: 1, frame_error: 1, skipped_long: 1, no_caption: 1 },
      { slow: 4, fast: 2 },
    ],
    [
      "edit_captions",
      { success: 1, unchanged: 1, rejected: 1, api_error: 1, no_caption: 2 },
      { slow: 4, fast: 2 },
    ],
  ] as const)("splits %s into slow and fast files", (jobType, stats, expected) => {
    expect(jobTimingCounts(makeJob({ job_type: jobType, stats }))).toEqual(expected);
  });

  it("estimates an images-only watermark before any video has finished", () => {
    const job = makeJob({
      job_type: "watermark",
      processed: 4,
      total: 10,
      started_at: "2026-01-01T12:00:00.000Z",
      stats: { success: 4, image_success: 4 },
    });

    expect(jobRemainingSeconds(job, Date.parse("2026-01-01T12:00:08.000Z"))).toBe(12);
  });

  it("keeps estimating while a model job has only skipped files behind it", () => {
    const job = makeJob({
      job_type: "auto_caption",
      processed: 4,
      total: 10,
      started_at: "2026-01-01T12:00:00.000Z",
      stats: { skipped_long: 4 },
    });

    expect(jobRemainingTimeLabel(job, Date.parse("2026-01-01T12:00:08.000Z"))).toBe(
      "Estimating...",
    );
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

describe("elapsed time", () => {
  it("formats elapsed durations without rounding a run up to the next minute", () => {
    expect(formatElapsed(0.2)).toBe("<1s");
    expect(formatElapsed(45)).toBe("45s");
    expect(formatElapsed(65)).toBe("1 min 5s");
    expect(formatElapsed(120)).toBe("2 min");
    expect(formatElapsed(3599)).toBe("59 min 59s");
    expect(formatElapsed(3600)).toBe("1 hr");
    expect(formatElapsed(3720)).toBe("1 hr 2 min");
  });

  it("reports how long a completed job took", () => {
    const job = makeJob({
      status: "completed",
      processed: 10,
      total: 10,
      started_at: "2026-01-01T12:00:00.000Z",
      finished_at: "2026-01-01T12:02:30.000Z",
    });

    expect(jobElapsedSeconds(job)).toBe(150);
    expect(jobTimeLabel(job)).toBe("Took 2 min 30s");
  });

  it("reports elapsed time for cancelled and failed jobs too", () => {
    const cancelled = makeJob({
      status: "cancelled",
      processed: 4,
      started_at: "2026-01-01T12:00:00.000Z",
      finished_at: "2026-01-01T12:00:20.000Z",
    });
    const failed = makeJob({
      status: "failed",
      processed: 1,
      error: "boom",
      started_at: "2026-01-01T12:00:00.000Z",
      finished_at: "2026-01-01T12:00:05.000Z",
    });

    expect(jobTimeLabel(cancelled)).toBe("Took 20s");
    expect(jobTimeLabel(failed)).toBe("Took 5s");
  });

  it("falls back to created_at when a job was cancelled before it started", () => {
    const job = makeJob({
      status: "cancelled",
      processed: 0,
      created_at: "2026-01-01T12:00:00.000Z",
      started_at: null,
      finished_at: "2026-01-01T12:00:03.000Z",
    });

    expect(jobTimeLabel(job)).toBe("Took 3s");
  });

  it("reads zone-less timestamps written by the interrupted-job fallback as UTC", () => {
    const job = makeJob({
      status: "interrupted",
      processed: 2,
      started_at: "2026-01-01 12:00:00",
      finished_at: "2026-01-01 12:00:42",
    });

    expect(jobTimeLabel(job)).toBe("Took 42s");
  });

  it("shows nothing when a finished job has no timestamps to measure", () => {
    expect(jobTimeLabel(makeJob({ status: "completed", finished_at: null }))).toBeNull();
  });

  it("keeps showing the estimate while a job is still running", () => {
    const job = makeJob({
      status: "running",
      processed: 2,
      total: 10,
      started_at: "2026-01-01T12:00:00.000Z",
      stats: { success: 2 },
    });

    expect(jobTimeLabel(job, Date.parse("2026-01-01T12:01:00.000Z"))).toBe("~4 min left");
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

describe("job severity presentation", () => {
  it("reads the warning the server composed rather than re-deriving one", () => {
    const job = makeJob({
      status: "completed",
      effective_status: "completed",
      warning: "1 file had no caption sidecar (.txt) and was skipped.",
    });

    expect(jobShowsWarningState(job)).toBe(true);
    expect(jobWarningMessage(job)).toBe("1 file had no caption sidecar (.txt) and was skipped.");
    expect(statusLabel(job)).toBe("Warnings");
    expect(jobStatusTone(job)).toBe("warning");
  });

  it("reads a clean completion as a success", () => {
    const job = makeJob({ status: "completed", effective_status: "completed" });

    expect(jobShowsWarningState(job)).toBe(false);
    expect(jobWarningMessage(job)).toBeNull();
    expect(statusLabel(job)).toBe("Completed");
    expect(jobStatusTone(job)).toBe("success");
  });

  it("follows the effective status when stats demoted a completed job", () => {
    const job = makeJob({
      status: "completed",
      effective_status: "failed",
      error: "Model server unavailable",
    });

    expect(jobShowsErrorState(job)).toBe(true);
    expect(jobErrorMessage(job)).toBe("Model server unavailable");
    expect(statusLabel(job)).toBe("Failed");
    expect(jobStatusTone(job)).toBe("danger");
  });

  it("treats an interrupted job as an error state", () => {
    expect(
      jobShowsErrorState(makeJob({ status: "interrupted", effective_status: "interrupted" })),
    ).toBe(true);
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

describe("isTrainLoraCoTrackedByExternal", () => {
  const trainingJob = makeJob({
    job_type: "train_lora",
    external_ref: "sample_train_v1",
    status: "running",
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

  it("matches a train_lora job to an Ostris run by external_ref name", () => {
    expect(isTrainLoraCoTrackedByExternal(trainingJob, [externalJob])).toBe(true);
    expect(
      isTrainLoraCoTrackedByExternal(trainingJob, [{ ...externalJob, name: "other_train" }]),
    ).toBe(false);
    expect(isTrainLoraCoTrackedByExternal(trainingJob, [])).toBe(false);
  });

  it("ignores non-training jobs and missing external refs", () => {
    expect(
      isTrainLoraCoTrackedByExternal(makeJob({ job_type: "auto_caption" }), [externalJob]),
    ).toBe(false);
    expect(
      isTrainLoraCoTrackedByExternal(makeJob({ job_type: "train_lora", external_ref: null }), [
        externalJob,
      ]),
    ).toBe(false);
  });
});

describe("train_lora remaining time", () => {
  it("uses Ostris sec/iter from stats with the same thresholds as the external card", () => {
    const job = makeJob({
      job_type: "train_lora",
      external_ref: "sample_train_v1",
      status: "running",
      processed: 100,
      total: 200,
      stats: { step: 100, total_steps: 200, speed_ms_per_step: 2000 },
      started_at: "2026-01-01T12:00:00.000Z",
    });

    // 100 steps left * 2s = 200s → ~4 min left (matches ExternalJobCard).
    expect(jobRemainingTimeLabel(job, Date.parse("2026-01-01T12:10:00.000Z"))).toBe("~4 min left");
  });

  it("shows under a minute left when less than 60 seconds remain at the Ostris rate", () => {
    const job = makeJob({
      job_type: "train_lora",
      status: "running",
      processed: 190,
      total: 200,
      stats: { speed_ms_per_step: 2000 },
      started_at: "2026-01-01T12:00:00.000Z",
    });

    expect(jobRemainingTimeLabel(job)).toBe("<1 min left");
  });
});
