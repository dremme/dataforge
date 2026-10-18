import { useId, useMemo, useRef, useState } from "react";
import { CreationTimelineChart } from "@/features/gallery/components/CreationTimelineChart";
import { useCountUp } from "@/features/gallery/hooks/useCountUp";
import {
  computeDatasetStats,
  type CreationTimelineGrouping,
  type DatasetStats,
  type StatBucket,
} from "@/features/gallery/lib/datasetStats";
import {
  iconBookOpen,
  iconCalendar,
  iconChartBar,
  iconFiles,
  iconHourglass,
  iconImages,
  iconMessageCheck,
  iconMessageDashed,
  iconMessageSquareText,
  iconMessageWarning,
  iconProportions,
  iconRulerDimensionLine,
  iconTag,
  iconX,
  type AppIcon,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { readStored, writeStored } from "@/shared/lib/storage";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { GalleryItem } from "@/shared/types";

const CREATION_GROUPING_KEY = "stats-creation-grouping";
const CREATION_GROUPING_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
] as const;

interface StatsModalProps {
  open: boolean;
  items: GalleryItem[];
  onClose: () => void;
  /** Sends a frequent word or tag to the gallery search. Omitted, both lists stay read-only. */
  onSearchWord?: (word: string) => void;
}

export function StatsModal({ open, items, onClose, onSearchWord }: StatsModalProps) {
  // Slides out rather than vanishing, so it outlives open by the animation length.
  const [closing, setClosing] = useState(false);
  const [renderedOpen, setRenderedOpen] = useState(open);
  if (renderedOpen !== open) {
    setRenderedOpen(open);
    setClosing(renderedOpen && !open);
  }

  if (!open && !closing) return null;

  return (
    <ModalShell
      block="stats-modal"
      panelAs="aside"
      // StatsButton points aria-controls here from outside the drawer, so the id stays a fixed string.
      panelId="stats-modal-panel"
      labelledById="stats-modal-title"
      onClose={onClose}
      scrollLock="stats-modal-open"
      backdropLabel="Close dataset statistics"
      enterAnimation="none"
      closing={closing}
      onExited={() => setClosing(false)}
    >
      <header className="stats-modal__header">
        <div className="stats-modal__title">
          <Icon icon={iconChartBar} className="stats-modal__title-icon" />
          <h2 id="stats-modal-title">Dataset statistics</h2>
        </div>

        <button type="button" className="stats-modal__close" onClick={onClose} aria-label="Close">
          <Icon icon={iconX} />
        </button>
      </header>

      <div className="stats-modal__content" data-scroll-lock-allow>
        <StatsContent items={items} onSearchWord={onSearchWord} />
      </div>
    </ModalShell>
  );
}

