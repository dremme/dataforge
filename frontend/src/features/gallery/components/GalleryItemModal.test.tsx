import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH, homeBrowse } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import type { GalleryItem } from "@/shared/types";
import { formatModifiedAt } from "@/shared/lib/format";
import * as useCopyFeedbackModule from "@/shared/hooks/useCopyFeedback";
import { GalleryItemModal } from "./GalleryItemModal";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

function makeItem(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `${HOME_PATH}\\${name}`,
    description: "Golden hour over the lake",
    has_description: true,
    has_caption_file: true,
    issue: null,
    issue_suggestions: null,
    has_issue_file: false,
    has_bboxes: false,
    caption_status: "text",
    caption_file_type: "txt",
    media_type: "image",
    modified_at: "2026-03-15T14:30:00.000Z",
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

describe("GalleryItemModal", () => {
  beforeEach(() => {
    installMockBackend();
  });

  it("shows the modified date in the media meta section", async () => {
    render(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const modifiedLabel = formatModifiedAt("2026-03-15T14:30:00.000Z");
    expect(modifiedLabel).not.toBeNull();
    expect(within(dialog).getByText("Modified")).toBeInTheDocument();
    expect(within(dialog).getByText(modifiedLabel!)).toBeInTheDocument();
  });

  it("copies the caption without re-fetch loops", async () => {
    const user = userEvent.setup();
    const onCaptionSaved = vi.fn();
    const copyText = vi.fn().mockResolvedValue(true);

    vi.spyOn(useCopyFeedbackModule, "useCopyFeedback").mockReturnValue({
      copyState: "idle",
      copyLabel: "Copy",
      copyText,
    });

    render(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });

    await waitFor(() => {
      expect(onCaptionSaved).toHaveBeenCalledTimes(1);
    });

    const copyButton = within(dialog).getByRole("button", { name: "Copy" });
    expect(copyButton).not.toBeDisabled();

    await user.click(copyButton);

    expect(copyText).toHaveBeenCalledWith("Golden hour over the lake");
    expect(onCaptionSaved).toHaveBeenCalledTimes(1);
  });

  it("reflects background caption updates while the modal stays open", async () => {
    const onCaptionSaved = vi.fn();
    const initialItem = makeItem("sunset.png");
    const updatedItem = {
      ...initialItem,
      description: "Updated by a background folder refresh",
    };

    const { rerender } = render(
      <GalleryItemModal
        items={[initialItem]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    const caption = within(dialog).getByRole("textbox", { name: "Caption for sunset.png" });

    await waitFor(() => {
      expect(caption).toHaveValue("Golden hour over the lake");
    });

    rerender(
      <GalleryItemModal
        items={[updatedItem]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    await waitFor(() => {
      expect(caption).toHaveValue("Updated by a background folder refresh");
    });
  });

  it("opens the JSON editor for Ideogram captions", async () => {
    const user = userEvent.setup();
    const jsonItem = makeItem("scene.png", {
      description: "JSON scene caption",
      caption_file_type: "json",
    });
    const jsonContent = JSON.stringify(
      {
        description: "JSON scene caption",
      },
      null,
      2,
    );

    installMockBackend({
      browseByPath: {
        [HOME_PATH]: {
          ...homeBrowse,
          items: [...homeBrowse.items, jsonItem],
        },
      },
    });

    render(
      <GalleryItemModal
        items={[jsonItem]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing scene.png" });

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Edit .json caption" })).not.toBeDisabled();
    });

    await user.click(within(dialog).getByRole("button", { name: "Edit .json caption" }));

    const jsonEditor = await screen.findByRole("dialog", {
      name: "Edit .json caption for scene.png",
    });
    const jsonInput = within(jsonEditor).getByRole("textbox", {
      name: ".json caption for scene.png",
    });

    expect(jsonInput).toHaveValue(jsonContent);
  });

  it("deletes the file after confirmation", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const items = [
      makeItem("sunset.png"),
      makeItem("beach.jpg", { name: "beach.jpg", path: `${HOME_PATH}\\beach.jpg` }),
    ];

    render(
      <GalleryItemModal
        items={items}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sunset.png" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith(`${HOME_PATH}\\sunset.png`);
    });
  });

  it("opens images in the image preview", async () => {
    const user = userEvent.setup();

    render(
      <GalleryItemModal
        items={[makeItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Open in image preview" }));

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "Open in image preview" }),
      ).not.toBeDisabled();
    });
  });

  it("does not offer image preview for videos", async () => {
    render(
      <GalleryItemModal
        items={[
          makeItem("clip.mp4", {
            media_type: "video",
            caption_file_type: null,
          }),
        ]}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing clip.mp4" });
    expect(
      within(dialog).queryByRole("button", { name: "Open in image preview" }),
    ).not.toBeInTheDocument();
  });

  it("navigates within the filtered item list only", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const items = [
      makeItem("sunset.png"),
      makeItem("beach.jpg", {
        description: null,
        has_description: false,
        has_caption_file: false,
        caption_status: "none",
        caption_file_type: null,
      }),
    ];

    render(
      <GalleryItemModal
        items={items}
        index={0}
        onClose={vi.fn()}
        onPrevious={vi.fn()}
        onNext={onNext}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(within(dialog).getByText("1 / 2")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Next item" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
