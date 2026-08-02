import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { thumbnailUrl } from "@/features/gallery/api/media";
import { classNames } from "@/shared/lib/classNames";
import type { OstrisTrainingSample } from "@/shared/types";
import { Tooltip } from "@/shared/ui/Tooltip";
import { TrainingSampleModal } from "./TrainingSampleModal";

const SAMPLE_THUMBNAIL_WIDTH = 240;

function withPath(paths: ReadonlySet<string>, path: string): ReadonlySet<string> {
  if (paths.has(path)) return paths;
  return new Set(paths).add(path);
}

interface TrainingSamplesProps {
  samples: OstrisTrainingSample[];
  /** Small thumbnails for the narrow job cards in the drawer. */
  compact?: boolean;
  /** Lets a focus-trapping host stand down while the lightbox is up. */
  onLightboxOpenChange?: (open: boolean) => void;
}

/** The sample images AI-Toolkit rendered at the latest sampled step. */
export function TrainingSamples({
  samples,
  compact = false,
  onLightboxOpenChange,
}: TrainingSamplesProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [loadedPaths, setLoadedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [missingPaths, setMissingPaths] = useState<ReadonlySet<string>>(() => new Set());
  const openRef = useRef(false);

  // AI-Toolkit prunes older samples, so a listed file can be gone by the time it is fetched.
  const availableSamples = useMemo(
    () => samples.filter((sample) => !missingPaths.has(sample.path)),
    [missingPaths, samples],
  );

  const setOpen = useCallback(
    (index: number | null) => {
      openRef.current = index !== null;
      setOpenIndex(index);
      onLightboxOpenChange?.(index !== null);
    },
    [onLightboxOpenChange],
  );

  useEffect(
    () => () => {
      if (openRef.current) onLightboxOpenChange?.(false);
    },
    [onLightboxOpenChange],
  );

  // A poll or a missing file can drop samples out from under an open lightbox.
  useEffect(() => {
    setOpenIndex((index) => {
      if (index === null || index < availableSamples.length) return index;
      openRef.current = false;
      return null;
    });
  }, [availableSamples.length]);

  if (availableSamples.length === 0) return null;

  const step = availableSamples[0].step;

  return (
    <div className={classNames("training-samples", compact && "training-samples--compact")}>
      <p className="training-samples__label">Samples at step {step}</p>
      <ul className="training-samples__list" data-scroll-lock-allow>
        {availableSamples.map((sample, index) => (
          <li key={sample.path} className="training-samples__item">
            <Tooltip content={sample.prompt}>
              <button
                type="button"
                className="training-samples__button"
                onClick={() => setOpen(index)}
                aria-label={`View training sample ${index + 1} of ${availableSamples.length}`}
              >
                <img
                  className={classNames(
                    "training-samples__image",
                    loadedPaths.has(sample.path) && "training-samples__image--ready",
                  )}
                  src={thumbnailUrl(sample.path, SAMPLE_THUMBNAIL_WIDTH, sample.name)}
                  alt={sample.prompt}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onLoad={() => setLoadedPaths((paths) => withPath(paths, sample.path))}
                  onError={() => setMissingPaths((paths) => withPath(paths, sample.path))}
                />
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>

      {openIndex !== null && (
        <TrainingSampleModal
          samples={availableSamples}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
