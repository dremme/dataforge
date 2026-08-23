import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import type { GalleryItem } from "@/shared/types";
import { IssueResolverModal } from "./IssueResolverModal";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

function makeIssueItem(name: string, overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name,
    path: `${HOME_PATH}\\${name}`,
    description: "A red car in the street.",
    has_description: true,
    has_caption_file: true,
    issue_fixes: [
      'Replace "a blue car" with "a red car".',
      'Remove "parked at the curb" - the car is moving.',
    ],
    has_issue_file: true,
    has_duplicate_file: false,
    has_backup: false,
    caption_status: "text",
    media_type: "image",
    ...overrides,
  };
}

describe("IssueResolverModal", () => {
  beforeEach(() => {
    installMockBackend();
  });

  it("lists the suggested changes in order alongside the caption editor", async () => {
    render(
      <IssueResolverModal
        items={[
          makeIssueItem("sunset.png", {
            description: "Golden hour over the lake",
          }),
        ]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });

    expect(within(dialog).getByText("Suggested changes")).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((entry) => entry.textContent),
    ).toEqual([
      'Replace "a blue car" with "a red car".',
      'Remove "parked at the curb" - the car is moving.',
    ]);

    await waitFor(() => {
      expect(screen.getByLabelText("Caption for sunset.png")).toHaveValue(
        "Golden hour over the lake",
      );
    });
  });

  it("renders a single fix without turning it into a list of one", async () => {
    render(
      <IssueResolverModal
        items={[makeIssueItem("sunset.png", { issue_fixes: ['Change "seated" to "kneeling".'] })]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });

    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(dialog).toHaveTextContent('Change "seated" to "kneeling".');
  });

  it("falls back to an error line when the issue file carries no fixes", async () => {
    render(
      <IssueResolverModal
        items={[makeIssueItem("sunset.png", { issue_fixes: [] })]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });

    expect(within(dialog).getByText("Error in issue file")).toBeInTheDocument();
    expect(within(dialog).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows resolution and live character count in the meta row", async () => {
    const user = userEvent.setup();
    const caption = "Golden hour over the lake";

    render(
      <IssueResolverModal
        items={[
          makeIssueItem("sunset.png", {
            description: caption,
            width: 1920,
            height: 1080,
          }),
        ]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Caption for sunset.png")).toHaveValue(caption);
    });

    expect(dialog).toHaveTextContent("2.1 MP");
    expect(dialog).toHaveTextContent("1920 × 1080");
    expect(dialog).toHaveTextContent(`${caption.length} characters`);

    const captionInput = screen.getByLabelText("Caption for sunset.png");
    await user.clear(captionInput);
    await user.type(captionInput, "Short");

    await waitFor(() => {
      expect(dialog).toHaveTextContent("5 characters");
    });
    expect(dialog).not.toHaveTextContent(`${caption.length} characters`);
  });

  it("opens images in the image preview", async () => {
    const user = userEvent.setup();

    render(
      <IssueResolverModal
        items={[makeIssueItem("sunset.png")]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    await user.click(within(dialog).getByRole("button", { name: "Open in image preview" }));

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "Open in image preview" }),
      ).not.toBeDisabled();
    });
  });

  it("does not offer image preview for videos", async () => {
    render(
      <IssueResolverModal
        items={[
          makeIssueItem("clip.mp4", {
            media_type: "video",
          }),
        ]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for clip.mp4",
    });
    expect(
      within(dialog).queryByRole("button", { name: "Open in image preview" }),
    ).not.toBeInTheDocument();
  });

  it("plays a video on repeat, with controls to stop it", async () => {
    render(
      <IssueResolverModal
        items={[
          makeIssueItem("clip.mp4", {
            media_type: "video",
          }),
        ]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for clip.mp4",
    });
    const video = dialog.querySelector("video");

    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("loop");
    // Autoplay is only permitted while muted, so losing this silently stops the
    // clip from ever starting. React assigns `muted` as a property and never
    // reflects it to an attribute, so this is the only way to see it.
    expect(video!.muted).toBe(true);
    // The loop runs until the user pauses it, which needs the native controls.
    expect(video).toHaveAttribute("controls");
  });

  it("does not save the caption while typing", async () => {
    const user = userEvent.setup();
    const saveCaption = vi.spyOn(api, "saveCaption");

    render(
      <IssueResolverModal
        items={[makeIssueItem("car.png")]}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    const captionInput = await screen.findByLabelText("Caption for car.png");
    await user.clear(captionInput);
    await user.type(captionInput, "Draft caption");

    await waitFor(() => {
      expect(captionInput).toHaveValue("Draft caption");
    });

    expect(saveCaption).not.toHaveBeenCalled();
  });

  it("resolves the caption and advances to the next issue", async () => {
    const user = userEvent.setup();
    const onCaptionSaved = vi.fn();
    const onIndexChange = vi.fn();
    const items = [
      makeIssueItem("car.png"),
      makeIssueItem("boat.png", {
        description: "A boat on the lake.",
        issue_fixes: ['Add the white sail to "a boat on the lake".'],
      }),
    ];

    render(
      <IssueResolverModal
        items={items}
        index={0}
        onClose={vi.fn()}
        onIndexChange={onIndexChange}
        onCaptionSaved={onCaptionSaved}
      />,
    );

    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    const captionInput = await screen.findByLabelText("Caption for car.png");
    await user.clear(captionInput);
    await user.type(captionInput, "A bright red car parked on the street.");

    await user.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(onCaptionSaved).toHaveBeenCalled();
      expect(onIndexChange).toHaveBeenCalledWith(1);
    });
  });

  it("keeps walking the full issue queue when resolved items leave the live list", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const resolvedPaths: string[] = [];

    const initialItems = [
      makeIssueItem("one.png", { issue_fixes: ["Fix one."] }),
      makeIssueItem("two.png", { issue_fixes: ["Fix two."] }),
      makeIssueItem("three.png", { issue_fixes: ["Fix three."] }),
      makeIssueItem("four.png", { issue_fixes: ["Fix four."] }),
    ];

    // The backend reports each item's real issue state on a caption fetch, so the
    // mock has to know these items: otherwise every fetch answers "no issue file"
    // and the harness below cannot tell a fetch from a resolve.
    installMockBackend({
      folderByPath: { [HOME_PATH]: { ...homeFolder, items: initialItems } },
    });

    function Harness() {
      const [index, setIndex] = useState(0);
      // Mimic the parent: only a resolve clears has_issue_file, which drops the item
      // from the live issue list (caption fetch updates do not).
      const [liveItems, setLiveItems] = useState(initialItems);

      return (
        <IssueResolverModal
          items={liveItems}
          index={index}
          onClose={onClose}
          onIndexChange={setIndex}
          onCaptionSaved={(path, update) => {
            if (update.has_issue_file !== false) return;
            // Re-fetching an item resolved earlier reports the same cleared state,
            // so record the transition rather than every response carrying it.
            if (resolvedPaths.includes(path)) return;
            resolvedPaths.push(path);
            setLiveItems((current) => current.filter((entry) => entry.path !== path));
          }}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByText("Fix one.")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    await waitFor(() => {
      expect(screen.getByText("2 / 4")).toBeInTheDocument();
      expect(screen.getByText("Fix two.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => {
      expect(screen.getByText("3 / 4")).toBeInTheDocument();
      expect(screen.getByText("Fix three.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => {
      expect(screen.getByText("4 / 4")).toBeInTheDocument();
      expect(screen.getByText("Fix four.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(resolvedPaths).toHaveLength(4);
  });

  it("drops a caption selection when skipping to the next issue", async () => {
    const user = userEvent.setup();
    const items = [
      makeIssueItem("car.png"),
      makeIssueItem("boat.png", { description: "A boat on the lake." }),
    ];

    function Host() {
      const [index, setIndex] = useState(0);
      return (
        <IssueResolverModal
          items={items}
          index={index}
          onClose={vi.fn()}
          onIndexChange={setIndex}
          onCaptionSaved={vi.fn()}
        />
      );
    }

    render(<Host />);

    const caption = await screen.findByLabelText("Caption for car.png");

    await user.click(screen.getByRole("button", { name: "Skip" }));

    const nextCaption = await screen.findByLabelText("Caption for boat.png");

    // A reused editor carries the old item's selection into the new caption.
    expect(nextCaption).not.toBe(caption);
  });

  it("steps back to an item that was skipped", async () => {
    const user = userEvent.setup();
    const items = [
      makeIssueItem("car.png"),
      makeIssueItem("boat.png", { description: "A boat on the lake." }),
    ];

    function Host() {
      const [index, setIndex] = useState(0);
      return (
        <IssueResolverModal
          items={items}
          index={index}
          onClose={vi.fn()}
          onIndexChange={setIndex}
          onCaptionSaved={vi.fn()}
        />
      );
    }

    render(<Host />);

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByText("2 / 2");

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Caption for car.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("presents an item resolved earlier in the session as settled, not outstanding", async () => {
    const user = userEvent.setup();
    const items = [
      makeIssueItem("car.png"),
      makeIssueItem("boat.png", { description: "A boat on the lake." }),
    ];

    function Host() {
      const [index, setIndex] = useState(0);
      return (
        <IssueResolverModal
          items={items}
          index={index}
          onClose={vi.fn()}
          onIndexChange={setIndex}
          onCaptionSaved={vi.fn()}
        />
      );
    }

    render(<Host />);

    expect(screen.getByText("Suggested changes")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    await screen.findByText("2 / 2");

    await user.click(screen.getByRole("button", { name: "Back" }));

    // The frozen queue still carries the fixes; they now read as work done.
    const dialog = await screen.findByRole("dialog", {
      name: "Resolve caption issue for car.png",
    });
    expect(within(dialog).getByText("Applied changes")).toBeInTheDocument();
    expect(within(dialog).queryByText("Suggested changes")).not.toBeInTheDocument();
    expect(dialog.querySelector(".issue-resolver-modal__issue-card--resolved")).toBeInTheDocument();

    // Still editable and re-savable — going back is what makes a bad fix fixable.
    expect(within(dialog).getByRole("button", { name: "Resolve" })).toBeEnabled();
  });

  it("closes after resolving the final issue", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const saveCaption = vi.spyOn(api, "saveCaption");

    render(
      <IssueResolverModal
        items={[makeIssueItem("car.png")]}
        index={0}
        onClose={onClose}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(saveCaption).toHaveBeenCalledWith(
        expect.stringContaining("car.png"),
        expect.any(String),
        { resolveIssue: true },
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("closes once per Escape press", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <IssueResolverModal
        items={[makeIssueItem("car.png")]}
        index={0}
        onClose={onClose}
        onIndexChange={vi.fn()}
        onCaptionSaved={vi.fn()}
      />,
    );

    await user.keyboard("{Escape}");

    // Escape belongs to ModalShell alone. This modal used to register its own
    // handler as well, which fired the close path twice on one keypress.
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
