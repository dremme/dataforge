import { useId, useState } from "react";
import {
  VIDEO_PROJECT_EXPORT_EXTENSION,
  VIDEO_PROJECT_EXPORT_TAG,
  VIDEO_PROJECT_LOUDNESS_TARGET_LUFS,
  VIDEO_PROJECT_TRUE_PEAK_CEILING_DB,
} from "@/shared/constants";
import { formatFileSize } from "@/shared/lib/format";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import { RadioTileGroup } from "@/shared/ui/RadioTileGroup";
import type {
  VideoProjectAudioLevel,
  VideoProjectExportSettings,
  VideoProjectExportSpan,
  VideoProjectOrientation,
  VideoProjectQuality,
  VideoProjectSizePreset,
} from "@/shared/types";
import {
  estimateExportBytes,
  exportSize,
  projectOrientation,
} from "@/features/videoEditor/lib/composition";
import {
  formatTimecode,
  projectDuration,
  sourceById,
  type Project,
  type TimeRange,
} from "@/features/videoEditor/lib/timeline";

/** What part of the timeline to render: all of it, the marked range, or the selected clips. */
type ExportExtent = "whole" | "range" | "selection";

interface ExportDialogProps {
  project: Project;
  /** The range marked on the timeline, offered as a part to export. */
  range: TimeRange | null;
  /** From the start of the earliest selected clip to the end of the latest one. */
  selectionSpan: TimeRange | null;
  busy: boolean;
  error: string | null;
  /** Why the export cannot start, e.g. a missing source; null when it can. */
  blocked: string | null;
  /** ``span`` is null for the whole timeline. */
  onExport: (settings: VideoProjectExportSettings, span: VideoProjectExportSpan | null) => void;
  onCancel: () => void;
}

const RANGE_EXPORT_TAG = "-range";

const AUDIO_LEVEL_HINTS: Record<VideoProjectAudioLevel, string> = {
  limit: `Holds true peaks at ${VIDEO_PROJECT_TRUE_PEAK_CEILING_DB} dB, so loud clips summed together cannot clip.`,
  normalize: `Brings the whole mix to ${VIDEO_PROJECT_LOUDNESS_TARGET_LUFS} LUFS with one gain, then limits peaks at ${VIDEO_PROJECT_TRUE_PEAK_CEILING_DB} dB.`,
  unchanged: "Sums the clips exactly as set; a loud mix can clip.",
};

function defaultExportStem(project: Project): string {
  const initial = sourceById(project, project.initial_source_id);
  const stem = initial ? initial.name.replace(/\.[^.]+$/, "") : "video";
  return `${stem}${VIDEO_PROJECT_EXPORT_TAG}`;
}

export function ExportDialog({
  project,
  range,
  selectionSpan,
  busy,
  error,
  blocked,
  onExport,
  onCancel,
}: ExportDialogProps) {
  const saved = project.export;
  const wholeName = (saved.filename || defaultExportStem(project)).replace(/\.mp4$/i, "");
  const partName = `${defaultExportStem(project)}${RANGE_EXPORT_TAG}`;
  const [filename, setFilename] = useState(wholeName);
  const marked = range && range.end - range.start > 0 ? range : null;
  const spans: Record<ExportExtent, TimeRange | null> = {
    whole: null,
    range: marked,
    selection: selectionSpan,
  };
  const [extent, setExtent] = useState<ExportExtent>("whole");
  const chooseExtent = (next: ExportExtent) => {
    setExtent(next);
    // The suggested name follows the choice until it is typed over.
    const part = next !== "whole";
    if (filename === (part ? wholeName : partName)) setFilename(part ? partName : wholeName);
  };
  const [size, setSize] = useState<VideoProjectSizePreset>(saved.size);
  const [orientation, setOrientation] = useState<VideoProjectOrientation>(
    saved.orientation ?? projectOrientation(project.width, project.height),
  );
  const [quality, setQuality] = useState<VideoProjectQuality>(saved.quality);
  const [copyCaption, setCopyCaption] = useState(saved.copy_caption);
  const [audioLevel, setAudioLevel] = useState<VideoProjectAudioLevel>(saved.audio_level);
  const nameId = useId();
  const captionId = useId();

  const settings: VideoProjectExportSettings = {
    filename: filename.trim(),
    size,
    orientation,
    quality,
    copy_caption: copyCaption,
    audio_level: audioLevel,
  };
  const frame = exportSize(project, settings);
  const total = projectDuration(project);
  const span = spans[extent];
  const duration = span ? Math.max(0, Math.min(span.end, total) - span.start) : total;
  const canExport = !busy && !blocked && duration > 0;
  const submit = () => {
    if (canExport) onExport(settings, span && { start: span.start, end: span.end });
  };
  const extentTitle = (part: TimeRange) =>
    `${formatTimecode(part.start, project.frame_rate)} – ${formatTimecode(part.end, project.frame_rate)}`;

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
          Saved in this folder; a taken name gets a number, so nothing is overwritten.
        </p>
      </div>
      <div className="video-export-dialog__choices">
        {(marked || selectionSpan) && (
          <RadioTileGroup
            label="Part"
            name="video-export-extent"
            groupLabel="Part of the timeline to export"
            value={extent}
            disabled={busy}
            onChange={chooseExtent}
            options={[
              { value: "whole", title: "Whole timeline" },
              ...(marked
                ? [
                    {
                      value: "range" as const,
                      title: "Marked range",
                      description: extentTitle(marked),
                    },
                  ]
                : []),
              ...(selectionSpan
                ? [
                    {
                      value: "selection" as const,
                      title: "Selected clips",
                      description: extentTitle(selectionSpan),
                    },
                  ]
                : []),
            ]}
          />
        )}
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
        <RadioTileGroup
          label="Sound"
          name="video-export-audio-level"
          groupLabel="Export sound level"
          value={audioLevel}
          disabled={busy}
          onChange={setAudioLevel}
          options={[
            { value: "limit", title: "Limit peaks" },
            { value: "normalize", title: "Normalize" },
            { value: "unchanged", title: "As mixed" },
          ]}
        />
        <p className="dialog__hint video-export-dialog__sound-hint">
          {AUDIO_LEVEL_HINTS[audioLevel]}
        </p>
        {span && (
          <p className="dialog__hint video-export-dialog__sound-hint">
            A part is for checking a passage: it is saved without the project snapshot or a caption.
          </p>
        )}
      </div>
      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={captionId}>
          <input
            id={captionId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={copyCaption}
            onChange={(event) => setCopyCaption(event.target.checked)}
            disabled={busy || span !== null}
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
        {duration > 0 &&
          total > 0 &&
          ` · about ${formatFileSize((estimateExportBytes(project, settings) * duration) / total)}`}
      </p>
      {blocked && <p className="dialog__error">{blocked}</p>}
      {error && <p className="dialog__error">{error}</p>}
    </Dialog>
  );
}
