import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { fetchJobs } from "@/features/jobs/api/jobs";
import type * as JobsApi from "@/features/jobs/api/jobs";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import type { ExternalOstrisJob, Job } from "@/shared/types";
import { JobsDrawer } from "./JobsDrawer";

vi.mock("@/features/jobs/api/externalJobs", () => ({
  fetchOstrisTrainingSamples: vi.fn(),
}));

vi.mock("@/features/jobs/api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsApi>()),
  fetchJobs: vi.fn(),
}));

const fetchSamples = vi.mocked(fetchOstrisTrainingSamples);
const fetchJobsMock = vi.mocked(fetchJobs);

const trainingJob: Job = {
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
  started_at: "2026-01-01T00:00:01.000Z",
};

const captionJob: Job = {
  ...trainingJob,
  id: "job-2",
  job_type: "auto_caption",
  external_ref: null,
  total: 10,
  processed: 3,
  stats: {},
};

const externalJob: ExternalOstrisJob = {
  id: "ostris-1",
  name: "sample_train_v1",
  status: "running",
  step: 500,
  total_steps: 1000,
  info: "Training",
  speed_string: "2.15 sec/iter",
  job_type: "train",
  dataset_folder: "C:\\datasets\\landscapes",
  dataset_folder_name: "landscapes",
  model: "krea/Krea-2-Turbo",
  created_at: "2026-01-01T00:00:00.000Z",
  save_now: false,
  stop_requested: false,
};

const jobsContext = {
  jobs: [] as Job[],
  externalJobs: [] as ExternalOstrisJob[],
  drawerOpen: true,
  closeDrawer: vi.fn(),
  cancelJob: vi.fn(),
  cancellingJobId: null,
  stoppingOstrisJobId: null,
  stopExternalOstrisJob: vi.fn(),
  deleteJob: vi.fn(),
  deleteAllJobs: vi.fn(),
};

vi.mock("@/features/jobs/context/JobsContext", () => ({
  useJobs: () => jobsContext,
}));

function renderDrawer(jobs: Job[], externalJobs: ExternalOstrisJob[] = []) {
  jobsContext.jobs = jobs;
  jobsContext.externalJobs = externalJobs;
  return render(<JobsDrawer currentFolder="C:\\datasets\\landscapes" onOpenFolder={vi.fn()} />);
}

