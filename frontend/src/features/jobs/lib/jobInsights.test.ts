import { describe, expect, it } from "vitest";
import { job } from "@/test/fixtures";
import {
  groupJobsForDrawer,
  jobHeadline,
  jobOutcomeMix,
  jobThroughputLabel,
  jobWhenLabel,
  jobWorkflow,
} from "./jobInsights";

const finished = (options: Parameters<typeof job>[0] = {}) =>
  job({
    status: "completed",
    started_at: "2026-03-10T10:00:00.000Z",
    finished_at: "2026-03-10T10:01:40.000Z",
    ...options,
  });

describe("jobOutcomeMix", () => {
  it("counts a clean run as all done", () => {
    expect(jobOutcomeMix(finished({ total: 5, processed: 5, stats: { success: 5 } }))).toEqual({
      done: 5,
      skipped: 0,
      failed: 0,
      notRun: 0,
    });
  });

  it("splits failures and skips out of the processed files", () => {
    const mixed = finished({
      total: 10,
      processed: 10,
      stats: { success: 6, skipped_long: 1, no_caption: 1, api_error: 2 },
    });

    expect(jobOutcomeMix(mixed)).toEqual({ done: 6, skipped: 2, failed: 2, notRun: 0 });
  });

  it("does not count sub-stats of success twice", () => {
    const adjusted = finished({
      job_type: "auto_adjust",
      total: 4,
      processed: 4,
      stats: { success: 4, image_success: 3, video_success: 1 },
    });

    expect(jobOutcomeMix(adjusted)?.done).toBe(4);
  });

  it("does not count the file a cancel interrupted as done", () => {
    // Four files finished; the fifth was interrupted and counted as processed.
    const cancelled = finished({
      status: "cancelled",
      total: 10,
      processed: 5,
      stats: { success: 4, cancelled: 6 },
    });

    expect(jobOutcomeMix(cancelled)).toEqual({ done: 4, skipped: 0, failed: 0, notRun: 6 });
  });

  it("reports nothing for a run that failed before reaching a file", () => {
    expect(jobOutcomeMix(finished({ status: "failed", total: 10, processed: 0 }))).toBeNull();
  });

  it("reports nothing for running jobs or training steps", () => {
    expect(jobOutcomeMix(job({ status: "running", total: 5, processed: 2 }))).toBeNull();
    expect(
      jobOutcomeMix(finished({ job_type: "train_lora", total: 1000, processed: 1000 })),
    ).toBeNull();
  });
});

describe("jobHeadline", () => {
  it("names the duplicates a scan found", () => {
    expect(
      jobHeadline(finished({ job_type: "find_duplicates", stats: { duplicate: 12, group: 5 } })),
    ).toBe("12 duplicates in 5 groups");
    expect(jobHeadline(finished({ job_type: "find_duplicates", stats: {} }))).toBe(
      "No duplicates found",
    );
  });

  it("names the captions a check flagged", () => {
    expect(jobHeadline(finished({ job_type: "verify_captions", stats: { issues_found: 1 } }))).toBe(
      "1 caption flagged",
    );
    expect(jobHeadline(finished({ job_type: "check_caption_rules", stats: {} }))).toBe(
      "No caption issues found",
    );
  });

  it("claims a clean result only for a scan that completed", () => {
    for (const status of ["failed", "cancelled", "interrupted"] as const) {
      expect(jobHeadline(finished({ status, job_type: "find_duplicates", stats: {} }))).toBeNull();
      expect(jobHeadline(finished({ status, job_type: "verify_captions", stats: {} }))).toBeNull();
    }
    expect(
      jobHeadline(
        finished({ status: "cancelled", job_type: "verify_captions", stats: { issues_found: 2 } }),
      ),
    ).toBe("2 captions flagged");
  });

  it("says nothing for types whose mix already tells the story", () => {
    expect(jobHeadline(finished({ stats: { success: 3 } }))).toBeNull();
  });
});

