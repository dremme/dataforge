import { GuardedDialog } from "@/shared/ui/GuardedDialog";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { previewCaptionRestore } from "@/features/automation/api/jobs";
import { folderKey } from "@/features/folder/lib/folderPath";
import { thumbnailUrl } from "@/features/gallery/api/media";
import { CAPTION_BACKUP_DIR_NAME } from "@/shared/constants";
import {
  iconAlertTriangle,
  iconCircleCheck,
  iconColumns2,
  iconFilterX,
  iconImage,
  iconRefresh,
  iconRows3,
  iconSearch,
  iconX,
  type AppIcon,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { countChangedWords, diffCaptionWords } from "@/shared/lib/captionWordDiff";
import { formatCount } from "@/shared/lib/format";
import { readStored, writeStored } from "@/shared/lib/storage";
import { formatApiError } from "@/shared/api/http";
import type { CaptionBackupCompareSample, RestoreCaptionsPreviewResponse } from "@/shared/types";
import { CaptionDiffView, type CaptionDiffLayout } from "@/shared/ui/CaptionWordDiff";
import { DialogActions, DialogButton } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Icon } from "@/shared/ui/Icon";

const LAYOUT_STORAGE_KEY = "restore-captions-diff-layout";
// The gallery's size, so the thumbnails are usually cached already and stay sharp at 2x.
const THUMBNAIL_WIDTH = 400;

const LAYOUT_OPTIONS: ReadonlyArray<{ value: CaptionDiffLayout; label: string; icon: AppIcon }> = [
  { value: "inline", label: "Inline", icon: iconRows3 },
  { value: "split", label: "Side by side", icon: iconColumns2 },
];

type SampleKind = "changed" | "new" | "unreadable";
type KindFilter = "all" | SampleKind;

const FILTER_OPTIONS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "changed", label: "Changed" },
  { value: "new", label: "New" },
  { value: "unreadable", label: "Unreadable" },
];

interface ReviewedSample {
  sample: CaptionBackupCompareSample;
  kind: SampleKind;
  /** Lowercased name and both captions, for the search box. */
  haystack: string;
}

function kindOf(sample: CaptionBackupCompareSample): SampleKind {
  if (sample.error) return "unreadable";
  return sample.current === null || sample.current === undefined ? "new" : "changed";
}

