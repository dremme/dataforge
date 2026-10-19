import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import { ExportDialog } from "./ExportDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import type { Project } from "@/features/videoEditor/lib/timeline";
import type { VideoProjectExportSettings, VideoProjectExportSpan } from "@/shared/types";

describe("ProjectSettingsDialog", () => {
  const project = makeProject({
    sources: [
      makeSource("still", "still.png", "image"),
      makeSource("film", "film.mp4", "video", { width: 1280, height: 720, frame_rate: 25 }),
    ],
  });

  it("matches a video of the project and applies its size and rate", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(patch: Pick<Project, "width" | "height" | "frame_rate">) => void>();
    render(
      <ProjectSettingsDialog project={project} onSave={onSave} onCancel={vi.fn<() => void>()} />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Match a video" }), "film");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledWith({ width: 1280, height: 720, frame_rate: 25 });
  });

  it("rounds an odd size down to even, as the encoder needs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(patch: Pick<Project, "width" | "height" | "frame_rate">) => void>();
    render(
      <ProjectSettingsDialog project={project} onSave={onSave} onCancel={vi.fn<() => void>()} />,
    );

    await user.clear(screen.getByRole("textbox", { name: "Width" }));
    await user.type(screen.getByRole("textbox", { name: "Width" }), "1001");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledWith({ width: 1000, height: 360, frame_rate: 30 });
  });

  it("explains an out-of-range value and will not apply it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(patch: Pick<Project, "width" | "height" | "frame_rate">) => void>();
    render(
      <ProjectSettingsDialog project={project} onSave={onSave} onCancel={vi.fn<() => void>()} />,
    );

    await user.clear(screen.getByRole("textbox", { name: "Frame rate" }));
    await user.type(screen.getByRole("textbox", { name: "Frame rate" }), "500");

    expect(screen.getByText("The frame rate must be above 0 and at most 120.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
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

    await user.click(screen.getByRole("radio", { name: "1080p" }));
    await user.click(screen.getByRole("radio", { name: "Portrait" }));
    expect(screen.getByText(/1080 × 1920/)).toBeInTheDocument();
    const estimate = () =>
      /about [\d.]+ [KMG]?B/.exec(screen.getByText(/1080 × 1920/).textContent!)?.[0];
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
    expect(screen.getByText(/1280 × 720|640 × 360/).textContent).toContain("00:00:01:00");
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
