import { useMemo, useState } from "react";
import {
  computeDatasetStats,
  type DatasetStats,
  type StatBucket,
} from "@/features/gallery/lib/datasetStats";
import {
  iconChartBar,
  iconFiles,
  iconMessageCheck,
  iconMessageDashed,
  iconMessageWarning,
  iconX,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import type { GalleryItem } from "@/shared/types";

interface StatsDrawerProps {
  open: boolean;
  /** The whole folder, not the filtered view: a dataset overview ignores the search. */
  items: GalleryItem[];
  onClose: () => void;
}

/** What the open folder looks like as a training set, as a side drawer. */
export function StatsDrawer({ open, items, onClose }: StatsDrawerProps) {
  // The sheet slides out rather than vanishing, so it outlives `open` by the length
  // of that animation. Derived during render, as in `JobsDrawer`.
  const [closing, setClosing] = useState(false);
  const [renderedOpen, setRenderedOpen] = useState(open);
  if (renderedOpen !== open) {
    setRenderedOpen(open);
    setClosing(renderedOpen && !open);
  }

  // Everything below only mounts while the drawer is open, which is what lets
  // `ModalShell` own the focus, lock and Escape wiring, and keeps the stats off
  // the render path entirely while the drawer is shut.
  if (!open && !closing) return null;

  return (
    <ModalShell
      block="stats-drawer"
      panelAs="aside"
      // `StatsButton` points `aria-controls` here from outside the drawer, so it
      // stays a fixed string rather than a generated one.
      panelId="stats-drawer-panel"
      labelledById="stats-drawer-title"
      onClose={onClose}
      scrollLock="stats-drawer-open"
      backdropLabel="Close dataset statistics"
      // The panel has its own slide-in, and `_stats-drawer.scss` overrides the
      // shell's generic fade-out with a matching slide-out.
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
        <StatsContent items={items} />
      </div>
    </ModalShell>
  );
}

/** `1284` reads as `1.3K` at display sizes, where the exact digit adds nothing. */
function compactCount(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}K`;
}

function StatsContent({ items }: { items: GalleryItem[] }) {
  const stats = useMemo(() => computeDatasetStats(items), [items]);

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

      {stats.captionLength && (
        <Section title="Caption length">
          <div className="stats-drawer__tiles">
            <Tile value={stats.captionLength.min} label="Shortest" />
            <Tile value={stats.captionLength.median} label="Median" />
            <Tile value={stats.captionLength.max} label="Longest" />
          </div>
          <BarChart buckets={stats.captionLength.buckets} unit="caption length in characters" />
        </Section>
      )}

      <Section title="Media">
        <dl className="stats-drawer__rows">
          {stats.mediaTypes
            .filter((entry) => entry.count > 0)
            .map((entry) => (
              <Row key={entry.label} label={entry.label} value={entry.count} />
            ))}
        </dl>
      </Section>

      <Section title="Resolution">
        <BarChart buckets={stats.megapixels} unit="megapixels" />
        {stats.unknownResolution > 0 && (
          <p className="stats-drawer__note">
            {stats.unknownResolution} {stats.unknownResolution === 1 ? "file has" : "files have"} an
            unknown resolution.
          </p>
        )}
      </Section>

      {stats.topWords.length > 0 && (
        <Section title="Most frequent words">
          <BarChart
            buckets={stats.topWords.map((entry) => ({ label: entry.word, count: entry.count }))}
            unit="how often each word appears"
            labelWidth="wide"
          />
        </Section>
      )}
    </div>
  );
}

/**
 * The headline: how much of the folder is ready to train on, and what is not.
 *
 * A ratio against a limit is a meter, not a chart - and the percentage is the one
 * number the drawer leads with, so it gets hero treatment. The findings ride
 * underneath as status rows rather than as slices of the meter, because they cut
 * across the captioned/missing split rather than partitioning it: a file can be
 * captioned *and* flagged, *and* a duplicate.
 *
 * Titled for the whole block rather than for the meter alone, since a duplicate is a
 * property of the file and would read as a non-sequitur under "Caption coverage".
 */
function Overview({ stats }: { stats: DatasetStats }) {
  const { captioned, missingCaption, captionIssues, duplicates, duplicateGroups } = stats.findings;
  const percent = stats.total === 0 ? 0 : Math.round((captioned / stats.total) * 100);
  const clear = missingCaption === 0 && captionIssues === 0 && duplicates === 0;

  return (
    <section className="stats-drawer__section stats-drawer__section--lead">
      <h3 className="stats-drawer__section-title">Overview</h3>

      <p className="stats-drawer__hero">
        <span className="stats-drawer__hero-value">{percent}</span>
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
        <div className="stats-drawer__meter-fill" style={{ width: `${percent}%` }} />
      </div>

      <p className="stats-drawer__hero-caption">
        {captioned} of {stats.total} files captioned
      </p>

      {/* Status is never colour alone: each of these carries its own icon and words. */}
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

      {/* Accent rather than amber, matching the card badge and the resolver: a
          duplicate is a housekeeping decision, not a defect in the caption, and it
          should not compete with the rows above for alarm. */}
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
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stats-drawer__section">
      <h3 className="stats-drawer__section-title">{title}</h3>
      {children}
    </section>
  );
}

/** Headline numbers, side by side. Proportional figures: these are display sizes. */
function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="stats-drawer__tile">
      <span className="stats-drawer__tile-value">{compactCount(value)}</span>
      <span className="stats-drawer__tile-label">{label}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="stats-drawer__row">
      <dt className="stats-drawer__row-label">{label}</dt>
      <dd className="stats-drawer__row-value">{value}</dd>
    </div>
  );
}

/**
 * A horizontal bar per category, sized against the fullest one rather than the
 * total, so a lopsided distribution still shows its shape.
 *
 * One hue for every bar: length already encodes the count, and spending the colour
 * channel on the same fact would double-encode it. The value sits at the bar's tip
 * in a text token, never in the bar's own colour, so nothing is gated behind hover.
 */
function BarChart({
  buckets,
  unit,
  labelWidth = "narrow",
}: {
  buckets: StatBucket[];
  unit: string;
  labelWidth?: "narrow" | "wide";
}) {
  const peak = Math.max(...buckets.map((bucket) => bucket.count));
  if (peak === 0) return null;

  return (
    // A figure is what a chart is, and it takes an accessible name - a bare <dl>
    // exposes no role for the label to attach to.
    <figure className="stats-drawer__chart" aria-label={`Distribution by ${unit}`}>
      <dl className={`stats-drawer__bars stats-drawer__bars--${labelWidth}`}>
        {buckets.map((bucket) => (
          <div key={bucket.label} className="stats-drawer__bar-row">
            <dt className="stats-drawer__bar-label" title={bucket.label}>
              {bucket.label}
            </dt>
            <dd className="stats-drawer__bar-value">
              <span className="stats-drawer__bar-track">
                {/* An empty bucket draws no mark at all - the fill carries a
                    minimum width so one file stays visible, which would otherwise
                    render zero as a sliver and overstate it. */}
                {bucket.count > 0 && (
                  <span
                    className="stats-drawer__bar-fill"
                    style={{ width: `${(bucket.count / peak) * 100}%` }}
                  />
                )}
              </span>
              <span className="stats-drawer__bar-count">{compactCount(bucket.count)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
