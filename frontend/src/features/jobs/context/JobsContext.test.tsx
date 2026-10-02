import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAllJobs, deleteJob, fetchJobs } from "@/features/jobs/api/jobs";
import { fetchOstrisJobs } from "@/features/jobs/api/externalJobs";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import type { ExternalOstrisJobsResponse, JobsResponse } from "@/shared/types";
import { installFakeEventSource, type FakeStream } from "@/test/fakeEventSource";
import { job } from "@/test/fixtures";
import { queryWrapper } from "@/test/queryClient";
import {
  CONNECTED_ACTIVE_POLL_MS,
  DISCONNECTED_ACTIVE_POLL_MS,
  JobsProvider,
  useJobs,
} from "./JobsContext";

vi.mock("@/features/jobs/api/jobs", () => ({
  fetchJobs: vi.fn(),
  fetchLatestFolderJob: vi.fn(),
  cancelJob: vi.fn(),
  deleteJob: vi.fn(),
  deleteAllJobs: vi.fn(),
}));

vi.mock("@/features/jobs/api/externalJobs", () => ({
  fetchOstrisJobs: vi.fn(),
  stopOstrisJob: vi.fn(),
}));

const listJobs = vi.mocked(fetchJobs);
const deleteJobMock = vi.mocked(deleteJob);
const deleteAllJobsMock = vi.mocked(deleteAllJobs);
const listExternalJobs = vi.mocked(fetchOstrisJobs);

const runningJob = job({ id: "job-1", status: "running", total: 10, processed: 3, revision: 5 });

function listing(jobs = [runningJob], revision = 10): JobsResponse {
  return { jobs, active_count: jobs.length, total: jobs.length, revision };
}

function externalSnapshot(revision: number, available = true): ExternalOstrisJobsResponse {
  return { jobs: [], active_count: 0, available, revision };
}

