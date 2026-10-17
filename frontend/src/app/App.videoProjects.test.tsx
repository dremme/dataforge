import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import type { VideoProjectDocument, VideoProjectSummary } from "@/shared/types";
import * as videoProjectsApi from "@/features/videoEditor/api/videoProjects";
import { HOME_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

afterEach(() => vi.restoreAllMocks());

const DRAFT_PATH = `${HOME_PATH}\\clip-edit.video-project.json`;
const DRAFT_ADDRESS = `/editor/project?${new URLSearchParams({ path: DRAFT_PATH })}`;

const at = () => ({
  pathname: window.location.pathname,
  path: new URLSearchParams(window.location.search).get("path"),
});
const projectName = () => screen.queryByRole("textbox", { name: "Project name" });

const summary: VideoProjectSummary = {
  path: DRAFT_PATH,
  name: "Lake trip",
  updated_at: "2026-10-12T10:00:00Z",
  duration: 12,
  clip_count: 3,
  initial_source_name: "clip.mp4",
  thumbnail_path: null,
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
          gain: 1,
          speech: false,
        },
      ],
      clips: [],
      transitions: [],
      mix: { master_gain: 1, duck_gain: 0.25 },
      export: {
        filename: "",
        size: "source",
        orientation: null,
        quality: "standard",
        copy_caption: false,
        audio_level: "limit",
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
    expect(buttons.indexOf("Open video editor")).toBe(
      buttons.indexOf("Collapse folder sidebar") + 1,
    );
    await user.click(within(sidebar).getByRole("button", { name: "Open video editor" }));

    expect(await screen.findByRole("textbox", { name: "Project name" })).toHaveValue(
      "Untitled project",
    );
    expect(start).toHaveBeenCalledWith(HOME_PATH);
  });

  it("gives the editor its own history entry: Back returns to the gallery, Forward reopens it", async () => {
    const user = userEvent.setup();
    installMockBackend({ videoProjects: { [HOME_PATH]: [summary] } });
    const open = vi.spyOn(videoProjectsApi, "openVideoProject").mockResolvedValue(draft());
    renderApp();
    const section = await screen.findByRole("region", { name: "Video projects" });
    await waitFor(() => expect(at()).toEqual({ pathname: "/", path: HOME_PATH }));

    await user.click(
      within(section).getByRole("button", {
        name: "Open the video project Lake trip in the video editor",
      }),
    );
    expect(await screen.findByRole("textbox", { name: "Project name" })).toHaveValue("Lake trip");
    await waitFor(() => expect(at()).toEqual({ pathname: "/editor/project", path: DRAFT_PATH }));

    act(() => window.history.back());
    await waitFor(() => expect(projectName()).not.toBeInTheDocument());
    expect(at()).toEqual({ pathname: "/", path: HOME_PATH });
    expect(screen.getByRole("region", { name: "Video projects" })).toBeInTheDocument();

    const opens = open.mock.calls.length;
    act(() => window.history.forward());
    expect(await screen.findByRole("textbox", { name: "Project name" })).toHaveValue("Lake trip");
    expect(open.mock.calls.length).toBeGreaterThan(opens);
  });

  it("opens the editor from its address, and leaving it shows the folder it worked in", async () => {
    const user = userEvent.setup();
    installMockBackend();
    vi.spyOn(videoProjectsApi, "openVideoProject").mockResolvedValue(draft());
    window.history.replaceState(null, "", DRAFT_ADDRESS);
    const entries = window.history.length;
    renderApp();

    expect(await screen.findByRole("textbox", { name: "Project name" })).toHaveValue("Lake trip");
    await user.click(screen.getByRole("button", { name: "Back to gallery" }));

    await waitFor(() => expect(projectName()).not.toBeInTheDocument());
    await waitFor(() => expect(at()).toEqual({ pathname: "/", path: HOME_PATH }));
    // Nothing was under the editor's entry, so it became the gallery's rather than leaving the app.
    expect(window.history.length).toBe(entries);
  });

  it("saves before Back leaves, and stays to ask when the save fails", async () => {
    const user = userEvent.setup();
    installMockBackend({ videoProjects: { [HOME_PATH]: [summary] } });
    vi.spyOn(videoProjectsApi, "openVideoProject").mockResolvedValue(draft());
    const save = vi
      .spyOn(videoProjectsApi, "saveVideoProject")
      .mockRejectedValue(new ApiError(500, "The disk is full"));
    renderApp();
    const section = await screen.findByRole("region", { name: "Video projects" });
    await user.click(
      within(section).getByRole("button", {
        name: "Open the video project Lake trip in the video editor",
      }),
    );
    const name = await screen.findByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Lake trip 2{Enter}");

    act(() => window.history.back());

    expect(
      await screen.findByRole("alertdialog", { name: "Your latest changes are not saved" }),
    ).toBeInTheDocument();
    expect(save).toHaveBeenCalled();
    await waitFor(() => expect(at()).toEqual({ pathname: "/editor/project", path: DRAFT_PATH }));
    // The dialog hides the editor from the accessibility tree; its edit is still there.
    expect(screen.getByRole("textbox", { name: "Project name", hidden: true })).toHaveValue(
      "Lake trip 2",
    );

    await user.click(screen.getByRole("button", { name: "Exit" }));
    await waitFor(() => expect(projectName()).not.toBeInTheDocument());
    expect(at()).toEqual({ pathname: "/", path: HOME_PATH });
  });

  it("moves a new project's address to its draft once saved, without reopening it", async () => {
    const user = userEvent.setup();
    installMockBackend();
    const empty = { ...draft(), path: null };
    empty.project = { ...empty.project, name: "Untitled project", revision: 0 };
    vi.spyOn(videoProjectsApi, "newVideoProject").mockResolvedValue(empty);
    const open = vi.spyOn(videoProjectsApi, "openVideoProject");
    vi.spyOn(videoProjectsApi, "saveVideoProject").mockResolvedValue({
      path: DRAFT_PATH,
      revision: 1,
      updated_at: "",
    });
    renderApp();
    const sidebar = await screen.findByRole("complementary", { name: "Folder navigation" });
    await user.click(within(sidebar).getByRole("button", { name: "Open video editor" }));
    const name = await screen.findByRole("textbox", { name: "Project name" });
    await waitFor(() => expect(at()).toEqual({ pathname: "/editor/new", path: HOME_PATH }));

    await user.clear(name);
    await user.type(name, "Beach{Enter}");

    await waitFor(() => expect(at()).toEqual({ pathname: "/editor/project", path: DRAFT_PATH }), {
      timeout: 3000,
    });
    expect(projectName()).toHaveValue("Beach");
    expect(open).not.toHaveBeenCalled();
  });

  it("closes an untouched empty project on Back", async () => {
    const user = userEvent.setup();
    installMockBackend();
    const empty = { ...draft(), path: null };
    empty.project = { ...empty.project, name: "Untitled project", revision: 0 };
    vi.spyOn(videoProjectsApi, "newVideoProject").mockResolvedValue(empty);
    renderApp();
    const sidebar = await screen.findByRole("complementary", { name: "Folder navigation" });
    await waitFor(() => expect(at()).toEqual({ pathname: "/", path: HOME_PATH }));
    await user.click(within(sidebar).getByRole("button", { name: "Open video editor" }));
    await screen.findByRole("textbox", { name: "Project name" });
    await waitFor(() => expect(at()).toEqual({ pathname: "/editor/new", path: HOME_PATH }));

    act(() => window.history.back());

    await waitFor(() => expect(at()).toEqual({ pathname: "/", path: HOME_PATH }));
    await waitFor(() => expect(document.querySelector(".video-editor")).toBeNull());
    expect(await screen.findByRole("region", { name: "Media" })).toBeVisible();
  });

  it("shows no section for a folder without drafts", async () => {
    installMockBackend();
    renderApp();

    await screen.findByRole("region", { name: "Media" });

    expect(screen.queryByRole("region", { name: "Video projects" })).not.toBeInTheDocument();
  });
});
