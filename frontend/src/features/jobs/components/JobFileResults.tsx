import { useState } from "react";
import { useJobFileResults } from "@/features/jobs/hooks/useJobFileResults";
import {
  cancelledCountFromStats,
  countFailedResults,
  failedCountFromStats,
  failedResultPaths,
  groupResultsForDisplay,
  resultStatusLabel,
  resultToneOf,
  type ResultGroup,
  type ResultTone,
} from "@/features/jobs/lib/jobFileResults";
import { isActiveJobStatus } from "@/features/jobs/lib/jobs";
import {
  iconBan,
  iconChevronDown,
  iconCircleAlert,
  iconCircleCheck,
  iconCircleDashed,
  iconLoader2,
  iconRotateCcw,
  type AppIcon,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import type { Job, JobFileResult } from "@/shared/types";

interface JobFileResultsProps {
  job: Job;
  onOpenItem?: (path: string) => void;
  onRetryFailed?: (paths: string[]) => void;
  onRunAgain?: () => void;
}

const TONE_ICONS: Record<ResultTone, AppIcon> = {
  failed: iconCircleAlert,
  cancelled: iconCircleDashed,
  done: iconCircleCheck,
  skipped: iconBan,
};

const TONE_WORDS: Record<ResultTone, string> = {
  failed: "failed",
  cancelled: "not run",
  done: "done",
  skipped: "skipped",
};

const MIX_ORDER: readonly ResultTone[] = ["done", "skipped", "cancelled", "failed"];

/** A cancelled run counts far more files than it has rows, so the remainder is stated in words. */
function unlistedNote(group: ResultGroup): string | null {
  const unlisted = group.count - group.results.length;
  if (unlisted <= 0) return null;
  if (group.results.length > 0) return `${unlisted} more never started.`;
  return unlisted === 1 ? "1 file never started." : `${unlisted} files never started.`;
}

function ResultMix({ groups }: { groups: ResultGroup[] }) {
  const ordered = MIX_ORDER.map((tone) => groups.find((group) => group.tone === tone)).filter(
    (group): group is ResultGroup => group !== undefined,
  );

  // A clean run has nothing to compare, and the Completed group already carries the count.
  if (ordered.every((group) => group.tone === "done")) return null;

  return (
    <figure className="job-file-results__mix">
      <div className="job-file-results__mix-track" aria-hidden="true">
        {ordered.map((group) => (
          <span
            key={group.tone}
            className={`job-file-results__mix-segment job-file-results__mix-segment--${group.tone}`}
            style={{ flexGrow: group.count }}
          />
        ))}
      </div>
      <figcaption className="job-file-results__mix-caption">
        {ordered.map((group) => `${group.count} ${TONE_WORDS[group.tone]}`).join(" · ")}
      </figcaption>
    </figure>
  );
}

function ResultRow({
  result,
  onOpenItem,
}: {
  result: JobFileResult;
  onOpenItem?: (path: string) => void;
}) {
  const tone = resultToneOf(result);

  const content = (
    <>
      <Icon icon={TONE_ICONS[tone]} className="job-file-results__row-icon" />
      <span className="job-file-results__name" title={result.path}>
        {result.name}
      </span>
      <span className="job-file-results__status">{resultStatusLabel(result.status)}</span>
      {result.message && <span className="job-file-results__message">{result.message}</span>}
    </>
  );

  return (
    <li className={classNames("job-file-results__row", `job-file-results__row--${tone}`)}>
      {onOpenItem ? (
        <button
          type="button"
          className="job-file-results__row-body job-file-results__row-body--action"
          // Names the row after the file alone, so the status and message stay out of the label.
          aria-label={result.name}
          onClick={() => onOpenItem(result.path)}
        >
          {content}
        </button>
      ) : (
        <div className="job-file-results__row-body">{content}</div>
      )}
    </li>
  );
}

export function JobFileResults({
  job,
  onOpenItem,
  onRetryFailed,
  onRunAgain,
}: JobFileResultsProps) {
  const [expanded, setExpanded] = useState(false);
  const { results, loading, failed } = useJobFileResults(job, expanded);

  if (isActiveJobStatus(job.status)) return null;

  const failedCount = failedCountFromStats(job.stats);
  const groups = groupResultsForDisplay(results, cancelledCountFromStats(job.stats));
  const retryPaths = failedResultPaths(results);
  const loadedFailedCount = countFailedResults(results);

  return (
    <div className="job-file-results">
      <button
        type="button"
        className="job-file-results__toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <Icon
          icon={iconChevronDown}
          className={classNames(
            "job-file-results__toggle-icon",
            expanded && "job-file-results__toggle-icon--open",
          )}
        />
        <span className="job-file-results__label">Per-file results</span>
        {failedCount > 0 && (
          <span className="job-file-results__chip job-file-results__chip--failed">
            {failedCount} failed
          </span>
        )}
      </button>

      {expanded && (
        <div className="job-file-results__panel">
          {loading && (
            <p className="job-file-results__note">
              <Icon icon={iconLoader2} className="job-file-results__note-icon" spin />
              Loading results...
            </p>
          )}

          {failed && !loading && (
            <p className="job-file-results__alert" role="alert">
              <Icon icon={iconCircleAlert} className="job-file-results__alert-icon" />
              This job&apos;s results are no longer stored.
            </p>
          )}

          {!loading && !failed && groups.length === 0 && (
            <p className="job-file-results__note">This job recorded no per-file results.</p>
          )}

          {groups.length > 0 && (
            <>
              <ResultMix groups={groups} />

              <div className="job-file-results__groups" data-scroll-lock-allow>
                {groups.map((group) => {
                  const unlisted = unlistedNote(group);

                  return (
                    <section key={group.tone} className="job-file-results__group">
                      <p
                        className={`job-file-results__group-label job-file-results__group-label--${group.tone}`}
                      >
                        {group.label}
                        <span className="job-file-results__group-count">{group.count}</span>
                      </p>
                      {group.results.length > 0 && (
                        <ul className="job-file-results__list">
                          {group.results.map((result) => (
                            <ResultRow key={result.path} result={result} onOpenItem={onOpenItem} />
                          ))}
                        </ul>
                      )}
                      {unlisted && <p className="job-file-results__group-note">{unlisted}</p>}
                    </section>
                  );
                })}
              </div>
            </>
          )}

          {(onRetryFailed || onRunAgain) && !loading && (
            <div className="job-file-results__actions">
              {onRetryFailed && loadedFailedCount > 0 && (
                <button
                  type="button"
                  className="job-file-results__action job-file-results__action--primary"
                  onClick={() => onRetryFailed(retryPaths)}
                >
                  <Icon icon={iconRotateCcw} className="job-file-results__action-icon" />
                  Retry {loadedFailedCount} failed
                </button>
              )}
              {onRunAgain && (
                <button type="button" className="job-file-results__action" onClick={onRunAgain}>
                  Run again
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