describe("jobThroughputLabel", () => {
  it("divides the wall clock by the files processed", () => {
    expect(jobThroughputLabel(finished({ processed: 40 }))).toBe("2.5 s/file");
    expect(jobThroughputLabel(finished({ processed: 4 }))).toBe("25 s/file");
    expect(jobThroughputLabel(finished({ processed: 400 }))).toBe("4 files/s");
  });

  it("uses training's own step speed", () => {
    expect(
      jobThroughputLabel(
        finished({ job_type: "train_lora", processed: 1000, stats: { speed_ms_per_step: 1240 } }),
      ),
    ).toBe("1.2 s/step");
  });

  it("stays quiet for a single file or a running job", () => {
    expect(jobThroughputLabel(finished({ processed: 1 }))).toBeNull();
    expect(jobThroughputLabel(job({ status: "running", processed: 40 }))).toBeNull();
  });
});

describe("jobWorkflow", () => {
  it("names the ComfyUI preset a run used", () => {
    expect(jobWorkflow(job({ job_type: "comfy_process", workflow: "upscale_2x" }))).toEqual({
      kind: "Workflow",
      name: "upscale_2x",
      edited: false,
    });
  });

  it("names a training run's template by its model, and says when it was edited", () => {
    const training = job({ job_type: "train_lora", workflow: "qwen_image_2" });

    expect(jobWorkflow(training)).toEqual({
      kind: "Template",
      name: "Qwen Image 2.1",
      edited: false,
    });
    expect(jobWorkflow({ ...training, workflow_edited: true })?.edited).toBe(true);
  });

  it("says nothing for runs from before the field existed or other job types", () => {
    expect(jobWorkflow(job({ job_type: "comfy_process" }))).toBeNull();
    expect(jobWorkflow(job({ workflow: "stray" }))).toBeNull();
  });
});

describe("jobWhenLabel", () => {
  const now = Date.parse("2026-03-10T10:05:00.000Z");

  it("says when a finished job finished, and when a running one started", () => {
    expect(jobWhenLabel(finished(), now)?.label).toBe("Finished 3 minutes ago");
    expect(
      jobWhenLabel(job({ status: "running", started_at: "2026-03-10T10:04:30.000Z" }), now)?.label,
    ).toBe("Started just now");
    expect(jobWhenLabel(job({ created_at: "2026-03-10T09:05:00.000Z" }), now)?.label).toBe(
      "Queued 1 hour ago",
    );
  });
});

describe("groupJobsForDrawer", () => {
  const now = new Date(2026, 2, 10, 15, 0).getTime();
  const at = (day: number, hour: number) => new Date(2026, 2, day, hour, 0).toISOString();

  it("puts running, then new, then finished jobs by day", () => {
    const running = job({ id: "running", status: "running" });
    const unseen = finished({ id: "unseen", finished_at: at(10, 14) });
    const today = finished({ id: "today", finished_at: at(10, 9) });
    const lateYesterday = finished({ id: "yesterday", finished_at: at(9, 23) });
    const earlier = finished({ id: "earlier", finished_at: at(8, 23) });
    const seenAt = new Date(2026, 2, 10, 12, 0).getTime();

    const sections = groupJobsForDrawer(
      [unseen, running, earlier, today, lateYesterday],
      seenAt,
      now,
    );

    expect(sections.map((section) => [section.label, section.jobs.map((item) => item.id)])).toEqual(
      [
        ["Running", ["running"]],
        ["New", ["unseen"]],
        ["Today", ["today"]],
        ["Yesterday", ["yesterday"]],
        ["Earlier", ["earlier"]],
      ],
    );
  });

  it("dates a job without a finish time by when it was created", () => {
    const interrupted = job({ status: "interrupted", created_at: at(9, 8), finished_at: null });

    expect(groupJobsForDrawer([interrupted], now, now).map((section) => section.id)).toEqual([
      "yesterday",
    ]);
  });
});
