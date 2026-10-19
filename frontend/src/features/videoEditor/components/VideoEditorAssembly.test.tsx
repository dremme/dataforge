import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoProjectDocument, VideoProjectSourceInfo } from "@/shared/types";
import { makeItem } from "@/test/galleryItemDialog";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import * as api from "@/features/videoEditor/api/videoProjects";
import { restingAdjust } from "@/features/videoEditor/lib/timeline";
import { setEditorClipboard } from "@/features/videoEditor/lib/clipboardStore";
import { VideoEditorWorkspace } from "./VideoEditorWorkspace";
import type {
  listVideoProjectExports,
  listVideoProjects,
  probeVideoProjectSource,
  saveVideoProject,
  startVideoProject,
} from "@/features/videoEditor/api/videoProjects";

vi.mock("@/features/videoEditor/api/videoProjects", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    startVideoProject: vi.fn<typeof startVideoProject>(),
    saveVideoProject: vi.fn<typeof saveVideoProject>(),
    listVideoProjects: vi.fn<typeof listVideoProjects>(),
    listVideoProjectExports: vi.fn<typeof listVideoProjectExports>(),
    probeVideoProjectSource: vi.fn<typeof probeVideoProjectSource>(),
  };
});

/** A 4 s shot with linked sound on V1/A1 at 0 s, and a 2 s still on V1 at 6 s. */
function startingDocument(): VideoProjectDocument {
  return {
    path: null,
    folder: "C:\\media",
    sources: [
      { source_id: "src", state: "ok", path: "C:\\media\\clip.mp4" },
      { source_id: "still", state: "ok", path: "C:\\media\\still.png" },
    ],
    project: makeProject({
      name: "clip edit",
      initial_source_id: "src",
      sources: [makeSource("src", "clip.mp4", "video"), makeSource("still", "still.png", "image")],
      clips: [
        makeClip("shot", "v1", 0, 4, {
          kind: "video",
          source_id: "src",
          link_id: "l",
          adjust: { ...restingAdjust(), exposure: 0.5 },
        }),
        makeClip("shot-sound", "a1", 0, 4, { kind: "audio", source_id: "src", link_id: "l" }),
        makeClip("still", "v1", 6, 2),
      ],
    }),
  };
}

const take: VideoProjectSourceInfo = {
  path: "C:\\media\\take2.mp4",
  name: "take2.mp4",
  kind: "video",
  size: 9,
  modified_us: 9,
  duration: 10,
  width: 640,
  height: 360,
  frame_rate: 30,
  has_audio: false,
};

function renderEditor() {
  renderWithProviders(
    <VideoEditorWorkspace
      request={{ kind: "video", path: "C:\\media\\clip.mp4" }}
      items={[makeItem("take2.mp4", { path: take.path, media_type: "video", duration: 10 })]}
      onExit={vi.fn<() => void>()}
      onOpenInGallery={vi.fn<(path: string) => void>()}
    />,
  );
}

const clipButtons = (name: string) =>
  screen.queryAllByRole("button", { name: new RegExp(`^${name.replace(".", "\\.")}, `) });

async function select(name: string, index = 0) {
  const button = (await screen.findAllByRole("button", { name: new RegExp(`^${name}, `) }))[index];
  fireEvent.keyDown(button, { key: "Enter" });
}

async function seekTo(frame: number, timecode: string) {
  const playhead = await screen.findByRole<HTMLInputElement>("slider", { name: "Playhead" });
  await waitFor(() => {
    fireEvent.change(playhead, { target: { value: String(frame) } });
    expect(playhead).toHaveAttribute("aria-valuetext", timecode);
  });
}

describe("VideoEditorWorkspace assembly", () => {
  beforeEach(() => {
    installMockBackend();
    setEditorClipboard(null);
    vi.mocked(api.startVideoProject).mockResolvedValue(startingDocument());
    vi.mocked(api.saveVideoProject).mockResolvedValue({
      path: "C:\\media\\clip-edit.video-project.json",
      revision: 1,
      updated_at: "",
    });
    vi.mocked(api.listVideoProjects).mockResolvedValue({ projects: [] });
    vi.mocked(api.listVideoProjectExports).mockResolvedValue({ exports: [] });
    vi.mocked(api.probeVideoProjectSource).mockResolvedValue(take);
  });
  afterEach(() => vi.restoreAllMocks());

  it("replaces the selected shot from the source monitor and keeps its slot and look", async () => {
    const user = userEvent.setup();
    renderEditor();
    await select("clip\\.mp4");
    await user.click(await screen.findByRole("button", { name: "Preview take2.mp4" }));

    await user.click(screen.getByRole("button", { name: "Replace" }));

    await waitFor(() => expect(clipButtons("take2.mp4")).toHaveLength(1));
    // The new take has no sound, so the old linked sound goes with the old take.
    expect(clipButtons("clip.mp4")).toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("00:00:00:00");
    expect(screen.getByRole("textbox", { name: "Length" })).toHaveValue("00:00:04:00");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(clipButtons("clip.mp4")).toHaveLength(2);
  });

  it("inserts at the playhead and moves everything after it later", async () => {
    const user = userEvent.setup();
    renderEditor();
    await seekTo(60, "00:00:02:00");
    await user.click(await screen.findByRole("button", { name: "Preview take2.mp4" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));

    await waitFor(() => expect(clipButtons("take2.mp4")).toHaveLength(1));
    // The shot is cut at 2 s; its second half and its sound sit after the 10 s take.
    expect(clipButtons("clip.mp4")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /^still\.png, 00:16 to 00:18/ })).toBeInTheDocument();
  });

  it("moves a clip to a typed start and nudges it by frames", async () => {
    const user = userEvent.setup();
    renderEditor();
    await select("still\\.png");

    const start = screen.getByRole("textbox", { name: "Start" });
    await user.clear(start);
    await user.type(start, "00:00:05:00{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^still\.png, 00:05 to 00:07/ })).toBeVisible(),
    );

    fireEvent.keyDown(document.body, { key: "," });
    fireEvent.keyDown(document.body, { key: "," });
    expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("00:00:04:28");
  });

  it("copies a clip with its linked sound, pastes it at the playhead, then pastes its look", async () => {
    const user = userEvent.setup();
    renderEditor();
    await select("clip\\.mp4");
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
    await seekTo(240, "00:00:08:00");

    fireEvent.keyDown(document.body, { key: "v", ctrlKey: true });

    await waitFor(() => expect(clipButtons("clip.mp4")).toHaveLength(4));
    expect(screen.getAllByRole("button", { name: /^clip\.mp4, 00:08 to 00:12/ })).toHaveLength(2);

    await select("still\\.png");
    fireEvent.keyDown(document.body, { key: "V", ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Paste attributes" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Fades" }));
    await user.click(within(dialog).getByRole("button", { name: "Paste" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Paste attributes" })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /^Color/ }));
    expect(screen.getByRole("slider", { name: "Exposure" })).toHaveValue("0.5");
  });

  it("sets one value on every selected clip from the inspector", async () => {
    renderEditor();
    await select("clip\\.mp4");
    const still = (await screen.findAllByRole("button", { name: /^still\.png, / }))[0];
    fireEvent.keyDown(still, { key: "Enter", shiftKey: true });
    await screen.findByText(/clips selected/);

    const opacity = screen.getByRole("slider", { name: /^Opacity/ });
    fireEvent.change(opacity, { target: { value: "0.4" } });
    fireEvent.pointerUp(opacity);

    // Once every picture holds the value, it no longer reads as mixed.
    expect(await screen.findByRole("slider", { name: "Opacity" })).toHaveValue("0.4");
  });
});
