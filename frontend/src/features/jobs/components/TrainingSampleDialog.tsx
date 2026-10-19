import { useCallback, useEffect } from "react";
import { optionalMediaUrl } from "@/features/gallery/api/media";
import { ZoomableImage } from "@/features/gallery/components/ZoomableImage";
import { isVideoName } from "@/features/gallery/lib/itemKind";
import {
  schedulePrefetchDialogMedia,
  type DialogMediaPrefetchTarget,
} from "@/features/gallery/lib/dialogMediaPrefetch";
import { iconChevronLeft, iconChevronRight, iconX } from "@/shared/icons";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { queueIndexAfter, queueStepFor } from "@/shared/lib/shortcuts";
import type { OstrisTrainingSample } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { DialogShell } from "@/shared/ui/DialogShell";

interface TrainingSampleDialogProps {
  samples: OstrisTrainingSample[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** A read-only lightbox for one training sample, with navigation across the step's samples. */
export function TrainingSampleDialog({
  samples,
  index,
  onIndexChange,
  onClose,
}: TrainingSampleDialogProps) {
  const goTo = useCallback(
    (offset: number) => {
      if (samples.length === 0) return;
      onIndexChange((index + offset + samples.length) % samples.length);
    },
    [index, onIndexChange, samples.length],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;

      const step = queueStepFor(event);
      if (!step || samples.length === 0) return;
      event.preventDefault();
      if (step === "previous") goTo(-1);
      else if (step === "next") goTo(1);
      else onIndexChange(queueIndexAfter(step, index, samples.length));
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [goTo, index, onIndexChange, samples.length]);

  // Warm the neighbours so navigation does not flash empty.
  useEffect(() => {
    const count = samples.length;
    const current = samples[index];
    if (!current || count < 2) return;

    const targets = new Map<string, DialogMediaPrefetchTarget>();
    for (const offset of [-1, 1]) {
      const neighbour = samples[(index + offset + count) % count];
      if (neighbour.path === current.path) continue;
      targets.set(neighbour.path, {
        path: neighbour.path,
        url: optionalMediaUrl(neighbour.path, neighbour.name),
        kind: isVideoName(neighbour.name) ? "video" : "image",
      });
    }

    return schedulePrefetchDialogMedia([...targets.values()]);
  }, [index, samples]);

  const sample = samples[index];
  if (!sample) return null;

  const hasSiblings = samples.length > 1;

  return (
    <DialogShell
      block="training-sample-dialog"
      label={`Training sample ${index + 1} of ${samples.length}`}
      onClose={onClose}
      scrollLock="training-sample-dialog-open"
      backdropLabel="Close sample viewer"
    >
      <header className="training-sample-dialog__header">
        <div className="training-sample-dialog__header-text">
          <h2 className="training-sample-dialog__title">Sample at step {sample.step}</h2>
          <span className="training-sample-dialog__counter">
            {index + 1} / {samples.length}
          </span>
        </div>
        <button
          type="button"
          className="training-sample-dialog__close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon icon={iconX} />
        </button>
      </header>

      <div className="training-sample-dialog__stage">
        {hasSiblings && (
          <button
            type="button"
            className="training-sample-dialog__nav training-sample-dialog__nav--prev"
            onClick={() => goTo(-1)}
            aria-label="Previous sample"
          >
            <Icon icon={iconChevronLeft} />
          </button>
        )}

        {isVideoName(sample.name) ? (
          <video
            key={sample.path}
            className="training-sample-dialog__video"
            src={optionalMediaUrl(sample.path, sample.name)}
            aria-label={sample.prompt}
            controls
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <ZoomableImage
            key={sample.path}
            className="training-sample-dialog__media-wrap"
            imgClassName="training-sample-dialog__img"
            src={optionalMediaUrl(sample.path, sample.name)}
            alt={sample.prompt}
          />
        )}

        {hasSiblings && (
          <button
            type="button"
            className="training-sample-dialog__nav training-sample-dialog__nav--next"
            onClick={() => goTo(1)}
            aria-label="Next sample"
          >
            <Icon icon={iconChevronRight} />
          </button>
        )}
      </div>

      <footer className="training-sample-dialog__footer">
        <p className="training-sample-dialog__prompt" data-scroll-lock-allow>
          {sample.prompt}
        </p>
      </footer>
    </DialogShell>
  );
}
