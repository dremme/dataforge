import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
}));

import { cancelJob, deleteAllJobs, deleteJob, fetchJobs, fetchLatestFolderJob } from "./jobs";

describe("jobs API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("fetches the latest job for a folder", async () => {
    requestJsonMock.mockResolvedValue(null);

    await fetchLatestFolderJob("C:\\Photos");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/jobs/folder-latest?path=C%3A%5CPhotos");
  });

  it("fetches jobs with the default limit", async () => {
    requestJsonMock.mockResolvedValue({ jobs: [], active_count: 0, total: 0 });

    await fetchJobs();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/jobs?limit=100", { signal: undefined });
  });

  it("fetches a filtered page of history", async () => {
    requestJsonMock.mockResolvedValue({ jobs: [], active_count: 0, total: 0 });

    await fetchJobs({
      limit: 50,
      offset: 50,
      jobType: "watermark",
      status: "stopped",
      folder: "C:\\Photos",
    });

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/api/jobs?limit=50&offset=50&job_type=watermark&status=stopped&folder=C%3A%5CPhotos",
      { signal: undefined },
    );
  });

  it("cancels a job", async () => {
    requestJsonMock.mockResolvedValue({ id: "job-1", status: "cancelled" });

    await cancelJob("job-1");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/jobs/job-1/cancel", {
      method: "POST",
    });
  });

  it("deletes a job", async () => {
    requestJsonMock.mockResolvedValue({ deleted_count: 1 });

    await deleteJob("job-1");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/jobs/job-1", {
      method: "DELETE",
    });
  });

  it("deletes all jobs", async () => {
    requestJsonMock.mockResolvedValue({ deleted_count: 3 });

    await deleteAllJobs();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/jobs", {
      method: "DELETE",
    });
  });
});
