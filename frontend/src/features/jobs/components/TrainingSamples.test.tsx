import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import type { OstrisTrainingSample } from "@/shared/types";
import { TrainingSamples } from "./TrainingSamples";

const SAMPLES_FOLDER = "C:\\AI-Toolkit\\output\\sample_train_v1\\samples";

function makeSamples(count: number): OstrisTrainingSample[] {
  const prompts = [
    "a mountain lake at sunrise",
    "a red hatchback on a wet street",
    "a wooden bench in a park",
  ];

  return Array.from({ length: count }, (_, index) => ({
    path: `${SAMPLES_FOLDER}\\1__000000200_${index}.jpg`,
    name: `1__000000200_${index}.jpg`,
    step: 200,
    prompt: prompts[index % prompts.length],
  }));
}

afterEach(() => {
  resetScrollLockManagerForTests();
});

describe("TrainingSamples", () => {
  it("renders nothing without samples", () => {
    const { container } = render(<TrainingSamples samples={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders one button per sample under the step label", () => {
    render(<TrainingSamples samples={makeSamples(3)} />);

    expect(screen.getByText("Samples at step 200")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByAltText("a mountain lake at sunrise")).toBeInTheDocument();
  });

  it("reveals a thumbnail only once it has decoded", () => {
    render(<TrainingSamples samples={makeSamples(1)} />);

    const image = screen.getByAltText("a mountain lake at sunrise");
    expect(image).not.toHaveClass("training-samples__image--ready");

    fireEvent.load(image);

    expect(image).toHaveClass("training-samples__image--ready");
  });

  it("drops a sample whose file is gone instead of showing it broken", () => {
    render(<TrainingSamples samples={makeSamples(3)} />);

    fireEvent.error(screen.getByAltText("a red hatchback on a wet street"));

    expect(screen.queryByAltText("a red hatchback on a wet street")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "View training sample 2 of 2" })).toBeInTheDocument();
  });

  it("hides the whole section once every sample turns out to be missing", () => {
    const { container } = render(<TrainingSamples samples={makeSamples(2)} />);

    for (const image of screen.getAllByRole("img")) {
      fireEvent.error(image);
    }

    expect(container).toBeEmptyDOMElement();
  });

  it("closes the lightbox when the open sample turns out to be missing", async () => {
    const user = userEvent.setup();
    const { container } = render(<TrainingSamples samples={makeSamples(2)} />);

    await user.click(screen.getByRole("button", { name: "View training sample 2 of 2" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const strip = container.querySelector<HTMLElement>(".training-samples__list")!;
    fireEvent.error(within(strip).getByAltText("a red hatchback on a wet street"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shrinks the thumbnails when compact", () => {
    const { container } = render(<TrainingSamples samples={makeSamples(2)} compact />);

    expect(container.querySelector(".training-samples")).toHaveClass("training-samples--compact");
  });

  it("opens the clicked sample in the lightbox", async () => {
    const user = userEvent.setup();
    render(<TrainingSamples samples={makeSamples(3)} />);

    await user.click(screen.getByRole("button", { name: "View training sample 2 of 3" }));

    const dialog = screen.getByRole("dialog", { name: "Training sample 2 of 3" });
    expect(within(dialog).getByText("a red hatchback on a wet street")).toBeInTheDocument();
  });

  it("reports the lightbox opening and closing, but not on mount", async () => {
    const user = userEvent.setup();
    const onLightboxOpenChange = vi.fn();
    render(
      <TrainingSamples samples={makeSamples(2)} onLightboxOpenChange={onLightboxOpenChange} />,
    );

    expect(onLightboxOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "View training sample 1 of 2" }));
    expect(onLightboxOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Close sample viewer" }));
    expect(onLightboxOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("releases the host when it unmounts with the lightbox open", async () => {
    const user = userEvent.setup();
    const onLightboxOpenChange = vi.fn();
    const { unmount } = render(
      <TrainingSamples samples={makeSamples(2)} onLightboxOpenChange={onLightboxOpenChange} />,
    );

    await user.click(screen.getByRole("button", { name: "View training sample 1 of 2" }));
    onLightboxOpenChange.mockClear();

    unmount();

    expect(onLightboxOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the lightbox when a poll drops the open sample", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TrainingSamples samples={makeSamples(3)} />);

    await user.click(screen.getByRole("button", { name: "View training sample 3 of 3" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(<TrainingSamples samples={makeSamples(2)} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