/** A promise the test settles by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Probe({ onRender }: { onRender: (value: ReturnType<typeof useJobs>) => void }) {
  onRender(useJobs());
  return null;
}

function renderProvider() {
  const latest = { current: null as ReturnType<typeof useJobs> | null };

  render(
    <NotificationsProvider>
      <ServerEventsProvider>
        <JobsProvider>
          <Probe
            onRender={(value) => {
              latest.current = value;
            }}
          />
        </JobsProvider>
      </ServerEventsProvider>
    </NotificationsProvider>,
    { wrapper: queryWrapper().wrapper },
  );

  return latest;
}

async function connect(stream: FakeStream) {
  await waitFor(() => expect(() => stream.source()).not.toThrow());
  await act(async () => {
    stream.open();
  });
}

function becomeVisible() {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  // Bubbles, as the browser's does: the query client listens on window.
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

beforeEach(() => {
  listJobs.mockResolvedValue(listing());
  listExternalJobs.mockResolvedValue(externalSnapshot(1, false));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("JobsProvider", () => {
  it("polls on a timer while there is no push stream", async () => {
    vi.useFakeTimers();

    renderProvider();

    await vi.waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));

    // An active job keeps the fallback on its fast cadence.
    await vi.advanceTimersByTimeAsync(DISCONNECTED_ACTIVE_POLL_MS);
    expect(listJobs).toHaveBeenCalledTimes(2);
  });

  it("takes push updates while connected and only safety-polls on a slow cadence", async () => {
    vi.useFakeTimers();
    const stream = installFakeEventSource();
    renderProvider();
    await vi.waitFor(() => expect(listJobs).toHaveBeenCalled());

    await act(async () => {
      stream.open();
    });
    // Connecting re-reads once, because the stream carries no history.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsAfterConnect = listJobs.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DISCONNECTED_ACTIVE_POLL_MS);
    });
    expect(listJobs).toHaveBeenCalledTimes(callsAfterConnect);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTED_ACTIVE_POLL_MS);
    });
    expect(listJobs.mock.calls.length).toBeGreaterThan(callsAfterConnect);
  });

  it("ignores a frame type it does not recognise", async () => {
    const stream = installFakeEventSource();
    const latest = renderProvider();
    await connect(stream);
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    await act(async () => {
      stream.push({ type: "heartbeat" });
    });

    expect(latest.current?.externalJobs).toEqual([]);
    expect(latest.current?.activeCount).toBe(1);
    expect(latest.current?.jobs).toHaveLength(1);
  });

  it("resumes polling when the stream drops", async () => {
    const stream = installFakeEventSource();
    renderProvider();
    await connect(stream);
    await waitFor(() => expect(listJobs).toHaveBeenCalled());

    act(() => stream.source().onerror?.());

    const callsBefore = listJobs.mock.calls.length;
    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("applies a pushed job snapshot without refetching", async () => {
    const stream = installFakeEventSource();
    const latest = renderProvider();
    await connect(stream);
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    // Hang later polls so a safety fetch cannot supply the assertion from the static mock.
    listJobs.mockReturnValue(new Promise(() => {}));
    const callsBeforePush = listJobs.mock.calls.length;

    act(() => {
      stream.push({
        type: "job",
        job: { ...runningJob, processed: 9, status: "completed", revision: 20 },
      });
    });

    await waitFor(() => expect(latest.current?.jobs[0].processed).toBe(9));
    expect(latest.current?.activeCount).toBe(0);
    expect(listJobs).toHaveBeenCalledTimes(callsBeforePush);
  });

  it("ignores a pushed frame older than the copy it already holds", async () => {
    const stream = installFakeEventSource();
    const latest = renderProvider();
    await connect(stream);
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    act(() => {
      stream.push({ type: "job", job: { ...runningJob, processed: 1, revision: 4 } });
      stream.push({ type: "job", job: { ...runningJob, id: "job-2", revision: 6 } });
    });

    await waitFor(() => expect(latest.current?.jobs).toHaveLength(2));
    expect(latest.current?.jobs.find((entry) => entry.id === "job-1")?.processed).toBe(3);
  });

  it("keeps a job pushed mid-request when the response predates the push", async () => {
    // Applying a stale in-flight listing as is would roll the job back to running.
    const held = deferred<JobsResponse>();
    listJobs.mockReturnValueOnce(held.promise);
    listJobs.mockReturnValue(new Promise(() => {}));

    const stream = installFakeEventSource();
    const latest = renderProvider();
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    act(() => stream.source().onmessage?.({ data: "{}" }));

    act(() => {
      stream.push({
        type: "job",
        job: { ...runningJob, processed: 9, status: "completed", revision: 20 },
      });
    });
    await waitFor(() => expect(latest.current?.jobs[0]?.processed).toBe(9));

    await act(async () => {
      held.resolve(listing([runningJob], 10));
    });
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));

    expect(latest.current?.jobs[0]).toMatchObject({ processed: 9, status: "completed" });
  });

  it("drops a job deleted in another tab without waiting for a poll", async () => {
    const stream = installFakeEventSource();
    const latest = renderProvider();
    await connect(stream);
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));
    listJobs.mockReturnValue(new Promise(() => {}));

    act(() => {
      stream.push({ type: "jobs_removed", ids: ["job-1"], revision: 30 });
    });

    await waitFor(() => expect(latest.current?.jobs).toEqual([]));
  });

  it("does not let a listing read before a deletion bring the job back", async () => {
    const stream = installFakeEventSource();
    const latest = renderProvider();
    await connect(stream);
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    const held = deferred<JobsResponse>();
    listJobs.mockReturnValueOnce(held.promise).mockReturnValue(new Promise(() => {}));
    act(() => latest.current!.toggleDrawer());
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(3));

    act(() => {
      stream.push({ type: "jobs_removed", ids: ["job-1"], revision: 30 });
    });
    await waitFor(() => expect(latest.current?.jobs).toEqual([]));
    await act(async () => {
      held.resolve(listing([runningJob], 25));
    });

    // Give the stale listing every chance to land before checking it did not.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(latest.current?.jobs).toEqual([]);
  });

  it("keeps an external-jobs push that lands during an in-flight read", async () => {
    const held = deferred<ExternalOstrisJobsResponse>();
    listExternalJobs.mockReturnValueOnce(held.promise).mockReturnValue(new Promise(() => {}));
    const stream = installFakeEventSource();
    const latest = renderProvider();
    await waitFor(() => expect(listExternalJobs).toHaveBeenCalled());

    act(() => {
      stream.push({
        type: "external_jobs",
        jobs: [],
        active_count: 0,
        available: true,
        revision: 9,
      });
    });
    await act(async () => {
      held.resolve(externalSnapshot(4, false));
    });

    expect(latest.current?.ostrisAvailable).toBe(true);
  });

  it("refetches when the jobs drawer opens", async () => {
    const latest = renderProvider();
    await waitFor(() => expect(listJobs).toHaveBeenCalled());

    const callsBeforeOpen = listJobs.mock.calls.length;
    act(() => latest.current!.toggleDrawer());

    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(callsBeforeOpen));
  });

  it("refetches when the tab becomes visible again", async () => {
    renderProvider();
    await waitFor(() => expect(listJobs).toHaveBeenCalled());

    const callsBeforeVisible = listJobs.mock.calls.length;
    act(() => becomeVisible());

    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(callsBeforeVisible));
  });

  it("ignores a listing older than one it already merged", async () => {
    const latest = renderProvider();
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    listJobs.mockResolvedValueOnce(listing([job({ id: "job-latest", revision: 40 })], 50));
    act(() => latest.current!.toggleDrawer());
    await waitFor(() => expect(latest.current?.jobs[0]?.id).toBe("job-latest"));

    listJobs.mockResolvedValueOnce(listing([job({ id: "job-stale" })], 30));
    act(() => latest.current!.toggleDrawer());
    act(() => latest.current!.toggleDrawer());
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(3));

    expect(latest.current?.jobs.map((entry) => entry.id)).toEqual(["job-latest"]);
  });

  it("removes a deleted job at once, before the server answers", async () => {
    const answer = deferred<{ deleted_count: number }>();
    deleteJobMock.mockReturnValue(answer.promise);
    const latest = renderProvider();
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    act(() => {
      void latest.current!.deleteJob("job-1");
    });

    await waitFor(() => expect(latest.current?.jobs).toEqual([]));
    listJobs.mockResolvedValue(listing([], 60));
    await act(async () => {
      answer.resolve({ deleted_count: 1 });
    });
    expect(latest.current?.jobs).toEqual([]);
  });

  it("puts the job back and tells the user when a single delete fails", async () => {
    deleteJobMock.mockRejectedValue(new Error("Job not found"));
    const latest = renderProvider();
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await latest.current!.deleteJob("job-1");
    });

    expect(deleted).toBe(false);
    expect(latest.current?.jobs.map((entry) => entry.id)).toEqual(["job-1"]);
    expect(await screen.findByText("Could not delete job: Job not found")).toBeInTheDocument();
  });

  it("tells the user when clearing every job fails", async () => {
    deleteAllJobsMock.mockRejectedValue(new Error("Database is locked"));
    const latest = renderProvider();
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    await act(async () => {
      await latest.current!.deleteAllJobs();
    });

    expect(latest.current?.jobs).toHaveLength(1);
    expect(
      await screen.findByText("Could not delete jobs: Database is locked"),
    ).toBeInTheDocument();
  });

  it("marks a job as cancelling until it leaves the active states", async () => {
    const { cancelJob } = await import("@/features/jobs/api/jobs");
    vi.mocked(cancelJob).mockResolvedValue(runningJob);
    const stream = installFakeEventSource();
    const latest = renderProvider();
    await connect(stream);
    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    await act(async () => {
      await latest.current!.cancelJob("job-1");
    });
    await waitFor(() => expect(latest.current?.cancellingJobId).toBe("job-1"));

    act(() => {
      stream.push({ type: "job", job: { ...runningJob, status: "cancelled", revision: 90 } });
    });
    await waitFor(() => expect(latest.current?.cancellingJobId).toBeNull());
  });
});
