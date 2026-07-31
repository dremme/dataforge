import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExternalOstrisJob, Job } from "@/shared/types";
import { JobsDrawer } from "./JobsDrawer";

const trainingJob: Job = {
  id: "job-1",
  folder: "C:\\datasets\\landscapes",
  folder_name: "landscapes",
  job_type: "train_lora",
  external_ref: "sample_train_v1",
  status: "running",
  total: 1000,
  processed: 500,
  stats: { step: 500 },
  results: [],
  created_at: "2026-01-01T00:00:00.000Z",
  started_at: "2026-01-01T00:00:01.000Z",
};

const captionJob: Job = {
  ...trainingJob,
  id: "job-2",
  job_type: "auto_caption",
  external_ref: null,
  total: 10,
  processed: 3,
  stats: {},
};

const externalJob: ExternalOstrisJob = {
  id: "ostris-1",
  name: "sample_train_v1",
  status: "running",
  step: 500,
  total_steps: 1000,
  info: "Training",
  speed_string: "2.15 sec/iter",
  job_type: "train",
  dataset_folder: "C:\\datasets\\landscapes",
  dataset_folder_name: "landscapes",
  model: "krea/Krea-2-Turbo",
  created_at: "2026-01-01T00:00:00.000Z",
  save_now: false,
  stop_requested: false,
};

const jobsContext = {
  jobs: [] as Job[],
  externalJobs: [] as ExternalOstrisJob[],
  drawerOpen: true,
  closeDrawer: vi.fn(),
  cancelJob: vi.fn(),
  cancellingJobId: null,
  stoppingOstrisJobId: null,
  stopExternalOstrisJob: vi.fn(),
  deleteJob: vi.fn(),
  deleteAllJobs: vi.fn(),
};

vi.mock("@/features/jobs/context/JobsContext", () => ({
  useJobs: () => jobsContext,
}));

function renderDrawer(jobs: Job[], externalJobs: ExternalOstrisJob[] = []) {
  jobsContext.jobs = jobs;
  jobsContext.externalJobs = externalJobs;
  return render(<JobsDrawer currentFolder="C:\\datasets\\landscapes" onOpenFolder={vi.fn()} />);
}

describe("JobsDrawer", () => {
  it("shows a co-tracked training run only as an external card, never twice", () => {
    const { baseElement } = renderDrawer([trainingJob], [externalJob]);

    expect(screen.getByLabelText("external job sample_train_v1")).toBeInTheDocument();
    expect(screen.queryByLabelText("DataForge jobs")).not.toBeInTheDocument();
    expect(baseElement.querySelectorAll(".job-card")).toHaveLength(1);
  });

  it("still lists other job types in the DataForge section", () => {
    renderDrawer([trainingJob, captionJob], [externalJob]);

    const local = screen.getByLabelText("DataForge jobs");
    expect(local.querySelectorAll(".job-card")).toHaveLength(1);
    expect(within(local).getByLabelText("Auto-caption job for landscapes")).toBeInTheDocument();
  });

  it("keeps a finished training job visible after Ostris drops it", () => {
    const finished: Job = { ...trainingJob, status: "completed", processed: 1000 };

    renderDrawer([finished], []);

    expect(screen.getByLabelText("LoRA training job for landscapes")).toBeInTheDocument();
    expect(screen.queryByText("No background jobs yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete all jobs" })).toBeInTheDocument();
  });

  it("shows a training job when Ostris has not listed the run yet", () => {
    renderDrawer([trainingJob], []);

    expect(screen.getByLabelText("LoRA training job for landscapes")).toBeInTheDocument();
  });
});
