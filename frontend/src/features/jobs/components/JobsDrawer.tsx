import { useEffect, useId, useMemo, useState } from "react";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { useJobHistory } from "@/features/jobs/hooks/useJobHistory";
import {
  DEFAULT_JOB_FILTERS,
  isDefaultJobFilters,
  JOB_STATUS_FILTER_OPTIONS,
  JOB_TYPE_FILTER_OPTIONS,
  jobHistoryStatusOf,
  jobsQueryFor,
  matchesJobFilters,
  mergeJobLists,
  type JobFilters,
} from "@/features/jobs/lib/jobFilters";
import { cacheJobFilters, readJobFilters } from "@/features/jobs/lib/jobFilterPreferences";
import { groupJobsForDrawer } from "@/features/jobs/lib/jobInsights";
import { isUnseenJob } from "@/features/jobs/lib/jobSeen";
import { DialogSelect } from "@/shared/ui/DialogSelect";
import { ModalShell } from "@/shared/ui/ModalShell";
import {
  iconBot,
  iconFileCheck,
  iconFolder,
  iconMessageCheck,
  iconScanSquare,
  iconTrash2,
  iconX,
} from "@/shared/icons";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import { useTicker } from "@/shared/hooks/useTicker";
import { classNames } from "@/shared/lib/classNames";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Tooltip } from "@/shared/ui/Tooltip";
import {
  isActiveJobStatus,
  isTrainLoraCoTrackedByExternal,
  runningJobCount,
} from "@/features/jobs/lib/jobs";
import { ExternalJobCard } from "./ExternalJobCard";
import { Icon } from "@/shared/ui/Icon";
import { CancelJobConfirm } from "./CancelJobConfirm";
import { JobCard, type JobFollowUp } from "./JobCard";
import type { AutomationActions } from "@/features/automation/lib/automationActions";
import type { Job } from "@/shared/types";

const RETICK_MS = 30_000;

/** The jobs that flag caption issues for the resolver. */
const ISSUE_JOB_TYPES: ReadonlySet<string> = new Set(["verify_captions", "check_caption_rules"]);

/** The open folder's automation handlers; cards for other folders get none. */
export type CurrentJobActions = Pick<
  AutomationActions,
  | "job"
  | "onOpenItem"
  | "onRetryFailed"
  | "issueCount"
  | "onResolveIssues"
  | "duplicateGroupCount"
  | "onResolveDuplicates"
  | "candidateCount"
  | "onReviewCandidates"
>;

