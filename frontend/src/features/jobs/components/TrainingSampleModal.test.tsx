import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import type { OstrisTrainingSample } from "@/shared/types";
import { TrainingSampleModal } from "./TrainingSampleModal";

const SAMPLES_FOLDER = "C:\\AI-Toolkit\\output\\sample_train_v1\\samples";

const PROMPTS = [
  "a mountain lake at sunrise",
  "a red hatchback on a wet street",
  "a wooden bench in a park",
];

function makeSamples(count: number): OstrisTrainingSample[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `${SAMPLES_FOLDER}\\1__000000200_${index}.jpg`,
    name: `1__000000200_${index}.jpg`,
    step: 200,
    prompt: PROMPTS[index % PROMPTS.length],
  }));
}

function renderModal(overrides: { index?: number; count?: number } = {}) {
  const onIndexChange = vi.fn();
  const onClose = vi.fn();

  render(
    <TrainingSampleModal
      samples={makeSamples(overrides.count ?? 3)}
      index={overrides.index ?? 1}
      onIndexChange={onIndexChange}
      onClose={onClose}
    />,
  );

  return { onIndexChange, onClose };
}

afterEach(() => {
  resetScrollLockManagerForTests();
});

describe("TrainingSampleModal", () => {
  it("shows the sample's step, position and prompt", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Training sample 2 of 3" });
    expect(within(dialog).getByText("Sample at step 200")).toBeInTheDocument();
    expect(within(dialog).getByText("2 / 3")).toBeInTheDocument();
    expect(within(dialog).getByText("a red hatchback on a wet street")).toBeInTheDocument();
  });

  it("shows the full-size media rather than a thumbnail", () => {
    renderModal();

    const image = screen.getByAltText("a red hatchback on a wet street");
    expect(image).toHaveAttribute("src", expect.stringContaining("/api/media?"));
    expect(image.getAttribute("src")).not.toContain("/api/thumbnail");
  });

  it("wraps forward past the last sample", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderModal({ index: 2 });

    await user.click(screen.getByRole("button", { name: "Next sample" }));

    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("wraps backward past the first sample", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderModal({ index: 0 });

    await user.click(screen.getByRole("button", { name: "Previous sample" }));

    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("navigates with the arrow keys", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderModal({ index: 1 });

    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);

    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("leaves the arrow keys alone while typing in a field", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderModal();

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    await user.keyboard("{ArrowRight}");

    expect(onIndexChange).not.toHaveBeenCalled();
    input.remove();
  });

  it("closes on Escape and on a backdrop click", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close sample viewer" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("hides navigation for a lone sample", () => {
    renderModal({ index: 0, count: 1 });

    expect(screen.queryByRole("button", { name: "Next sample" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous sample" })).not.toBeInTheDocument();
  });

  it("offers no actions beyond viewing, navigation and closing", () => {
    renderModal();

    const dialog = screen.getByRole("dialog");
    const labels = within(dialog)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual([
      "Close sample viewer",
      "Close",
      "Previous sample",
      "Zoom in a red hatchback on a wet street",
      "Next sample",
    ]);
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  });
});
