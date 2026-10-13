import { useState, type ComponentProps } from "react";
import { createEvent, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemModal";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MediaBrowser, type MediaView } from "./MediaBrowser";
import { SOURCE_DRAG_TYPE } from "./Timeline";

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
      folder={HOME_PATH}
      items={ITEMS}
      usedPaths={new Set([ITEMS[0].path])}
      view={view}
      onView={setView}
      previewing={null}
      currentProjectPath={null}
      onPreview={vi.fn()}
      onAdd={vi.fn()}
      onOpenProject={vi.fn()}
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
    const onPreview = vi.fn();
    const onAdd = vi.fn();
    renderWithProviders(<Harness onPreview={onPreview} onAdd={onAdd} />);

    await user.click(screen.getByRole("button", { name: "Preview sunset.jpg" }));
    await user.click(screen.getByRole("button", { name: "Add sunset.jpg to the timeline" }));
    const row = screen.getByRole("button", { name: "Preview sunset.jpg" }).closest("li")!;
    const setData = vi.fn();
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

  it("lists the folder's drafts and opens one, the open draft staying put", async () => {
    const user = userEvent.setup();
    const draft = (name: string) => ({
      path: `${HOME_PATH}\\${name}.video-project.json`,
      name,
      updated_at: "2026-10-01T10:00:00Z",
      duration: 12,
      clip_count: 3,
    });
    installMockBackend({ videoProjects: { [HOME_PATH]: [draft("Trip"), draft("Party")] } });
    const onOpenProject = vi.fn();
    renderWithProviders(
      <Harness currentProjectPath={draft("Party").path} onOpenProject={onOpenProject} />,
    );

    await user.click(screen.getByRole("tab", { name: "Projects" }));
    await user.click(await screen.findByRole("button", { name: "Open Trip" }));

    expect(onOpenProject).toHaveBeenCalledWith(draft("Trip").path);
    const open = screen.getByRole("button", { name: "Open Party" });
    expect(open).toBeDisabled();
    expect(within(open).getByText("Open")).toBeInTheDocument();
  });

  it("says so when the folder has no drafts yet", async () => {
    const user = userEvent.setup();
    installMockBackend();
    renderWithProviders(<Harness />);

    await user.click(screen.getByRole("tab", { name: "Projects" }));

    expect(await screen.findByText("No saved drafts in this folder yet.")).toBeInTheDocument();
  });
});
