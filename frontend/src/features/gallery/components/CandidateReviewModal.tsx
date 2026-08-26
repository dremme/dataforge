import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { acceptCandidate, rejectCandidate } from "@/features/gallery/api/comfyCandidates";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import { useImageZoom } from "@/features/gallery/hooks/useImageZoom";
import {
  candidateStageAspect,
  differenceLabel,
  isOrphanedCandidate,
  resolutionGain,
  type CandidateReviewEntry,
} from "@/features/gallery/lib/candidateReview";
import { useCandidateDetails } from "@/features/gallery/hooks/useCandidateDetails";
import { formatApiError } from "@/shared/api/http";
import { classNames } from "@/shared/lib/classNames";
import { formatFileSize, formatMegapixels } from "@/shared/lib/format";
import { iconArrowRight, iconTriangleAlert, iconX } from "@/shared/icons";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import type { GalleryItem } from "@/shared/types";

type PendingAction = "accept" | "reject" | null;

interface CandidateReviewModalProps {
  entries: CandidateReviewEntry[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  /** Fires after files change on disk, so the folder listing can catch up. */
  onResolved: () => void;
}

export function CandidateReviewModal({
  entries,
  index,
  onClose,
  onIndexChange,
  onResolved,
}: CandidateReviewModalProps) {
  // Frozen at mount, like the duplicate resolver's queue: accepting rewrites the file
  // the gallery is listing, which would otherwise reshuffle the list under the index.
  const [queue] = useState(() => entries);
  const entry = queue[index];

  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [settledPaths, setSettledPaths] = useState<ReadonlySet<string>>(() => new Set());

  const busy = pending !== null;
  const settled = entry ? settledPaths.has(entry.path) : false;
  const orphaned = entry ? isOrphanedCandidate(entry) : false;

  useEffect(() => {
    setError(null);
    setPending(null);
  }, [entry?.path]);

  const closeModal = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const goTo = useCallback(
    (next: number) => {
      if (busy) return;
      if (next >= 0 && next < queue.length) onIndexChange(next);
    },
    [busy, onIndexChange, queue.length],
  );

  const advance = useCallback(
    (path: string) => {
      setSettledPaths((current) => new Set(current).add(path));
      onResolved();

      if (index < queue.length - 1) {
        onIndexChange(index + 1);
      } else {
        onClose();
      }
    },
    [index, onClose, onIndexChange, onResolved, queue.length],
  );

  const settle = useCallback(
    async (action: "accept" | "reject") => {
      if (!entry || busy || settled) return;

      setPending(action);
      setError(null);

      try {
        if (action === "accept") {
          await acceptCandidate(entry.path);
        } else {
          await rejectCandidate(entry.path);
        }
        advance(entry.path);
      } catch (caught) {
        setError(formatApiError(caught));
      } finally {
        setPending(null);
      }
    },
    [advance, busy, entry, settled],
  );

  // Navigation only. Accepting publishes one image over another and cannot be undone, so
  // it is never a keystroke away - the footer buttons are the only way to settle, and
  // the arrow keys just move. The editable-target guard stays regardless: a key pressed
  // into a text field is typing, not a command aimed at the queue behind it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "arrowright") {
        event.preventDefault();
        goTo(index + 1);
      } else if (key === "arrowleft") {
        event.preventDefault();
        goTo(index - 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo, index]);

  if (!entry) return null;

