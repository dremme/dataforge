import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useJobs } from "../context/JobsContext";
import { useScrollLock } from "../hooks/useScrollLock";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { iconListChecks, iconTrash2, iconX } from "../icons";
import { foldersMatch } from "../utils/folderPath";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExternalJobCard } from "./ExternalJobCard";
import { Icon } from "./Icon";
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

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, drawerOpen);

  useScrollLock(drawerOpen, "jobs-drawer-open");

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !clearAllOpen) closeDrawer();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearAllOpen, drawerOpen, closeDrawer]);

  if (!drawerOpen) return null;

  const hasLocalJobs = jobs.length > 0;
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
      {createPortal(
        <div className="jobs-drawer" role="presentation">
          <button
            type="button"
            className="jobs-drawer__backdrop"
            aria-label="Close jobs panel"
            onClick={closeDrawer}
            tabIndex={-1}
          />

          <aside
            ref={panelRef}
            id="jobs-drawer-panel"
            className="jobs-drawer__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="jobs-drawer-title"
            aria-hidden={clearAllOpen ? true : undefined}
            inert={clearAllOpen}
          >
            <header className="jobs-drawer__header">
              <div className="jobs-drawer__title">
                <Icon icon={iconListChecks} className="jobs-drawer__title-icon" />
                <div>
                  <h2 id="jobs-drawer-title">Background jobs</h2>
                </div>
              </div>

              <div className="jobs-drawer__header-actions">
                {jobs.length > 0 && (
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
                  <p>No background jobs yet.</p>
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
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {hasLocalJobs && (
                    <section
                      className={`jobs-drawer__section${hasExternalJobs ? " jobs-drawer__section--local" : ""}`}
                      aria-label="DataForge jobs"
                    >
                      {hasExternalJobs && <h3 className="jobs-drawer__section-title">DataForge</h3>}
                      <div className="jobs-drawer__list">
                        {jobs.map((job) => (
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
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}

      {clearAllOpen && (
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
