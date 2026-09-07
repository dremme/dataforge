import { useState } from "react";
import { useJobFileResults } from "@/features/jobs/hooks/useJobFileResults";
import {
  countFailedResults,
  failedCountFromStats,
  failedResultPaths,
  isFailedResult,
  isSkippedResult,
  resultStatusLabel,
} from "@/features/jobs/lib/jobFileResults";
import { isActiveJobStatus } from "@/features/jobs/lib/jobs";
import { iconChevronDown, iconLoader2, iconRotateCcw } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import type { Job, JobFileResult } from "@/shared/types";

interface JobFileResultsProps {
  job: Job;
  onOpenItem?: (path: string) => void;
  onRetryFailed?: (paths: string[]) => void;
  onRunAgain?: () => void;
}

function resultTone(result: JobFileResult): string | false {
  if (isFailedResult(result)) return "job-file-results__row--failed";
  if (isSkippedResult(result)) return "job-file-results__row--skipped";
  return false;
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
  const summary = failedCount > 0 ? `${failedCount} failed` : "Per-file results";
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
        <span
          className={classNames(
            "job-file-results__summary",
            failedCount > 0 && "job-file-results__summary--failed",
          )}
        >
          {summary}
        </span>
      </button>

      {expanded && (
        <div className="job-file-results__panel">
          {loading && (
            <p className="job-file-results__note">
              <Icon
                icon={iconLoader2}
                className="job-file-results__note-icon job-file-results__note-icon--spin"
              />
              Loading results...
            </p>
          )}

          {failed && !loading && (
            <p className="job-file-results__note" role="alert">
              This job&apos;s results are no longer stored.
            </p>
          )}

          {!loading && !failed && results.length === 0 && (
            <p className="job-file-results__note">This job recorded no per-file results.</p>
          )}

          {results.length > 0 && (
            <ul className="job-file-results__list">
              {results.map((result) => (
                <li
                  key={result.path}
                  className={classNames("job-file-results__row", resultTone(result))}
                >
                  {onOpenItem ? (
                    <button
                      type="button"
                      className="job-file-results__name job-file-results__name--action"
                      onClick={() => onOpenItem(result.path)}
                      title={result.path}
                    >
                      {result.name}
                    </button>
                  ) : (
                    <span className="job-file-results__name" title={result.path}>
                      {result.name}
                    </span>
                  )}
                  <span className="job-file-results__status">
                    {resultStatusLabel(result.status)}
                  </span>
                  {result.message && (
                    <span className="job-file-results__message" title={result.message}>
                      {result.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(onRetryFailed || onRunAgain) && !loading && (
            <div className="job-file-results__actions">
              {onRetryFailed && loadedFailedCount > 0 && (
                <button
                  type="button"
                  className="job-file-results__action"
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
