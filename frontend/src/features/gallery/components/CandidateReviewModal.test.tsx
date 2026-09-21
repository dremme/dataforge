import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function videoEntries(names: string[] = ["clip.mp4"]) {
  const sources = names.map((name) =>
    mediaItem(name, HOME_PATH, {
      width: 960,
      height: 540,
      size: 1000,
      media_type: "video",
      has_candidate: true,
      candidate_name: name,
    }),
  );
  const candidates = names.map((name) =>
    mediaItem(name, STAGING_PATH, {
      width: 1920,
      height: 1080,
      size: 8000,
      media_type: "video",
    }),
  );
  return buildCandidateReviewQueue(HOME_PATH, sources, candidates);
}

function renderEntries(queue: ReturnType<typeof entries>) {
  const onIndexChange = vi.fn();
  render(
    <NotificationsProvider>
      <CandidateReviewModal
        entries={queue}
        index={0}
        onClose={vi.fn()}
        onIndexChange={onIndexChange}
        onResolved={vi.fn()}
      />
    </NotificationsProvider>,
  );
  return { onIndexChange };
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
    // jsdom implements no playback, so duration is NaN and the clamp would blank every seek.
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 10,
    });
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
    const sources = [
      mediaItem("a.png", HOME_PATH, {
        width: 480,
        height: 270,
        size: 1000,
        has_candidate: true,
        candidate_name: "a.png",
      }),
    ];
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

    // The before/after arrow is an icon, so textContent would just concatenate the two numbers.
    expect(metaItem("Dimensions")).toHaveTextContent("480×2701,920×1,080px");
    expect(metaItem("Megapixels")).toHaveTextContent("0.132.1MP");
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

    await waitFor(() => expect(acceptOne).toHaveBeenCalledWith(`${HOME_PATH}\\a.png`, false));
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

  it("cannot accept a candidate whose source is gone", async () => {
    const user = userEvent.setup();
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

    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(acceptOne).not.toHaveBeenCalled();
  });

  it("discards an orphaned candidate keyed by the staged name", async () => {
    const user = userEvent.setup();
    const orphan = buildCandidateReviewQueue(HOME_PATH, [], [mediaItem("gone.png", STAGING_PATH)]);
    const onResolved = vi.fn();
    const onClose = vi.fn();

    render(
      <NotificationsProvider>
        <CandidateReviewModal
          entries={orphan}
          index={0}
          onClose={onClose}
          onIndexChange={vi.fn()}
          onResolved={onResolved}
        />
      </NotificationsProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(rejectOne).toHaveBeenCalledWith(`${HOME_PATH}\\gone.png`);
    });
    expect(onResolved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
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

  it("accepts the candidate with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const { onIndexChange, onResolved } = renderModal();

    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(acceptOne).toHaveBeenCalledWith(`${HOME_PATH}\\a.png`, false));
    expect(onResolved).toHaveBeenCalled();
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

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

  describe("a video candidate", () => {
    const details = {
      difference_percent: 1.1,
      frame_rate: 48,
      source_frame_rate: 24,
      frame_count: 480,
      source_frame_count: 240,
      duration_seconds: 10,
      source_duration_seconds: 10,
      length_mismatch: false,
      dropped_audio: false,
    };

    it("plays both versions instead of showing stills", async () => {
      readState.mockResolvedValue(details as never);
      renderEntries(videoEntries());

      await waitFor(() => expect(readState).toHaveBeenCalled());
      expect(document.querySelectorAll("video")).toHaveLength(2);
      expect(document.querySelector("img")).toBeNull();
    });

    it("reports the frame rate and the duration to a tenth", async () => {
      readState.mockResolvedValue(details as never);
      renderEntries(videoEntries());

      await waitFor(() => expect(metaItem("Frame rate")).toHaveTextContent("24"));
      expect(metaItem("Frame rate")).toHaveTextContent("48");
      expect(metaItem("Duration")).toHaveTextContent("10.0 s");
    });

    it("leaves out the frame count, which the rate and the length already say", async () => {
      readState.mockResolvedValue(details as never);
      renderEntries(videoEntries());

      await waitFor(() => expect(readState).toHaveBeenCalled());
      expect(screen.queryByText("Frames")).toBeNull();
    });

    it("plays and pauses both panes together, from either one", () => {
      renderEntries(videoEntries());
      const [before, after] = Array.from(document.querySelectorAll("video"));
      const playBefore = vi.spyOn(before, "play").mockResolvedValue();
      const pauseBefore = vi.spyOn(before, "pause").mockImplementation(() => {});
      const playAfter = vi.spyOn(after, "play").mockResolvedValue();
      const pauseAfter = vi.spyOn(after, "pause").mockImplementation(() => {});

      fireEvent.play(after);
      expect(playBefore).toHaveBeenCalled();
      fireEvent.pause(after);
      expect(pauseBefore).toHaveBeenCalled();

      fireEvent.play(before);
      expect(playAfter).toHaveBeenCalled();
      fireEvent.pause(before);
      expect(pauseAfter).toHaveBeenCalled();
    });

    it("moves the other pane to the same moment on a seek", () => {
      renderEntries(videoEntries());
      const [before, after] = Array.from(document.querySelectorAll("video"));

      after.currentTime = 4.2;
      fireEvent.seeked(after);

      expect(before.currentTime).toBeCloseTo(4.2);
    });

    it("does not fight a peer that is already where it should be", () => {
      // The mirrored seek fires its own seeked event; without the drift guard it echoes back.
      renderEntries(videoEntries());
      const [before, after] = Array.from(document.querySelectorAll("video"));
      after.currentTime = 4.2;
      before.currentTime = 4.24;

      fireEvent.seeked(after);

      expect(before.currentTime).toBeCloseTo(4.24);
    });

    it("shows the resolution gain for a video upscale", async () => {
      readState.mockResolvedValue(details as never);
      renderEntries(videoEntries());

      await waitFor(() => expect(readState).toHaveBeenCalled());
      expect(metaItem("Resolution")).toHaveTextContent("4.0");
      expect(metaItem("Megapixels")).toBeInTheDocument();
    });

    it.each(["gif", "image"] as const)("renders a %s source beside a video", (type) => {
      const queue = videoEntries();
      queue[0].source = { ...queue[0].source!, media_type: type };
      renderEntries(queue);
      expect(document.querySelectorAll("video")).toHaveLength(1);
      expect(screen.getByRole("img", { name: /Original/ })).toBeInTheDocument();
    });

    it("renders a GIF result beside its video source", () => {
      const queue = videoEntries();
      queue[0].candidate.media_type = "gif";
      renderEntries(queue);
      expect(document.querySelectorAll("video")).toHaveLength(1);
      expect(screen.getByRole("img", { name: /Processed/ })).toBeInTheDocument();
    });

    it("leaves the arrow keys to a focused player instead of the queue", async () => {
      // Otherwise seeking a clip walks the review queue out from under it.
      readState.mockResolvedValue(details as never);
      const { onIndexChange } = renderEntries(videoEntries(["a.mp4", "b.mp4"]));
      const player = document.querySelector("video") as HTMLVideoElement;

      fireEvent.keyDown(player, { key: "ArrowRight", bubbles: true });
      expect(onIndexChange).not.toHaveBeenCalled();

      // The same key outside a player still walks the queue.
      fireEvent.keyDown(document.body, { key: "ArrowRight", bubbles: true });
      expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it("warns about a length mismatch without blocking accept", async () => {
      readState.mockResolvedValue({
        ...details,
        duration_seconds: 12.5,
        length_mismatch: true,
      } as never);
      renderEntries(videoEntries());

      expect(await screen.findByText(/Check the output node/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /accept/i })).toBeEnabled();
    });

    it("warns about dropped audio without blocking accept", async () => {
      readState.mockResolvedValue({ ...details, dropped_audio: true } as never);
      renderEntries(videoEntries());

      expect(await screen.findByText(/audio track/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /accept/i })).toBeEnabled();
    });
  });

  describe("a source with an unreverted edit", () => {
    function editedEntries() {
      const queue = entries(["a.png"]);
      queue[0].source = { ...queue[0].source!, has_backup: true };
      return queue;
    }

    function editedEntries2() {
      const queue = entries(["a.png", "b.png"]);
      queue[0].source = { ...queue[0].source!, has_backup: true };
      return queue;
    }

    function renderEntriesWithClose(queue: ReturnType<typeof entries>) {
      const onClose = vi.fn();
      render(
        <NotificationsProvider>
          <CandidateReviewModal
            entries={queue}
            index={0}
            onClose={onClose}
            onIndexChange={vi.fn()}
            onResolved={vi.fn()}
          />
        </NotificationsProvider>,
      );
      return { onClose };
    }

    it("asks before accepting instead of letting the backend refuse", async () => {
      const user = userEvent.setup();
      renderEntries(editedEntries());

      await user.click(screen.getByRole("button", { name: "Accept" }));

      expect(screen.getByRole("heading", { name: /Discard the edit/ })).toBeInTheDocument();
      expect(acceptOne).not.toHaveBeenCalled();
    });

    it("discards the edit only once the question is answered", async () => {
      const user = userEvent.setup();
      renderEntries(editedEntries());

      await user.click(screen.getByRole("button", { name: "Accept" }));
      await user.click(screen.getByRole("button", { name: "Discard edit and accept" }));

      expect(acceptOne).toHaveBeenCalledWith(`${HOME_PATH}\\a.png`, true);
    });

    it("leaves the file alone when the question is declined", async () => {
      const user = userEvent.setup();
      renderEntries(editedEntries());

      await user.click(screen.getByRole("button", { name: "Accept" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(acceptOne).not.toHaveBeenCalled();
      expect(screen.queryByRole("heading", { name: /Discard the edit/ })).toBeNull();
    });

    it("dismisses only the question on Escape, not the review it sits over", async () => {
      // The shell suspends while the question stands; without that, one Escape closed both.
      const user = userEvent.setup();
      const { onClose } = renderEntriesWithClose(editedEntries());

      await user.click(screen.getByRole("button", { name: "Accept" }));
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("heading", { name: /Discard the edit/ })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(acceptOne).not.toHaveBeenCalled();
    });

    it("leaves the queue keys alone while the question stands", async () => {
      const user = userEvent.setup();
      const { onIndexChange } = renderEntries(editedEntries2());

      await user.click(screen.getByRole("button", { name: "Accept" }));
      await user.keyboard("{ArrowRight}");

      expect(onIndexChange).not.toHaveBeenCalled();
    });

    it("routes the accept shortcut through the same question", async () => {
      const user = userEvent.setup();
      renderEntries(editedEntries());

      await user.keyboard("{Control>}{Enter}{/Control}");

      expect(screen.getByRole("heading", { name: /Discard the edit/ })).toBeInTheDocument();
      expect(acceptOne).not.toHaveBeenCalled();
    });

    it("accepts an unedited source with no question at all", async () => {
      const user = userEvent.setup();
      renderEntries(entries(["a.png"]));

      await user.click(screen.getByRole("button", { name: "Accept" }));

      expect(acceptOne).toHaveBeenCalledWith(`${HOME_PATH}\\a.png`, false);
    });
  });
});
