import { useMemo, useState } from "react";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { useJobHistory } from "@/features/jobs/hooks/useJobHistory";
import {
  DEFAULT_JOB_FILTERS,
  isDefaultJobFilters,
  JOB_FOLDER_FILTER_OPTIONS,
  JOB_STATUS_FILTER_OPTIONS,
  JOB_TYPE_FILTER_OPTIONS,
  jobHistoryStatusOf,
  jobsQueryFor,
  matchesJobFilters,
  mergeJobLists,
  type JobFilters,
} from "@/features/jobs/lib/jobFilters";
import { cacheJobFilters, readJobFilters } from "@/features/jobs/lib/jobFilterPreferences";
import { DialogSelect } from "@/shared/ui/DialogSelect";
import { ModalShell } from "@/shared/ui/ModalShell";
import { iconBot, iconTrash2, iconX } from "@/shared/icons";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import { classNames } from "@/shared/lib/classNames";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { isTrainLoraCoTrackedByExternal } from "@/features/jobs/lib/jobs";
import { ExternalJobCard } from "./ExternalJobCard";
import { Icon } from "@/shared/ui/Icon";
import { JobCard } from "./JobCard";

interface JobsDrawerProps {
  currentFolder?: string;
  onOpenFolder: (folderPath: string) => void;
}

export function JobsDrawer({ currentFolder, onOpenFolder }: JobsDrawerProps) {
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
  } = useJobs();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [filters, setFilters] = useState<JobFilters>(readJobFilters);

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

  const overlayAbove = !closing && (clearAllOpen || lightboxOpen);

  if (!drawerOpen && !closing) return null;

  const filtering = !isDefaultJobFilters(filters);
  const matches = (job: (typeof jobs)[number]) => matchesJobFilters(job, filters, currentFolder);
  // The live copy wins so progress keeps moving; re-filtering drops a job whose status moved on.
  const localJobs = mergeJobLists(jobs.filter(matches), history.jobs).filter(
    (job) => matches(job) && !isTrainLoraCoTrackedByExternal(job, externalJobs),
  );
  const hasLocalJobs = localJobs.length > 0;
  const hasExternalJobs = externalJobs.length > 0;
  const hasAnyJobs = hasLocalJobs || hasExternalJobs;
  const hasHistory = jobs.length > 0 || history.total > 0 || filtering;
  const recordCount = filtering ? null : Math.max(history.total, jobs.length);
  const changeFilters = (next: JobFilters) => {
    setFilters(next);
    cacheJobFilters(next);
  };
  const updateFilter = (patch: Partial<JobFilters>) => changeFilters({ ...filters, ...patch });

  const runClearAll = async () => {
    setClearingAll(true);
    try {
      await deleteAllJobs();
      setClearAllOpen(false);
    } catch {
      // Shown in drawer state.
    } finally {
      setClearingAll(false);
    }
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
            <div>
              <h2 id="jobs-drawer-title">Automation jobs</h2>
            </div>
          </div>

          <div className="jobs-drawer__header-actions">
            {(jobs.length > 0 || history.total > 0) && (
              <button
                type="button"
                className="jobs-drawer__clear-all"
                onClick={() => setClearAllOpen(true)}
                aria-label="Delete all jobs"
                title="Delete all jobs"
              >
                <Icon icon={iconTrash2} className="jobs-drawer__clear-all-icon" />
                Clear all
              </button>
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
            <DialogSelect
              label="Type"
              value={filters.jobType}
              options={JOB_TYPE_FILTER_OPTIONS}
              onChange={(jobType) => updateFilter({ jobType })}
            />
            <DialogSelect
              label="Status"
              value={filters.status}
              options={JOB_STATUS_FILTER_OPTIONS}
              onChange={(status) => updateFilter({ status })}
            />
            <DialogSelect
              label="Folder"
              value={currentFolder ? filters.folder : "all"}
              options={JOB_FOLDER_FILTER_OPTIONS}
              disabled={!currentFolder}
              onChange={(folder) => updateFilter({ folder })}
            />
          </div>
        )}

        <div className="jobs-drawer__content" data-scroll-lock-allow>
          {history.error && (
            <p className="jobs-drawer__error" role="alert">
              Could not load job history. {history.error}
            </p>
          )}
          {!hasAnyJobs && filtering ? (
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
          ) : !hasAnyJobs ? (
            <div className="jobs-drawer__empty">
              <p>{history.loading ? "Loading job history..." : "No automation jobs yet."}</p>
              {!history.loading && (
                <p className="jobs-drawer__empty-hint">
                  Start one from a folder with media files using the automation panel.
                </p>
              )}
            </div>
          ) : (
            <>
              {hasExternalJobs && (
                <section className="jobs-drawer__section" aria-label="External jobs">
                  <h3 className="jobs-drawer__section-title">External</h3>
                  <div className="jobs-drawer__list">
                    {externalJobs.map((job) => (
                      <ExternalJobCard
                        key={`ostris-${job.id}`}
                        job={job}
                        isCurrentFolder={foldersMatch(currentFolder, job.dataset_folder)}
                        onOpenFolder={(folderPath) => {
                          onOpenFolder(folderPath);
                          closeDrawer();
                        }}
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
              {hasLocalJobs && (
                <section
                  className={classNames(
                    "jobs-drawer__section",
                    hasExternalJobs && "jobs-drawer__section--local",
                  )}
                  aria-label="DataForge jobs"
                >
                  {hasExternalJobs && <h3 className="jobs-drawer__section-title">DataForge</h3>}
                  <div className="jobs-drawer__list">
                    {localJobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        isCurrentFolder={foldersMatch(currentFolder, job.folder)}
                        onOpenFolder={(folderPath) => {
                          onOpenFolder(folderPath);
                          closeDrawer();
                        }}
                        cancelling={cancellingJobId === job.id}
                        onCancel={(jobId) => {
                          cancelJob(jobId).catch(() => {});
                        }}
                        onDelete={(jobId) => {
                          deleteJob(jobId).catch(() => {});
                        }}
                        onLightboxOpenChange={setLightboxOpen}
                      />
                    ))}
                  </div>
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
                </section>
              )}
              {!hasLocalJobs && filtering && (
                <p className="jobs-drawer__empty-hint">No DataForge jobs match these filters.</p>
              )}
            </>
          )}
        </div>
      </ModalShell>

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
