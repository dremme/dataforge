import { describe, expect, it } from "vitest";
import type { Job } from "@/shared/types";
import {
  classifyProcessedBatch,
  createJobTimingTracker,
  formatDuration,
  formatElapsed,
  isTrainLoraCoTrackedByExternal,
  jobCompletionNotification,
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

  it("evicts the previous job for the same folder and type, as the server does", () => {
    const previous = makeJob({ id: "job-1", job_type: "auto_caption", status: "completed" });
    const other = makeJob({ id: "job-2", job_type: "strip_metadata" });
    const replacement = makeJob({ id: "job-3", job_type: "auto_caption" });

    const merged = upsertJob([previous, other], replacement);

    expect(merged.map((job) => job.id)).toEqual(["job-3", "job-2"]);
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

describe("missing caption warnings", () => {
  it("flags completed jobs that skipped images without caption sidecars", () => {
    const job = makeJob({
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 2, no_caption: 1 },
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
      stats: { success: 2, no_caption: 3 },
    });

    expect(jobWarningMessage(job)).toBe("3 files had no caption sidecar (.txt) and were skipped.");
  });
});

describe("edit captions jobs", () => {
  function editJob(stats: Record<string, number>) {
    return makeJob({
      job_type: "edit_captions",
      status: "completed",
      processed: 10,
      total: 10,
      stats,
    });
  }

  it("warns rather than fails when captions came back unusable", () => {
    // The captions on disk are untouched, so this is the safe path working.
    const job = editJob({ success: 8, rejected: 2 });

    expect(statusLabel(job)).toBe("Warnings");
    expect(jobShowsWarningState(job)).toBe(true);
    expect(jobStatusTone(job)).toBe("warning");
    expect(jobWarningMessage(job)).toBe(
      "2 captions came back in a form the job would not write, and were left unchanged.",
    );
  });

  it("reads a single rejection as one", () => {
    expect(jobWarningMessage(editJob({ success: 9, rejected: 1 }))).toBe(
      "1 caption came back in a form the job would not write, and was left unchanged.",
    );
  });

  it("reports a missing caption and an unusable one side by side", () => {
    const message = jobWarningMessage(editJob({ success: 7, rejected: 2, no_caption: 1 }));

    expect(message).toContain("no caption sidecar");
    expect(message).toContain("would not write");
  });

  it("stays quiet when every caption was edited or left alone", () => {
    const job = editJob({ success: 7, unchanged: 3 });

    expect(jobShowsWarningState(job)).toBe(false);
    expect(jobWarningMessage(job)).toBeNull();
  });

  it("still fails on a model request error", () => {
    // Only the model being unreachable is a failure; a rejected caption is not.
    const job = editJob({ success: 9, api_error: 1 });

    expect(statusLabel(job)).toBe("Failed");
    expect(jobStatusTone(job)).toBe("danger");
  });
});

describe("caption backup and restore jobs", () => {
  it("does not warn about media that had no caption to back up", () => {
    const job = makeJob({
      job_type: "backup_captions",
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 2, sidecars: 3, skipped: 1 },
    });

    expect(jobShowsWarningState(job)).toBe(false);
    expect(jobWarningMessage(job)).toBeNull();
  });

  it("warns when a restored caption had no matching media file", () => {
    const job = makeJob({
      job_type: "restore_captions",
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 2, orphaned: 1 },
    });

    expect(jobShowsWarningState(job)).toBe(true);
    expect(jobWarningMessage(job)).toBe(
      "1 backed up caption had no matching media file and was skipped.",
    );
  });

  it("pluralizes the orphaned-caption warning", () => {
    const job = makeJob({
      job_type: "restore_captions",
      status: "completed",
      processed: 5,
      total: 5,
      stats: { success: 2, orphaned: 3 },
    });

    expect(jobWarningMessage(job)).toBe(
      "3 backed up captions had no matching media file and were skipped.",
    );
  });

  it("does not warn when every backed up caption was restored", () => {
    const job = makeJob({
      job_type: "restore_captions",
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 3, orphaned: 0 },
    });

    expect(jobShowsWarningState(job)).toBe(false);
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

describe("watermark jobs", () => {
  it("does not inherit the missing-caption warning", () => {
    const job = makeJob({
      job_type: "watermark",
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 3, image_success: 3, no_caption: 2 },
    });

    expect(jobShowsWarningState(job)).toBe(false);
    expect(jobWarningMessage(job)).toBeNull();
  });

  it("estimates from the videos, not the images", () => {
    const startedAt = new Date("2026-01-01T12:00:00.000Z").toISOString();
    const job = makeJob({
      job_type: "watermark",
      status: "running",
      processed: 9,
      total: 10,
      started_at: startedAt,
      // Eight images took no time; the one remaining file is another video.
      stats: { success: 9, image_success: 8, video_success: 1 },
    });

    const nowMs = Date.parse("2026-01-01T12:01:02.000Z");
    expect(jobRemainingSeconds(job, nowMs)).toBe(60);
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

  it("treats frame errors as failures for verify captions", () => {
    const job = makeJob({
      job_type: "verify_captions",
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 1, frame_error: 1 },
    });

    expect(statusLabel(job)).toBe("Failed");
  });

  it("treats media that never decoded as an auto-caption failure", () => {
    const job = makeJob({
      job_type: "auto_caption",
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 1, frame_error: 1 },
    });

    expect(statusLabel(job)).toBe("Failed");
  });

  it("warns when verify captions skipped files without txt sidecars", () => {
    const job = makeJob({
      job_type: "verify_captions",
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 1, no_caption: 1 },
    });

    expect(jobShowsWarningState(job)).toBe(true);
    expect(jobWarningMessage(job)).toBe("1 file had no caption sidecar (.txt) and was skipped.");
  });

  it("warns when clips carried no audio but were captioned anyway", () => {
    const job = makeJob({
      job_type: "auto_caption",
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 3, audio_error: 3 },
    });

    expect(jobShowsErrorState(job)).toBe(false);
    expect(statusLabel(job)).toBe("Warnings");
    expect(jobWarningMessage(job)).toBe(
      "3 videos had no audio track and were captioned without them.",
    );
  });

  it("uses the singular for a lone silent clip", () => {
    const job = makeJob({
      job_type: "auto_caption",
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 2, audio_error: 1 },
    });

    expect(jobWarningMessage(job)).toBe("1 video had no audio track and was captioned without it.");
  });

  it("reports a missing sidecar and missing audio together", () => {
    const job = makeJob({
      job_type: "auto_caption",
      status: "completed",
      processed: 3,
      total: 3,
      stats: { success: 1, no_caption: 1, audio_error: 1 },
    });

    expect(jobWarningMessage(job)).toBe(
      "1 file had no caption sidecar (.txt) and was skipped. " +
        "1 video had no audio track and was captioned without it.",
    );
  });

  it("keeps a real failure red even when clips were also silent", () => {
    const job = makeJob({
      job_type: "auto_caption",
      status: "completed",
      processed: 2,
      total: 2,
      stats: { success: 1, frame_error: 1, audio_error: 1 },
    });

    expect(statusLabel(job)).toBe("Failed");
    expect(jobShowsWarningState(job)).toBe(false);
  });

  it("never warns about audio for verify captions", () => {
    const job = makeJob({
      job_type: "verify_captions",
      status: "completed",
      processed: 1,
      total: 1,
      stats: { success: 1, audio_error: 1 },
    });

    expect(jobShowsWarningState(job)).toBe(false);
    expect(statusLabel(job)).toBe("Completed");
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
          stats: { success: 1, no_caption: 1 },
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
