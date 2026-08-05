import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { fetchJobResults } from "@/features/jobs/api/jobs";
import type { ExternalOstrisJob, Job } from "@/shared/types";
import {
  useExternalTrainingSamples,
  useOstrisTrainingSamples,
  useTrainingSamples,
} from "./useTrainingSamples";

vi.mock("@/features/jobs/api/externalJobs", () => ({
  fetchOstrisTrainingSamples: vi.fn(),
}));

vi.mock("@/features/jobs/api/jobs", () => ({
  fetchJobResults: vi.fn(),
}));

const fetchSamples = vi.mocked(fetchOstrisTrainingSamples);
const fetchResults = vi.mocked(fetchJobResults);

const SAMPLE_PATH = "C:\\AI-Toolkit\\output\\sample_train_v1\\samples\\1__000000500_0.jpg";

function trainingJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    folder: "C:\\datasets\\landscapes",
    folder_name: "landscapes",
    job_type: "train_lora",
    external_ref: "sample_train_v1",
    status: "running",
    total: 1000,
    processed: 500,
    stats: { step: 500 },
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function externalJob(overrides: Partial<ExternalOstrisJob> = {}): ExternalOstrisJob {
  return {
    id: "ostris-1",
    name: "sample_train_v1",
    status: "running",
    step: 500,
    total_steps: 1000,
    info: "training",
    speed_string: "1.20 sec/iter",
    job_type: "extension",
    dataset_folder: "C:\\datasets\\landscapes",
    dataset_folder_name: "landscapes",
    model: "krea/Krea-2-Turbo",
    created_at: "2026-01-01T00:00:00.000Z",
    save_now: false,
    stop_requested: false,
    ...overrides,
  };
}

function sampleResponse(prompt = "a mountain lake") {
  return {
    samples: [{ path: SAMPLE_PATH, name: "1__000000500_0.jpg", step: 500, prompt }],
    step: 500,
    available: true,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchResults.mockResolvedValue([]);
});

describe("useOstrisTrainingSamples", () => {
  it("keeps polling while asked to", async () => {
    vi.useFakeTimers();
    try {
      fetchSamples.mockResolvedValue(sampleResponse());

      renderHook(() => useOstrisTrainingSamples("sample_train_v1", { poll: true }));

      expect(fetchSamples).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchSamples).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads once and stops when polling is off", async () => {
    vi.useFakeTimers();
    try {
      fetchSamples.mockResolvedValue(sampleResponse());

      renderHook(() => useOstrisTrainingSamples("sample_train_v1", { poll: false }));

      expect(fetchSamples).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetchSamples).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never fetches without a training name", () => {
    renderHook(() => useOstrisTrainingSamples(null, { poll: true }));

    expect(fetchSamples).not.toHaveBeenCalled();
  });

  it("clears the previous run's samples when the name changes", async () => {
    fetchSamples.mockResolvedValue(sampleResponse());

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useOstrisTrainingSamples(name, { poll: false }),
      { initialProps: { name: "sample_train_v1" } },
    );

    await waitFor(() => expect(result.current).toHaveLength(1));

    fetchSamples.mockReturnValue(new Promise(() => {}));
    rerender({ name: "sample_train_v2" });

    expect(result.current).toEqual([]);
  });
});

describe("useTrainingSamples", () => {
  it("polls AI-Toolkit while the job runs", async () => {
    fetchSamples.mockResolvedValue(sampleResponse());

    const { result } = renderHook(() => useTrainingSamples(trainingJob()));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(fetchSamples).toHaveBeenCalledWith("sample_train_v1");
    expect(result.current[0].prompt).toBe("a mountain lake");
  });

  it("fetches the final samples for a finished job instead of polling", async () => {
    fetchResults.mockResolvedValue([
      {
        path: SAMPLE_PATH,
        name: "1__000000500_0.jpg",
        status: "sample",
        description: "a mountain lake",
      },
      { path: "C:\\other.txt", name: "other.txt", status: "skipped" },
    ]);

    const { result } = renderHook(() =>
      useTrainingSamples(trainingJob({ status: "completed", processed: 1000 })),
    );

    await waitFor(() =>
      expect(result.current).toEqual([
        { path: SAMPLE_PATH, name: "1__000000500_0.jpg", step: 1000, prompt: "a mountain lake" },
      ]),
    );
    expect(fetchResults).toHaveBeenCalledExactlyOnceWith("job-1");
    expect(fetchSamples).not.toHaveBeenCalled();
  });

  it("never fetches results while the run is still going", async () => {
    fetchSamples.mockResolvedValue(sampleResponse());

    renderHook(() => useTrainingSamples(trainingJob()));

    await waitFor(() => expect(fetchSamples).toHaveBeenCalled());
    expect(fetchResults).not.toHaveBeenCalled();
  });

  it("shows no samples when a finished job's results are already pruned", async () => {
    fetchResults.mockRejectedValue(new Error("Job not found"));

    const { result } = renderHook(() =>
      useTrainingSamples(trainingJob({ status: "completed", processed: 1000 })),
    );

    await waitFor(() => expect(fetchResults).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("stays empty for jobs that are not training runs", () => {
    const { result } = renderHook(() =>
      useTrainingSamples(trainingJob({ job_type: "auto_caption", external_ref: null })),
    );

    expect(result.current).toEqual([]);
    expect(fetchSamples).not.toHaveBeenCalled();
  });

  it("survives an unreachable AI-Toolkit", async () => {
    fetchSamples.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useTrainingSamples(trainingJob()));

    await waitFor(() => expect(fetchSamples).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});

describe("useExternalTrainingSamples", () => {
  it("fetches by the Ostris job name", async () => {
    fetchSamples.mockResolvedValue(sampleResponse());

    const { result } = renderHook(() => useExternalTrainingSamples(externalJob()));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(fetchSamples).toHaveBeenCalledWith("sample_train_v1");
  });

  it("keeps polling for a run that is still working", async () => {
    vi.useFakeTimers();
    try {
      fetchSamples.mockResolvedValue(sampleResponse());

      renderHook(() => useExternalTrainingSamples(externalJob({ status: "stopping" })));

      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchSamples).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still shows the samples of a finished run without polling for more", async () => {
    vi.useFakeTimers();
    try {
      fetchSamples.mockResolvedValue(sampleResponse());

      const { result } = renderHook(() =>
        useExternalTrainingSamples(externalJob({ status: "completed" })),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(result.current).toHaveLength(1);
      expect(fetchSamples).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays empty without a job", () => {
    const { result } = renderHook(() => useExternalTrainingSamples(null));

    expect(result.current).toEqual([]);
    expect(fetchSamples).not.toHaveBeenCalled();
  });
});
