import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { fetchJobResults } from "@/features/jobs/api/jobs";
import type { Job } from "@/shared/types";
import { JobCard } from "./JobCard";

vi.mock("@/features/jobs/api/externalJobs", () => ({
  fetchOstrisTrainingSamples: vi.fn(),
}));

vi.mock("@/features/jobs/api/jobs", () => ({
  fetchJobResults: vi.fn(),
}));

const fetchSamples = vi.mocked(fetchOstrisTrainingSamples);
const fetchResults = vi.mocked(fetchJobResults);

const runningJob: Job = {
  id: "job-1",
  folder: "C:\\Photos",
  folder_name: "Photos",
  job_type: "auto_caption",
  status: "running",
  total: 10,
  processed: 3,
  current_file: null,
  current_name: null,
  stats: {},
  error: null,
  created_at: "2026-01-01T00:00:00Z",
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
  it("shows a spinner on the cancel button while cancellation is in flight", () => {
    const { container } = render(<JobCard job={runningJob} onCancel={vi.fn()} cancelling />);

    const cancelButton = screen.getByRole("button", { name: "Cancel job for Photos" });
    expect(cancelButton).toBeDisabled();
    expect(container.querySelector(".job-card__cancel-icon--spin")).toBeInTheDocument();
  });

  it("shows how long a finished job took where the estimate used to be", () => {
    const cancelledJob: Job = {
      ...runningJob,
      status: "cancelled",
      started_at: "2026-01-01T00:00:00Z",
      finished_at: "2026-01-01T00:01:15Z",
    };

    const { container } = render(<JobCard job={cancelledJob} />);

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
      total: 1000,
      processed: 1000,
    };

    const { container } = render(<JobCard job={finishedTrainingJob} />);

    expect(await screen.findByAltText("a mountain lake at sunrise")).toBeInTheDocument();
    expect(container.querySelector(".training-samples--compact")).toBeInTheDocument();
    expect(fetchSamples).not.toHaveBeenCalled();
  });

  it("shows no samples strip for other job types", () => {
    const { container } = render(<JobCard job={runningJob} />);

    expect(container.querySelector(".training-samples")).not.toBeInTheDocument();
    expect(fetchSamples).not.toHaveBeenCalled();
  });
});