  return (
    <ModalShell
      block="candidate-review-modal"
      label={`Review candidate ${index + 1} of ${queue.length}`}
      onClose={closeModal}
      busy={busy}
      scrollLock="candidate-review-modal-open"
    >
      <header className="candidate-review-modal__header">
        <div className="candidate-review-modal__header-text">
          <h2 className="candidate-review-modal__title">{entry.name}</h2>
          <span className="candidate-review-modal__counter">
            {index + 1} / {queue.length}
          </span>
        </div>

        <button
          type="button"
          className="candidate-review-modal__close"
          onClick={closeModal}
          disabled={busy}
          aria-label="Close"
        >
          <Icon icon={iconX} />
        </button>
      </header>

      <div className="candidate-review-modal__body" data-scroll-lock-allow>
        <CompareStage entry={entry} />

        <CompareMeta entry={entry} />

        {orphaned && (
          <p className="candidate-review-modal__warning" role="status">
            <Icon icon={iconTriangleAlert} className="candidate-review-modal__warning-icon" />
            The image this candidate was made from is no longer in the folder. It can only be
            discarded from here.
          </p>
        )}

        {error && (
          <p className="candidate-review-modal__error" role="alert">
            <Icon icon={iconTriangleAlert} className="candidate-review-modal__error-icon" />
            {error}
          </p>
        )}
      </div>

      <footer className="candidate-review-modal__footer">
        <DialogButton
          label="Back"
          variant="secondary"
          disabled={busy || index === 0}
          onClick={() => goTo(index - 1)}
        />
        <DialogButton
          label="Skip"
          variant="secondary"
          disabled={busy || index === queue.length - 1}
          onClick={() => goTo(index + 1)}
        />
        <DialogButton
          label={pending === "reject" ? "Discarding..." : "Reject"}
          variant="warning"
          busy={pending === "reject"}
          disabled={busy || settled}
          onClick={() => {
            void settle("reject");
          }}
        />
        <DialogButton
          label={pending === "accept" ? "Accepting..." : "Accept"}
          variant="primary"
          busy={pending === "accept"}
          disabled={busy || settled || orphaned}
          onClick={() => {
            void settle("accept");
          }}
        />
      </footer>
    </ModalShell>
  );
}

/**
 * The bar of facts about the pair, in the app's shared modal-meta idiom: a value with a
 * small uppercase label under it, divided from its neighbours.
 *
 * Where the gallery item's version reports single facts, every fact here is a *change*,
 * so the values read as transitions. An orphaned candidate has no before to transition
 * from and shows the after alone - the warning below the bar is what explains why, so
 * the bar itself does not need to.
 */
