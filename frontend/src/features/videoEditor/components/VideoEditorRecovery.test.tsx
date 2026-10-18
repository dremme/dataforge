import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoProjectDocument, VideoProjectSourceInfo } from "@/shared/types";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import * as api from "@/features/videoEditor/api/videoProjects";
import { VideoEditorWorkspace } from "./VideoEditorWorkspace";
import type {
  listVideoProjectExports,
  listVideoProjectVersions,
  listVideoProjects,
  makeCompatibleCopy,
  openVideoProject,
  probeVideoProjectSource,
  readVideoProjectVersion,
  saveVideoProject,
  saveVideoProjectVersion,
  startVideoProject,
} from "@/features/videoEditor/api/videoProjects";

vi.mock("@/features/videoEditor/api/videoProjects", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    startVideoProject: vi.fn<typeof startVideoProject>(),
    openVideoProject: vi.fn<typeof openVideoProject>(),
    saveVideoProject: vi.fn<typeof saveVideoProject>(),
    listVideoProjects: vi.fn<typeof listVideoProjects>(),
    listVideoProjectExports: vi.fn<typeof listVideoProjectExports>(),
    probeVideoProjectSource: vi.fn<typeof probeVideoProjectSource>(),
    makeCompatibleCopy: vi.fn<typeof makeCompatibleCopy>(),
    listVideoProjectVersions: vi.fn<typeof listVideoProjectVersions>(),
    saveVideoProjectVersion: vi.fn<typeof saveVideoProjectVersion>(),
    readVideoProjectVersion: vi.fn<typeof readVideoProjectVersion>(),
  };
});

const DRAFT = "C:\\media\\clip-edit.video-project.json";

function document(path: string | null = null): VideoProjectDocument {
  return {
    path,
    folder: "C:\\media",
    sources: [{ source_id: "src", state: "ok", path: "C:\\media\\clip.mp4" }],
    project: makeProject({
      name: "clip edit",
      initial_source_id: "src",
      sources: [makeSource("src", "clip.mp4", "video")],
      clips: [makeClip("shot", "v1", 0, 4, { kind: "video", source_id: "src" })],
    }),
  };
}

function renderEditor() {
  renderWithProviders(
    <VideoEditorWorkspace
      request={{ kind: "video", path: "C:\\media\\clip.mp4" }}
      items={[]}
      onExit={vi.fn<() => void>()}
      onOpenInGallery={vi.fn<(path: string) => void>()}
    />,
  );
}

async function pickFromMenu(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Project actions" }));
  await user.click(screen.getByRole("menuitem", { name: new RegExp(`^${name}`) }));
  return user;
}

