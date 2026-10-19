import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import type { OstrisTrainingSample } from "@/shared/types";
import { TrainingSampleDialog } from "./TrainingSampleDialog";

const SAMPLES_FOLDER = "C:\\AI-Toolkit\\output\\sample_train_v1\\samples";

const PROMPTS = [
  "a mountain lake at sunrise",
  "a red hatchback on a wet street",
  "a wooden bench in a park",
];

function makeSample(index: number, extension: "jpg" | "mp4" = "jpg"): OstrisTrainingSample {
  const name = `1__000000200_${index}.${extension}`;
  return {
    path: `${SAMPLES_FOLDER}\\${name}`,
    name,
    step: 200,
    prompt: PROMPTS[index % PROMPTS.length],
  };
}

function makeSamples(count: number): OstrisTrainingSample[] {
  return Array.from({ length: count }, (_, index) => makeSample(index));
}

function renderDialog(overrides: { index?: number; count?: number } = {}) {
  const onIndexChange = vi.fn<(index: number) => void>();
  const onClose = vi.fn<() => void>();

  const { unmount } = render(
    <TrainingSampleDialog
      samples={makeSamples(overrides.count ?? 3)}
      index={overrides.index ?? 1}
      onIndexChange={onIndexChange}
      onClose={onClose}
    />,
  );

  return { onIndexChange, onClose, unmount };
}

afterEach(() => {
  resetScrollLockManagerForTests();
});

describe("TrainingSampleDialog", () => {
  it("shows the sample's step, position and prompt", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Training sample 2 of 3" });
    expect(within(dialog).getByText("Sample at step 200")).toBeInTheDocument();
    expect(within(dialog).getByText("2 / 3")).toBeInTheDocument();
    expect(within(dialog).getByText("a red hatchback on a wet street")).toBeInTheDocument();
  });

  it("shows the full-size media rather than a thumbnail", () => {
    renderDialog();

    const image = screen.getByAltText("a red hatchback on a wet street");
    expect(image).toHaveAttribute("src", expect.stringContaining("/api/media?"));
    expect(image.getAttribute("src")).not.toContain("/api/thumbnail");
  });

  it("plays a video sample instead of treating it as an image", () => {
    const { unmount } = render(
      <TrainingSampleDialog
        samples={[makeSample(1, "mp4")]}
        index={0}
        onIndexChange={vi.fn<(index: number) => void>()}
        onClose={vi.fn<() => void>()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const video = dialog.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", expect.stringContaining("/api/media?"));
    expect(video?.getAttribute("src")).not.toContain("/api/thumbnail");
    expect(video).toHaveAttribute("aria-label", "a red hatchback on a wet street");
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Zoom in/ })).not.toBeInTheDocument();

    unmount();
  });

  it("keeps stills as images when navigating onto a video neighbour", async () => {
    const user = userEvent.setup();
    const onIndexChange = vi.fn<(index: number) => void>();
    const { unmount } = render(
      <TrainingSampleDialog
        samples={[makeSample(0, "jpg"), makeSample(1, "mp4")]}
        index={0}
        onIndexChange={onIndexChange}
        onClose={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByAltText("a mountain lake at sunrise")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("video")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next sample" }));
    expect(onIndexChange).toHaveBeenCalledWith(1);

    unmount();
  });

  it("wraps forward past the last sample", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderDialog({ index: 2 });

    await user.click(screen.getByRole("button", { name: "Next sample" }));

    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("wraps backward past the first sample", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderDialog({ index: 0 });

    await user.click(screen.getByRole("button", { name: "Previous sample" }));

    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("navigates with the arrow keys", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderDialog({ index: 1 });

    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);

    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("leaves a modified arrow to the browser", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderDialog({ index: 1 });

    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}{Control>}{ArrowRight}{/Control}");

    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("jumps to the last and first sample with End and Home", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderDialog({ index: 1 });

    await user.keyboard("{End}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);

    await user.keyboard("{Home}");
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("leaves the arrow keys alone while typing in a field", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderDialog();

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    await user.keyboard("{ArrowRight}");

    expect(onIndexChange).not.toHaveBeenCalled();
    input.remove();
  });

  it("closes on Escape and on a backdrop click", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText("Close sample viewer"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("hides navigation for a lone sample", () => {
    renderDialog({ index: 0, count: 1 });

    expect(screen.queryByRole("button", { name: "Next sample" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous sample" })).not.toBeInTheDocument();
  });

  it("offers no actions beyond viewing, navigation and closing", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    const labels = within(dialog)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual([
      "Close",
      "Previous sample",
      "Zoom in a red hatchback on a wet street",
      "Next sample",
    ]);
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps the backdrop out of the dialog accessibility tree", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(screen.getByLabelText("Close sample viewer")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Close sample viewer" })).toBeNull();
  });

  it("returns focus to the trigger when it closes", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = renderDialog();
    expect(trigger).not.toHaveFocus();

    unmount();
    await waitFor(() => expect(trigger).toHaveFocus());

    trigger.remove();
  });
});
