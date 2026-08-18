import { useMemo, type CSSProperties } from "react";
import {
  CROP_ASPECTS,
  IDENTITY_CROP,
  SCALE_PRESETS,
  SPEED_PRESETS,
  cropFromPixels,
  cropToPixels,
  formatScale,
  formatSpeed,
  scaleForTargetWidth,
  type CropRect,
} from "@/features/gallery/lib/videoEdit";
import { formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import { iconCrop, iconGauge, iconMaximize2, iconScissors, iconUndo2 } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { VideoEditTimeline } from "./VideoEditTimeline";
import type { VideoEdit } from "@/features/gallery/hooks/useVideoEdit";

interface VideoEditPanelProps {
  edit: VideoEdit;
  /** Modal work other than this render - the panel locks itself rather than racing it. */
  busy: boolean;
  aspectId: string;
  onAspectChange: (aspectId: string) => void;
  onRevertRequested: () => void;
}

export function VideoEditPanel({
  edit,
  busy,
  aspectId,
  onAspectChange,
  onRevertRequested,
}: VideoEditPanelProps) {
  const locked = !edit.ready || busy || edit.applying;
  const source = useMemo(
    () => ({ width: edit.sourceWidth, height: edit.sourceHeight }),
    [edit.sourceHeight, edit.sourceWidth],
  );
  const pixels = useMemo(() => cropToPixels(edit.draft.crop, source), [edit.draft.crop, source]);

  const setCropPixel = (field: keyof CropRect, value: number) => {
    edit.setCrop(cropFromPixels({ ...pixels, [field]: value }, source));
  };

  const setTargetWidth = (width: number) => {
    edit.setScale(scaleForTargetWidth(source, edit.draft.crop, width));
  };

  return (
    <div className="video-edit-panel" role="group" aria-label="Video editing">
      <VideoEditTimeline
        duration={edit.duration}
        trimStart={edit.draft.trimStart}
        trimEnd={edit.draft.trimEnd}
        playheadTime={edit.playheadTime}
        playing={edit.playing}
        ready={edit.ready}
        disabled={busy || edit.applying}
        onTrimStartChange={edit.setTrimStart}
        onTrimEndChange={edit.setTrimEnd}
        onSeek={edit.seekTo}
        onTogglePlay={edit.togglePlay}
        onSetStartAtPlayhead={edit.setTrimStartAtPlayhead}
        onSetEndAtPlayhead={edit.setTrimEndAtPlayhead}
      />

      <div className="video-edit-panel__controls">
        <div className="video-edit-panel__group">
          <span className="video-edit-panel__group-label">
            <Icon icon={iconGauge} />
            Speed
          </span>
          <div className="video-edit-panel__presets">
            {SPEED_PRESETS.map((speed) => (
              <button
                key={speed}
                type="button"
                className={classNames(
                  "video-edit-panel__preset",
                  edit.draft.speed === speed && "video-edit-panel__preset--active",
                )}
                aria-pressed={edit.draft.speed === speed}
                disabled={locked}
                onClick={() => edit.setSpeed(speed)}
              >
                {formatSpeed(speed)}
              </button>
            ))}
          </div>
        </div>

        <div className="video-edit-panel__group">
          <span className="video-edit-panel__group-label">
            <Icon icon={iconMaximize2} />
            Size
          </span>
          <div className="video-edit-panel__presets">
            {SCALE_PRESETS.map((scale) => (
              <button
                key={scale}
                type="button"
                className={classNames(
                  "video-edit-panel__preset",
                  edit.draft.scale === scale && "video-edit-panel__preset--active",
                )}
                aria-pressed={edit.draft.scale === scale}
                disabled={locked}
                onClick={() => edit.setScale(scale)}
              >
                {formatScale(scale)}
              </button>
            ))}
          </div>
          <label className="video-edit-panel__field">
            <span>Width</span>
            <input
              type="number"
              min={2}
              step={2}
              value={edit.outputWidth}
              disabled={locked}
              onChange={(event) => setTargetWidth(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="video-edit-panel__group video-edit-panel__group--crop">
          <span className="video-edit-panel__group-label">
            <Icon icon={iconCrop} />
            Crop
          </span>
          <div className="video-edit-panel__presets">
            {CROP_ASPECTS.map((aspect) => (
              <button
                key={aspect.id}
                type="button"
                className={classNames(
                  "video-edit-panel__preset",
                  aspectId === aspect.id && "video-edit-panel__preset--active",
                )}
                aria-pressed={aspectId === aspect.id}
                disabled={locked}
                onClick={() => onAspectChange(aspect.id)}
              >
                {aspect.label}
              </button>
            ))}
            <button
              type="button"
              className={classNames(
                "video-edit-panel__preset",
                edit.cropActive && "video-edit-panel__preset--active",
              )}
              aria-pressed={edit.cropActive}
              disabled={locked}
              onClick={() => edit.setCropActive(!edit.cropActive)}
            >
              {edit.cropActive ? "Hide handles" : "Show handles"}
            </button>
          </div>
          <div className="video-edit-panel__fields">
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field} className="video-edit-panel__field">
                <span>
                  {field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}
                </span>
                <input
                  type="number"
                  min={0}
                  step={2}
                  value={pixels[field]}
                  disabled={locked}
                  onChange={(event) => setCropPixel(field, Number(event.target.value))}
                />
              </label>
            ))}
            <button
              type="button"
              className="video-edit-panel__reset-crop"
              disabled={locked}
              onClick={() => {
                onAspectChange("free");
                edit.setCrop(IDENTITY_CROP);
              }}
            >
              Reset crop
            </button>
          </div>
        </div>
      </div>

      <div className="video-edit-panel__actions">
        <p className="video-edit-panel__summary">
          {edit.ready ? (
            <>
              {edit.sourceWidth} x {edit.sourceHeight} to {edit.outputWidth} x {edit.outputHeight}
              {" · "}
              {formatFrameTime(edit.duration)} to {formatFrameTime(edit.outputSeconds)}
            </>
          ) : (
            "The timeline loads with the video."
          )}
        </p>

        {edit.applying ? (
          <div className="video-edit-panel__progress-row">
            <div
              className="video-edit-panel__progress"
              style={{ "--edit-progress": `${(edit.progress ?? 0) * 100}%` } as CSSProperties}
              role="progressbar"
              aria-label="Rendering"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={edit.progress == null ? undefined : Math.round(edit.progress * 100)}
            >
              <span
                className={classNames(
                  "video-edit-panel__progress-fill",
                  edit.progress == null && "video-edit-panel__progress-fill--unknown",
                )}
              />
            </div>
            <button type="button" className="video-edit-panel__action" onClick={edit.cancel}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="video-edit-panel__buttons">
            <button
              type="button"
              className="video-edit-panel__action"
              disabled={locked || !edit.dirty}
              onClick={edit.resetDraft}
            >
              Reset
            </button>
            {edit.hasBackup && (
              <button
                type="button"
                className="video-edit-panel__action video-edit-panel__action--revert"
                disabled={locked}
                onClick={onRevertRequested}
              >
                <Icon icon={iconUndo2} />
                Revert original
              </button>
            )}
            <button
              type="button"
              className="video-edit-panel__action video-edit-panel__action--apply"
              disabled={locked || !edit.dirty}
              onClick={edit.apply}
            >
              <Icon icon={iconScissors} />
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
