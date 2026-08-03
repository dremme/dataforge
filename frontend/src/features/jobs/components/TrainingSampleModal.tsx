import { useCallback, useEffect } from "react";
import { mediaUrl } from "@/features/gallery/api/media";
import { ZoomableImage } from "@/features/gallery/components/ZoomableImage";
import {
  schedulePrefetchModalMedia,
  type ModalMediaPrefetchTarget,
} from "@/features/gallery/lib/modalMediaPrefetch";
import { iconChevronLeft, iconChevronRight, iconX } from "@/shared/icons";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import type { OstrisTrainingSample } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";

interface TrainingSampleModalProps {
  samples: OstrisTrainingSample[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** A read-only lightbox for one training sample, with navigation across the step's samples. */
export function TrainingSampleModal({
  samples,
  index,
  onIndexChange,
  onClose,
}: TrainingSampleModalProps) {
  const goTo = useCallback(
    (offset: number) => {
      if (samples.length === 0) return;
      onIndexChange((index + offset + samples.length) % samples.length);
    },
    [index, onIndexChange, samples.length],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft") goTo(-1);
      if (event.key === "ArrowRight") goTo(1);
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [goTo]);

  // Warm the neighbours so navigation does not flash empty.
  useEffect(() => {
    const count = samples.length;
    const current = samples[index];
    if (!current || count < 2) return;

    const targets = new Map<string, ModalMediaPrefetchTarget>();
    for (const offset of [-1, 1]) {
      const neighbour = samples[(index + offset + count) % count];
      if (neighbour.path === current.path) continue;
      targets.set(neighbour.path, {
        path: neighbour.path,
        url: mediaUrl(neighbour.path, neighbour.name),
        kind: "image",
      });
    }

    return schedulePrefetchModalMedia([...targets.values()]);
  }, [index, samples]);

  const sample = samples[index];
  if (!sample) return null;

  const hasSiblings = samples.length > 1;

  return (
    <ModalShell
      block="training-sample-modal"
      label={`Training sample ${index + 1} of ${samples.length}`}
      onClose={onClose}
      scrollLock="training-sample-modal-open"
      backdropLabel="Close sample viewer"
    >
      <header className="training-sample-modal__header">
        <div className="training-sample-modal__header-text">
          <h2 className="training-sample-modal__title">Sample at step {sample.step}</h2>
          <span className="training-sample-modal__counter">
            {index + 1} / {samples.length}
          </span>
        </div>
        <button
          type="button"
          className="training-sample-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon icon={iconX} />
        </button>
      </header>

      <div className="training-sample-modal__stage">
        {hasSiblings && (
          <button
            type="button"
            className="training-sample-modal__nav training-sample-modal__nav--prev"
            onClick={() => goTo(-1)}
            aria-label="Previous sample"
          >
            <Icon icon={iconChevronLeft} />
          </button>
        )}

        <ZoomableImage
          key={sample.path}
          className="training-sample-modal__media-wrap"
          imgClassName="training-sample-modal__img"
          src={mediaUrl(sample.path, sample.name)}
          alt={sample.prompt}
        />

        {hasSiblings && (
          <button
            type="button"
            className="training-sample-modal__nav training-sample-modal__nav--next"
            onClick={() => goTo(1)}
            aria-label="Next sample"
          >
            <Icon icon={iconChevronRight} />
          </button>
        )}
      </div>

      <footer className="training-sample-modal__footer">
        <p className="training-sample-modal__prompt" data-scroll-lock-allow>
          {sample.prompt}
        </p>
      </footer>
    </ModalShell>
  );
}
