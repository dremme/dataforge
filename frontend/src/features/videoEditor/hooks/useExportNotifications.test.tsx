import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRecord, VideoProjectExportState } from "@/shared/types";
import { useNotificationHistory } from "@/shared/notifications/notifications";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import * as api from "@/features/videoEditor/api/videoProjects";
import { useExportNotifications } from "./useExportNotifications";
import { useVideoExports } from "./useVideoExports";
import type { listVideoProjectExports } from "@/features/videoEditor/api/videoProjects";

vi.mock("@/features/videoEditor/api/videoProjects", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return { ...actual, listVideoProjectExports: vi.fn<typeof listVideoProjectExports>() };
});

function job(id: string, patch: Partial<VideoProjectExportState>): VideoProjectExportState {
  return {
    id,
    folder: "/media",
    status: "completed",
    progress: 1,
    output_path: `/media/${id}.mp4`,
    output_name: `${id}.mp4`,
    project_name: id,
    started_at: "",
    ...patch,
  };
}

function outcome(patch: Partial<NotificationRecord>): NotificationRecord {
  return {
    id: "n",
    message: "Exported party.mp4",
    variant: "success",
    source: "job",
    job_id: "party",
    count: 1,
    created_at: "",
    read_at: null,
    ...patch,
  };
}

/** The jobs drawer keeps the export list loaded in the app; here the harness does. */
function Harness({ onOpen }: { onOpen: ((path: string) => void) | null }) {
  const { exports } = useVideoExports();
  useExportNotifications(onOpen);
  const { actionFor } = useNotificationHistory();
  const action = exports.length > 0 ? actionFor(outcome({})) : undefined;
  const failed = actionFor(outcome({ variant: "danger" }));
  return (
    <>
      {exports.length > 0 && <span>Exports loaded</span>}
      {action && (
        <button type="button" onClick={action.run}>
          {`${action.label} party`}
        </button>
      )}
      {failed && <span>Failed export offers an action</span>}
    </>
  );
}

describe("useExportNotifications", () => {
  beforeEach(() => {
    installMockBackend();
    vi.mocked(api.listVideoProjectExports).mockResolvedValue({ exports: [job("party", {})] });
  });

  it("lets a finished export's notification open the file it wrote", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn<(path: string) => void>();
    renderWithProviders(<Harness onOpen={onOpen} />);

    await user.click(await screen.findByRole("button", { name: "Open party" }));

    expect(onOpen).toHaveBeenCalledWith("/media/party.mp4");
    expect(screen.queryByText("Failed export offers an action")).not.toBeInTheDocument();
  });

  it("offers no Open while the editor, which has its own, is showing", async () => {
    renderWithProviders(<Harness onOpen={null} />);

    expect(await screen.findByText("Exports loaded")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open party" })).not.toBeInTheDocument();
  });
});
