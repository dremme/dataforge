import { thumbnailUrl } from "@/features/gallery/api/media";
import type { OstrisTrainingSample } from "@/shared/types";
import { Tooltip } from "@/shared/ui/Tooltip";

const SAMPLE_THUMBNAIL_WIDTH = 240;

interface TrainingSamplesProps {
  samples: OstrisTrainingSample[];
}

/** The sample images AI-Toolkit rendered at the latest sampled step. */
export function TrainingSamples({ samples }: TrainingSamplesProps) {
  if (samples.length === 0) return null;

  const step = samples[0].step;

  return (
    <div className="automation__samples">
      <p className="automation__samples-label">Samples at step {step}</p>
      <ul className="automation__samples-list" data-scroll-lock-allow>
        {samples.map((sample) => (
          <li key={sample.path} className="automation__samples-item">
            <Tooltip content={sample.prompt ?? sample.name}>
              <img
                className="automation__samples-image"
                src={thumbnailUrl(sample.path, SAMPLE_THUMBNAIL_WIDTH, sample.name)}
                alt={sample.prompt ?? `Training sample at step ${sample.step}`}
                loading="lazy"
              />
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
