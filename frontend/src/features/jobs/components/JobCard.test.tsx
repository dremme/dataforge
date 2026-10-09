import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { fetchJobResults } from "@/features/jobs/api/jobs";
import { iconMessageCheck } from "@/shared/icons";
import type { Job } from "@/shared/types";
import { JobCard } from "./JobCard";
import { renderWithQueryClient } from "@/test/queryClient";

vi.mock("@/features/jobs/api/externalJobs", () => ({
  fetchOstrisTrainingSamples: vi.fn(),
}));

vi.mock("@/features/jobs/api/jobs", () => ({
  fetchJobResults: vi.fn(),
}));

const fetchSamples = vi.mocked(fetchOstrisTrainingSamples);
const fetchResults = vi.mocked(fetchJobResults);

const runningJob: Job = {
  workflow_edited: false,
  id: "job-1",
  folder: "C:\\Photos",
  folder_name: "Photos",
  job_type: "auto_caption",
  status: "running",
  effective_status: "running",
  total: 10,
  processed: 3,
  current_file: null,
  current_name: null,
  stats: {},
  error: null,
  created_at: "2026-01-01T00:00:00Z",
  revision: 1,
  started_at: "2026-01-01T00:00:01Z",
  finished_at: null,
};

beforeEach(() => {
  fetchSamples.mockResolvedValue({ samples: [], step: null, available: true });
  fetchResults.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("JobCard", () => {
  it.each(["queued", "running"] as const)("shows progress for a %s job", (status) => {
    renderWithQueryClient(<JobCard job={{ ...runningJob, status }} />);

    expect(screen.getByRole("progressbar", { name: "Progress for Photos" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
  });

  it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "hides progress when a running job becomes %s",
    (status) => {
      const { rerender } = renderWithQueryClient(<JobCard job={runningJob} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();

      rerender(<JobCard job={{ ...runningJob, status }} />);

      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.getByRole("figure", { name: "Outcome: 3 done" })).toBeInTheDocument();
    },
  );

  it("shows a spinner on the cancel button while cancellation is in flight", () => {
    const { container } = renderWithQueryClient(
      <JobCard job={runningJob} onCancel={vi.fn()} cancelling />,
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel job for Photos" });
    expect(cancelButton).toBeDisabled();
    expect(container.querySelector(".job-card__cancel-icon--spin")).toBeInTheDocument();
  });

  it("opens the job's folder", async () => {
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    renderWithQueryClient(<JobCard job={runningJob} onOpenFolder={onOpenFolder} />);

    await user.click(screen.getByTitle(`Open ${runningJob.folder}`));

    expect(onOpenFolder).toHaveBeenCalledExactlyOnceWith(runningJob.folder);
  });

  it("shows how long a finished job took where the estimate used to be", () => {
    const cancelledJob: Job = {
      ...runningJob,
      status: "cancelled",
      effective_status: "cancelled",
      started_at: "2026-01-01T00:00:00Z",
      finished_at: "2026-01-01T00:01:15Z",
    };

    const { container } = renderWithQueryClient(<JobCard job={cancelledJob} />);

    expect(container.querySelector(".job-card__remaining")).toHaveTextContent("Took 1 min 15s");
  });

  it("keeps showing a finished training run's samples", async () => {
    fetchResults.mockResolvedValue([
      {
        path: "C:\\AI-Toolkit\\output\\sample_train_v1\\samples\\1__000001000_0.jpg",
        name: "1__000001000_0.jpg",
        status: "sample",
        description: "a mountain lake at sunrise",
      },
    ]);

    const finishedTrainingJob: Job = {
      ...runningJob,
      job_type: "train_lora",
      external_ref: "sample_train_v1",
      status: "completed",
      effective_status: "completed",
      total: 1000,
      processed: 1000,
    };

    const { container } = renderWithQueryClient(<JobCard job={finishedTrainingJob} />);

    expect(await screen.findByAltText("a mountain lake at sunrise")).toBeInTheDocument();
    expect(container.querySelector(".training-samples--compact")).toBeInTheDocument();
    expect(fetchSamples).not.toHaveBeenCalled();
  });

  it("shows no samples strip for other job types", () => {
    const { container } = renderWithQueryClient(<JobCard job={runningJob} />);

    expect(container.querySelector(".training-samples")).not.toBeInTheDocument();
    expect(fetchSamples).not.toHaveBeenCalled();
  });

  it("says which workflow a ComfyUI run used, and which template a training run used", () => {
    const comfy: Job = { ...runningJob, job_type: "comfy_process", workflow: "upscale_2x" };
    const { rerender } = renderWithQueryClient(<JobCard job={comfy} />);

    expect(screen.getByText("Workflow")).toBeInTheDocument();
    expect(screen.getByText("upscale_2x")).toBeInTheDocument();

    rerender(
      <JobCard
        job={{
          ...runningJob,
          job_type: "train_lora",
          workflow: "krea2_turbo",
          workflow_edited: true,
        }}
      />,
    );
    expect(screen.getByText("Template")).toBeInTheDocument();
    expect(screen.getByText("Krea 2 Turbo")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("names the file it is working on", () => {
    renderWithQueryClient(<JobCard job={{ ...runningJob, current_name: "lake.png" }} />);

    expect(screen.getByText("3 of 10 files")).toBeInTheDocument();
    expect(screen.getByText("lake.png")).toBeInTheDocument();
  });

  it("breaks a finished run down by outcome without fetching its results", () => {
    const mixed: Job = {
      ...runningJob,
      status: "completed",
      effective_status: "completed",
      processed: 10,
      stats: { success: 6, skipped_long: 2, api_error: 2 },
      started_at: "2026-01-01T00:00:00Z",
      finished_at: "2026-01-01T00:00:25Z",
    };

    renderWithQueryClient(<JobCard job={mixed} />);

    expect(
      screen.getByRole("figure", { name: "Outcome: 6 done, 2 skipped, 2 failed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Took 25s")).toBeInTheDocument();
    expect(screen.getByText("2.5 s/file")).toBeInTheDocument();
    expect(fetchResults).not.toHaveBeenCalled();
  });

  it("says when it finished and flags a run nobody has seen yet", () => {
    const finished: Job = {
      ...runningJob,
      status: "completed",
      effective_status: "completed",
      finished_at: "2026-01-01T00:10:00Z",
    };

    renderWithQueryClient(
      <JobCard job={finished} isNew nowMs={Date.parse("2026-01-01T00:15:00Z")} />,
    );

    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Finished 5 minutes ago")).toBeInTheDocument();
  });

  it("offers the follow-ups it was given once the job has finished", async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    const followUps = [{ label: "Review 3 issues", icon: iconMessageCheck, onClick: onReview }];
    const finished: Job = { ...runningJob, status: "completed", effective_status: "completed" };

    const { rerender } = renderWithQueryClient(<JobCard job={runningJob} followUps={followUps} />);
    expect(screen.queryByRole("button", { name: "Review 3 issues" })).not.toBeInTheDocument();

    rerender(<JobCard job={finished} followUps={followUps} />);
    await user.click(screen.getByRole("button", { name: "Review 3 issues" }));

    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