describe("VideoEditorWorkspace recovery", () => {
  beforeEach(() => {
    installMockBackend();
    vi.mocked(api.startVideoProject).mockResolvedValue(document());
    vi.mocked(api.saveVideoProject).mockResolvedValue({ path: DRAFT, revision: 1, updated_at: "" });
    vi.mocked(api.listVideoProjects).mockResolvedValue({ projects: [] });
    vi.mocked(api.listVideoProjectExports).mockResolvedValue({ exports: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("names a video the browser cannot decode and relinks it to an H.264 copy", async () => {
    const videos: HTMLVideoElement[] = [];
    const create = globalThis.document.createElement.bind(globalThis.document);
    vi.spyOn(globalThis.document, "createElement").mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === "video") videos.push(element as HTMLVideoElement);
      return element;
    });
    const copy: VideoProjectSourceInfo = {
      path: "C:\\media\\clip-h264.mp4",
      name: "clip-h264.mp4",
      kind: "video",
      size: 20,
      modified_us: 5,
      duration: 4,
      width: 640,
      height: 360,
      frame_rate: 30,
      has_audio: false,
    };
    vi.mocked(api.makeCompatibleCopy).mockResolvedValue(copy);
    vi.mocked(api.probeVideoProjectSource).mockResolvedValue(copy);
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });
    await waitFor(() => expect(videos.length).toBeGreaterThan(0));

    // StrictMode remounts the editor, releasing the first element; the last one is in use.
    const shown = videos.at(-1)!;
    Object.defineProperty(shown, "error", {
      configurable: true,
      // MEDIA_ERR_SRC_NOT_SUPPORTED, what Chrome reports for an MPEG-4 Part 2 file.
      value: { code: 4 },
    });
    shown.dispatchEvent(new Event("error"));

    const banner = await screen.findByText(/A source cannot be previewed/);
    const notice = banner.closest<HTMLElement>("[role=alert]")!;
    expect(notice).toHaveTextContent("clip.mp4 This browser cannot play its format or codec.");

    await userEvent.click(within(notice).getByRole("button", { name: "Use an H.264 copy" }));

    expect(api.makeCompatibleCopy).toHaveBeenCalledWith("C:\\media\\clip.mp4");
    await waitFor(() => expect(screen.queryByText(/cannot be previewed/)).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^clip-h264\.mp4, / })).toHaveLength(1);
  });

  it("says nothing about a missing file no clip uses any more", async () => {
    const opened = document();
    // The video the project started from was deleted after its clip was replaced.
    opened.project = {
      ...opened.project,
      sources: [...opened.project.sources, makeSource("old", "old.mp4", "video")],
    };
    opened.sources = [
      ...opened.sources,
      { source_id: "old", state: "missing", path: "C:\\media\\old.mp4" },
    ];
    vi.mocked(api.startVideoProject).mockResolvedValue(opened);
    renderEditor();

    await screen.findByRole("button", { name: "Back to gallery" });
    expect(screen.queryByText(/Some media is missing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs attention/)).not.toBeInTheDocument();
  });

  it("duplicates the project under a new id and carries on in the copy", async () => {
    const copyPath = "C:\\media\\clip-edit-2.video-project.json";
    vi.mocked(api.saveVideoProject).mockResolvedValue({
      path: copyPath,
      revision: 1,
      updated_at: "",
    });
    vi.mocked(api.openVideoProject).mockImplementation(async (path) => {
      const [, , , saved] = vi.mocked(api.saveVideoProject).mock.lastCall!;
      return { ...document(path), project: { ...saved, revision: 1 } };
    });
    renderEditor();

    await pickFromMenu("Duplicate project");

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("clip edit copy"),
    );
    const copySave = vi
      .mocked(api.saveVideoProject)
      .mock.calls.find((call) => call[3].name === "clip edit copy");
    assert(copySave);
    const [folder, path, revision, saved] = copySave;
    expect([folder, path, revision]).toEqual(["C:\\media", null, null]);
    expect(saved.id).not.toBe("p");
    expect(saved.clips).toHaveLength(1);
    expect(api.openVideoProject).toHaveBeenCalledWith(copyPath);
  });

  it("saves a named version and restores an earlier one as an undoable edit", async () => {
    vi.mocked(api.startVideoProject).mockResolvedValue(document(DRAFT));
    const earlier = makeProject({
      name: "Rough cut",
      sources: [makeSource("src", "clip.mp4", "video")],
      clips: [
        makeClip("a", "v1", 0, 1, { kind: "video", source_id: "src" }),
        makeClip("b", "v1", 2, 1, { kind: "video", source_id: "src" }),
      ],
    });
    const summary = {
      id: "v1",
      created_at: "2026-10-16T10:00:00+00:00",
      label: "Rough cut",
      revision: 3,
      name: "Rough cut",
      duration: 3,
      clip_count: 2,
    };
    vi.mocked(api.listVideoProjectVersions).mockResolvedValue({ versions: [summary] });
    vi.mocked(api.saveVideoProjectVersion).mockResolvedValue({ ...summary, id: "v2" });
    vi.mocked(api.readVideoProjectVersion).mockResolvedValue({
      project: earlier,
      sources: [{ source_id: "src", state: "ok", path: "C:\\media\\clip.mp4" }],
    });
    renderEditor();

    const user = await pickFromMenu("Versions...");
    const modal = await screen.findByRole("dialog", { name: "Project versions" });
    await user.type(within(modal).getByRole("textbox", { name: "Save this version as" }), "Mine");
    await user.click(within(modal).getByRole("button", { name: "Save version" }));
    expect(api.saveVideoProjectVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p", name: "clip edit" }),
      "Mine",
    );

    await user.click(within(modal).getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Project versions" })).not.toBeInTheDocument(),
    );
    expect(api.readVideoProjectVersion).toHaveBeenCalledWith("v1", "C:\\media");
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("Rough cut");
    expect(screen.getAllByRole("button", { name: /^clip\.mp4, / })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("clip edit");
    expect(screen.getAllByRole("button", { name: /^clip\.mp4, / })).toHaveLength(1);
  });
});
