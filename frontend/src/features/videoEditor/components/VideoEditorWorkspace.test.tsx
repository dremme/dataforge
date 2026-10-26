import { RESTING_EFFECTS } from "@/shared/lib/audioEffects";
import { createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import type { VideoProjectClip, VideoProjectDocument } from "@/shared/types";
import { makeItem } from "@/test/galleryItemDialog";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import * as api from "@/features/videoEditor/api/videoProjects";
import { restingAdjust } from "@/features/videoEditor/lib/timeline";
import { SOURCE_DRAG_TYPE, TIMELINE_ORIGIN_PX } from "./Timeline";
import { VideoEditorWorkspace } from "./VideoEditorWorkspace";
import type {
  cancelVideoProjectExport,
  deleteVideoProject,
  listVideoProjectExports,
  listAllVideoProjects,
  openVideoProject,
  probeVideoProjectSource,
  saveVideoProject,
  startVideoProject,
  startVideoProjectExport,
  suggestVideoProjectAdjust,
} from "@/features/videoEditor/api/videoProjects";

vi.mock("@/features/videoEditor/api/videoProjects", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    startVideoProject: vi.fn<typeof startVideoProject>(),
    saveVideoProject: vi.fn<typeof saveVideoProject>(),
    listVideoProjectExports: vi.fn<typeof listVideoProjectExports>(),
    listAllVideoProjects: vi.fn<typeof listAllVideoProjects>(),
    openVideoProject: vi.fn<typeof openVideoProject>(),
    deleteVideoProject: vi.fn<typeof deleteVideoProject>(),
    probeVideoProjectSource: vi.fn<typeof probeVideoProjectSource>(),
    suggestVideoProjectAdjust: vi.fn<typeof suggestVideoProjectAdjust>(),
    startVideoProjectExport: vi.fn<typeof startVideoProjectExport>(),
    cancelVideoProjectExport: vi.fn<typeof cancelVideoProjectExport>(),
  };
});

const startMock = vi.mocked(api.startVideoProject);
const saveMock = vi.mocked(api.saveVideoProject);

function clip(id: string, track: string, kind: VideoProjectClip["kind"]): VideoProjectClip {
  return {
    id,
    track_id: track,
    kind,
    source_id: "src",
    start: 0,
    duration: 4,
    source_in: 0,
    speed: 1,
    link_id: "link",
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    crop: null,
    fit: "fit",
    adjust: restingAdjust(),
    gain: 1,
    fade_in: 0,
    fade_out: 0,
    fade_curve: "equal_power",
    audio_effects: { ...RESTING_EFFECTS },
    title: null,
    keyframes: {
      x: [],
      y: [],
      scale: [],
      rotation: [],
      opacity: [],
      gain: [],
      bass: [],
      mid: [],
      treble: [],
    },
  };
}

const track = (id: string, kind: "video" | "audio", name: string) => ({
  id,
  kind,
  name,
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  gain: 1,
  speech: false,
  sync_lock: true,
  collapsed: false,
});

