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

interface StatsDrawerProps {
  open: boolean;
  items: GalleryItem[];
  onClose: () => void;
  /** Sends a frequent word or tag to the gallery search. Omitted, both lists stay read-only. */
  onSearchWord?: (word: string) => void;
}

export function StatsDrawer({ open, items, onClose, onSearchWord }: StatsDrawerProps) {
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
      block="stats-drawer"
      panelAs="aside"
      // StatsButton points aria-controls here from outside the drawer, so the id stays a fixed string.
      panelId="stats-drawer-panel"
      labelledById="stats-drawer-title"
      onClose={onClose}
      scrollLock="stats-drawer-open"
      backdropLabel="Close dataset statistics"
      enterAnimation="none"
      closing={closing}
      onExited={() => setClosing(false)}
    >
      <header className="stats-drawer__header">
        <div className="stats-drawer__title">
          <Icon icon={iconChartBar} className="stats-drawer__title-icon" />
          <h2 id="stats-drawer-title">Dataset statistics</h2>
        </div>

        <button type="button" className="stats-drawer__close" onClick={onClose} aria-label="Close">
          <Icon icon={iconX} />
        </button>
      </header>

      <div className="stats-drawer__content" data-scroll-lock-allow>
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
  const groupingName = useId();
  const stats = useMemo(
    () => computeDatasetStats(items, creationGrouping),
    [items, creationGrouping],
  );

  if (stats.total === 0) {
    return (
      <div className="stats-drawer__empty">
        <p>No media in this folder.</p>
        <p className="stats-drawer__empty-hint">
          Open a folder with images or videos to see how it looks as a training set.
        </p>
      </div>
    );
  }

  return (
    <div className="stats-drawer__stats">
      <Overview stats={stats} />

      <Section title="Media created" icon={iconCalendar}>
        {stats.creationTimeline.length > 0 && (
          <div
            className="stats-drawer__grouping"
            role="radiogroup"
            aria-label="Creation timeline grouping"
          >
            {CREATION_GROUPING_OPTIONS.map(({ value, label }) => (
              <label key={value} className="stats-drawer__grouping-option">
                <input
                  className="stats-drawer__grouping-input"
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
        />
        {stats.creationTimeline.length === 0 && (
          <p className="stats-drawer__note">Creation dates are unavailable for this folder.</p>
        )}
        {stats.creationTimeline.length > 0 && stats.unknownCreationDate > 0 && (
          <p className="stats-drawer__note">
            {stats.unknownCreationDate}{" "}
            {stats.unknownCreationDate === 1 ? "file has" : "files have"} an unknown creation date.
          </p>
        )}
      </Section>

      {stats.captionLength && (
        <Section title="Caption length" icon={iconMessageSquareText}>
          <div className="stats-drawer__tiles">
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
            "stats-drawer__tiles",
            stats.mediaTypes.audio > 0 && "stats-drawer__tiles--pairs",
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
            <p className="stats-drawer__note">
              {stats.unknownDuration} {stats.unknownDuration === 1 ? "video has" : "videos have"} an
              unknown duration.
            </p>
          )}
        </Section>
      )}

      <Section title="Resolution" icon={iconRulerDimensionLine}>
        <BarChart buckets={stats.megapixels} unit="megapixels" />
        {stats.unknownResolution > 0 && (
          <p className="stats-drawer__note">
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
      <p ref={refCountUp} className="stats-drawer__hero">
        <span className="stats-drawer__hero-value">{percentCountUp}</span>
        <span className="stats-drawer__hero-unit">%</span>
      </p>

      <div
        className="stats-drawer__meter"
        role="meter"
        aria-label="Caption coverage"
        aria-valuemin={0}
        aria-valuemax={stats.total}
        aria-valuenow={captioned}
        aria-valuetext={`${captioned} of ${stats.total} files captioned`}
      >
        <div className="stats-drawer__meter-fill" style={{ width: `${percentCountUp}%` }} />
      </div>

      <p className="stats-drawer__hero-caption">
        {captioned} of {stats.total} files captioned
      </p>

      {missingCaption > 0 && (
        <p className="stats-drawer__status stats-drawer__status--warning">
          <Icon icon={iconMessageDashed} className="stats-drawer__status-icon" />
          {missingCaption} {missingCaption === 1 ? "file is" : "files are"} missing a caption
        </p>
      )}

      {captionIssues > 0 && (
        <p className="stats-drawer__status stats-drawer__status--warning">
          <Icon icon={iconMessageWarning} className="stats-drawer__status-icon" />
          {captionIssues} {captionIssues === 1 ? "file has" : "files have"} a caption issue
        </p>
      )}

      {duplicates > 0 && (
        <p className="stats-drawer__status stats-drawer__status--info">
          <Icon icon={iconFiles} className="stats-drawer__status-icon" />
          {duplicates} {duplicates === 1 ? "file is" : "files are"} in {duplicateGroups}{" "}
          {duplicateGroups === 1 ? "duplicate group" : "duplicate groups"}
        </p>
      )}

      {clear && (
        <p className="stats-drawer__status stats-drawer__status--good">
          <Icon icon={iconMessageCheck} className="stats-drawer__status-icon" />
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
    <section className={classNames("stats-drawer__section", lead && "stats-drawer__section--lead")}>
      <h3 className="stats-drawer__section-title">
        {icon ? <Icon icon={icon} className="stats-drawer__section-title-icon" /> : null}
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
    <div ref={ref} className="stats-drawer__tile">
      <span className="stats-drawer__tile-value" aria-label={String(value)}>
        {displayed}
      </span>
      <span className="stats-drawer__tile-label">{label}</span>
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
    <figure className="stats-drawer__mix" aria-label={`File extensions: ${summary}`}>
      <div className="stats-drawer__mix-track">
        {buckets.map((bucket) => (
          <Tooltip
            key={bucket.label}
            content={formatName(bucket.label)}
            delay={0}
            className="stats-drawer__mix-cell"
            style={{ flexGrow: bucket.count }}
          >
            <span className="stats-drawer__mix-segment" data-extension={bucket.label} />
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
    <figure className="stats-drawer__chart" aria-label={`Distribution by ${unit}`}>
      <dl className={`stats-drawer__bars stats-drawer__bars--${labelWidth}`}>
        {visible.map((bucket) => (
          <div key={bucket.label} className="stats-drawer__bar-row">
            <dt className="stats-drawer__bar-label" title={bucket.label}>
              {onSelectLabel ? (
                <button
                  type="button"
                  className="stats-drawer__bar-button"
                  onClick={() => onSelectLabel(bucket.label)}
                  title={`Search for "${bucket.label}"`}
                >
                  {bucket.label}
                </button>
              ) : (
                bucket.label
              )}
            </dt>
            <dd className="stats-drawer__bar-value">
              <span className="stats-drawer__bar-track">
                <span
                  className="stats-drawer__bar-fill"
                  style={{ width: `${(bucket.count / peak) * 100}%` }}
                />
              </span>
              <span className="stats-drawer__bar-count">{compactCount(bucket.count)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
