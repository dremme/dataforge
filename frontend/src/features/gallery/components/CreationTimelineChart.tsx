import { useRef } from "react";
import { useCountUp } from "@/features/gallery/hooks/useCountUp";
import type { CreationTimelineGrouping, StatBucket } from "@/features/gallery/lib/datasetStats";
import { iconChevronLeft, iconChevronRight } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

const countFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function CreationTimelineChart({
  buckets,
  grouping,
  onNavigatePeriod,
}: {
  buckets: StatBucket[];
  grouping: CreationTimelineGrouping;
  onNavigatePeriod: (direction: -1 | 1) => void;
}) {
  const chartRef = useRef<HTMLElement>(null);
  const progress = useCountUp(buckets.length > 0 ? 100 : 0, chartRef);
  if (buckets.length === 0) return null;

  const peak = Math.max(...buckets.map((bucket) => bucket.count));
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, peak / 4)));
  const step = [1, 2, 5, 10].find((value) => value * magnitude >= peak / 4)! * magnitude;
  const maximum = Math.max(step, Math.ceil(peak / step) * step);
  const ticks = Array.from({ length: maximum / step + 1 }, (_, index) => index * step);
  const labelStep = Math.ceil(buckets.length / 7);
  const navigationUnit = grouping === "day" ? "month" : "year";
  const period =
    grouping === "day"
      ? buckets[0].label.replace(/ \d+,/, "")
      : grouping === "month"
        ? buckets[0].label.slice(-4)
        : "All years";

  return (
    <figure
      ref={chartRef}
      className="stats-drawer__timeline"
      aria-label="Distribution by media creation date"
    >
      <div className="stats-drawer__timeline-body">
        <div className="stats-drawer__timeline-y-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{countFormatter.format(tick)}</span>
          ))}
        </div>
        <div className="stats-drawer__timeline-viewport">
          <div className="stats-drawer__timeline-plot">
            <div className="stats-drawer__timeline-grid" aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick} style={{ bottom: `${(tick / maximum) * 100}%` }} />
              ))}
            </div>
            <dl
              className={classNames(
                "stats-drawer__timeline-columns",
                buckets.length > 12 && "stats-drawer__timeline-columns--dense",
              )}
              style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
            >
              {buckets.map((bucket, index) => {
                const label =
                  grouping === "day"
                    ? bucket.label.split(" ")[1].replace(",", "")
                    : bucket.label.split(" ")[0];
                const showLabel =
                  index === buckets.length - 1 ||
                  (index % labelStep === 0 && buckets.length - 1 - index > labelStep / 2);
                const countLabel = `${bucket.count} ${bucket.count === 1 ? "file" : "files"}`;
                return (
                  <div key={bucket.label} className="stats-drawer__timeline-column">
                    <dt
                      className={classNames(
                        "stats-drawer__timeline-label",
                        buckets.length > 12 && index === 0 && "stats-drawer__timeline-label--first",
                        buckets.length > 12 &&
                          index === buckets.length - 1 &&
                          "stats-drawer__timeline-label--last",
                      )}
                      title={bucket.label}
                    >
                      <span className="stats-drawer__timeline-full-label">{bucket.label}</span>
                      {showLabel && <span aria-hidden="true">{label}</span>}
                    </dt>
                    <dd className="stats-drawer__timeline-value">
                      {bucket.count > 0 ? (
                        <Tooltip
                          content={`${bucket.label}: ${countLabel}`}
                          delay={0}
                          placement="top"
                          className="stats-drawer__timeline-bar"
                          style={{ height: `${(bucket.count / maximum) * progress}%` }}
                        >
                          <span
                            className="stats-drawer__timeline-fill"
                            tabIndex={0}
                            role="img"
                            aria-label={countLabel}
                          >
                            {buckets.length <= 12 && (
                              <span className="stats-drawer__timeline-count">
                                {countFormatter.format(Math.round((bucket.count * progress) / 100))}
                              </span>
                            )}
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="stats-drawer__timeline-zero">0 files</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      </div>
      <figcaption className="stats-drawer__timeline-caption">
        <div className="stats-drawer__timeline-navigation">
          {peak === 0 && <p className="stats-drawer__note">No media created in this period.</p>}
          {grouping !== "year" && (
            <button
              type="button"
              className="stats-drawer__timeline-step"
              aria-label={`Previous ${navigationUnit}`}
              onClick={() => onNavigatePeriod(-1)}
            >
              <Icon icon={iconChevronLeft} />
            </button>
          )}
          <span aria-live="polite" aria-atomic="true">
            {period}
          </span>
          {grouping !== "year" && (
            <button
              type="button"
              className="stats-drawer__timeline-step"
              aria-label={`Next ${navigationUnit}`}
              onClick={() => onNavigatePeriod(1)}
            >
              <Icon icon={iconChevronRight} />
            </button>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
