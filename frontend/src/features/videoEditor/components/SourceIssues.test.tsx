import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeItem } from "@/test/galleryItemDialog";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import { SourceIssues } from "./SourceIssues";
import type { GalleryItem } from "@/shared/types";

const project = makeProject({
  sources: [makeSource("gone", "gone.png", "image"), makeSource("edited", "edited.png", "image")],
  clips: [
    makeClip("one", "v1", 0, 2, { source_id: "gone" }),
    makeClip("two", "v1", 2, 2, { source_id: "edited" }),
  ],
});

function renderIssues(busy = false) {
  const onRelink = vi.fn<(sourceId: string, item: GalleryItem) => void>();
  const onAccept = vi.fn<(sourceId: string) => void>();
  const view = render(
    <SourceIssues
      project={project}
      statuses={[
        { source_id: "gone", state: "missing", path: "/media/gone.png" },
        { source_id: "edited", state: "changed", path: "/media/edited.png" },
      ]}
      items={[makeItem("other.png"), makeItem("clip.mp4", { media_type: "video" })]}
      busy={busy}
      onRelink={onRelink}
      onAccept={onAccept}
    />,
  );
  return { onRelink, onAccept, ...view };
}

describe("SourceIssues", () => {
  it("lists each source in trouble and relinks one to a file of its kind", async () => {
    const user = userEvent.setup();
    const { onRelink } = renderIssues();

    expect(screen.getByRole("alert")).toHaveTextContent("2 sources need attention");
    const choice = screen.getByRole("combobox", { name: "Replacement for gone.png" });
    expect([...choice.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "",
      expect.stringMatching(/other\.png$/),
    ]);
    await user.selectOptions(choice, choice.querySelectorAll("option")[1]);
    await user.click(screen.getAllByRole("button", { name: "Relink" })[0]);

    expect(onRelink).toHaveBeenCalledWith("gone", expect.objectContaining({ name: "other.png" }));
  });

  it("accepts a changed file as it now is", async () => {
    const user = userEvent.setup();
    const { onAccept } = renderIssues();

    await user.click(screen.getByRole("button", { name: "Use the changed file" }));

    expect(onAccept).toHaveBeenCalledWith("edited");
  });

  it("holds every action while a relink is under way", () => {
    renderIssues(true);

    expect(screen.getByRole("button", { name: "Use the changed file" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Replacement for gone.png" })).toBeDisabled();
  });

  it("stays out of the way when every source is fine", () => {
    const { container } = render(
      <SourceIssues
        project={project}
        statuses={[]}
        items={[]}
        busy={false}
        onRelink={vi.fn<(sourceId: string, item: GalleryItem) => void>()}
        onAccept={vi.fn<(sourceId: string) => void>()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
