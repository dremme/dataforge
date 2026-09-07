import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";
import type { Job } from "@/shared/types";

const failedJob: Job = {
  id: "job-auto-caption",
  folder: HOME_PATH,
  folder_name: "Photos",
  job_type: "auto_caption",
  status: "completed",
  total: 3,
  processed: 3,
  current_file: null,
  current_name: null,
  stats: { total: 3, success: 2, write_error: 1 },
  error: null,
  created_at: "2026-01-01T00:00:00Z",
  started_at: "2026-01-01T00:00:01Z",
  finished_at: "2026-01-01T00:01:00Z",
};

function installBackendWithFailedJob() {
  return installMockBackend({
    jobs: [failedJob],
    jobResults: {
      "job-auto-caption": [
        { path: HOME_PATH + "\\sunset.png", name: "sunset.png", status: "success" },
        {
          path: HOME_PATH + "\\beach.jpg",
          name: "beach.jpg",
          status: "write_error",
          message: "Permission denied",
        },
        { path: HOME_PATH + "\\waves.mp4", name: "waves.mp4", status: "success" },
      ],
    },
  });
}

describe("App: job results", () => {
  it("lists the files a finished job failed on", async () => {
    const user = userEvent.setup();
    installBackendWithFailedJob();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /1 failed/ }));

    const row = await screen.findByText("Permission denied");
    expect(row).toBeInTheDocument();
    expect(screen.getByText("Write error")).toBeInTheDocument();
  });

  it("scopes a retry to the failed files only", async () => {
    const user = userEvent.setup();
    installBackendWithFailedJob();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /1 failed/ }));
    await user.click(await screen.findByRole("button", { name: "Retry 1 failed" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Start auto-caption?" });
    expect(dialog.querySelector(".dialog-scope__line")).toHaveTextContent(
      "1 selected file in Photos",
    );
  });

  it("runs a job again over the whole folder", async () => {
    const user = userEvent.setup();
    installBackendWithFailedJob();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /1 failed/ }));
    await user.click(await screen.findByRole("button", { name: "Run again" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Start auto-caption?" });
    expect(dialog.querySelector(".dialog-scope__line")).toHaveTextContent("All 3 files in Photos");
  });

  it("opens a failed file from its result row", async () => {
    const user = userEvent.setup();
    installBackendWithFailedJob();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: /1 failed/ }));
    await user.click(await screen.findByRole("button", { name: "beach.jpg" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Viewing beach.jpg" })).toBeInTheDocument();
    });
  });
});