function startingDocument(): VideoProjectDocument {
  return {
    path: null,
    folder: "C:\\media",
    sources: [{ source_id: "src", state: "ok", path: "C:\\media\\clip.mp4" }],
    project: {
      format_version: 1,
      id: "p",
      name: "clip edit",
      revision: 0,
      created_at: "",
      updated_at: "",
      width: 640,
      height: 360,
      frame_rate: 30,
      background: "#000000",
      initial_source_id: "src",
      sources: [
        {
          id: "src",
          name: "clip.mp4",
          kind: "video",
          size: 10,
          modified_us: 1,
          duration: 4,
          width: 640,
          height: 360,
          frame_rate: 30,
          has_audio: true,
        },
      ],
      tracks: [
        track("v2", "video", "V2"),
        track("v1", "video", "V1"),
        track("a1", "audio", "A1"),
        track("a2", "audio", "A2"),
      ],
      clips: [clip("video", "v1", "video"), clip("sound", "a1", "audio")],
      transitions: [],
      mix: { master_gain: 1, duck_gain: 0.25 },
      markers: [],
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

function renderEditor(onExit = vi.fn<() => void>()) {
  renderWithProviders(
    <VideoEditorWorkspace
      request={{ kind: "video", path: "C:\\media\\clip.mp4" }}
      items={[]}
      onExit={onExit}
      onOpenInGallery={vi.fn<(path: string) => void>()}
    />,
  );
  return onExit;
}

const clips = () =>
  screen.queryAllByRole("button", { name: /^clip\.mp4, 00:00:00:00 to 00:00:04:00/ });

/**
 * Moves the playhead and waits until it reads the new time. The engine learns the project's
 * length in an effect, and a seek before that is clamped to 00:00, so it is retried until then.
 */
async function seekTo(frame: number, timecode: string) {
  const playhead = await screen.findByRole<HTMLInputElement>("slider", { name: "Playhead" });
  await waitFor(() => {
    fireEvent.change(playhead, { target: { value: String(frame) } });
    expect(playhead).toHaveAttribute("aria-valuetext", timecode);
  });
  return playhead;
}

describe("VideoEditorWorkspace", () => {
  beforeEach(() => {
    installMockBackend();
    startMock.mockReset().mockResolvedValue(startingDocument());
    saveMock.mockReset().mockResolvedValue({
      path: "C:\\media\\clip-edit.video-project.json",
      revision: 1,
      updated_at: "",
    });
    vi.mocked(api.listVideoProjectExports).mockResolvedValue({ exports: [] });
    vi.mocked(api.listAllVideoProjects).mockResolvedValue({ projects: [] });
  });

  it("opens on the video at 00:00 with its sound linked on its own track", async () => {
    renderEditor();

    await screen.findByRole("button", { name: "Back to gallery" });
    for (const name of ["V2", "V1", "A1", "A2"]) {
      expect(
        screen.getByRole("button", { name: `${name}, double-click to rename` }),
      ).toBeInTheDocument();
    }
    expect(clips()).toHaveLength(2);
    expect(screen.getByText(/Not saved yet/).closest("[role=status]")).not.toBeNull();
  });

  it("deletes a clip with its linked sound, not while typing, and undoes it", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    fireEvent.keyDown(clips()[0], { key: "Enter" });
    const name = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.keyDown(name, { key: "Delete" });
    expect(clips()).toHaveLength(2);

    fireEvent.keyDown(document.body, { key: "Delete" });
    await waitFor(() => expect(clips()).toHaveLength(0));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(clips()).toHaveLength(2);
  });

  it("saves pending edits before going back to the gallery", async () => {
    const user = userEvent.setup();
    const onExit = renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    const name = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Trip{Enter}");
    await user.click(screen.getByRole("button", { name: "Back to gallery" }));

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(saveMock).toHaveBeenCalledWith(
      "C:\\media",
      null,
      null,
      expect.objectContaining({ name: "Trip" }),
    );
  });

  it("lets the user stay when the last save fails on the way out", async () => {
    const user = userEvent.setup();
    saveMock.mockRejectedValue(new ApiError(500, "Disk full"));
    const onExit = renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    const name = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Trip{Enter}");
    await user.click(screen.getByRole("button", { name: "Back to gallery" }));

    const dialog = await screen.findByRole("alertdialog", {
      name: "Your latest changes are not saved",
    });
    expect(dialog).toHaveTextContent("Disk full");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onExit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("lets the playhead slider reach an end that falls between frames", async () => {
    const document = startingDocument();
    // 4.01 s is 120.3 frames at 30 fps.
    document.project.clips = document.project.clips.map((item) => ({ ...item, duration: 4.01 }));
    startMock.mockResolvedValue(document);
    renderEditor();
    const slider = await screen.findByRole<HTMLInputElement>("slider", { name: "Playhead" });

    // Browsers (unlike jsdom) snap a range to whole steps, so a max between steps is out of reach.
    const steps = (Number(slider.max) - Number(slider.min)) / Number(slider.step);
    expect(steps).toBeCloseTo(Math.round(steps), 6);
    fireEvent.change(slider, { target: { value: slider.max } });

    await waitFor(() => expect(slider.value).toBe(slider.max));
  });

  it("deletes the open project after confirmation and closes the editor", async () => {
    const user = userEvent.setup();
    const saved = { ...startingDocument(), path: "C:\\media\\clip-edit.video-project.json" };
    vi.mocked(api.openVideoProject).mockResolvedValue(saved);
    const remove = vi.mocked(api.deleteVideoProject).mockResolvedValue();
    const onExit = vi.fn<() => void>();
    renderWithProviders(
      <VideoEditorWorkspace
        request={{ kind: "project", path: saved.path }}
        items={[]}
        onExit={onExit}
        onOpenInGallery={vi.fn<(path: string) => void>()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Project actions" }));
    await user.click(screen.getByRole("menuitem", { name: /^Delete project/ }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete project" }));

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(remove).toHaveBeenCalledWith(saved.path);
  });

  it("offers no delete before the project is saved", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: "Project actions" }));
    expect(screen.getByRole("menuitem", { name: /^Delete project/ })).toBeDisabled();
  });

  it("snaps media dropped just right of 00:00 onto 00:00", async () => {
    vi.mocked(api.probeVideoProjectSource).mockResolvedValue({
      path: "/media/other.mp4",
      name: "other.mp4",
      kind: "video",
      size: 99,
      modified_us: 7,
      duration: 2,
      width: 640,
      height: 360,
      frame_rate: 30,
      has_audio: false,
    });
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });
    const lanes = document.querySelector(".video-timeline__lanes") as HTMLElement;

    // jsdom has no DragEvent, so the pointer position is set on the event by hand.
    const drop = createEvent.drop(lanes, {
      dataTransfer: {
        getData: (type: string) => (type === SOURCE_DRAG_TYPE ? "/media/other.mp4" : ""),
      },
    });
    Object.defineProperties(drop, { clientX: { value: 4 }, clientY: { value: 10 } });
    fireEvent(lanes, drop);

    const dropped = await screen.findByRole("button", { name: /^other\.mp4, / });
    expect(dropped.style.left).toBe(`${TIMELINE_ORIGIN_PX}px`);
  });

  it("explains why an edit cannot be made", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    await user.click(screen.getByRole("button", { name: "Add title" }));
    await user.click(screen.getByRole("button", { name: "Add title" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No video track is free at 00:00:00:00 for a title.",
    );
    expect(screen.getAllByRole("button", { name: /^Title, / })).toHaveLength(1);
  });
  it("marks a range with I and O at the playhead, and Escape lets go of it", async () => {
    renderEditor();

    await seekTo(30, "00:00:01:00");
    fireEvent.keyDown(document.body, { key: "i" });
    await seekTo(90, "00:00:03:00");
    fireEvent.keyDown(document.body, { key: "o" });

    expect(await screen.findByText("00:00:01:00 – 00:00:03:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ripple delete" })).toBeEnabled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/00:00:01:00 –/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ripple delete" })).toBeDisabled();
  });

  it("switches tools with their letter keys", async () => {
    renderEditor();
    const blade = await screen.findByRole("button", { name: "Blade" });

    fireEvent.keyDown(document.body, { key: "b" });
    expect(blade).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(document.body, { key: "v" });
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
  });

  it("adds markers with M, steps between them and lists them in the inspector", async () => {
    renderEditor();
    await seekTo(30, "00:00:01:00");
    fireEvent.keyDown(document.body, { key: "m" });
    const playhead = await seekTo(60, "00:00:02:00");
    fireEvent.keyDown(document.body, { key: "m" });

    expect(await screen.findByRole("textbox", { name: "Name of Marker 2" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowUp", shiftKey: true });
    await waitFor(() => expect(playhead).toHaveAttribute("aria-valuetext", "00:00:01:00"));
    fireEvent.keyDown(document.body, { key: "ArrowDown", shiftKey: true });
    await waitFor(() => expect(playhead).toHaveAttribute("aria-valuetext", "00:00:02:00"));
  });

  it("ripple trims the clip under the playhead with Shift+W and selects all with Ctrl+A", async () => {
    renderEditor();
    await seekTo(60, "00:00:02:00");

    fireEvent.keyDown(document.body, { key: "W", shiftKey: true });
    expect(
      await screen.findAllByRole("button", { name: /^clip\.mp4, 00:00:00:00 to 00:00:02:00/ }),
    ).toHaveLength(2);

    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: /^clip\.mp4, / })
          .every((item) => item.getAttribute("aria-pressed") === "true"),
      ).toBe(true),
    );
  });

  it("jumps the playhead to the next and previous clip edge", async () => {
    renderEditor();
    const playhead = await seekTo(30, "00:00:01:00");

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    await waitFor(() => expect(playhead).toHaveAttribute("aria-valuetext", "00:00:04:00"));

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    await waitFor(() => expect(playhead).toHaveAttribute("aria-valuetext", "00:00:00:00"));
  });

  it("puts a slider back to its resting value on a double-click of its label", async () => {
    const document = startingDocument();
    document.project.clips = document.project.clips.map((item) => ({ ...item, fade_in: 1 }));
    startMock.mockResolvedValue(document);
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    fireEvent.keyDown(clips()[0], { key: "Enter" });
    const fadeIn = screen.getByRole<HTMLInputElement>("slider", { name: "Fade in" });
    expect(fadeIn.value).toBe("1");

    fireEvent.doubleClick(screen.getByText("Fade in"));

    await waitFor(() => expect(fadeIn.value).toBe("0"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole<HTMLInputElement>("slider", { name: "Fade in" }).value).toBe("1");
  });

  it("undoes and redoes with the keyboard while a slider still has focus", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });
    fireEvent.keyDown(clips()[0], { key: "Enter" });
    const fadeIn = () => screen.getByRole<HTMLInputElement>("slider", { name: "Fade in" });
    fadeIn().focus();
    fireEvent.change(fadeIn(), { target: { value: "1" } });
    fireEvent.keyUp(fadeIn(), { key: "ArrowRight" });
    expect(fadeIn().value).toBe("1");

    fireEvent.keyDown(fadeIn(), { key: "z", ctrlKey: true });
    await waitFor(() => expect(fadeIn().value).toBe("0"));
    fireEvent.keyUp(fadeIn(), { key: "z" });

    fireEvent.keyDown(fadeIn(), { key: "Z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(fadeIn().value).toBe("1"));
  });

  it("leaves Ctrl+Z to a text field being typed in", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });
    fireEvent.keyDown(clips()[0], { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Delete" });
    await waitFor(() => expect(clips()).toHaveLength(0));

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Project name" }), {
      key: "z",
      ctrlKey: true,
    });
    expect(clips()).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(clips()).toHaveLength(2));
  });
  it("lets Auto read the clip's take and adds its suggestion, then takes it back off", async () => {
    const user = userEvent.setup();
    const suggest = vi.mocked(api.suggestVideoProjectAdjust).mockResolvedValue({
      suggestion: { ...restingAdjust(), exposure: 0.4 },
    });
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    fireEvent.keyDown(clips()[0], { key: "Enter" });
    await user.click(screen.getByRole("button", { name: "Color" }));
    await user.click(screen.getByRole("button", { name: "Auto" }));

    expect(suggest).toHaveBeenCalledWith({
      path: "C:\\media\\clip.mp4",
      start: 0,
      end: 4,
      crop: null,
    });
    const exposure = await screen.findByRole<HTMLInputElement>("slider", { name: "Exposure" });
    await waitFor(() => expect(exposure.value).toBe("0.4"));
    expect(screen.getByRole("slider", { name: "Amount" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Auto" }));

    expect(screen.getByRole<HTMLInputElement>("slider", { name: "Exposure" }).value).toBe("0");
    expect(screen.queryByRole("slider", { name: "Amount" })).not.toBeInTheDocument();
  });

  it("sets a title in an installed font picked from a searchable list", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    await user.click(screen.getByRole("button", { name: "Add title" }));
    await user.click(screen.getByRole("button", { name: "Font: Default" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search fonts" }), "sans");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Sample Sans3",
    ]);
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("button", { name: "Font: Sample Sans" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Font style" }), "Bold");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Font style" }).value).toBe(
      "Bold",
    );
  });
  it("exports from the dialog and follows the export in the top bar", async () => {
    const user = userEvent.setup();
    const running = {
      id: "job",
      folder: "C:\\media",
      status: "running" as const,
      progress: 0.4,
      output_path: "C:\\media\\clip-edited.mp4",
      output_name: "clip-edited.mp4",
      project_name: "clip edit",
      started_at: "",
    };
    vi.mocked(api.startVideoProjectExport).mockResolvedValue(running);
    const cancel = vi
      .mocked(api.cancelVideoProjectExport)
      .mockResolvedValue({ ...running, status: "cancelled" });
    renderEditor();

    await user.click(await screen.findByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export video" });
    await user.click(within(dialog).getByRole("button", { name: "Export" }));

    expect(await screen.findByText("Exporting clip-edited.mp4 40%")).toBeInTheDocument();
    expect(api.startVideoProjectExport).toHaveBeenCalledWith(
      "C:\\media",
      null,
      expect.objectContaining({ export: expect.objectContaining({ filename: "clip-edited" }) }),
      null,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledWith("job");
  });

  it("changes the canvas from the format chip in the top bar", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      await screen.findByRole("button", { name: "Project settings: 640 × 360, 30 fps" }),
    );
    const width = screen.getByRole("textbox", { name: "Width" });
    await user.clear(width);
    await user.type(width, "1280");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(
      await screen.findByRole("button", { name: "Project settings: 1280 × 360, 30 fps" }),
    ).toBeInTheDocument();
  });

  it("splits at the playhead and duplicates from the toolbar", async () => {
    const user = userEvent.setup();
    renderEditor();
    await seekTo(60, "00:00:02:00");

    await user.click(screen.getByRole("button", { name: "Split at playhead" }));
    const halves = () =>
      screen.getAllByRole("button", { name: /^clip\.mp4, 00:00:00:00 to 00:00:02:00/ });
    expect(halves()).toHaveLength(2);

    // The copy lands right after the selection, so the later half is the one with room.
    fireEvent.keyDown(
      screen.getAllByRole("button", { name: /^clip\.mp4, 00:00:02:00 to 00:00:04:00/ })[0],
      {
        key: "Enter",
      },
    );
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(
      screen.getAllByRole("button", { name: /^clip\.mp4, 00:00:04:00 to 00:00:06:00/ }),
    ).toHaveLength(2);
  });

  it("lets go of chosen clips that an undo takes away", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });
    fireEvent.keyDown(clips()[0], { key: "Enter" });
    const everyClip = () => screen.getAllByRole("button", { name: /^clip\.mp4, / });
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(everyClip()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });

    await waitFor(() => expect(everyClip()).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("ripple-deletes a range marked with I and O", async () => {
    const user = userEvent.setup();
    renderEditor();

    await seekTo(30, "00:00:01:00");
    fireEvent.keyDown(document.body, { key: "i" });
    await seekTo(60, "00:00:02:00");
    fireEvent.keyDown(document.body, { key: "o" });
    await user.click(screen.getByRole("button", { name: "Ripple delete" }));

    expect(
      screen.getAllByRole("button", { name: /^clip\.mp4, 00:00:00:00 to 00:00:01:00/ }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: /^clip\.mp4, 00:00:01:00 to 00:00:03:00/ }),
    ).toHaveLength(2);
  });

  it("adds a file from the media browser at the playhead and marks it as used", async () => {
    const user = userEvent.setup();
    vi.mocked(api.probeVideoProjectSource).mockResolvedValue({
      path: "C:\\media\\sky.png",
      name: "sky.png",
      kind: "image",
      size: 5,
      modified_us: 2,
      duration: null,
      width: 640,
      height: 360,
      frame_rate: null,
      has_audio: false,
    });
    renderWithProviders(
      <VideoEditorWorkspace
        request={{ kind: "video", path: "C:\\media\\clip.mp4" }}
        items={[makeItem("sky.png", { path: "C:\\media\\sky.png" })]}
        onExit={vi.fn<() => void>()}
        onOpenInGallery={vi.fn<(path: string) => void>()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Add sky.png to the timeline" }));

    expect(
      await screen.findByRole("button", { name: /^sky\.png, 00:00:00:00 to / }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview sky.png, used on the timeline" }),
    ).toBeInTheDocument();
  });

  it("hides and shows the side panels from the top bar", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(await screen.findByRole("button", { name: "Hide media browser" }));
    await user.click(screen.getByRole("button", { name: "Hide inspector" }));
    expect(screen.queryByRole("complementary", { name: "Media and projects" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Clip inspector" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show media browser" }));
    expect(screen.getByRole("complementary", { name: "Media and projects" })).toBeInTheDocument();
  });

  it("opens another draft from the project menu", async () => {
    const user = userEvent.setup();
    const other = { ...startingDocument(), path: "C:\\media\\other.video-project.json" };
    other.project = { ...other.project, name: "Other cut" };
    vi.mocked(api.listAllVideoProjects).mockResolvedValue({
      projects: [
        { path: other.path, name: "Other cut", updated_at: "", duration: 4, clip_count: 2 },
      ],
    });
    vi.mocked(api.openVideoProject).mockResolvedValue(other);
    renderEditor();

    await user.click(await screen.findByRole("button", { name: "Project actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Open project..." }));
    await user.click(await screen.findByRole("button", { name: "Open Other cut" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("Other cut"),
    );
  });

  it("moves the app to a draft's other folder, then opens it in place", async () => {
    const user = userEvent.setup();
    const elsewhere = "C:\\trips\\beach-edit.video-project.json";
    vi.mocked(api.listAllVideoProjects).mockResolvedValue({
      projects: [{ path: elsewhere, name: "Beach", updated_at: "", duration: 4, clip_count: 2 }],
    });
    const saved = saveMock.getMockImplementation();
    saveMock.mockRejectedValue(new ApiError(500, "The disk is full"));
    const beach = { ...startingDocument(), path: elsewhere, folder: "C:\\trips" };
    beach.project = { ...beach.project, name: "Beach" };
    vi.mocked(api.openVideoProject).mockResolvedValue(beach);
    const onOpenProject = vi.fn<(path: string) => Promise<void>>(async () => {});
    renderWithProviders(
      <VideoEditorWorkspace
        request={{ kind: "video", path: "C:\\media\\clip.mp4" }}
        items={[]}
        onExit={vi.fn<() => void>()}
        onOpenInGallery={vi.fn<(path: string) => void>()}
        onOpenProject={onOpenProject}
      />,
    );
    const name = await screen.findByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Changed{Enter}");
    await user.click(screen.getByRole("tab", { name: "Projects" }));

    await user.click(await screen.findByRole("button", { name: "Open Beach" }));
    expect(
      await screen.findByText("Save this project before opening another; it has unsaved changes."),
    ).toBeInTheDocument();
    expect(onOpenProject).not.toHaveBeenCalled();

    saveMock.mockImplementation(saved!);
    await user.click(screen.getByRole("button", { name: "Open Beach" }));
    await waitFor(() => expect(name).toHaveValue("Beach"));
    expect(onOpenProject).toHaveBeenCalledWith(elsewhere);
    expect(api.openVideoProject).toHaveBeenCalledWith(elsewhere);
    // Still the same session: the browser stays on its tab.
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
  });

  it("relinks a missing source to another file of the folder", async () => {
    const user = userEvent.setup();
    const document = startingDocument();
    document.sources = [{ source_id: "src", state: "missing", path: "C:\\media\\clip.mp4" }];
    startMock.mockResolvedValue(document);
    vi.mocked(api.probeVideoProjectSource).mockResolvedValue({
      path: "C:\\media\\take2.mp4",
      name: "take2.mp4",
      kind: "video",
      size: 11,
      modified_us: 3,
      duration: 4,
      width: 640,
      height: 360,
      frame_rate: 30,
      has_audio: true,
    });
    renderWithProviders(
      <VideoEditorWorkspace
        request={{ kind: "video", path: "C:\\media\\clip.mp4" }}
        items={[makeItem("take2.mp4", { path: "C:\\media\\take2.mp4", media_type: "video" })]}
        onExit={vi.fn<() => void>()}
        onOpenInGallery={vi.fn<(path: string) => void>()}
      />,
    );

    const choice = await screen.findByRole("combobox", { name: "Replacement for clip.mp4" });
    await user.selectOptions(choice, "C:\\media\\take2.mp4");
    await user.click(screen.getByRole("button", { name: "Relink" }));

    await waitFor(() => expect(screen.queryByText(/needs attention/)).not.toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^take2\.mp4, / })).toHaveLength(2);
  });

  it("zooms the timeline with the keyboard and fits it again", async () => {
    renderEditor();
    const zoom = await screen.findByRole<HTMLInputElement>("slider", { name: "Timeline zoom" });
    fireEvent.keyDown(document.body, { key: "Z", shiftKey: true });
    const fitted = Number(zoom.value);

    fireEvent.keyDown(document.body, { key: "-" });
    expect(Number(zoom.value)).toBeLessThan(fitted);
    fireEvent.keyDown(document.body, { key: "Z", shiftKey: true });
    expect(Number(zoom.value)).toBeCloseTo(fitted);
  });
  it("reopens with the panels laid out as they were left", async () => {
    window.localStorage.setItem(
      "video-editor-layout",
      JSON.stringify({ browserOpen: false, inspectorOpen: true, timeline: 400, guides: true }),
    );
    renderEditor();

    await screen.findByRole("button", { name: "Show media browser" });
    expect(screen.queryByRole("complementary", { name: "Media and projects" })).toBeNull();
    expect(screen.getByRole("button", { name: "Safe-area guides" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    window.localStorage.removeItem("video-editor-layout");
  });

  it("resizes the timeline from its splitter and puts it back on a double-click", async () => {
    renderEditor();
    const splitter = await screen.findByRole("separator", { name: "Timeline height" });
    const frame = document.querySelector<HTMLElement>(".video-editor__frame")!;
    const height = () => frame.style.getPropertyValue("--timeline-height");
    const start = height();

    fireEvent.keyDown(splitter, { key: "ArrowUp", shiftKey: true });
    expect(height()).not.toBe(start);
    fireEvent.doubleClick(splitter);
    expect(height()).toBe(start);
  });

  it("hands the transport keys to the source monitor while it shows a file", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderWithProviders(
      <VideoEditorWorkspace
        request={{ kind: "video", path: "C:\\media\\clip.mp4" }}
        items={[makeItem("take.mp4", { path: "C:\\media\\take.mp4", media_type: "video" })]}
        onExit={vi.fn<() => void>()}
        onOpenInGallery={vi.fn<(path: string) => void>()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Preview take.mp4" }));
    expect(screen.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.body, { key: " " });
    expect(play).toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    fireEvent.keyDown(document.body, { key: "End" });
    expect(screen.getByRole("slider", { name: "Playhead" })).toHaveAttribute(
      "aria-valuetext",
      "00:00:04:00",
    );
    play.mockRestore();
  });

  it("explains that there is nothing to delete or ripple yet", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Select clips to delete");
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));

    fireEvent.keyDown(document.body, { key: "Delete", shiftKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Mark a range first");
  });

  it("adds a cross-dissolve between two stills and removes it with Delete", async () => {
    const user = userEvent.setup();
    const document = startingDocument();
    document.project.clips = [
      { ...clip("one", "v1", "image"), link_id: null, duration: 2 },
      { ...clip("two", "v1", "image"), link_id: null, start: 2, duration: 2 },
    ];
    startMock.mockResolvedValue(document);
    renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    fireEvent.keyDown(
      screen.getAllByRole("button", { name: /^clip\.mp4, 00:00:00:00 to 00:00:02:00/ })[0],
      {
        key: "Enter",
      },
    );
    await user.click(screen.getByRole("button", { name: /Add cross-dissolve/ }));
    expect(await screen.findByRole("heading", { name: "Cross-dissolve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cross-dissolve, / })).toBeInTheDocument();

    fireEvent.keyDown(window.document.body, { key: "Delete" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Cross-dissolve, / })).toBeNull(),
    );
  });

  it("opens a finished export in the gallery once the project is saved", async () => {
    const user = userEvent.setup();
    const onOpenInGallery = vi.fn<(path: string) => void>();
    vi.mocked(api.listVideoProjectExports).mockResolvedValue({
      exports: [
        {
          id: "done",
          folder: "C:\\media",
          status: "completed",
          progress: 1,
          output_path: "C:\\media\\clip-edited.mp4",
          output_name: "clip-edited.mp4",
          project_name: "clip edit",
          project_path: "C:\\media\\clip-edit.video-project.json",
          started_at: "",
        },
      ],
    });
    const saved = { ...startingDocument(), path: "C:\\media\\clip-edit.video-project.json" };
    vi.mocked(api.openVideoProject).mockResolvedValue(saved);
    renderWithProviders(
      <VideoEditorWorkspace
        request={{ kind: "project", path: saved.path }}
        items={[]}
        onExit={vi.fn<() => void>()}
        onOpenInGallery={onOpenInGallery}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Open in gallery" }));

    await waitFor(() => expect(onOpenInGallery).toHaveBeenCalledWith("C:\\media\\clip-edited.mp4"));
  });

  it("leaves without saving when the user gives up on a failed save", async () => {
    const user = userEvent.setup();
    saveMock.mockRejectedValue(new ApiError(500, "Disk full"));
    const onExit = renderEditor();
    await screen.findByRole("button", { name: "Back to gallery" });

    const name = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Trip{Enter}");
    await user.click(screen.getByRole("button", { name: "Back to gallery" }));
    await user.click(await screen.findByRole("button", { name: "Retry save" }));
    expect(onExit).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalled();
  });
});
