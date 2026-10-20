import { useState, type ComponentProps } from "react";
import { createEvent, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemDialog";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MediaBrowser, type MediaView } from "./MediaBrowser";
import { SOURCE_DRAG_TYPE } from "./Timeline";
import type { GalleryItem } from "@/shared/types";

const ITEMS = [
  makeItem("beach.mp4", { media_type: "video", duration: 65 }),
  makeItem("sunset.jpg"),
  makeItem("tone.wav", { media_type: "audio", duration: 2 }),
  makeItem("notes.txt"),
];

/** Holds the tab and view the way the workspace does, so switching them shows. */
function Harness(props: Partial<ComponentProps<typeof MediaBrowser>>) {
  const [tab, setTab] = useState<"media" | "projects">("media");
  const [view, setView] = useState<MediaView>("grid");
  return (
    <MediaBrowser
      tab={tab}
      onTab={setTab}
      items={ITEMS}
      usedPaths={new Set([ITEMS[0].path])}
      view={view}
      onView={setView}
      previewing={null}
      currentProjectPath={null}
      onPreview={vi.fn<(item: GalleryItem) => void>()}
      onAdd={vi.fn<(item: GalleryItem) => void>()}
      onOpenProject={vi.fn<(path: string) => void>()}
      {...props}
    />
  );
}

const media = () => screen.getAllByRole("button", { name: /^Preview / });

describe("MediaBrowser", () => {
  it("lists the editor's media with counts, filtered by kind and by name", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderWithProviders(<Harness />);

    expect(media()).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /^All\s*3$/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("radio", { name: /^Audio\s*1$/ }));
    expect(media().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Preview tone.wav",
    ]);

    await user.click(screen.getByRole("radio", { name: /^All\s*3$/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search filenames" }), "zzz");
    expect(screen.getByText("Nothing matches the search and filter.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(media()).toHaveLength(3);
  });

  it("marks files already on the timeline and switches between tiles and a list", async () => {
    const user = userEvent.setup();
    installMockBackend();
    const { container } = renderWithProviders(<Harness />);

    expect(
      screen.getByRole("button", { name: "Preview beach.mp4, used on the timeline" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show as a list" }));
    expect(container.querySelector(".video-editor__media-list--list")).not.toBeNull();
    expect(screen.getByText("01:05 · on timeline")).toBeInTheDocument();
  });

  it("previews, adds and drags a file", async () => {
    const user = userEvent.setup();
    installMockBackend();
    const onPreview = vi.fn<(item: GalleryItem) => void>();
    const onAdd = vi.fn<(item: GalleryItem) => void>();
    renderWithProviders(<Harness onPreview={onPreview} onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: "Preview sunset.jpg" }));
    await user.click(screen.getByRole("button", { name: "Add sunset.jpg to the timeline" }));
    const row = screen.getByRole("button", { name: "Preview sunset.jpg" }).closest("li")!;
    const setData = vi.fn<(format: string, data: string) => void>();
    fireEvent(row, createEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: "" } }));

    expect(onPreview).toHaveBeenCalledWith(ITEMS[1]);
    expect(onAdd).toHaveBeenCalledWith(ITEMS[1]);
    expect(setData).toHaveBeenCalledWith(SOURCE_DRAG_TYPE, ITEMS[1].path);
  });

  it("says when a folder has nothing the editor can use", () => {
    installMockBackend();
    renderWithProviders(<Harness items={[makeItem("notes.txt")]} />);

    expect(screen.getByText(/This folder has no MP4/)).toBeInTheDocument();
  });

  it("lists drafts from every folder, newest first, and opens one", async () => {
    const user = userEvent.setup();
    const draft = (folder: string, name: string, updated_at: string) => ({
      path: `${folder}\\${name}.video-project.json`,
      name,
      updated_at,
      duration: 12,
      clip_count: 3,
    });
    const trip = draft(VACATION_PATH, "Trip", "2026-10-02T10:00:00Z");
    const party = draft(HOME_PATH, "Party", "2026-10-01T10:00:00Z");
    installMockBackend({ videoProjects: { [HOME_PATH]: [party], [VACATION_PATH]: [trip] } });
    const onOpenProject = vi.fn<(path: string) => void>();
    renderWithProviders(<Harness currentProjectPath={party.path} onOpenProject={onOpenProject} />);

    await user.click(screen.getByRole("tab", { name: "Projects" }));
    await user.click(await screen.findByRole("button", { name: "Open Trip" }));

    expect(onOpenProject).toHaveBeenCalledWith(trip.path);
    const rows = screen.getAllByRole("button", { name: /^Open / });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Open Trip", "Open Party"]);
    expect(within(rows[0]).getByText("Vacation")).toHaveAttribute("title", VACATION_PATH);
    expect(within(rows[1]).getByText("Photos")).toHaveAttribute("title", HOME_PATH);
    expect(rows[1]).toBeDisabled();
    expect(within(rows[1]).getByText("Open")).toBeInTheDocument();
  });

  it("says so when there are no drafts yet", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole("tab", { name: "Projects" }));

    expect(await screen.findByText("No saved drafts yet.")).toBeInTheDocument();
  });
});
