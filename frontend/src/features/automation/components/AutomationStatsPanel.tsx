import { useMemo } from "react";
import { computeDatasetStats, type StatBucket } from "@/features/gallery/lib/datasetStats";
import type { CaptionFilter } from "@/features/gallery/lib/query";
import { classNames } from "@/shared/lib/classNames";
import type { GalleryItem } from "@/shared/types";

export interface AutomationStatsPanelProps {
  /** Matches the aria-controls of the toggle button in the automation header. */
  id: string;
  open: boolean;
  /** The whole folder, not the filtered view: a dataset overview ignores the search. */
  items: GalleryItem[];
  filter: CaptionFilter;
  onFilterChange: (filter: CaptionFilter) => void;
}

/** Collapsible read-only summary of the folder as a training set. */
export function AutomationStatsPanel({
  id,
  open,
  items,
  filter,
  onFilterChange,
}: AutomationStatsPanelProps) {
  const stats = useMemo(() => computeDatasetStats(items), [items]);

  if (stats.total === 0) return null;

  return (
    <div
      id={id}
      className={classNames("automation__specs-panel", open && "automation__specs-panel--open")}
    >
      <div className="automation__specs-panel-inner">
        <div className="automation__stats" role="region" aria-label="Dataset statistics">
          <StatsSection title={`Captions (${stats.total} files)`}>
            {stats.coverage.map((entry) => {
              const active = filter === entry.filter;
              return (
                <button
                  key={entry.filter}
                  type="button"
                  className={classNames(
                    "automation__stat",
                    "automation__stat--filter",
                    active && "automation__stat--active",
                  )}
                  aria-pressed={active}
                  // Clicking an applied filter clears it, matching the toolbar stats.
                  onClick={() => onFilterChange(active ? "all" : entry.filter)}
                >
                  <span className="automation__stat-value">{entry.count}</span>
                  <span className="automation__stat-label">{entry.label}</span>
                </button>
              );
            })}
          </StatsSection>

          {stats.captionLength && (
            <StatsSection title="Caption length">
              <Stat value={stats.captionLength.min} label="shortest" />
              <Stat value={stats.captionLength.median} label="median" />
              <Stat value={stats.captionLength.max} label="longest" />
              <BucketBars buckets={stats.captionLength.buckets} unit="characters" />
            </StatsSection>
          )}

          <StatsSection title="Media">
            {stats.mediaTypes
              .filter((entry) => entry.count > 0)
              .map((entry) => (
                <Stat key={entry.label} value={entry.count} label={entry.label} />
              ))}
            <BucketBars buckets={stats.megapixels} unit="megapixels" />
            {stats.unknownResolution > 0 && (
              <p className="automation__stats-note">
                {stats.unknownResolution}{" "}
                {stats.unknownResolution === 1 ? "file has" : "files have"} an unknown resolution.
              </p>
            )}
          </StatsSection>

          {stats.topWords.length > 0 && (
            <StatsSection title="Most frequent words">
              <ul className="automation__stats-words">
                {stats.topWords.map((entry) => (
                  <li key={entry.word} className="automation__stats-word">
                    {entry.word}
                    <span className="automation__stats-word-count">{entry.count}</span>
                  </li>
                ))}
              </ul>
            </StatsSection>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="automation__stats-section">
      <h3 className="automation__stats-title">{title}</h3>
      <div className="automation__stats-body">{children}</div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="automation__stat">
      <span className="automation__stat-value">{value}</span>
      <span className="automation__stat-label">{label}</span>
    </span>
  );
}

/** A compact histogram; each bar is sized against the fullest bucket, not the total. */
function BucketBars({ buckets, unit }: { buckets: StatBucket[]; unit: string }) {
  const peak = Math.max(...buckets.map((bucket) => bucket.count));
  if (peak === 0) return null;

  return (
    <ul className="automation__stats-buckets" aria-label={`Distribution by ${unit}`}>
      {buckets.map((bucket) => (
        <li key={bucket.label} className="automation__stats-bucket">
          <span className="automation__stats-bucket-label">{bucket.label}</span>
          <span className="automation__stats-bucket-track">
            <span
              className="automation__stats-bucket-bar"
              style={{ width: `${(bucket.count / peak) * 100}%` }}
            />
          </span>
          <span className="automation__stats-bucket-count">{bucket.count}</span>
        </li>
      ))}
    </ul>
  );
}
