import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
}));

import { fetchOstrisJobs, stopOstrisJob } from "./externalJobs";

describe("externalJobs API", () => {
  beforeEach(() => {
    requestJsonMock.mockReset();
  });

  it("fetches active Ostris jobs", async () => {
    requestJsonMock.mockResolvedValue({ jobs: [], active_count: 0, available: true });

    await fetchOstrisJobs();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/external/ostris/jobs");
  });

  it("stops an Ostris job with checkpoint save", async () => {
    requestJsonMock.mockResolvedValue({
      success: true,
      message: "Checkpoint saved and job stopped.",
    });

    await stopOstrisJob("job-1");

    expect(requestJsonMock).toHaveBeenCalledWith("/api/external/ostris/jobs/job-1/stop", {
      method: "POST",
    });
  });
});
