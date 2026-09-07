import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJobResults } from "@/features/jobs/api/jobs";
import type { Job, JobFileResult } from "@/shared/types";
import { JobFileResults } from "./JobFileResults";

vi.mock("@/features/jobs/api/jobs", () => ({
  fetchJobResults: vi.fn(),
}));

const fetchResults = vi.mocked(fetchJobResults);

const finishedJob: Job = {
  id: "job-1",
  folder: "C:\\Photos",
  folder_name: "Photos",
  job_type: "auto_caption",
  status: "completed",
  total: 3,
  processed: 3,
  current_file: null,
  current_name: null,
  stats: { total: 3, success: 1, write_error: 1, skipped: 1 },
  error: null,
  created_at: "2026-01-01T00:00:00Z",
  started_at: "2026-01-01T00:00:01Z",
  finished_at: "2026-01-01T00:01:00Z",
};

const results: JobFileResult[] = [
  { path: "C:\\Photos\\done.png", name: "done.png", status: "success" },
  { path: "C:\\Photos\\skipped.png", name: "skipped.png", status: "skipped" },
  {
    path: "C:\\Photos\\broken.png",
    name: "broken.png",
    status: "write_error",
    message: "Permission denied",
  },
];

beforeEach(() => {
  fetchResults.mockResolvedValue(results);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("JobFileResults", () => {
  it("shows nothing while the job is still running", () => {
    const { container } = render(<JobFileResults job={{ ...finishedJob, status: "running" }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the failure count without fetching the list", () => {
    render(<JobFileResults job={finishedJob} />);

    expect(screen.getByRole("button", { name: /1 failed/ })).toBeInTheDocument();
    expect(fetchResults).not.toHaveBeenCalled();
  });

  it("fetches the list only when expanded, failures first", async () => {
    const user = userEvent.setup();
    render(<JobFileResults job={finishedJob} />);

    await user.click(screen.getByRole("button", { name: /1 failed/ }));

    await waitFor(() => expect(fetchResults).toHaveBeenCalledWith("job-1"));
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => within(row).getByTitle(/Photos/).textContent)).toEqual([
      "broken.png",
      "skipped.png",
      "done.png",
    ]);
    expect(within(rows[0]).getByText("Write error")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Permission denied")).toBeInTheDocument();
  });

  it("retries only the files that failed", async () => {
    const user = userEvent.setup();
    const onRetryFailed = vi.fn();
    render(<JobFileResults job={finishedJob} onRetryFailed={onRetryFailed} />);

    await user.click(screen.getByRole("button", { name: /1 failed/ }));
    await user.click(await screen.findByRole("button", { name: "Retry 1 failed" }));

    expect(onRetryFailed).toHaveBeenCalledWith(["C:\\Photos\\broken.png"]);
  });

  it("offers no retry when nothing failed", async () => {
    const user = userEvent.setup();
    fetchResults.mockResolvedValue([results[0]]);
    render(
      <JobFileResults
        job={{ ...finishedJob, stats: { total: 1, success: 1 } }}
        onRetryFailed={vi.fn()}
        onRunAgain={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Per-file results/ }));

    expect(await screen.findByRole("button", { name: "Run again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("opens a file from its row", async () => {
    const user = userEvent.setup();
    const onOpenItem = vi.fn();
    render(<JobFileResults job={finishedJob} onOpenItem={onOpenItem} />);

    await user.click(screen.getByRole("button", { name: /1 failed/ }));
    await user.click(await screen.findByRole("button", { name: "broken.png" }));

    expect(onOpenItem).toHaveBeenCalledWith("C:\\Photos\\broken.png");
  });

  it("says so when a job's results are gone", async () => {
    const user = userEvent.setup();
    fetchResults.mockRejectedValue(new Error("Job not found"));
    render(<JobFileResults job={finishedJob} />);

    await user.click(screen.getByRole("button", { name: /1 failed/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer stored");
  });
});
