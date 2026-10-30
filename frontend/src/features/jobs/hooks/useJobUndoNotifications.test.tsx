import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as JobsApi from "@/features/jobs/api/jobs";
import { undoJob } from "@/features/jobs/api/jobs";
import { jobKeys } from "@/features/jobs/lib/jobQueries";
import type { LiveJobs } from "@/features/jobs/lib/jobsCache";
import { useNotificationHistory } from "@/shared/notifications/notifications";
import type { Job, NotificationRecord } from "@/shared/types";
import { HOME_PATH, job } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useJobUndoNotifications } from "./useJobUndoNotifications";

vi.mock("@/features/jobs/api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsApi>()),
  undoJob: vi.fn<typeof undoJob>(),
}));

const undoMock = vi.mocked(undoJob);

function outcome(jobId: string): NotificationRecord {
  return {
    id: `n-${jobId}`,
    message: "Set captions completed.",
    variant: "success",
    source: "job",
    job_id: jobId,
    count: 1,
    created_at: "",
    read_at: null,
  };
}

/** Seeds the live jobs cache the way the jobs push would, then shows each record's action. */
function Harness({ jobs }: { jobs: Job[] }) {
  const queryClient = useQueryClient();
  useState(() =>
    queryClient.setQueryData<LiveJobs>(jobKeys.live, { jobs, revision: 1, removed: {} }),
  );
  useJobUndoNotifications();
  const { actionFor } = useNotificationHistory();
  return (
    <>
      {jobs.map((entry) => {
        const action = actionFor(outcome(entry.id));
        return action ? (
          <button key={entry.id} type="button" onClick={action.run}>
            {`${action.label} ${entry.id}`}
          </button>
        ) : null;
      })}
    </>
  );
}

describe("useJobUndoNotifications", () => {
  beforeEach(() => {
    installMockBackend();
    undoMock.mockReset();
  });

  it("offers Undo only for a job whose writes can still be taken back", async () => {
    undoMock.mockResolvedValue({ restored: [`${HOME_PATH}\\lake.png`], changed: [], failed: [] });
    const user = userEvent.setup();
    renderWithProviders(
      <Harness
        jobs={[
          job({ id: "set", job_type: "set_captions", undoable: true }),
          job({ id: "strip", job_type: "strip_metadata", undoable: false }),
        ]}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Undo set" }));

    expect(screen.queryByRole("button", { name: "Undo strip" })).toBeNull();
    expect(undoMock).toHaveBeenCalledWith("set");
    expect(await screen.findByText("Restored 1 caption.")).toBeInTheDocument();
  });

  it("names the captions it kept because they were edited after the job", async () => {
    undoMock.mockResolvedValue({ restored: [], changed: [`${HOME_PATH}\\lake.png`], failed: [] });
    const user = userEvent.setup();
    renderWithProviders(<Harness jobs={[job({ id: "set", undoable: true })]} />);

    await user.click(await screen.findByRole("button", { name: "Undo set" }));

    await waitFor(() =>
      expect(screen.getByText("Kept captions edited since the job: lake.png.")).toBeInTheDocument(),
    );
  });
});
