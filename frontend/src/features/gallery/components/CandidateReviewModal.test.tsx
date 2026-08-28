import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCandidate,
  fetchCandidateState,
  rejectCandidate,
} from "@/features/gallery/api/comfyCandidates";
import { buildCandidateReviewQueue } from "@/features/gallery/lib/candidateReview";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import type { GalleryItem } from "@/shared/types";
import { HOME_PATH, mediaItem } from "@/test/fixtures";
import { CandidateReviewModal } from "./CandidateReviewModal";

vi.mock("@/features/gallery/api/comfyCandidates", () => ({
  acceptCandidate: vi.fn(),
  fetchCandidateState: vi.fn(),
  rejectCandidate: vi.fn(),
}));

const acceptOne = vi.mocked(acceptCandidate);
const rejectOne = vi.mocked(rejectCandidate);
const readState = vi.mocked(fetchCandidateState);

const STAGING_PATH = `${HOME_PATH}\\staging`;

function entries(names: string[]) {
  const sources: GalleryItem[] = names.map((name) =>
    mediaItem(name, HOME_PATH, {
      width: 512,
      height: 512,
      size: 1000,
      has_candidate: true,
      candidate_name: name,
    }),
  );
  const candidates = names.map((name) =>
    mediaItem(name, STAGING_PATH, { width: 1024, height: 1024, size: 4000 }),
  );
  return buildCandidateReviewQueue(HOME_PATH, sources, candidates);
}

/** One block of the meta bar, found by the label under its value. */
function metaItem(label: string): HTMLElement {
  const found = screen.getByText(label).closest(".candidate-review-modal__meta-item");
  if (!found) throw new Error(`No meta item labelled ${label}`);
  return found as HTMLElement;
}

function renderModal(names = ["a.png", "b.png"], overrides: Partial<{ index: number }> = {}) {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  const onResolved = vi.fn();

  render(
    <NotificationsProvider>
      <CandidateReviewModal
        entries={entries(names)}
        index={overrides.index ?? 0}
        onClose={onClose}
        onIndexChange={onIndexChange}
        onResolved={onResolved}
      />
    </NotificationsProvider>,
  );

  return { onClose, onIndexChange, onResolved };
}

