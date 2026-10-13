import { useId, useState } from "react";
import { VIDEO_PROJECT_EXPORT_EXTENSION, VIDEO_PROJECT_EXPORT_TAG } from "@/shared/constants";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import { RadioTileGroup } from "@/shared/ui/RadioTileGroup";
import type {
  VideoProjectExportSettings,
  VideoProjectOrientation,
  VideoProjectQuality,
  VideoProjectSizePreset,
} from "@/shared/types";
import { exportSize, projectOrientation } from "@/features/videoEditor/lib/composition";
import {
  formatTimecode,
  projectDuration,
  sourceById,
  type Project,
} from "@/features/videoEditor/lib/timeline";

interface ExportDialogProps {
  project: Project;
  busy: boolean;
  error: string | null;
  /** Why the export cannot start, e.g. a missing source; null when it can. */
  blocked: string | null;
  onExport: (settings: VideoProjectExportSettings) => void;
  onCancel: () => void;
}

function defaultExportStem(project: Project): string {
  const initial = sourceById(project, project.initial_source_id);
  const stem = initial ? initial.name.replace(/\.[^.]+$/, "") : "video";
  return `${stem}${VIDEO_PROJECT_EXPORT_TAG}`;
}

export function ExportDialog({
  project,
  busy,
  error,
  blocked,
  onExport,
  onCancel,
}: ExportDialogProps) {
  const saved = project.export;
  const [filename, setFilename] = useState(
    (saved.filename || defaultExportStem(project)).replace(/\.mp4$/i, ""),
  );
  const [size, setSize] = useState<VideoProjectSizePreset>(saved.size);
  const [orientation, setOrientation] = useState<VideoProjectOrientation>(
    saved.orientation ?? projectOrientation(project.width, project.height),
  );
  const [quality, setQuality] = useState<VideoProjectQuality>(saved.quality);
  const [copyCaption, setCopyCaption] = useState(saved.copy_caption);
  const nameId = useId();
  const captionId = useId();

  const settings: VideoProjectExportSettings = {
    filename: filename.trim(),
    size,
    orientation,
    quality,
    copy_caption: copyCaption,
  };
  const frame = exportSize(project, settings);
  const duration = projectDuration(project);
  const canExport = !busy && !blocked && duration > 0;
  const submit = () => {
    if (canExport) onExport(settings);
  };

  return (
    <Dialog
      title="Export video"
      role="dialog"
      panelClassName="video-export-dialog"
      busy={busy}
      onConfirm={submit}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Export"
          busyLabel="Starting..."
          busy={busy}
          confirmDisabled={!canExport}
          onConfirm={submit}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label className="dialog__label" htmlFor={nameId}>
          File name
        </label>
        <div className="video-export-dialog__name">
          <input
            id={nameId}
            className="dialog__input"
            value={filename}
            maxLength={200}
            onChange={(event) => setFilename(event.target.value)}
            disabled={busy}
          />
          <span className="video-export-dialog__suffix">{VIDEO_PROJECT_EXPORT_EXTENSION}</span>
        </div>
        <p className="dialog__hint">
          Saved in this folder. If the name or one of its sidecars is taken, a numbered name is used
          instead, and nothing is overwritten.
        </p>
      </div>
      <RadioTileGroup
        label="Size"
        name="video-export-size"
        groupLabel="Export size"
        value={size}
        disabled={busy}
        onChange={setSize}
        options={[
          { value: "source", title: "Source size" },
          { value: "720p", title: "720p" },
          { value: "1080p", title: "1080p" },
        ]}
      />
      <RadioTileGroup
        label="Shape"
        name="video-export-orientation"
        groupLabel="Export shape"
        value={orientation}
        disabled={busy}
        onChange={setOrientation}
        options={[
          { value: "landscape", title: "Landscape" },
          { value: "portrait", title: "Portrait" },
          { value: "square", title: "Square" },
        ]}
      />
      <RadioTileGroup
        label="Quality"
        name="video-export-quality"
        groupLabel="Export quality"
        value={quality}
        disabled={busy}
        onChange={setQuality}
        options={[
          { value: "standard", title: "Standard" },
          { value: "high", title: "High quality" },
          { value: "small", title: "Smaller file" },
        ]}
      />
      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={captionId}>
          <input
            id={captionId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={copyCaption}
            onChange={(event) => setCopyCaption(event.target.checked)}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Copy initial video's caption</span>
        </label>
        <p className="dialog__hint">Unticked, the new video starts without a caption.</p>
      </div>
      <p className="video-export-dialog__summary" aria-live="polite">
        MP4 · {frame.width} × {frame.height} · {Number(project.frame_rate.toFixed(3))} fps ·{" "}
        {formatTimecode(duration, project.frame_rate)}
        {(frame.width !== project.width || frame.height !== project.height) &&
          " · fitted without stretching"}
      </p>
      {blocked && <p className="dialog__error">{blocked}</p>}
      {error && <p className="dialog__error">{error}</p>}
    </Dialog>
  );
}