interface JobsDrawerProps {
  currentActions?: Partial<CurrentJobActions>;
  currentFolder?: string;
  onOpenFolder: (folderPath: string) => void;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The folder's review queues, offered on the job that filled them: its latest run. */
function followUpsFor(
  job: Job,
  actions: Partial<CurrentJobActions> | undefined,
  closeDrawer: () => void,
): JobFollowUp[] {
  if (!actions?.job || actions.job.id !== job.id || isActiveJobStatus(job.status)) return [];

  const thenClose = (action: (() => void) | undefined) => () => {
    closeDrawer();
    action?.();
  };
  const followUps: JobFollowUp[] = [];
  const { issueCount = 0, duplicateGroupCount = 0, candidateCount = 0 } = actions;

  if (issueCount > 0 && actions.onResolveIssues && ISSUE_JOB_TYPES.has(job.job_type)) {
    followUps.push({
      label: `Review ${plural(issueCount, "issue")}`,
      icon: iconMessageCheck,
      onClick: thenClose(actions.onResolveIssues),
    });
  }
  if (
    duplicateGroupCount > 0 &&
    actions.onResolveDuplicates &&
    job.job_type === "find_duplicates"
  ) {
    followUps.push({
      label: `Resolve ${plural(duplicateGroupCount, "duplicate group")}`,
      icon: iconFileCheck,
      onClick: thenClose(actions.onResolveDuplicates),
    });
  }
  if (candidateCount > 0 && actions.onReviewCandidates && job.job_type === "comfy_process") {
    followUps.push({
      label: `Review ${plural(candidateCount, "candidate")}`,
      icon: iconScanSquare,
      onClick: thenClose(actions.onReviewCandidates),
    });
  }
  return followUps;
}

export function JobsDrawer({ currentFolder, onOpenFolder, currentActions }: JobsDrawerProps) {
  const {
    jobs,
    externalJobs,
    drawerOpen,
    closeDrawer,
    cancelJob,
    cancellingJobId,
    stoppingOstrisJobId,
    stopExternalOstrisJob,
    deleteJob,
    deleteAllJobs,
    seenAtMs,
    setShownJobFilter,
  } = useJobs();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Job | null>(null);
  const [filters, setFilters] = useState<JobFilters>(readJobFilters);
  const statusName = useId();

  useEffect(() => {
    setShownJobFilter(
      isDefaultJobFilters(filters) ? null : (job) => matchesJobFilters(job, filters, currentFolder),
    );
    return () => setShownJobFilter(null);
  }, [filters, currentFolder, setShownJobFilter]);

  const nowMs = useTicker(RETICK_MS);

  // Starting, finishing or deleting a job changes which stored page is right; progress does not.
  const refreshKey = useMemo(
    () => jobs.map((job) => `${job.id}:${jobHistoryStatusOf(job.status)}`).join(","),
    [jobs],
  );
  const history = useJobHistory(jobsQueryFor(filters, currentFolder), {
    enabled: drawerOpen,
    refreshKey,
  });

  const [closing, setClosing] = useState(false);
  const [renderedOpen, setRenderedOpen] = useState(drawerOpen);
  if (renderedOpen !== drawerOpen) {
    setRenderedOpen(drawerOpen);
    setClosing(renderedOpen && !drawerOpen);
  }

  const overlayAbove = !closing && (clearAllOpen || lightboxOpen || cancelTarget !== null);

  if (!drawerOpen && !closing) return null;

  const filtering = !isDefaultJobFilters(filters);
  const matches = (job: (typeof jobs)[number]) => matchesJobFilters(job, filters, currentFolder);
  // The live copy wins so progress keeps moving; re-filtering drops a job whose status moved on.
  const localJobs = mergeJobLists(jobs.filter(matches), history.jobs).filter(
    (job) => matches(job) && !isTrainLoraCoTrackedByExternal(job, externalJobs),
  );
  const sections = groupJobsForDrawer(localJobs, seenAtMs, nowMs);
  const hasLocalJobs = localJobs.length > 0;
  const hasExternalJobs = externalJobs.length > 0;
  const hasAnyJobs = hasLocalJobs || hasExternalJobs;
  const hasHistory = jobs.length > 0 || history.total > 0 || filtering;
  const recordCount = filtering ? null : Math.max(history.total, jobs.length);
  const runningCount = runningJobCount(jobs, externalJobs);
  const newCount = jobs.filter((job) => isUnseenJob(job, seenAtMs)).length;
  const summary = [
    runningCount > 0 && `${runningCount} running`,
    newCount > 0 && `${newCount} new`,
  ].filter(Boolean);
  const changeFilters = (next: JobFilters) => {
    setFilters(next);
    cacheJobFilters(next);
  };
  const updateFilter = (patch: Partial<JobFilters>) => changeFilters({ ...filters, ...patch });
  const folderFilterOn = Boolean(currentFolder) && filters.folder === "current";

  const filteredEmpty = (
    <div className="jobs-drawer__empty">
      <p>{history.loading ? "Loading job history..." : "No jobs match these filters."}</p>
      <button
        type="button"
        className="jobs-drawer__reset-filters"
        onClick={() => changeFilters(DEFAULT_JOB_FILTERS)}
      >
        Clear filters
      </button>
    </div>
  );

  const runClearAll = async () => {
    setClearingAll(true);
    try {
      if (await deleteAllJobs()) setClearAllOpen(false);
    } finally {
      setClearingAll(false);
    }
  };

  const openFolder = (folderPath: string) => {
    onOpenFolder(folderPath);
    closeDrawer();
  };

  const renderJobCard = (job: Job) => {
    const inCurrentFolder = foldersMatch(job.folder, currentFolder);
    const actions = inCurrentFolder ? currentActions : undefined;

    return (
      <JobCard
        key={job.id}
        job={job}
        isNew={isUnseenJob(job, seenAtMs)}
        nowMs={nowMs}
        isCurrentFolder={inCurrentFolder}
        onOpenFolder={openFolder}
        onOpenItem={
          actions?.onOpenItem
            ? (path) => {
                closeDrawer();
                actions.onOpenItem?.(path);
              }
            : undefined
        }
        onRetryFailed={
          actions?.onRetryFailed
            ? (paths) => {
                closeDrawer();
                actions.onRetryFailed?.(job.job_type, paths);
              }
            : undefined
        }
        followUps={followUpsFor(job, actions, closeDrawer)}
        cancelling={cancellingJobId === job.id}
        onCancel={() => setCancelTarget(job)}
        onDelete={(jobId) => {
          void deleteJob(jobId).finally(() => history.reload());
        }}
        onLightboxOpenChange={setLightboxOpen}
      />
    );
  };

  return (
    <>
      <ModalShell
        block="jobs-drawer"
        panelAs="aside"
        panelId="jobs-drawer-panel"
        labelledById="jobs-drawer-title"
        onClose={closeDrawer}
        suspended={overlayAbove}
        scrollLock="jobs-drawer-open"
        backdropLabel="Close jobs panel"
        enterAnimation="none"
        closing={closing}
        onExited={() => setClosing(false)}
      >
        <header className="jobs-drawer__header">
          <div className="jobs-drawer__title">
            <Icon icon={iconBot} className="jobs-drawer__title-icon" />
            <div className="jobs-drawer__title-text">
              <h2 id="jobs-drawer-title">Automation jobs</h2>
              {/* Always present, so filtering down to nothing does not shift the header. */}
              <p className="jobs-drawer__summary">
                {summary.length > 0
                  ? summary.join(" · ")
                  : hasHistory || hasAnyJobs
                    ? "Nothing running"
                    : "No jobs yet"}
              </p>
            </div>
          </div>

          <div className="jobs-drawer__header-actions">
            {(jobs.length > 0 || history.total > 0) && (
              <Tooltip content="Delete all jobs">
                <button
                  type="button"
                  className="jobs-drawer__clear-all"
                  onClick={() => setClearAllOpen(true)}
                  aria-label="Delete all jobs"
                >
                  <Icon icon={iconTrash2} />
                </button>
              </Tooltip>
            )}

            <button
              type="button"
              className="jobs-drawer__close"
              onClick={closeDrawer}
              aria-label="Close"
            >
              <Icon icon={iconX} />
            </button>
          </div>
        </header>

        {hasHistory && (
          <div className="jobs-drawer__filters" role="group" aria-label="Filter jobs">
            <div className="jobs-drawer__status" role="radiogroup" aria-label="Status">
              {JOB_STATUS_FILTER_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={classNames(
                    "jobs-drawer__status-option",
                    filters.status === option.value && "jobs-drawer__status-option--active",
                  )}
                >
                  <input
                    type="radio"
                    name={statusName}
                    className="jobs-drawer__status-input"
                    value={option.value}
                    checked={filters.status === option.value}
                    onChange={() => updateFilter({ status: option.value })}
                  />
                  {option.value === "all" ? "All" : option.title}
                </label>
              ))}
            </div>

            <div className="jobs-drawer__refine">
              <div className="jobs-drawer__type">
                <DialogSelect
                  label="Type"
                  value={filters.jobType}
                  options={JOB_TYPE_FILTER_OPTIONS}
                  onChange={(jobType) => updateFilter({ jobType })}
                />
              </div>
              <button
                type="button"
                className={classNames(
                  "jobs-drawer__folder-chip",
                  folderFilterOn && "jobs-drawer__folder-chip--active",
                )}
                aria-pressed={folderFilterOn}
                disabled={!currentFolder}
                title={currentFolder ? undefined : "Open a folder to filter by it"}
                onClick={() => updateFilter({ folder: folderFilterOn ? "all" : "current" })}
              >
                <Icon icon={iconFolder} className="jobs-drawer__folder-chip-icon" />
                This folder
              </button>
            </div>
          </div>
        )}

