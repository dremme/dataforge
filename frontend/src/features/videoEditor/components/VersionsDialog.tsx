import { DiscardChangesDialog } from "@/shared/ui/DiscardChangesDialog";
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError } from "@/shared/api/http";
import { classNames } from "@/shared/lib/classNames";
import { formatClockTime, formatDurationSeconds } from "@/shared/lib/format";
import { iconBookmark, iconHistory, iconLoader2, iconRotateCcw, iconTrash2 } from "@/shared/icons";
import { Dialog, DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
import type { VideoProjectVersionSummary } from "@/shared/types";
import {
  deleteVideoProjectVersion,
  listVideoProjectVersions,
  saveVideoProjectVersion,
} from "@/features/videoEditor/api/videoProjects";
import type { Project } from "@/features/videoEditor/lib/timeline";
import { groupVersionsByDay } from "@/features/videoEditor/lib/versionDays";

const VIDEO_PROJECT_VERSIONS_QUERY_KEY = ["video-project-versions"] as const;

interface VersionsDialogProps {
  project: Project;
  /** Replaces the timeline with the version; one undo step, saved like any edit. */
  onRestore: (version: VideoProjectVersionSummary) => Promise<void>;
  onClose: () => void;
}

/** Named versions and automatic checkpoints of this project, newest first. */
export function VersionsDialog({ project, onRestore, onClose }: VersionsDialogProps) {
  const queryClient = useQueryClient();
  const queryKey = [...VIDEO_PROJECT_VERSIONS_QUERY_KEY, project.id];
  const versions = useQuery({
    queryKey,
    queryFn: async () => (await listVideoProjectVersions(project.id)).versions,
  });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const discard = useDiscardChanges({
    unsavedChanges: label !== "",
    busy: busy !== null,
    onNavigationDiscard: onClose,
  });

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey, exact: true });
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const saveVersion = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (await run("save", () => saveVideoProjectVersion(project, trimmed))) setLabel("");
  };

  const rows = versions.data ?? [];
  return (
    <Dialog
      title="Project versions"
      description={
        "Name the edit as it is now to come back to it later. Restoring counts as one edit, " +
        "so Undo brings this one back."
      }
      role="dialog"
      panelClassName="video-versions-dialog"
      busy={busy !== null}
      suspended={discard.confirming}
      onClose={() => {
        void discard.request(onClose);
      }}
    >
      <div className="video-versions-dialog__body">
        <div className="dialog__field">
          <label className="dialog__label" htmlFor={labelId}>
            Save this version as
          </label>
          <div className="video-versions-dialog__save">
            <input
              id={labelId}
              className="dialog__input"
              value={label}
              maxLength={80}
              placeholder="e.g. Before the music change"
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveVersion();
                }
              }}
              disabled={busy !== null}
            />
            <DialogButton
              label="Save version"
              variant="primary"
              busy={busy === "save"}
              disabled={busy !== null || !label.trim()}
              onClick={() => void saveVersion()}
            />
          </div>
        </div>
        <div className="video-versions-dialog__history-head">
          <h3 className="video-versions-dialog__heading">History</h3>
          <span className="video-versions-dialog__heading-hint">
            Checkpoints are kept every ten minutes of editing
          </span>
        </div>
        {versions.isPending ? (
          <p className="dialog__hint">Loading versions...</p>
        ) : versions.isError ? (
          <p className="dialog__error">{formatApiError(versions.error)}</p>
        ) : rows.length === 0 ? (
          <p className="dialog__hint">
            No versions yet. Name one above, or keep editing for the first checkpoint.
          </p>
        ) : (
          <ul className="video-versions-dialog__list" aria-label="Versions">
            {groupVersionsByDay(rows).map((day) => (
              <li key={day.label} className="video-versions-dialog__day">
                <h3 className="video-versions-dialog__day-label">{day.label}</h3>
                <ul className="video-versions-dialog__day-list">
                  {day.versions.map((version) => {
                    const named = version.label !== null;
                    return (
                      <li
                        key={version.id}
                        className={classNames(
                          "video-versions-dialog__row",
                          named && "video-versions-dialog__row--named",
                        )}
                      >
                        <Icon
                          icon={named ? iconBookmark : iconHistory}
                          className="video-versions-dialog__kind"
                        />
                        <span className="video-versions-dialog__text">
                          <span className="video-versions-dialog__name">
                            {version.label ?? "Automatic checkpoint"}
                          </span>
                          <span className="video-versions-dialog__meta">
                            {formatClockTime(version.created_at) ?? version.created_at} ·{" "}
                            {formatDurationSeconds(version.duration)} · {version.clip_count}{" "}
                            {version.clip_count === 1 ? "clip" : "clips"}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="video-versions-dialog__restore"
                          disabled={busy !== null}
                          onClick={() =>
                            void discard.request(async () => {
                              if (await run(`restore-${version.id}`, () => onRestore(version)))
                                onClose();
                            })
                          }
                        >
                          <Icon
                            icon={busy === `restore-${version.id}` ? iconLoader2 : iconRotateCcw}
                            spin={busy === `restore-${version.id}`}
                          />
                          {busy === `restore-${version.id}` ? "Restoring..." : "Restore"}
                        </button>
                        {named && (
                          <button
                            type="button"
                            className="video-versions-dialog__delete"
                            aria-label={`Delete version ${version.label}`}
                            disabled={busy !== null}
                            onClick={() =>
                              void run(`delete-${version.id}`, () =>
                                deleteVideoProjectVersion(version.id),
                              )
                            }
                          >
                            <Icon icon={iconTrash2} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="dialog__error">{error}</p>}
      </div>
      {discard.promptProps && <DiscardChangesDialog {...discard.promptProps} />}
    </Dialog>
  );
}
