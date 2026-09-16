import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJobs } from "@/features/jobs/api/jobs";
import type { JobsQuery } from "@/features/jobs/lib/jobFilters";
import { job } from "@/test/fixtures";
import type { Job, JobsResponse } from "@/shared/types";
import { JOB_HISTORY_PAGE_SIZE, useJobHistory } from "./useJobHistory";

vi.mock("@/features/jobs/api/jobs", () => ({ fetchJobs: vi.fn() }));

const fetchJobsMock = vi.mocked(fetchJobs);

function page(jobs: Job[], total: number): JobsResponse {
  return { jobs, total, active_count: 0 };
}

function jobs(prefix: string, count: number): Job[] {
  return Array.from({ length: count }, (_, index) => job({ id: `${prefix}-${index}` }));
}

function renderHistory(
  initial: { query?: JobsQuery; enabled?: boolean; refreshKey?: string } = {},
) {
  return renderHook(
    ({ query, enabled, refreshKey }) => useJobHistory(query, { enabled, refreshKey }),
    { initialProps: { query: {}, enabled: true, refreshKey: "", ...initial } },
  );
}

describe("useJobHistory", () => {
  beforeEach(() => {
    fetchJobsMock.mockReset();
  });

  it("does nothing while disabled", () => {
    renderHistory({ enabled: false });

    expect(fetchJobsMock).not.toHaveBeenCalled();
  });

  it("loads the first page with the filter", async () => {
    fetchJobsMock.mockResolvedValue(page(jobs("a", 2), 2));

    const { result } = renderHistory({ query: { jobType: "watermark" } });

    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    expect(fetchJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: JOB_HISTORY_PAGE_SIZE, offset: 0, jobType: "watermark" }),
    );
    expect(result.current.hasMore).toBe(false);
  });

  it("appends the next page on load more", async () => {
    fetchJobsMock
      .mockResolvedValueOnce(page(jobs("a", JOB_HISTORY_PAGE_SIZE), 60))
      .mockResolvedValueOnce(page(jobs("b", 10), 60));

    const { result } = renderHistory();
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.jobs).toHaveLength(60));
    expect(fetchJobsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: JOB_HISTORY_PAGE_SIZE }),
    );
    expect(result.current.hasMore).toBe(false);
  });

  it("starts over when the filter or the refresh key changes", async () => {
    fetchJobsMock.mockResolvedValue(page(jobs("a", 1), 1));
    const { rerender } = renderHistory();
    await waitFor(() => expect(fetchJobsMock).toHaveBeenCalledTimes(1));

    rerender({ query: { status: "failed" }, enabled: true, refreshKey: "" });
    await waitFor(() => expect(fetchJobsMock).toHaveBeenCalledTimes(2));

    rerender({ query: { status: "failed" }, enabled: true, refreshKey: "job-2:active" });
    await waitFor(() => expect(fetchJobsMock).toHaveBeenCalledTimes(3));
    expect(fetchJobsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, status: "failed" }),
    );
  });

  it("ignores a response that a newer filter superseded", async () => {
    let resolveStale!: (response: JobsResponse) => void;
    fetchJobsMock
      .mockImplementationOnce(() => new Promise((resolve) => (resolveStale = resolve)))
      .mockResolvedValueOnce(page(jobs("fresh", 1), 1));

    const { result, rerender } = renderHistory();
    rerender({ query: { status: "failed" }, enabled: true, refreshKey: "" });
    await waitFor(() => expect(result.current.jobs.map((entry) => entry.id)).toEqual(["fresh-0"]));

    await act(async () => resolveStale(page(jobs("stale", 3), 3)));

    expect(result.current.jobs.map((entry) => entry.id)).toEqual(["fresh-0"]);
  });
});
