import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExternalOstrisJob } from "@/shared/types";
import { ExternalJobCard } from "./ExternalJobCard";

const runningJob: ExternalOstrisJob = {
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

const queuedJob: ExternalOstrisJob = { ...runningJob, status: "queued", step: 0 };

function badgeIcon(container: HTMLElement) {
  return container.querySelector(".job-card__badge-icon");
}

describe("ExternalJobCard", () => {
  it("spins the badge while the run is training", () => {
    const { container } = render(<ExternalJobCard job={runningJob} />);

    expect(badgeIcon(container)).toHaveClass("job-card__badge-icon--spin");
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows a still badge while the run only waits in the queue", () => {
    const { container } = render(<ExternalJobCard job={queuedJob} />);

    expect(badgeIcon(container)).not.toHaveClass("job-card__badge-icon--spin");
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });

  it("spins again once a stop is in flight for a queued run", () => {
    const { container } = render(<ExternalJobCard job={queuedJob} onStop={vi.fn()} stopping />);

    expect(badgeIcon(container)).toHaveClass("job-card__badge-icon--spin");
  });
});
