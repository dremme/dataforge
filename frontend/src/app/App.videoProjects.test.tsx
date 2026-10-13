import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoProjectDocument, VideoProjectSummary } from "@/shared/types";
import * as videoProjectsApi from "@/features/videoEditor/api/videoProjects";
import { HOME_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

afterEach(() => vi.restoreAllMocks());

const DRAFT_PATH = `${HOME_PATH}\\clip-edit.video-project.json`;

const summary: VideoProjectSummary = {
  path: DRAFT_PATH,
  name: "Lake trip",
  updated_at: "2026-10-12T10:00:00Z",
  duration: 12,
  clip_count: 3,
  initial_source_name: "clip.mp4",
  initial_source_path: null,
};

function draft(): VideoProjectDocument {
  return {
    path: DRAFT_PATH,
    folder: HOME_PATH,
    sources: [],
    project: {
      format_version: 1,
      id: "p",
      name: "Lake trip",
      revision: 4,
      created_at: "",
      updated_at: "",
      width: 640,
      height: 360,
      frame_rate: 30,
      sources: [],
      tracks: [
        {
          id: "v1",
          kind: "video",
          name: "V1",
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      clips: [],
      transitions: [],
      export: {
        filename: "",
        size: "source",
        orientation: null,
        quality: "standard",
        copy_caption: false,
      },
    },
  };
}

describe("App video projects", () => {
  it("lists the folder's drafts and opens one in the editor", async () => {
    const user = userEvent.setup();
    const { requestsTo } = installMockBackend({ videoProjects: { [HOME_PATH]: [summary] } });
    const open = vi.spyOn(videoProjectsApi, "openVideoProject").mockResolvedValue(draft());
    renderApp();

    const section = await screen.findByRole("region", { name: "Video projects" });
    const listUrl = `/api/video-projects?${new URLSearchParams({ folder: HOME_PATH })}`;
    const reads = requestsTo(listUrl).length;
    await user.click(
      within(section).getByRole("button", {
        name: "Open the video project Lake trip in the video editor",
      }),
    );

    expect(await screen.findByRole("textbox", { name: "Project name" })).toHaveValue("Lake trip");
    expect(open).toHaveBeenCalledWith(DRAFT_PATH);

    await user.click(screen.getByRole("button", { name: "Back to gallery" }));
    await waitFor(() => expect(requestsTo(listUrl).length).toBeGreaterThan(reads));
    expect(screen.queryByRole("textbox", { name: "Project name" })).not.toBeInTheDocument();
  });

  it("opens an empty project in the open folder from the sidebar", async () => {
    const user = userEvent.setup();
    installMockBackend();
    const empty = { ...draft(), path: null };
    empty.project = { ...empty.project, name: "Untitled project", revision: 0 };
    const start = vi.spyOn(videoProjectsApi, "newVideoProject").mockResolvedValue(empty);
    renderApp();

    const sidebar = await screen.findByRole("complementary", { name: "Folder navigation" });
    const buttons = within(sidebar)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(buttons.indexOf("Open video editor")).toBe(buttons.indexOf("Open folder") + 1);
    await user.click(within(sidebar).getByRole("button", { name: "Open video editor" }));

    expect(await screen.findByRole("textbox", { name: "Project name" })).toHaveValue(
      "Untitled project",
    );
    expect(start).toHaveBeenCalledWith(HOME_PATH);
  });

  it("shows no section for a folder without drafts", async () => {
    installMockBackend();
    renderApp();

    await screen.findByRole("region", { name: "Media" });

    expect(screen.queryByRole("region", { name: "Video projects" })).not.toBeInTheDocument();
  });
});