        <div className="jobs-drawer__content" data-scroll-lock-allow>
          {history.error && (
            <p className="jobs-drawer__error" role="alert">
              Could not load job history. {history.error}
            </p>
          )}
          {!hasAnyJobs && filtering ? (
            filteredEmpty
          ) : !hasAnyJobs ? (
            <div className="jobs-drawer__empty">
              <span className="jobs-drawer__empty-icon" aria-hidden="true">
                <Icon icon={iconBot} />
              </span>
              <p>{history.loading ? "Loading job history..." : "No automation jobs yet."}</p>
              {!history.loading && (
                <p className="jobs-drawer__empty-hint">
                  Start one from a folder with media files using Auto-caption or Tools.
                </p>
              )}
            </div>
          ) : (
            <>
              {hasExternalJobs && (
                <section className="jobs-drawer__section" aria-label="External jobs">
                  <h3 className="jobs-drawer__section-title">AI-Toolkit</h3>
                  <div className="jobs-drawer__list">
                    {externalJobs.map((job) => (
                      <ExternalJobCard
                        key={`ostris-${job.id}`}
                        job={job}
                        isCurrentFolder={foldersMatch(currentFolder, job.dataset_folder)}
                        onOpenFolder={openFolder}
                        stopping={stoppingOstrisJobId === job.id}
                        onStop={(jobId) => {
                          stopExternalOstrisJob(jobId).catch(() => {});
                        }}
                        onLightboxOpenChange={setLightboxOpen}
                      />
                    ))}
                  </div>
                </section>
              )}
              {(hasLocalJobs || filtering) && (
                <div className="jobs-drawer__local" role="region" aria-label="DataForge jobs">
                  {!hasLocalJobs ? (
                    filteredEmpty
                  ) : (
                    <>
                      {sections.map((section) => (
                        <section
                          key={section.id}
                          className={classNames(
                            "jobs-drawer__section",
                            `jobs-drawer__section--${section.id}`,
                          )}
                          aria-labelledby={`jobs-drawer-section-${section.id}`}
                        >
                          <h3
                            id={`jobs-drawer-section-${section.id}`}
                            className="jobs-drawer__section-title"
                          >
                            {section.label}
                            <span className="jobs-drawer__section-count">
                              {section.jobs.length}
                            </span>
                          </h3>
                          <div className="jobs-drawer__list">{section.jobs.map(renderJobCard)}</div>
                        </section>
                      ))}
                      {history.hasMore && (
                        <div className="jobs-drawer__more">
                          <span className="jobs-drawer__more-count">
                            Showing {history.jobs.length} of {history.total}
                          </span>
                          <button
                            type="button"
                            className="jobs-drawer__load-more"
                            onClick={history.loadMore}
                            disabled={history.loading}
                          >
                            {history.loading ? "Loading..." : "Load more"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </ModalShell>

      {cancelTarget && !closing && (
        <CancelJobConfirm
          job={cancelTarget}
          onConfirm={() => {
            setCancelTarget(null);
            cancelJob(cancelTarget.id).catch(() => {});
          }}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {clearAllOpen && !closing && (
        <ConfirmDialog
          title="Delete all job records?"
          description={
            recordCount === null
              ? "This permanently removes every job record from history, not just the filtered ones. Running jobs will be cancelled first."
              : `This permanently removes all ${recordCount} job record${recordCount === 1 ? "" : "s"} from history. Running jobs will be cancelled first.`
          }
          confirmLabel={clearingAll ? "Deleting..." : "Delete all"}
          confirmVariant="danger"
          busy={clearingAll}
          onConfirm={() => {
            void runClearAll();
          }}
          onCancel={() => {
            if (!clearingAll) setClearAllOpen(false);
          }}
        />
      )}
    </>
  );
}
