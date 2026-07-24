import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Job } from "../types";
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
});
