import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Job } from "@/shared/types";
import { JobCard } from "./JobCard";

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
  results: [],
  error: null,
  created_at: "2026-01-01T00:00:00Z",
  started_at: "2026-01-01T00:00:01Z",
  finished_at: null,
};

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
});