describe("CandidateReviewModal", () => {
  beforeEach(() => {
    acceptOne.mockReset().mockResolvedValue({} as never);
    rejectOne.mockReset().mockResolvedValue({} as never);
    readState.mockReset().mockResolvedValue({ difference_percent: 3.2 } as never);
  });

  it("shows both versions of the image and its position in the queue", () => {
    renderModal();

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "a.png" })).toBeInTheDocument();
    expect(screen.getByAltText("Original a.png")).toBeInTheDocument();
    expect(screen.getByAltText("Processed a.png")).toBeInTheDocument();
  });

  it("draws both panes in the candidate's shape, not a square", () => {
    const sources = [mediaItem("a.png", HOME_PATH, { width: 960, height: 540, size: 1000 })];
    const candidates = [
      mediaItem("a.png", STAGING_PATH, { width: 1920, height: 1080, size: 4000 }),
    ];

    render(
      <NotificationsProvider>
        <CandidateReviewModal
          entries={buildCandidateReviewQueue(HOME_PATH, sources, candidates)}
          index={0}
          onClose={vi.fn()}
          onIndexChange={vi.fn()}
          onResolved={vi.fn()}
        />
      </NotificationsProvider>,
    );

    // Stage aspect is the image's shape; the ratio sits on the grid so both panes share an origin.
    const compare = document.querySelector<HTMLElement>(".candidate-review-modal__compare");
    expect(document.querySelectorAll(".candidate-review-modal__stage")).toHaveLength(2);
    expect(Number(compare?.style.getPropertyValue("--stage-aspect"))).toBeCloseTo(16 / 9);
  });

  it("reports the resolution the candidate gained", () => {
    renderModal();

    // 1024x1024 against 512x512 is four times the pixels.
    expect(screen.getByText("4.0")).toBeInTheDocument();
    expect(screen.getByText("Resolution")).toBeInTheDocument();
  });

  it("reads both sides of every measurement into one bar", () => {
    // Under a thousand: toLocaleString would otherwise assert this machine's group separator.
    const sources = [
      mediaItem("a.png", HOME_PATH, {
        width: 480,
        height: 270,
        size: 1000,
        has_candidate: true,
        candidate_name: "a.png",
      }),
    ];
    const candidates = [mediaItem("a.png", STAGING_PATH, { width: 960, height: 540, size: 4000 })];

    render(
      <NotificationsProvider>
        <CandidateReviewModal
          entries={buildCandidateReviewQueue(HOME_PATH, sources, candidates)}
          index={0}
          onClose={vi.fn()}
          onIndexChange={vi.fn()}
          onResolved={vi.fn()}
        />
      </NotificationsProvider>,
    );

    // The before/after arrow is an icon, so textContent would just concatenate the two numbers.
    expect(metaItem("Dimensions")).toHaveTextContent("480×270960×540px");
    expect(metaItem("Megapixels")).toHaveTextContent("0.130.52MP");
    expect(metaItem("File size")).toHaveTextContent("1000 B3.9 KB");

    for (const label of ["Dimensions", "Megapixels", "File size"]) {
      expect(metaItem(label).querySelector("svg")).toBeInTheDocument();
    }
  });

  it("reports how far the candidate moved from the source", async () => {
    renderModal();

    // Fetched per entry rather than carried by the listing, so it arrives a tick late.
    expect(await screen.findByText("3.2%")).toBeInTheDocument();
    expect(screen.getByText("composition kept")).toBeInTheDocument();
    expect(readState).toHaveBeenCalledWith(`${HOME_PATH}\\a.png`, expect.anything());
  });

  it("drops the difference rather than the bar when the score cannot be fetched", async () => {
    readState.mockRejectedValue(new Error("offline"));

    renderModal();

    await waitFor(() => expect(readState).toHaveBeenCalled());
    expect(screen.queryByText("Difference")).not.toBeInTheDocument();
    // The facts that came from the listing are still there.
    expect(screen.getByText("Resolution")).toBeInTheDocument();
  });

  it("does not ask for the state of a candidate whose source is gone", () => {
    const candidates = [mediaItem("a.png", STAGING_PATH, { width: 800, height: 600 })];

    render(
      <NotificationsProvider>
        <CandidateReviewModal
          entries={buildCandidateReviewQueue(HOME_PATH, [], candidates)}
          index={0}
          onClose={vi.fn()}
          onIndexChange={vi.fn()}
          onResolved={vi.fn()}
        />
      </NotificationsProvider>,
    );

    // Every candidate route resolves the source path, so this would 404 on every step.
    expect(readState).not.toHaveBeenCalled();
    // And with no before to compare against, the bar reports the candidate alone.
    expect(screen.getByLabelText("Comparison details")).toHaveTextContent("800×600px");
    expect(screen.queryByText("Resolution")).not.toBeInTheDocument();
  });

  it("accepts the candidate for the source path and moves on", async () => {
    const user = userEvent.setup();
    const { onIndexChange, onResolved } = renderModal();

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(acceptOne).toHaveBeenCalledWith(`${HOME_PATH}\\a.png`));
    expect(onResolved).toHaveBeenCalled();
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("rejects without touching the dataset image", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderModal();

    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(rejectOne).toHaveBeenCalledWith(`${HOME_PATH}\\a.png`));
    expect(acceptOne).not.toHaveBeenCalled();
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("closes after the last decision", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal(["only.png"]);

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the queue on the same item when a decision fails", async () => {
    const user = userEvent.setup();
    acceptOne.mockRejectedValue(new Error("This image has an unreverted edit."));
    const { onIndexChange } = renderModal();

    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("unreverted edit");
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("cannot accept a candidate whose source is gone", () => {
    const orphan = buildCandidateReviewQueue(HOME_PATH, [], [mediaItem("gone.png", STAGING_PATH)]);

    render(
      <NotificationsProvider>
        <CandidateReviewModal
          entries={orphan}
          index={0}
          onClose={vi.fn()}
          onIndexChange={vi.fn()}
          onResolved={vi.fn()}
        />
      </NotificationsProvider>,
    );

    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    // Discarding it is still offered: it is a real file taking up real space.
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("no longer in the folder");
  });

  it("offers no way to accept the queue in bulk", () => {
    renderModal();

    expect(screen.queryByRole("button", { name: /accept all/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });

  it("walks the queue with the arrow keys", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = renderModal();

    await user.keyboard("{ArrowRight}");

    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  // Accept/reject is never a keystroke.
  it("does not settle anything from a bare keypress", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.keyboard("ar");

    expect(acceptOne).not.toHaveBeenCalled();
    expect(rejectOne).not.toHaveBeenCalled();
  });

  it("will not settle the same candidate twice", async () => {
    // The index is owned by the caller, so a decision that leaves the modal on the same
    // entry must not let a second click act on a file already settled.
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(acceptOne).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(rejectOne).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });
});
