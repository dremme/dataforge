import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJobs } from "@/features/jobs/api/jobs";
import { fetchOstrisJobs } from "@/features/jobs/api/externalJobs";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { JobsProvider, useJobs } from "./JobsContext";

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
const listExternalJobs = vi.mocked(fetchOstrisJobs);

/** Minimal stand-in for the browser's EventSource, which jsdom does not implement. */
class FakeEventSource {
  static last: FakeEventSource | null = null;

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  close() {}
}

const runningJob = {
  id: "job-1",
  folder: "C:\\Photos",
  folder_name: "Photos",
  job_type: "auto_caption" as const,
  status: "running" as const,
  total: 10,
  processed: 3,
  stats: {},
  created_at: "2026-01-01T00:00:00.000Z",
};

function Probe({ onRender }: { onRender: (value: ReturnType<typeof useJobs>) => void }) {
  onRender(useJobs());
  return null;
}

function renderProvider() {
  const latest = { current: null as ReturnType<typeof useJobs> | null };

  render(
    <NotificationsProvider>
      <JobsProvider>
        <Probe
          onRender={(value) => {
            latest.current = value;
          }}
        />
      </JobsProvider>
    </NotificationsProvider>,
  );

  return latest;
}

beforeEach(() => {
  listJobs.mockResolvedValue({ jobs: [runningJob], active_count: 1 });
  listExternalJobs.mockResolvedValue({ jobs: [], active_count: 0, available: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  FakeEventSource.last = null;
});

describe("JobsProvider", () => {
  it("polls on a timer while there is no push stream", async () => {
    vi.useFakeTimers();

    renderProvider();

    await vi.waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));

    // An active job keeps the fallback on its fast cadence.
    await vi.advanceTimersByTimeAsync(1000);
    expect(listJobs).toHaveBeenCalledTimes(2);
  });

  it("takes push updates while connected and only safety-polls on a slow cadence", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    renderProvider();

    await vi.waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    await act(async () => {
      FakeEventSource.last!.onopen!();
    });
    // Connecting hydrates once, because the stream carries no history.
    await vi.waitFor(() => expect(listJobs).toHaveBeenCalled());
    // Let React apply streamConnected and restart the poll effect.
    await act(async () => {
      await Promise.resolve();
    });

    const callsAfterConnect = listJobs.mock.calls.length;
    // Connected + active job → 3s safety poll, not the 1s disconnected cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(listJobs).toHaveBeenCalledTimes(callsAfterConnect);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(listJobs.mock.calls.length).toBeGreaterThan(callsAfterConnect);
  });

  it("resumes polling when the stream drops", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    renderProvider();

    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const source = FakeEventSource.last!;

    source.onopen!();
    await waitFor(() => expect(listJobs).toHaveBeenCalled());

    source.onerror!();

    const callsBefore = listJobs.mock.calls.length;
    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("applies a pushed job snapshot without refetching", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const latest = renderProvider();

    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const source = FakeEventSource.last!;
    source.onopen!();

    await waitFor(() => expect(latest.current?.jobs).toHaveLength(1));

    source.onmessage!({
      data: JSON.stringify({
        type: "job",
        job: { ...runningJob, processed: 9, status: "completed" },
      }),
    });

    await waitFor(() => expect(latest.current?.jobs[0].processed).toBe(9));
    expect(latest.current?.activeCount).toBe(0);
  });

  it("refetches when the jobs drawer opens", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const latest = renderProvider();

    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    FakeEventSource.last!.onopen!();
    await waitFor(() => expect(listJobs).toHaveBeenCalled());

    const callsBeforeOpen = listJobs.mock.calls.length;
    latest.current!.toggleDrawer();

    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(callsBeforeOpen));
  });

  it("refetches when the tab becomes visible again", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    renderProvider();

    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    FakeEventSource.last!.onopen!();
    await waitFor(() => expect(listJobs).toHaveBeenCalled());

    const callsBeforeVisible = listJobs.mock.calls.length;

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(callsBeforeVisible));
  });

  it("applies only the latest hydrate when refreshes overlap", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    listExternalJobs.mockResolvedValue({ jobs: [], active_count: 0, available: false });

    let releaseFirst:
      | ((value: { jobs: (typeof runningJob)[]; active_count: number }) => void)
      | null = null;
    listJobs
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValue({
        jobs: [{ ...runningJob, id: "job-latest", processed: 9 }],
        active_count: 1,
      });

    const latest = renderProvider();

    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    FakeEventSource.last!.onopen!();
    await waitFor(() => expect(releaseFirst).not.toBeNull());

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    releaseFirst!({ jobs: [{ ...runningJob, id: "job-stale", processed: 1 }], active_count: 1 });

    await waitFor(() => expect(latest.current?.jobs[0]?.id).toBe("job-latest"));
  });
});
