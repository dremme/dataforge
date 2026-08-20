import { useMemo, useState, type ReactNode } from "react";
import { CROP_ASPECTS, isIdentityCrop } from "@/features/gallery/lib/crop";
import {
  SCALE_PRESETS,
  SPEED_PRESETS,
  formatScale,
  formatSpeed,
  scaleForTargetHeight,
  scaleForTargetWidth,
} from "@/features/gallery/lib/videoEdit";
import { formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import {
  iconCrop,
  iconGauge,
  iconLoader2,
  iconMaximize2,
  iconScissors,
  iconUndo2,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { VideoEditTimeline } from "./VideoEditTimeline";
import type { AppIcon } from "@/shared/icons";
import type { VideoEdit } from "@/features/gallery/hooks/useVideoEdit";

type ToolId = "trim" | "crop" | "speed" | "size";

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; icon: AppIcon }> = [
  { id: "trim", label: "Trim", icon: iconScissors },
  { id: "crop", label: "Crop", icon: iconCrop },
  { id: "speed", label: "Speed", icon: iconGauge },
  { id: "size", label: "Size", icon: iconMaximize2 },
];

interface VideoEditPanelProps {
  edit: VideoEdit;
  /** Modal work other than this render - the panel locks itself rather than racing it. */
  busy: boolean;
  onRevertRequested: () => void;
}

/**
 * The editing surface: one always-present timeline, one tool at a time.
 *
 * Every control used to be on screen at once, which put roughly two dozen targets in a
 * strip and left the timeline - the only one that matters continuously - competing with
 * the rest for width. Tools are exclusive instead, and each one carries a dot when its
 * value is no longer the default, so collapsing them costs nothing you could previously
 * see at a glance. The output readout stays put for the same reason: it is the answer to
 * "what will I get", and it must not move when the tool does.
 */
export function VideoEditPanel({ edit, busy, onRevertRequested }: VideoEditPanelProps) {
  const [activeTool, setActiveTool] = useState<ToolId>("trim");

  const locked = !edit.ready || busy || edit.applying;
  const source = useMemo(
    () => ({ width: edit.sourceWidth, height: edit.sourceHeight }),
    [edit.sourceHeight, edit.sourceWidth],
  );
  const modified: Record<ToolId, boolean> = {
    trim: edit.draft.trimStart > 0 || (edit.ready && edit.draft.trimEnd < edit.duration),
    crop: !isIdentityCrop(edit.draft.crop),
    speed: edit.draft.speed !== 1,
    size: edit.draft.scale !== 1,
  };

  const selectTool = (tool: ToolId) => {
    setActiveTool(tool);
    // Selecting the crop tool is what brings the handles out, the way picking a tool
    // reveals its gizmo anywhere else. It replaces a button that did nothing but that.
    edit.setCropActive(tool === "crop");
  };

  return (
    <div className="video-edit-panel" role="group" aria-label="Video editing">
      <VideoEditTimeline
        duration={edit.duration}
        trimStart={edit.draft.trimStart}
        trimEnd={edit.draft.trimEnd}
        playheadTime={edit.playheadTime}
        playing={edit.playing}
        muted={edit.muted}
        ready={edit.ready}
        disabled={busy || edit.applying}
        onTrimStartChange={edit.setTrimStart}
        onTrimEndChange={edit.setTrimEnd}
        onSeek={edit.seekTo}
        onTogglePlay={edit.togglePlay}
        onToggleMuted={edit.toggleMuted}
      />

      <div className="video-edit-panel__bar">
        {/* Toggle buttons rather than a tablist or a radio group: both of those promise
            arrow-key navigation, and arrows already belong to the trim handles and to
            gallery navigation in this modal. */}
        <div className="video-edit-panel__tools" role="group" aria-label="Editing tool">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={classNames(
                "video-edit-panel__tool",
                activeTool === tool.id && "video-edit-panel__tool--active",
                modified[tool.id] && "video-edit-panel__tool--modified",
              )}
              aria-pressed={activeTool === tool.id}
              aria-label={modified[tool.id] ? `${tool.label}, changed` : tool.label}
              disabled={locked}
              onClick={() => selectTool(tool.id)}
            >
              <Icon icon={tool.icon} />
              {tool.label}
            </button>
          ))}
        </div>

        <p className="video-edit-panel__output">
          {edit.ready ? (
            <>
              <span className="video-edit-panel__output-part">
                {edit.sourceWidth} x {edit.sourceHeight}
                <span className="video-edit-panel__output-arrow"> to </span>
                <strong>
                  {edit.outputWidth} x {edit.outputHeight}
                </strong>
              </span>
              <span className="video-edit-panel__output-part">
                {formatFrameTime(edit.duration)}
                <span className="video-edit-panel__output-arrow"> to </span>
                <strong>{formatFrameTime(edit.outputSeconds)}</strong>
              </span>
            </>
          ) : (
            <span className="video-edit-panel__output-part">
              The timeline loads with the video.
            </span>
          )}
        </p>
      </div>

      <div className="video-edit-panel__bar video-edit-panel__bar--tool">
        <div className="video-edit-panel__tool-controls">
          {activeTool === "trim" && (
            <>
              <button
                type="button"
                className="video-edit-panel__control"
                disabled={locked}
                onClick={edit.setTrimStartAtPlayhead}
              >
                Set in
              </button>
              <button
                type="button"
                className="video-edit-panel__control"
                disabled={locked}
                onClick={edit.setTrimEndAtPlayhead}
              >
                Set out
              </button>
              <span className="video-edit-panel__hint">
                Both follow the playhead. Drag a handle, or nudge it with the arrow keys.
              </span>
            </>
          )}

          {activeTool === "crop" && (
            <>
              <ToolPresets label="Aspect">
                {CROP_ASPECTS.map((aspect) => (
                  <PresetButton
                    key={aspect.id}
                    active={edit.aspectId === aspect.id}
                    disabled={locked}
                    onClick={() => edit.selectAspect(aspect.id)}
                  >
                    {aspect.label}
                  </PresetButton>
                ))}
              </ToolPresets>
              <span className="video-edit-panel__hint">Or drag the rectangles on the frame.</span>
            </>
          )}

          {activeTool === "speed" && (
            <ToolPresets label="Playback">
              {SPEED_PRESETS.map((speed) => (
                <PresetButton
                  key={speed}
                  active={edit.draft.speed === speed}
                  disabled={locked}
                  onClick={() => edit.setSpeed(speed)}
                >
                  {formatSpeed(speed)}
                </PresetButton>
              ))}
            </ToolPresets>
          )}

          {activeTool === "size" && (
            <>
              <ToolPresets label="Scale">
                {SCALE_PRESETS.map((scale) => (
                  <PresetButton
                    key={scale}
                    active={edit.draft.scale === scale}
                    disabled={locked}
                    onClick={() => edit.setScale(scale)}
                  >
                    {formatScale(scale)}
                  </PresetButton>
                ))}
              </ToolPresets>
              {/* Both write the one `scale` the spec carries, so setting either moves the
                  other with it and the output never leaves the source's aspect. */}
              <div className="video-edit-panel__fields">
                <label className="video-edit-panel__field">
                  <span>W</span>
                  <input
                    type="number"
                    min={2}
                    step={2}
                    value={edit.outputWidth}
                    disabled={locked}
                    onChange={(event) =>
                      edit.setScale(
                        scaleForTargetWidth(source, edit.draft.crop, Number(event.target.value)),
                      )
                    }
                  />
                </label>
                <label className="video-edit-panel__field">
                  <span>H</span>
                  <input
                    type="number"
                    min={2}
                    step={2}
                    value={edit.outputHeight}
                    disabled={locked}
                    onChange={(event) =>
                      edit.setScale(
                        scaleForTargetHeight(source, edit.draft.crop, Number(event.target.value)),
                      )
                    }
                  />
                </label>
              </div>
            </>
          )}
        </div>

        {edit.applying ? (
          <div className="video-edit-panel__actions">
            {/* A bar sized to a whole row overstated a step that is usually seconds, so
                this says the same thing in the space a button takes. */}
            <span
              className="video-edit-panel__rendering"
              role="progressbar"
              aria-label="Rendering"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={edit.progress == null ? undefined : Math.round(edit.progress * 100)}
            >
              <Icon icon={iconLoader2} spin />
              {edit.progress == null ? "Rendering" : `${Math.round(edit.progress * 100)}%`}
            </span>
            <button type="button" className="video-edit-panel__control" onClick={edit.cancel}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="video-edit-panel__actions">
            {edit.hasBackup && (
              <button
                type="button"
                className="video-edit-panel__control video-edit-panel__control--revert"
                disabled={locked}
                onClick={onRevertRequested}
              >
                <Icon icon={iconUndo2} />
                Revert original
              </button>
            )}
            <button
              type="button"
              className="video-edit-panel__control"
              disabled={locked || !edit.dirty}
              onClick={edit.resetDraft}
            >
              Reset
            </button>
            <button
              type="button"
              className="video-edit-panel__apply"
              disabled={locked || !edit.dirty}
              onClick={edit.apply}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolPresets({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="video-edit-panel__presets" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function PresetButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={classNames(
        "video-edit-panel__preset",
        active && "video-edit-panel__preset--active",
      )}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