function CompareMeta({ entry }: { entry: CandidateReviewEntry }) {
  const details = useCandidateDetails(entry);
  const { source, candidate } = entry;
  const gain = resolutionGain(entry);
  const difference = details?.difference_percent ?? null;

  const dimensions = (item: GalleryItem) =>
    item.width && item.height ? (
      <>
        {item.width.toLocaleString()}
        <span className="candidate-review-modal__meta-times">×</span>
        {item.height.toLocaleString()}
      </>
    ) : null;

  const before = source ? dimensions(source) : null;
  const after = dimensions(candidate);
  const megapixels = (item: GalleryItem) =>
    item.width && item.height ? formatMegapixels(item.width, item.height).replace(" MP", "") : null;

  const items: { key: string; label: string; value: ReactNode }[] = [];

  if (gain !== null) {
    items.push({
      key: "resolution",
      label: "Resolution",
      value: (
        <>
          {gain.toFixed(1)}
          <span className="candidate-review-modal__meta-times">×</span>
        </>
      ),
    });
  }

  if (after) {
    items.push({
      key: "dimensions",
      label: "Dimensions",
      value: (
        <>
          {before && (
            <>
              {before}
              <Icon icon={iconArrowRight} className="candidate-review-modal__meta-arrow" />
            </>
          )}
          {after}
          <span className="candidate-review-modal__meta-unit">px</span>
        </>
      ),
    });
  }

  const afterMegapixels = megapixels(candidate);
  const beforeMegapixels = source ? megapixels(source) : null;
  if (afterMegapixels) {
    items.push({
      key: "megapixels",
      label: "Megapixels",
      value: (
        <>
          {beforeMegapixels && (
            <>
              {beforeMegapixels}
              <Icon icon={iconArrowRight} className="candidate-review-modal__meta-arrow" />
            </>
          )}
          {afterMegapixels}
          <span className="candidate-review-modal__meta-unit">MP</span>
        </>
      ),
    });
  }

  if (candidate.size != null) {
    items.push({
      key: "size",
      label: "File size",
      value: (
        <>
          {source?.size != null && (
            <>
              {formatFileSize(source.size)}
              <Icon icon={iconArrowRight} className="candidate-review-modal__meta-arrow" />
            </>
          )}
          {formatFileSize(candidate.size)}
        </>
      ),
    });
  }

  if (difference !== null) {
    items.push({
      key: "difference",
      label: "Difference",
      value: (
        <>
          {difference.toFixed(1)}%
          <span className="candidate-review-modal__meta-unit">{differenceLabel(difference)}</span>
        </>
      ),
    });
  }

  return (
    <div className="candidate-review-modal__meta" aria-label="Comparison details">
      {items.map((item, position) => (
        <Fragment key={item.key}>
          {position > 0 && (
            <span className="candidate-review-modal__meta-divider" aria-hidden="true" />
          )}
          <div className="candidate-review-modal__meta-item">
            <span className="candidate-review-modal__meta-value">{item.value}</span>
            <span className="candidate-review-modal__meta-label">{item.label}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Before and after under one zoom.
 *
 * Both panes are driven by a single `useImageZoom`, whose state is a pointer origin in
 * percent plus a scale: feeding two canvases from one instance is what keeps them
 * looking at the same part of the frame with nothing to synchronise. The natural size
 * recorded is the *candidate's*, so the shared scale is allowed to reach the upscale's
 * own detail - clamping to the smaller original would cap the zoom exactly where the
 * comparison starts being worth making, and a soft "before" is the honest rendering of
 * an image that really does have fewer pixels.
 *
 * That same natural size shapes the box the two panes are drawn in, via
 * `--stage-aspect`. The zoom scales the *box* and paints the image across it, so a box
 * that is not the image's shape distorts it - which is what a fixed square stage used
 * to do, hardest at full zoom where the comparison is actually made. The stylesheet
 * also sizes the pair from it, so a portrait candidate narrows both columns together
 * instead of stranding the two frames at opposite edges of the panel.
 */
function CompareStage({ entry }: { entry: CandidateReviewEntry }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [loadedSize, setLoadedSize] = useState<{ width: number; height: number } | null>(null);
  const {
    zoomed,
    containerStyle,
    canvasStyle,
    handleClick,
    handleMouseMove,
    toggleZoom,
    recordNaturalSize,
  } = useImageZoom(entry.path);

  // The measured size belongs to the image that reported it. `useImageZoom` drops its
  // own copy on every new entry; this one has to go with it, or the next candidate is
  // laid out in the previous one's shape until it finishes decoding.
  useEffect(() => {
    setLoadedSize(null);
  }, [entry.path]);

  const afterSrc = galleryItemMediaUrl(entry.candidate);
  const beforeSrc = entry.source ? galleryItemMediaUrl(entry.source) : null;
  const aspect = candidateStageAspect(entry, loadedSize);

  const pane = (side: "before" | "after") => {
    const src = side === "after" ? afterSrc : beforeSrc;

    return (
      <div className="candidate-review-modal__pane">
        <span className="candidate-review-modal__pane-label">
          {side === "after" ? "After" : "Before"}
        </span>
        <div
          className={classNames(
            "zoomable-image",
            zoomed && "zoomable-image--zoomed",
            "candidate-review-modal__stage",
          )}
          style={containerStyle}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          role="button"
          aria-label={zoomed ? `Zoom out ${entry.name}` : `Zoom in ${entry.name}`}
          aria-pressed={zoomed}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            toggleZoom(rootRef.current);
          }}
          ref={side === "after" ? rootRef : undefined}
        >
          <div className="zoomable-image__canvas" style={canvasStyle}>
            {src === null ? (
              <span className="candidate-review-modal__missing">No original left</span>
            ) : (
              <img
                className="zoomable-image__img"
                src={src}
                alt={`${side === "after" ? "Processed" : "Original"} ${entry.name}`}
                draggable={false}
                onLoad={(event) => {
                  if (side !== "after") return;
                  const img = event.currentTarget;
                  recordNaturalSize(img.naturalWidth, img.naturalHeight);
                  setLoadedSize({ width: img.naturalWidth, height: img.naturalHeight });
                }}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    // The ratio is set here rather than on each stage, so the two panes read one value
    // and the grid can size itself from the same number - two boxes of this shape at
    // full height is exactly what the pair is allowed to grow to.
    <div
      className="candidate-review-modal__compare"
      style={{ "--stage-aspect": aspect } as CSSProperties}
    >
      {pane("before")}
      {pane("after")}
    </div>
  );
}
