import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import type { Job } from "@/shared/types";
import { useTrainingSamples } from "./useTrainingSamples";

vi.mock("@/features/jobs/api/externalJobs", () => ({
  fetchOstrisTrainingSamples: vi.fn(),
}));

const fetchSamples = vi.mocked(fetchOstrisTrainingSamples);

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
    results: [],
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTrainingSamples", () => {
  it("polls AI-Toolkit while the job runs", async () => {
    fetchSamples.mockResolvedValue({
      samples: [
        { path: SAMPLE_PATH, name: "1__000000500_0.jpg", step: 500, prompt: "a mountain lake" },
      ],
      step: 500,
      available: true,
    });

    const { result } = renderHook(() => useTrainingSamples(trainingJob()));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(fetchSamples).toHaveBeenCalledWith("sample_train_v1");
    expect(result.current[0].prompt).toBe("a mountain lake");
  });

  it("reads the final samples off a finished job instead of polling", async () => {
    const { result } = renderHook(() =>
      useTrainingSamples(
        trainingJob({
          status: "completed",
          processed: 1000,
          results: [
            {
              path: SAMPLE_PATH,
              name: "1__000000500_0.jpg",
              status: "sample",
              description: "a mountain lake",
            },
            { path: "C:\\other.txt", name: "other.txt", status: "skipped" },
          ],
        }),
      ),
    );

    expect(result.current).toEqual([
      { path: SAMPLE_PATH, name: "1__000000500_0.jpg", step: 1000, prompt: "a mountain lake" },
    ]);
    expect(fetchSamples).not.toHaveBeenCalled();
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