function readLayout(): CaptionDiffLayout {
  return readStored(LAYOUT_STORAGE_KEY) === "split" ? "split" : "inline";
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

interface RestoreCaptionsDialogProps {
  scope: DialogScopeInfo;
  folderPath: string;
  /** The files the restore will run on, so the preview compares exactly those. */
  selectedPaths?: string[];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreCaptionsDialog({
  scope,
  folderPath,
  selectedPaths,
  busy = false,
  onConfirm,
  onCancel,
}: RestoreCaptionsDialogProps) {
  const preview = useQuery({
    queryKey: ["restore-preview", folderKey(folderPath), selectedPaths ?? null],
    queryFn: ({ signal }) => previewCaptionRestore(folderPath, selectedPaths, signal),
    retry: false,
  });
  const differing = preview.data ? preview.data.changed + preview.data.missing : null;
  // A failed or pending preview never blocks the restore; only a known no-op does.
  const nothingToRestore = differing === 0;

  return (
    <GuardedDialog
      role="alertdialog"
      confirmDisabled={nothingToRestore}
      scope={scope}
      title="Restore captions from backup?"
      description={
        <>
          Replaces the current captions with their copies in{" "}
          <strong>{CAPTION_BACKUP_DIR_NAME}</strong>. Files without a backup keep their caption, and
          the backup itself stays in place.
        </>
      }
      panelClassName="restore-captions-dialog"
      busy={busy}
      onConfirm={nothingToRestore ? undefined : onConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel={
            differing ? `Restore ${plural(differing, "caption", "captions")}` : "Restore captions"
          }
          busyLabel="Starting..."
          onCancel={onCancel}
        />
      }
    >
      <div className="restore-captions-dialog__body">
        {preview.isError ? (
          <EmptyState
            icon={iconAlertTriangle}
            variant="error"
            role="alert"
            title="Could not compare with the backup"
            description={`${formatApiError(preview.error)} You can still restore without reviewing.`}
            action={
              <DialogButton
                label="Try again"
                variant="secondary"
                icon={iconRefresh}
                busy={preview.isFetching}
                onClick={() => void preview.refetch()}
              />
            }
          />
        ) : !preview.data ? (
          <RestoreSkeleton />
        ) : differing === 0 ? (
          <EmptyState
            icon={iconCircleCheck}
            variant="success"
            role="status"
            title="Every caption matches the backup"
            description={skippedNote(preview.data) || "Restoring would change nothing."}
          />
        ) : (
          <RestoreReview preview={preview.data} />
        )}
      </div>
    </GuardedDialog>
  );
}

/** What the restore leaves alone, or an empty string when it touches every backup. */
function skippedNote(preview: RestoreCaptionsPreviewResponse): string {
  const parts = [
    preview.unchanged > 0 &&
      plural(preview.unchanged, "caption already matches", "captions already match"),
    preview.orphaned > 0 &&
      `${plural(preview.orphaned, "backup has", "backups have")} no media and will be skipped`,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(" · ")}.` : "";
}

function RestoreReview({ preview }: { preview: RestoreCaptionsPreviewResponse }) {
  const [layout, setLayout] = useState(readLayout);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const filterName = useId();
  const layoutName = useId();

  const reviewed = useMemo<ReviewedSample[]>(
    () =>
      preview.samples.map((sample) => ({
        sample,
        kind: kindOf(sample),
        haystack: `${sample.name}\n${sample.current ?? ""}\n${sample.backup}`.toLowerCase(),
      })),
    [preview.samples],
  );
  const counts = useMemo(() => {
    const result: Record<KindFilter, number> = { all: 0, changed: 0, new: 0, unreadable: 0 };
    for (const entry of reviewed) {
      result.all += 1;
      result[entry.kind] += 1;
    }
    return result;
  }, [reviewed]);
  const visible = useMemo(
    () =>
      reviewed.filter(
        (entry) =>
          (filter === "all" || entry.kind === filter) &&
          (!deferredQuery || entry.haystack.includes(deferredQuery)),
      ),
    [deferredQuery, filter, reviewed],
  );
  const narrowed = filter !== "all" || query.trim() !== "";
  const skipped = skippedNote(preview);

  const changeLayout = (next: CaptionDiffLayout) => {
    setLayout(next);
    writeStored(LAYOUT_STORAGE_KEY, next);
  };
  const clearFilters = () => {
    setFilter("all");
    setQuery("");
  };

  return (
    <div className="restore-captions-dialog__review">
      <div className="restore-captions-dialog__toolbar">
        <div className="restore-captions-dialog__filters" role="radiogroup" aria-label="Show">
          {FILTER_OPTIONS.filter(
            (option) => option.value === "all" || counts[option.value] > 0,
          ).map((option) => (
            <label
              key={option.value}
              className={classNames(
                "restore-captions-dialog__filter",
                `restore-captions-dialog__filter--${option.value}`,
                filter === option.value && "restore-captions-dialog__filter--active",
              )}
            >
              <input
                type="radio"
                name={filterName}
                className="restore-captions-dialog__radio"
                value={option.value}
                checked={filter === option.value}
                onChange={() => setFilter(option.value)}
              />
              <span className="restore-captions-dialog__filter-label">{option.label}</span>
              <span className="restore-captions-dialog__filter-count">
                {formatCount(counts[option.value])}
              </span>
            </label>
          ))}
        </div>

        <div className="restore-captions-dialog__tools">
          <label className="restore-captions-dialog__search">
            <Icon icon={iconSearch} className="restore-captions-dialog__search-icon" />
            <input
              type="search"
              className="restore-captions-dialog__search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter would otherwise confirm the dialog and start the restore.
                if (event.key === "Enter") event.preventDefault();
                // Escape clears the search before it closes the dialog.
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder="Filter by file or caption..."
              aria-label="Filter by file name or caption text"
            />
            {query && (
              <button
                type="button"
                className="restore-captions-dialog__search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear the filter"
              >
                <Icon icon={iconX} />
              </button>
            )}
          </label>

          <div className="restore-captions-dialog__views" role="radiogroup" aria-label="Diff view">
            {LAYOUT_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={classNames(
                  "restore-captions-dialog__view",
                  layout === option.value && "restore-captions-dialog__view--active",
                )}
                title={option.label}
              >
                <input
                  type="radio"
                  name={layoutName}
                  className="restore-captions-dialog__radio"
                  value={option.value}
                  checked={layout === option.value}
                  onChange={() => changeLayout(option.value)}
                />
                <Icon icon={option.icon} className="restore-captions-dialog__view-icon" />
                <span className="restore-captions-dialog__view-label">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="restore-captions-dialog__list">
        {/* Same grid as a row, so each label sits exactly over its column. */}
        <div className="restore-captions-dialog__list-header">
          {layout === "split" ? (
            <div className="restore-captions-dialog__columns">
              <span className="restore-captions-dialog__column restore-captions-dialog__column--before">
                Current caption
              </span>
              <span className="restore-captions-dialog__column restore-captions-dialog__column--after">
                After restore
              </span>
            </div>
          ) : (
            <div className="restore-captions-dialog__legend">
              <span>
                <del className="caption-diff__removed">removed</del> only in the current caption
              </span>
              <span>
                <ins className="caption-diff__added">restored</ins> from the backup
              </span>
            </div>
          )}
        </div>

        {visible.length > 0 ? (
          // Remounted per layout, so no row keeps a height measured for the other one.
          <RestoreSampleList key={layout} entries={visible} layout={layout} />
        ) : (
          <div className="restore-captions-dialog__no-match">
            <p>
              No differing caption matches
              {query.trim() ? <> “{query.trim()}”</> : " this filter"}.
            </p>
            <DialogButton
              label="Clear filters"
              variant="secondary"
              icon={iconFilterX}
              onClick={clearFilters}
            />
          </div>
        )}
      </div>

      <p className="restore-captions-dialog__footnote">
        <span role="status">
          {narrowed
            ? `Showing ${formatCount(visible.length)} of ${formatCount(counts.all)}`
            : `${plural(counts.all, "caption differs", "captions differ")} from the backup`}
          .
        </span>
        {skipped && <> {skipped}</>}
      </p>
    </div>
  );
}

function RestoreSkeleton() {
  return (
    <div
      className="restore-captions-dialog__list restore-captions-dialog__list--loading"
      role="status"
      aria-label="Comparing with the backup..."
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="restore-captions-dialog__skeleton-row" aria-hidden="true">
          <span className="restore-captions-dialog__thumb skeleton-shimmer" />
          <span className="restore-captions-dialog__skeleton-lines">
            <span className="skeleton-shimmer" />
            <span className="skeleton-shimmer" />
          </span>
        </div>
      ))}
    </div>
  );
}

// Row metrics from `_restore-captions-dialog.scss`; estimates only, every row is measured.
const ROW_PADDING_Y_PX = 21;
const THUMB_PX = 128;
const HEADER_PX = 24;
const LINE_PX = 21;
const ROW_INSET_X_PX = 176;
const SPLIT_GAP_PX = 12;
// Each side is a padded panel: vertical padding plus its border, then horizontal padding.
const SPLIT_SIDE_Y_PX = 14;
const SPLIT_SIDE_X_PX = 22;
const AVERAGE_CHAR_PX = 6.8;

function estimateRowHeight(
  entry: ReviewedSample | undefined,
  layout: CaptionDiffLayout,
  listWidth: number,
): number {
  if (!entry) return ROW_PADDING_Y_PX + THUMB_PX;
  const { sample } = entry;
  const textWidth = Math.max(listWidth - ROW_INSET_X_PX, 240);
  const current = sample.current ?? "";
  const longer = Math.max(current.length, sample.backup.length);
  const [chars, width] =
    layout === "split"
      ? [longer, (textWidth - SPLIT_GAP_PX) / 2 - SPLIT_SIDE_X_PX]
      : // Inline shows the shared text once, plus whatever each side alone has.
        [Math.ceil(longer * 1.15), textWidth];
  const lines = Math.max(1, Math.ceil((chars * AVERAGE_CHAR_PX) / width));
  const sides = layout === "split" ? SPLIT_SIDE_Y_PX : 0;
  return ROW_PADDING_Y_PX + Math.max(THUMB_PX, HEADER_PX + lines * LINE_PX + sides);
}

/** Every differing caption, rendered only around the scroll position; rows size to their text. */
function RestoreSampleList({
  entries,
  layout,
}: {
  entries: ReviewedSample[];
  layout: CaptionDiffLayout;
}) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  // Flags TanStack Virtual for the React Compiler, which this app does not use.
  // oxlint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) =>
      estimateRowHeight(entries[index], layout, scrollElement?.clientWidth ?? 0),
    overscan: 8,
    getItemKey: (index) => entries[index]?.sample.path ?? index,
    // A synchronous commit inside the row observer's callback mounts rows it then fails to
    // deliver (the ResizeObserver loop error); close estimates keep the deferred fix-up small.
    useFlushSync: false,
  });

  // A narrowed list starts from its first match rather than an offset into the old one.
  useEffect(() => {
    if (scrollElement) scrollElement.scrollTop = 0;
  }, [entries, scrollElement]);

  return (
    <div ref={setScrollElement} className="restore-captions-dialog__scroller">
      <div
        role="list"
        aria-label="Captions that differ from the backup"
        className="restore-captions-dialog__rows"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const entry = entries[row.index];
          if (!entry) return null;
          return (
            <RestoreRow
              key={row.key}
              ref={virtualizer.measureElement}
              index={row.index}
              start={row.start}
              entry={entry}
              layout={layout}
            />
          );
        })}
      </div>
    </div>
  );
}

function RestoreRow({
  ref,
  index,
  start,
  entry,
  layout,
}: {
  ref: (element: HTMLElement | null) => void;
  index: number;
  start: number;
  entry: ReviewedSample;
  layout: CaptionDiffLayout;
}) {
  const { sample, kind } = entry;
  const { current, backup } = sample;
  const segments = useMemo(() => diffCaptionWords(current ?? "", backup), [backup, current]);
  const words = useMemo(() => countChangedWords(segments), [segments]);

  return (
    <div
      ref={ref}
      data-index={index}
      role="listitem"
      aria-label={sample.name}
      className={classNames(
        "restore-captions-dialog__row",
        `restore-captions-dialog__row--${kind}`,
      )}
      style={{ transform: `translateY(${start}px)` }}
    >
      <RestoreThumbnail sample={sample} />
      <div className="restore-captions-dialog__row-main">
        <div className="restore-captions-dialog__row-header">
          <span className="restore-captions-dialog__name" title={sample.name}>
            {sample.name}
          </span>
          {kind === "new" && (
            <span className="restore-captions-dialog__badge restore-captions-dialog__badge--new">
              New caption
            </span>
          )}
          {kind === "unreadable" && (
            <span className="restore-captions-dialog__badge restore-captions-dialog__badge--error">
              Unreadable
            </span>
          )}
          {kind !== "unreadable" && (
            <span
              className="restore-captions-dialog__words"
              title={`${plural(words.removed, "word", "words")} removed, ${plural(words.added, "word", "words")} restored`}
            >
              {words.removed > 0 && (
                <span className="restore-captions-dialog__words-removed">
                  −{formatCount(words.removed)}
                </span>
              )}
              {words.added > 0 && (
                <span className="restore-captions-dialog__words-added">
                  +{formatCount(words.added)}
                </span>
              )}
            </span>
          )}
        </div>
        {sample.error && layout === "split" ? (
          <div className="caption-diff-split restore-captions-dialog__diff">
            <p className="caption-diff caption-diff-split__side caption-diff-split__side--before restore-captions-dialog__error">
              {sample.error}.
            </p>
            <p className="caption-diff caption-diff-split__side caption-diff-split__side--after">
              {sample.backup}
            </p>
          </div>
        ) : sample.error ? (
          <p className="restore-captions-dialog__error">
            {sample.error}. Restoring replaces it with the backup:{" "}
            <span className="restore-captions-dialog__error-backup">{sample.backup}</span>
          </p>
        ) : (
          <CaptionDiffView
            className="restore-captions-dialog__diff"
            segments={segments}
            layout={layout}
            emptySideLabel="No caption"
          />
        )}
      </div>
    </div>
  );
}

function RestoreThumbnail({ sample }: { sample: CaptionBackupCompareSample }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="restore-captions-dialog__thumb" aria-hidden="true">
      {failed ? (
        <Icon icon={iconImage} className="restore-captions-dialog__thumb-icon" />
      ) : (
        <img
          src={thumbnailUrl(sample.path, THUMBNAIL_WIDTH, sample.version ?? undefined)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
