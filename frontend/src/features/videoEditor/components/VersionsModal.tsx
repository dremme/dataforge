import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError } from "@/shared/api/http";
import { formatDurationSeconds, formatModifiedAt } from "@/shared/lib/format";
import { DiscardChangesModal, Modal, ModalButton } from "@/shared/ui/Modal";
import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
import type { VideoProjectVersionSummary } from "@/shared/types";
import {
  deleteVideoProjectVersion,
  listVideoProjectVersions,
  saveVideoProjectVersion,
} from "@/features/videoEditor/api/videoProjects";
import type { Project } from "@/features/videoEditor/lib/timeline";

const VIDEO_PROJECT_VERSIONS_QUERY_KEY = ["video-project-versions"] as const;

interface VersionsModalProps {
  project: Project;
  /** Replaces the timeline with the version; one undo step, saved like any edit. */
  onRestore: (version: VideoProjectVersionSummary) => Promise<void>;
  onClose: () => void;
}

/** Named versions and automatic checkpoints of this project, newest first. */
export function VersionsModal({ project, onRestore, onClose }: VersionsModalProps) {
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
  const discard = useDiscardChanges(label !== "", busy !== null, busy !== null, onClose);

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
    <Modal
      title="Project versions"
      description={
        "Save the edit as it is now under a name, or go back to an earlier version. A " +
        "restore replaces the timeline as one edit, so Undo brings this one back."
      }
      role="dialog"
      panelClassName="video-versions-modal"
      busy={busy !== null}
      suspended={discard.confirming}
      onClose={() => {
        void discard.request(onClose);
      }}
    >
      <div className="video-versions-modal__body">
        <div className="modal__field">
          <label className="modal__label" htmlFor={labelId}>
            Save this version as
          </label>
          <div className="video-versions-modal__save">
            <input
              id={labelId}
              className="modal__input"
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
            <ModalButton
              label="Save version"
              variant="primary"
              busy={busy === "save"}
              disabled={busy !== null || !label.trim()}
              onClick={() => void saveVersion()}
            />
          </div>
        </div>
        {versions.isPending ? (
          <p className="modal__hint">Loading versions...</p>
        ) : versions.isError ? (
          <p className="modal__error">{formatApiError(versions.error)}</p>
        ) : rows.length === 0 ? (
          <p className="modal__hint">
            No versions yet. Saving keeps an automatic checkpoint every ten minutes of editing.
          </p>
        ) : (
          <ul className="video-versions-modal__list" aria-label="Versions">
            {rows.map((version) => (
              <li key={version.id} className="video-versions-modal__row">
                <span className="video-versions-modal__text">
                  <strong>{version.label ?? "Automatic checkpoint"}</strong>
                  <span className="video-versions-modal__meta">
                    {formatModifiedAt(version.created_at) ?? version.created_at} ·{" "}
                    {formatDurationSeconds(version.duration)} · {version.clip_count}{" "}
                    {version.clip_count === 1 ? "clip" : "clips"}
                  </span>
                </span>
                <button
                  type="button"
                  className="video-editor__text-btn"
                  disabled={busy !== null}
                  onClick={() =>
                    void discard.request(async () => {
                      if (await run(`restore-${version.id}`, () => onRestore(version))) onClose();
                    })
                  }
                >
                  {busy === `restore-${version.id}` ? "Restoring..." : "Restore"}
                </button>
                {version.label !== null && (
                  <button
                    type="button"
                    className="video-editor__text-btn"
                    aria-label={`Delete version ${version.label}`}
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`delete-${version.id}`, () => deleteVideoProjectVersion(version.id))
                    }
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="modal__error">{error}</p>}
      </div>
      {discard.confirming && (
        <DiscardChangesModal onDiscard={discard.discard} onKeepEditing={discard.keepEditing} />
      )}
    </Modal>
  );
}
