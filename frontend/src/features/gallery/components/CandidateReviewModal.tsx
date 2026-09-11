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
  isVideoEntry,
  resolutionGain,
  type CandidateReviewEntry,
} from "@/features/gallery/lib/candidateReview";
import { useCandidateDetails } from "@/features/gallery/hooks/useCandidateDetails";
import { formatApiError } from "@/shared/api/http";
import { classNames } from "@/shared/lib/classNames";
import { formatDurationSeconds, formatFileSize, formatMegapixels } from "@/shared/lib/format";
import { iconArrowRight, iconTriangleAlert, iconX } from "@/shared/icons";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { isVideo } from "@/features/gallery/lib/itemKind";
import type { ComfyCandidateStateResponse, GalleryItem } from "@/shared/types";

type CandidateDetails = ComfyCandidateStateResponse;

type PendingAction = "accept" | "reject" | null;

interface CandidateReviewModalProps {
  entries: CandidateReviewEntry[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onResolved: () => void;
}

export function CandidateReviewModal({
  entries,
  index,
  onClose,
  onIndexChange,
  onResolved,
}: CandidateReviewModalProps) {
  // Frozen at mount: accepting rewrites the listed file and would reshuffle it under the index.
  const [queue] = useState(() => entries);
  const entry = queue[index];

  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [settledPaths, setSettledPaths] = useState<ReadonlySet<string>>(() => new Set());

  const details = useCandidateDetails(entry);
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
      if (!entry || busy || settled || (action === "accept" && orphaned)) return;

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
    [advance, busy, entry, orphaned, settled],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      // A focused player owns the arrows, or seeking a clip walks the queue out from under it.
      if (event.target instanceof Element && event.target.closest("video")) return;

      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void settle("accept");
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

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
  }, [goTo, index, settle]);

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

        <CompareMeta entry={entry} details={details} />

        {orphaned && (
          <p className="candidate-review-modal__warning" role="status">
            <Icon icon={iconTriangleAlert} className="candidate-review-modal__warning-icon" />
            The file this candidate was made from is no longer in the folder. It can only be
            discarded from here.
          </p>
        )}

        <CandidateWarnings details={details} />

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

/** Length and dropped audio, which accepting would destroy with no copy kept. */
function CandidateWarnings({ details }: { details: CandidateDetails | null }) {
  if (!details) return null;

  const lengths =
    details.duration_seconds != null && details.source_duration_seconds != null
      ? `This candidate runs ${formatDurationSeconds(details.duration_seconds)}; the original runs ${formatDurationSeconds(details.source_duration_seconds)}.`
      : null;

  return (
    <>
      {details.length_mismatch && lengths && (
        <p className="candidate-review-modal__warning" role="status">
          <Icon icon={iconTriangleAlert} className="candidate-review-modal__warning-icon" />
          {lengths} Check the output node's frame rate.
        </p>
      )}
      {details.dropped_audio && (
        <p className="candidate-review-modal__warning" role="status">
          <Icon icon={iconTriangleAlert} className="candidate-review-modal__warning-icon" />
          The original has an audio track and this candidate does not. Accepting keeps no copy of
          the original.
        </p>
      )}
    </>
  );
}

function beforeAfter(before: ReactNode, after: ReactNode, unit?: string): ReactNode {
  return (
    <>
      {before != null && (
        <>
          {before}
          <Icon icon={iconArrowRight} className="candidate-review-modal__meta-arrow" />
        </>
      )}
      {after}
      {unit && <span className="candidate-review-modal__meta-unit">{unit}</span>}
    </>
  );
}

function CompareMeta({
  entry,
  details,
}: {
  entry: CandidateReviewEntry;
  details: CandidateDetails | null;
}) {
  const { source, candidate } = entry;
  const motion = isVideoEntry(entry);
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

  if (motion && details?.frame_rate != null) {
    items.push({
      key: "frame-rate",
      label: "Frame rate",
      value: beforeAfter(details.source_frame_rate ?? null, details.frame_rate, "fps"),
    });
  }

  if (motion && details?.frame_count != null) {
    items.push({
      key: "frames",
      label: "Frames",
      value: beforeAfter(
        details.source_frame_count?.toLocaleString() ?? null,
        details.frame_count.toLocaleString(),
      ),
    });
  }

  if (motion && details?.duration_seconds != null) {
    items.push({
      key: "duration",
      label: "Duration",
      value: beforeAfter(
        details.source_duration_seconds != null
          ? formatDurationSeconds(details.source_duration_seconds)
          : null,
        formatDurationSeconds(details.duration_seconds),
      ),
    });
  }

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

  // Drop with the entry like useImageZoom, or the next candidate keeps the old shape until decode.
  useEffect(() => {
    setLoadedSize(null);
  }, [entry.path]);

  const afterSrc = galleryItemMediaUrl(entry.candidate);
  const beforeSrc = entry.source ? galleryItemMediaUrl(entry.source) : null;
  const aspect = candidateStageAspect(entry, loadedSize);

  const missing = <span className="candidate-review-modal__missing">No original left</span>;

  const videoPane = (side: "before" | "after", src: string | null) => (
    <div className="candidate-review-modal__pane">
      <span className="candidate-review-modal__pane-label">
        {side === "after" ? "After" : "Before"}
      </span>
      {/* Outside useImageZoom: its click handler would swallow every press on the transport. */}
      <div className="candidate-review-modal__stage">
        {src === null ? (
          missing
        ) : (
          <video
            // Remount on src: React would otherwise reuse the element and keep the old frame.
            key={src}
            className="candidate-review-modal__stage-video"
            src={src}
            controls
            muted
            playsInline
            loop
            preload="metadata"
            aria-label={`${side === "after" ? "Processed" : "Original"} ${entry.name}`}
            onLoadedMetadata={(event) => {
              if (side !== "after") return;
              const video = event.currentTarget;
              setLoadedSize({ width: video.videoWidth, height: video.videoHeight });
            }}
          />
        )}
      </div>
    </div>
  );

  const pane = (side: "before" | "after") => {
    const src = side === "after" ? afterSrc : beforeSrc;
    // Per side, not per entry: a GIF in a <video> renders nothing, so it keeps the <img>.
    const item = side === "after" ? entry.candidate : entry.source;
    if (item && isVideo(item)) return videoPane(side, src);

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
              missing
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
    <div
      className="candidate-review-modal__compare"
      style={{ "--stage-aspect": aspect } as CSSProperties}
    >
      {pane("before")}
      {pane("after")}
    </div>
  );
}
