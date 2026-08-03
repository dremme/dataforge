import { useState } from "react";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { ModalShell } from "@/shared/ui/ModalShell";
import { iconSparkles, iconTrash2, iconX } from "@/shared/icons";
import { foldersMatch } from "@/features/browse/lib/folderPath";
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

  // The sheet slides out rather than vanishing, so it outlives `drawerOpen` by
  // the length of that animation. Derived during render (React's documented
  // way to adjust state from changing input) so there is no extra commit and
  // no frame where the panel is gone but the animation has not started.
  const [closing, setClosing] = useState(false);
  const [renderedOpen, setRenderedOpen] = useState(drawerOpen);
  if (renderedOpen !== drawerOpen) {
    setRenderedOpen(drawerOpen);
    setClosing(renderedOpen && !drawerOpen);
  }

  // Suspends the trap as well as marking the panel inert — `inert` alone does
  // not stop it, because the trap keys off aria-hidden on each element itself
  // rather than its ancestors. See `ModalShell`'s `suspended` prop.
  // Nothing sits above a drawer that is on its way out.
  const overlayAbove = !closing && (clearAllOpen || lightboxOpen);

  // Everything below the guard only mounts while the drawer is open, which is
  // what lets `ModalShell` own the focus, lock and Escape wiring: its
  // mount-scoped effects fire on open rather than at app start.
  if (!drawerOpen && !closing) return null;

  // While Ostris still lists the run, show only the external card. Once training
  // finishes (or Ostris is offline), the DataForge train_lora job stays visible.
  const localJobs = jobs.filter((job) => !isTrainLoraCoTrackedByExternal(job, externalJobs));
  const hasLocalJobs = localJobs.length > 0;
  const hasExternalJobs = externalJobs.length > 0;
  const hasAnyJobs = hasLocalJobs || hasExternalJobs;

  const runClearAll = async () => {
    setClearingAll(true);
    try {
      await deleteAllJobs();
      setClearAllOpen(false);
    } catch {
      // Errors surface in drawer state.
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <>
      <ModalShell
        block="jobs-drawer"
        panelAs="aside"
        // `JobsButton` points `aria-controls` at this id from outside the
        // drawer, so it stays a fixed string rather than a generated one.
        panelId="jobs-drawer-panel"
        labelledById="jobs-drawer-title"
        onClose={closeDrawer}
        suspended={overlayAbove}
        scrollLock="jobs-drawer-open"
        backdropLabel="Close jobs panel"
        // The panel has its own slide-in, and `_jobs-drawer.scss` overrides the
        // shell's generic fade-out with a matching slide-out.
        enterAnimation="none"
        closing={closing}
        onExited={() => setClosing(false)}
      >
        <header className="jobs-drawer__header">
          <div className="jobs-drawer__title">
            <Icon icon={iconSparkles} className="jobs-drawer__title-icon" />
            <div>
              <h2 id="jobs-drawer-title">Automation jobs</h2>
            </div>
          </div>

          <div className="jobs-drawer__header-actions">
            {hasLocalJobs && (
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

        <div className="jobs-drawer__content" data-scroll-lock-allow>
          {!hasAnyJobs ? (
            <div className="jobs-drawer__empty">
              <p>No automation jobs yet.</p>
              <p className="jobs-drawer__empty-hint">
                Start one from a folder with media files using the automation panel.
              </p>
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
                          stopExternalOstrisJob(jobId).catch(() => {
                            // Errors surface in drawer state.
                          });
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
                          cancelJob(jobId).catch(() => {
                            // Errors surface in drawer state.
                          });
                        }}
                        onDelete={(jobId) => {
                          deleteJob(jobId).catch(() => {
                            // Errors surface in drawer state.
                          });
                        }}
                        onLightboxOpenChange={setLightboxOpen}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </ModalShell>

      {clearAllOpen && !closing && (
        <ConfirmDialog
          title="Delete all job records?"
          description={`This permanently removes all ${jobs.length} job record${jobs.length === 1 ? "" : "s"} from history. Running jobs will be cancelled first.`}
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
