export const ASPECT_RATIO_BUCKETS = [
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
  { label: "21:9", ratio: 21 / 9 },
] as const;

export const OTHER_ASPECT_LABEL = "Other";

const ASPECT_RATIO_MAX_DRIFT = 1.15;

const ASPECT_RATIO_EXACT_DRIFT = 1.01;

function nearestBucket(width: number, height: number) {
  const ratio = width / height;
  let label: string = OTHER_ASPECT_LABEL;
  let drift = Number.POSITIVE_INFINITY;

  for (const bucket of ASPECT_RATIO_BUCKETS) {
    const bucketDrift = ratio > bucket.ratio ? ratio / bucket.ratio : bucket.ratio / ratio;
    if (bucketDrift < drift) {
      drift = bucketDrift;
      label = bucket.label;
    }
  }

  return { label, drift };
}

export function aspectRatioLabel(width: number, height: number): string {
  const { label, drift } = nearestBucket(width, height);
  return drift <= ASPECT_RATIO_MAX_DRIFT ? label : OTHER_ASPECT_LABEL;
}

export function formatAspectRatio(width: number, height: number): string {
  const { label, drift } = nearestBucket(width, height);
  if (drift <= ASPECT_RATIO_EXACT_DRIFT) return label;
  if (drift <= ASPECT_RATIO_MAX_DRIFT) return `~${label}`;
  return width >= height ? `${(width / height).toFixed(2)}:1` : `1:${(height / width).toFixed(2)}`;
}