beforeEach(() => {
  jobsContext.drawerOpen = true;
  fetchSamples.mockResolvedValue({ samples: [], step: null, available: true });
  fetchJobsMock.mockResolvedValue({ jobs: [], active_count: 0, total: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  resetScrollLockManagerForTests();
});

describe("JobsDrawer", () => {
  describe("history", () => {
    const finishedCaption: Job = { ...captionJob, status: "completed", processed: 10 };
    const olderWatermark: Job = {
      ...captionJob,
      id: "job-old",
      job_type: "watermark",
      status: "failed",
      created_at: "2025-12-01T00:00:00.000Z",
    };

    it("lists stored runs the live list no longer carries", async () => {
      fetchJobsMock.mockResolvedValue({ jobs: [olderWatermark], active_count: 0, total: 1 });

      renderDrawer([finishedCaption]);

      expect(await screen.findByLabelText("Watermark job for landscapes")).toBeInTheDocument();
      expect(screen.getByLabelText("Auto-caption job for landscapes")).toBeInTheDocument();
    });

    it("sends the chosen filters and hides live jobs that do not match", async () => {
      const user = userEvent.setup();
      renderDrawer([finishedCaption]);

      await user.selectOptions(screen.getByLabelText("Type"), "watermark");
      await user.selectOptions(screen.getByLabelText("Status"), "failed");
      await user.selectOptions(screen.getByLabelText("Folder"), "current");

      await waitFor(() =>
        expect(fetchJobsMock).toHaveBeenLastCalledWith(
          expect.objectContaining({
            offset: 0,
            jobType: "watermark",
            status: "failed",
            // JSX attribute strings keep their backslashes, so this is what the drawer received.
            folder: "C:\\\\datasets\\\\landscapes",
          }),
        ),
      );
      expect(screen.queryByLabelText("Auto-caption job for landscapes")).not.toBeInTheDocument();
      expect(await screen.findByText("No jobs match these filters.")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(await screen.findByLabelText("Auto-caption job for landscapes")).toBeInTheDocument();
    });

    it("offers to clear filters that hide every local job beside an external one", async () => {
      const user = userEvent.setup();
      renderDrawer([finishedCaption], [externalJob]);

      await user.selectOptions(screen.getByLabelText("Status"), "failed");

      const localSection = await screen.findByRole("region", { name: "DataForge jobs" });
      expect(localSection).toHaveTextContent("No jobs match these filters.");
      expect(localSection.querySelector(".jobs-drawer__empty")).not.toBeNull();

      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(await screen.findByLabelText("Auto-caption job for landscapes")).toBeInTheDocument();
    });

    it("restores the filters chosen earlier in the session", async () => {
      const user = userEvent.setup();
      const first = renderDrawer([finishedCaption]);
      await user.selectOptions(screen.getByLabelText("Status"), "failed");
      first.unmount();
      fetchJobsMock.mockClear();

      renderDrawer([finishedCaption]);

      expect(screen.getByLabelText("Status")).toHaveValue("failed");
      await waitFor(() =>
        expect(fetchJobsMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" })),
      );
    });

    it("loads the next page on demand", async () => {
      const user = userEvent.setup();
      const firstPage = Array.from({ length: 50 }, (_, index) => ({
        ...finishedCaption,
        id: `page-1-${index}`,
      }));
      fetchJobsMock
        .mockResolvedValueOnce({ jobs: firstPage, active_count: 0, total: 51 })
        .mockResolvedValueOnce({ jobs: [olderWatermark], active_count: 0, total: 51 });

      renderDrawer([finishedCaption]);

      expect(await screen.findByText("Showing 50 of 51")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Load more" }));

      expect(await screen.findByLabelText("Watermark job for landscapes")).toBeInTheDocument();
      expect(fetchJobsMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });
  });

  it("slides out before leaving the DOM", () => {
    const { rerender } = renderDrawer([captionJob]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Must re-render the same tree: a fresh mount would start with
    // `drawerOpen` already false and never enter the closing phase.
    jobsContext.drawerOpen = false;
    rerender(<JobsDrawer currentFolder="C:\\datasets\\landscapes" onOpenFolder={vi.fn()} />);

    const panel = screen.getByRole("dialog");
    expect(panel).toHaveClass("modal-panel--exit");

    fireEvent.animationEnd(panel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a co-tracked training run only as an external card, never twice", () => {
    const { baseElement } = renderDrawer([trainingJob], [externalJob]);

    expect(screen.getByLabelText("external job sample_train_v1")).toBeInTheDocument();
    expect(screen.queryByLabelText("DataForge jobs")).not.toBeInTheDocument();
    expect(baseElement.querySelectorAll(".job-card")).toHaveLength(1);
  });

  it("still lists other job types in the DataForge section", () => {
    renderDrawer([trainingJob, captionJob], [externalJob]);

    const local = screen.getByLabelText("DataForge jobs");
    expect(local.querySelectorAll(".job-card")).toHaveLength(1);
    expect(within(local).getByLabelText("Auto-caption job for landscapes")).toBeInTheDocument();
  });

  it("keeps a finished training job visible after Ostris drops it", () => {
    const finished: Job = { ...trainingJob, status: "completed", processed: 1000 };

    renderDrawer([finished], []);

    expect(screen.getByLabelText("LoRA training job for landscapes")).toBeInTheDocument();
    expect(screen.queryByText("No automation jobs yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete all jobs" })).toBeInTheDocument();
  });

  it("shows a training job when Ostris has not listed the run yet", () => {
    renderDrawer([trainingJob], []);

    expect(screen.getByLabelText("LoRA training job for landscapes")).toBeInTheDocument();
  });

  it("stands down while a sample lightbox is open above it", async () => {
    const user = userEvent.setup();
    fetchSamples.mockResolvedValue({
      samples: [
        {
          path: "C:\\AI-Toolkit\\output\\sample_train_v1\\samples\\1__000000200_0.jpg",
          name: "1__000000200_0.jpg",
          step: 200,
          prompt: "a mountain lake at sunrise",
        },
      ],
      step: 200,
      available: true,
    });

    const { baseElement } = renderDrawer([], [externalJob]);
    const panel = baseElement.querySelector(".jobs-drawer__panel")!;

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "View training sample 1 of 1" }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "View training sample 1 of 1" }));

    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveAttribute("aria-hidden", "true");

    await user.keyboard("{Escape}");
    expect(jobsContext.closeDrawer).not.toHaveBeenCalled();

    expect(
      screen.queryByRole("dialog", { name: "Training sample 1 of 1" }),
    ).not.toBeInTheDocument();
    expect(panel).not.toHaveAttribute("inert");
  });
});
