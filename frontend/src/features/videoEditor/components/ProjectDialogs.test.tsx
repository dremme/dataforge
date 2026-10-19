import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import { ExportDialog } from "./ExportDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import type { Project } from "@/features/videoEditor/lib/timeline";
import type { VideoProjectExportSettings, VideoProjectExportSpan } from "@/shared/types";

type Settings = Pick<Project, "width" | "height" | "frame_rate" | "background">;

describe("ProjectSettingsDialog", () => {
  const project = makeProject({
    sources: [
      makeSource("still", "still.png", "image"),
      makeSource("film", "film.mp4", "video", { width: 1280, height: 720, frame_rate: 25 }),
    ],
  });

  function open(shown: Project = project) {
    const onSave = vi.fn<(patch: Settings) => void>();
    render(
      <ProjectSettingsDialog project={shown} onSave={onSave} onCancel={vi.fn<() => void>()} />,
    );
    return { user: userEvent.setup(), onSave };
  }

  const field = (name: string) => screen.getByRole<HTMLInputElement>("textbox", { name });
  const select = (name: string) => screen.getByRole<HTMLSelectElement>("combobox", { name });
  const selected = (name: string) => select(name).selectedOptions[0].textContent;

  it("matches a video of the project and applies its size and rate", async () => {
    const { user, onSave } = open();

    await user.selectOptions(select("Match a video"), "film");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledWith({
      width: 1280,
      height: 720,
      frame_rate: 25,
      background: "#000000",
    });
  });

  it("rounds an odd size down to even, as the encoder needs", async () => {
    const { user, onSave } = open();

    await user.clear(field("Width"));
    await user.type(field("Width"), "1001");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ width: 1000, height: 360 }));
  });

  it("explains an out-of-range value and will not apply it", async () => {
    const { user } = open();

    await user.clear(field("FPS"));
    await user.type(field("FPS"), "500");

    expect(screen.getByText("The frame rate must be above 0 and at most 120.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("reads the presets back from the size and fills the size from them", async () => {
    const { user } = open(makeProject({ width: 1280, height: 720 }));
    expect(selected("Aspect ratio")).toBe("16:9");
    expect(selected("Resolution")).toBe("720p HD");

    await user.selectOptions(select("Aspect ratio"), "4:3");
    expect([field("Width"), field("Height")].map((input) => input.value)).toEqual(["960", "720"]);

    await user.click(screen.getByRole("button", { name: "Swap width and height" }));
    expect([field("Width"), field("Height")].map((input) => input.value)).toEqual(["720", "960"]);
    expect(selected("Aspect ratio")).toBe("3:4");

    await user.selectOptions(select("Resolution"), "1080p");
    expect([field("Width"), field("Height")].map((input) => input.value)).toEqual(["1080", "1440"]);
    expect(screen.getByText("1080 × 1440 · 3:4 · 30 fps")).toBeInTheDocument();
  });

  it("shows a size no preset names as Custom", async () => {
    const { user } = open(makeProject({ width: 1280, height: 720 }));

    await user.clear(field("Width"));
    await user.type(field("Width"), "1000");
    expect(selected("Aspect ratio")).toBe("Custom");
    expect(screen.getByText(/1000 × 720 · 1\.39:1/)).toBeInTheDocument();

    await user.clear(field("Height"));
    await user.type(field("Height"), "500");
    expect(selected("Aspect ratio")).toBe("2:1");
    expect(selected("Resolution")).toBe("Custom");
  });

  it("stores an NTSC preset rate exactly", async () => {
    const { user, onSave } = open();

    await user.selectOptions(select("Frame rate"), "29.97");
    expect(field("FPS")).toHaveValue("29.97");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ frame_rate: 30000 / 1001 }));
  });

  it("calls a rate no preset names Custom", async () => {
    const { user, onSave } = open();

    await user.clear(field("FPS"));
    await user.type(field("FPS"), "12.5");
    expect(selected("Frame rate")).toBe("Custom");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ frame_rate: 12.5 }));
  });

  it("applies the background color", async () => {
    const { onSave } = open();

    fireEvent.input(screen.getByLabelText("Background"), { target: { value: "#203040" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ background: "#203040" }));
  });
});