function compactCount(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}K`;
}

function StatsContent({
  items,
  onSearchWord,
}: {
  items: GalleryItem[];
  onSearchWord?: (word: string) => void;
}) {
  const [creationGrouping, setCreationGrouping] = useState<CreationTimelineGrouping | undefined>(
    () => {
      const stored = readStored(CREATION_GROUPING_KEY);
      return CREATION_GROUPING_OPTIONS.find((option) => option.value === stored)?.value;
    },
  );
  const [creationPeriod, setCreationPeriod] = useState(() => new Date());
  const groupingName = useId();
  const stats = useMemo(
    () => computeDatasetStats(items, creationGrouping, creationPeriod),
    [items, creationGrouping, creationPeriod],
  );

  if (stats.total === 0) {
    return (
      <div className="stats-modal__empty">
        <p>No media in this folder.</p>
        <p className="stats-modal__empty-hint">
          Open a folder with images or videos to see how it looks as a training set.
        </p>
      </div>
    );
  }

  return (
    <div className="stats-modal__stats">
      <Overview stats={stats} />

      <Section title="Media created" icon={iconCalendar}>
        {stats.creationTimeline.length > 0 && (
          <div
            className="stats-modal__grouping"
            role="radiogroup"
            aria-label="Creation timeline grouping"
          >
            {CREATION_GROUPING_OPTIONS.map(({ value, label }) => (
              <label key={value} className="stats-modal__grouping-option">
                <input
                  className="stats-modal__grouping-input"
                  type="radio"
                  name={groupingName}
                  value={value}
                  checked={stats.creationTimelineGrouping === value}
                  onChange={() => {
                    setCreationGrouping(value);
                    writeStored(CREATION_GROUPING_KEY, value);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        )}
        <CreationTimelineChart
          buckets={stats.creationTimeline}
          grouping={stats.creationTimelineGrouping}
          onNavigatePeriod={(direction) => {
            // Day one avoids skipping February when navigating from January 31.
            setCreationPeriod(
              (period) =>
                new Date(
                  period.getFullYear() +
                    (stats.creationTimelineGrouping === "month" ? direction : 0),
                  period.getMonth() + (stats.creationTimelineGrouping === "day" ? direction : 0),
                  1,
                  12,
                ),
            );
          }}
        />
        {stats.creationTimeline.length === 0 && (
          <p className="stats-modal__note">Creation dates are unavailable for this folder.</p>
        )}
        {stats.creationTimeline.length > 0 && stats.unknownCreationDate > 0 && (
          <p className="stats-modal__note">
            {stats.unknownCreationDate}{" "}
            {stats.unknownCreationDate === 1 ? "file has" : "files have"} an unknown creation date.
          </p>
        )}
      </Section>

      {stats.captionLength && (
        <Section title="Caption length" icon={iconMessageSquareText}>
          <div className="stats-modal__tiles">
            <Tile value={stats.captionLength.min} label="Shortest" />
            <Tile value={stats.captionLength.median} label="Median" />
            <Tile value={stats.captionLength.max} label="Longest" />
          </div>
          <BarChart buckets={stats.captionLength.buckets} unit="caption length in characters" />
        </Section>
      )}

      <Section title="Media" icon={iconImages}>
        <div
          className={classNames(
            "stats-modal__tiles",
            stats.mediaTypes.audio > 0 && "stats-modal__tiles--pairs",
          )}
        >
          <Tile value={stats.mediaTypes.images} label="Images" />
          <Tile value={stats.mediaTypes.videos} label="Videos" />
          <Tile value={stats.mediaTypes.gifs} label="GIFs" />
          {stats.mediaTypes.audio > 0 && <Tile value={stats.mediaTypes.audio} label="Audio" />}
        </div>
        <MediaMix buckets={stats.mediaTypes.byExtension} total={stats.total} />
      </Section>

      {stats.mediaTypes.videos > 0 && (
        <Section title="Video duration" icon={iconHourglass}>
          <BarChart buckets={stats.durations} unit="video duration in seconds" />
          {stats.unknownDuration > 0 && (
            <p className="stats-modal__note">
              {stats.unknownDuration} {stats.unknownDuration === 1 ? "video has" : "videos have"} an
              unknown duration.
            </p>
          )}
        </Section>
      )}

      <Section title="Resolution" icon={iconRulerDimensionLine}>
        <BarChart buckets={stats.megapixels} unit="megapixels" />
        {stats.unknownResolution > 0 && (
          <p className="stats-modal__note">
            {stats.unknownResolution} {stats.unknownResolution === 1 ? "file has" : "files have"} an
            unknown resolution.
          </p>
        )}
      </Section>

      {stats.aspectRatios.some((bucket) => bucket.count > 0) && (
        <Section title="Aspect ratio" icon={iconProportions}>
          <BarChart buckets={stats.aspectRatios} unit="aspect ratio" />
        </Section>
      )}

      {stats.topWords.length > 0 && (
        <Section title="Most frequent words" icon={iconBookOpen}>
          <BarChart
            buckets={stats.topWords.map((entry) => ({ label: entry.word, count: entry.count }))}
            unit="how often each word appears"
            labelWidth="wide"
            onSelectLabel={onSearchWord}
          />
        </Section>
      )}

      {stats.topTags.length > 0 && (
        <Section title="Most frequent tags" icon={iconTag}>
          <BarChart
            buckets={stats.topTags}
            unit="how many files have each tag"
            labelWidth="wide"
            onSelectLabel={onSearchWord}
          />
        </Section>
      )}
    </div>
  );
}

function Overview({ stats }: { stats: DatasetStats }) {
  const { captioned, missingCaption, captionIssues, duplicates, duplicateGroups } = stats.findings;
  const percent = stats.total === 0 ? 0 : Math.round((captioned / stats.total) * 100);
  const clear = missingCaption === 0 && captionIssues === 0 && duplicates === 0;

  const refCountUp = useRef<HTMLDivElement>(null);
  const percentCountUp = useCountUp(percent, refCountUp);

  return (
    <Section title="Overview" lead>
      <p ref={refCountUp} className="stats-modal__hero">
        <span className="stats-modal__hero-value">{percentCountUp}</span>
        <span className="stats-modal__hero-unit">%</span>
      </p>

      <div
        className="stats-modal__meter"
        role="meter"
        aria-label="Caption coverage"
        aria-valuemin={0}
        aria-valuemax={stats.total}
        aria-valuenow={captioned}
        aria-valuetext={`${captioned} of ${stats.total} files captioned`}
      >
        <div className="stats-modal__meter-fill" style={{ width: `${percentCountUp}%` }} />
      </div>

      <p className="stats-modal__hero-caption">
        {captioned} of {stats.total} files captioned
      </p>

      {missingCaption > 0 && (
        <p className="stats-modal__status stats-modal__status--warning">
          <Icon icon={iconMessageDashed} className="stats-modal__status-icon" />
          {missingCaption} {missingCaption === 1 ? "file is" : "files are"} missing a caption
        </p>
      )}

      {captionIssues > 0 && (
        <p className="stats-modal__status stats-modal__status--warning">
          <Icon icon={iconMessageWarning} className="stats-modal__status-icon" />
          {captionIssues} {captionIssues === 1 ? "file has" : "files have"} a caption issue
        </p>
      )}

      {duplicates > 0 && (
        <p className="stats-modal__status stats-modal__status--info">
          <Icon icon={iconFiles} className="stats-modal__status-icon" />
          {duplicates} {duplicates === 1 ? "file is" : "files are"} in {duplicateGroups}{" "}
          {duplicateGroups === 1 ? "duplicate group" : "duplicate groups"}
        </p>
      )}

      {clear && (
        <p className="stats-modal__status stats-modal__status--good">
          <Icon icon={iconMessageCheck} className="stats-modal__status-icon" />
          Every file is captioned, with no issues or duplicates
        </p>
      )}
    </Section>
  );
}

function Section({
  title,
  icon,
  lead = false,
  children,
}: {
  title: string;
  icon?: AppIcon;
  lead?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={classNames("stats-modal__section", lead && "stats-modal__section--lead")}>
      <h3 className="stats-modal__section-title">
        {icon ? <Icon icon={icon} className="stats-modal__section-title-icon" /> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const displayed = useCountUp(value, ref);

  return (
    <div ref={ref} className="stats-modal__tile">
      <span className="stats-modal__tile-value" aria-label={String(value)}>
        {displayed}
      </span>
      <span className="stats-modal__tile-label">{label}</span>
    </div>
  );
}

function formatName(extension: string): string {
  return extension.replace(/^\./, "").toUpperCase();
}

function MediaMix({ buckets, total }: { buckets: StatBucket[]; total: number }) {
  if (buckets.length === 0 || total === 0) return null;

  const summary = buckets
    .map((bucket) => `${formatName(bucket.label)} ${Math.round((bucket.count / total) * 100)}%`)
    .join(", ");

  return (
    <figure className="stats-modal__mix" aria-label={`File extensions: ${summary}`}>
      <div className="stats-modal__mix-track">
        {buckets.map((bucket) => (
          <Tooltip
            key={bucket.label}
            content={formatName(bucket.label)}
            delay={0}
            className="stats-modal__mix-cell"
            style={{ flexGrow: bucket.count }}
          >
            <span className="stats-modal__mix-segment" data-extension={bucket.label} />
          </Tooltip>
        ))}
      </div>
    </figure>
  );
}

function BarChart({
  buckets,
  unit,
  labelWidth = "narrow",
  onSelectLabel,
}: {
  buckets: StatBucket[];
  unit: string;
  labelWidth?: "narrow" | "wide";
  onSelectLabel?: (label: string) => void;
}) {
  const visible = buckets.filter((bucket) => bucket.count > 0);
  if (visible.length === 0) return null;
  const peak = Math.max(...visible.map((bucket) => bucket.count));

  return (
    <figure className="stats-modal__chart" aria-label={`Distribution by ${unit}`}>
      <dl className={`stats-modal__bars stats-modal__bars--${labelWidth}`}>
        {visible.map((bucket) => (
          <div key={bucket.label} className="stats-modal__bar-row">
            <dt className="stats-modal__bar-label" title={bucket.label}>
              {onSelectLabel ? (
                <button
                  type="button"
                  className="stats-modal__bar-button"
                  onClick={() => onSelectLabel(bucket.label)}
                  title={`Search for "${bucket.label}"`}
                >
                  {bucket.label}
                </button>
              ) : (
                bucket.label
              )}
            </dt>
            <dd className="stats-modal__bar-value">
              <span className="stats-modal__bar-track">
                <span
                  className="stats-modal__bar-fill"
                  style={{ width: `${(bucket.count / peak) * 100}%` }}
                />
              </span>
              <span className="stats-modal__bar-count">{compactCount(bucket.count)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