describe("ExportDialog", () => {
  const project = makeProject({
    initial_source_id: "film",
    sources: [makeSource("film", "trip.mp4", "video")],
    clips: [makeClip("shot", "v1", 0, 2, { kind: "video", source_id: "film" })],
  });

  it("names the file after the first video and exports with the chosen settings", async () => {
    const user = userEvent.setup();
    const onExport =
      vi.fn<(settings: VideoProjectExportSettings, span: VideoProjectExportSpan | null) => void>();
    render(
      <ExportDialog
        project={project}
        range={null}
        selectionSpan={null}
        busy={false}
        error={null}
        blocked={null}
        onExport={onExport}
        onCancel={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "File name" })).toHaveValue("trip-edited");

    await user.selectOptions(screen.getByRole("combobox", { name: "Size" }), "1080p");
    await user.click(screen.getByRole("radio", { name: "Portrait" }));
    expect(screen.getByText(/MP4 · 1080 × 1920/)).toBeInTheDocument();
    const estimate = () =>
      /about [\d.]+ [KMG]?B/.exec(screen.getByText(/MP4 · 1080 × 1920/).textContent!)?.[0];
    const standard = estimate();
    expect(standard).toBeDefined();
    await user.click(screen.getByRole("radio", { name: "Smaller file" }));
    expect(estimate()).not.toBe(standard);
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "trip-edited", size: "1080p", orientation: "portrait" }),
      null,
    );
  });

  it("sizes a preset to the project's own aspect", async () => {
    const user = userEvent.setup();
    render(
      <ExportDialog
        project={{ ...project, width: 2580, height: 1080 }}
        range={null}
        selectionSpan={null}
        busy={false}
        error={null}
        blocked={null}
        onExport={vi.fn<
          (settings: VideoProjectExportSettings, span: VideoProjectExportSpan | null) => void
        >()}
        onCancel={vi.fn<() => void>()}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Size" }), "720p");

    expect(screen.getByRole("option", { name: "720p (1720 × 720)" })).toBeInTheDocument();
    expect(screen.getByText(/MP4 · 1720 × 720/)).toBeInTheDocument();
  });

  it("limits the mix's peaks unless asked to normalize or leave it as mixed", async () => {
    const user = userEvent.setup();
    const onExport =
      vi.fn<(settings: VideoProjectExportSettings, span: VideoProjectExportSpan | null) => void>();
    render(
      <ExportDialog
        project={project}
        range={null}
        selectionSpan={null}
        busy={false}
        error={null}
        blocked={null}
        onExport={onExport}
        onCancel={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByRole("radio", { name: "Limit peaks" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Normalize" }));
    expect(screen.getByText(/Brings the whole mix to -14 LUFS/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ audio_level: "normalize" }),
      null,
    );
  });

  it("exports the marked range under its own name and leaves the caption out", async () => {
    const user = userEvent.setup();
    const onExport =
      vi.fn<(settings: VideoProjectExportSettings, span: VideoProjectExportSpan | null) => void>();
    render(
      <ExportDialog
        project={project}
        range={{ start: 0.5, end: 1.5 }}
        selectionSpan={null}
        busy={false}
        error={null}
        blocked={null}
        onExport={onExport}
        onCancel={vi.fn<() => void>()}
      />,
    );
    expect(screen.queryByRole("radio", { name: /Selected clips/ })).toBeNull();

    await user.click(screen.getByRole("radio", { name: /Marked range/ }));
    expect(screen.getByRole("textbox", { name: "File name" })).toHaveValue("trip-edited-range");
    expect(screen.getByRole("checkbox", { name: /caption/ })).toBeDisabled();
    expect(screen.getByText(/MP4 · (1280 × 720|640 × 360)/).textContent).toContain("00:00:01:00");
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "trip-edited-range" }),
      { start: 0.5, end: 1.5 },
    );
  });

  it("says why an export cannot start and keeps the button off", () => {
    render(
      <ExportDialog
        project={project}
        range={null}
        selectionSpan={null}
        busy={false}
        error="Disk full"
        blocked="The timeline is empty."
        onExport={vi.fn<
          (settings: VideoProjectExportSettings, span: VideoProjectExportSpan | null) => void
        >()}
        onCancel={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByText("The timeline is empty.")).toBeInTheDocument();
    expect(screen.getByText("Disk full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
