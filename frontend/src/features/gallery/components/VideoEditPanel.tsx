import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CROP_ASPECTS, isIdentityCrop } from "@/features/gallery/lib/crop";
import {
  SCALE_PRESETS,
  SPEED_PRESETS,
  formatScale,
  formatSpeed,
  scaleForTargetHeight,
  scaleForTargetWidth,
} from "@/features/gallery/lib/videoEdit";
import { MASK_STRENGTHS, describeMasks } from "@/features/gallery/lib/mask";
import { formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import {
  iconCrop,
  iconDroplets,
  iconGauge,
  iconLoader2,
  iconMaximize2,
  iconPlus,
  iconScissors,
  iconTrash2,
  iconUndo2,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { VideoEditTimeline } from "./VideoEditTimeline";
import { SizeNumberField } from "./SizeNumberField";
import type { AppIcon } from "@/shared/icons";
import type { VideoEdit } from "@/features/gallery/hooks/useVideoEdit";

type ToolId = "trim" | "crop" | "blur" | "speed" | "size";

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; icon: AppIcon }> = [
  { id: "trim", label: "Trim", icon: iconScissors },
  { id: "speed", label: "Speed", icon: iconGauge },
  { id: "crop", label: "Crop", icon: iconCrop },
  { id: "size", label: "Size", icon: iconMaximize2 },
  { id: "blur", label: "Blur", icon: iconDroplets },
];

interface VideoEditPanelProps {
  edit: VideoEdit;
  busy: boolean;
  onRevertRequested: () => void;
}

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
    blur: edit.draft.masks.length > 0,
    speed: edit.draft.speed !== 1,
    size: edit.draft.scale !== 1,
  };

  const { setCropActive, setMaskActive } = edit;

  // Keyed on the tool rather than on the click, or the one the panel opens on is never armed.
  useEffect(() => {
    setCropActive(activeTool === "crop");
    setMaskActive(activeTool === "blur");
  }, [activeTool, setCropActive, setMaskActive]);

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

      <div className="video-edit-panel__bar video-edit-panel__bar--tabs">
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
              onClick={() => setActiveTool(tool.id)}
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
              {modified.blur && (
                <span className="video-edit-panel__output-part">
                  {describeMasks(edit.draft.masks.length)}
                </span>
              )}
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
              <div className="video-edit-panel__tool-actions">
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
              </div>
              <span className="video-edit-panel__hint">
                Both follow the playhead. Drag a handle, or nudge it with the arrow keys.
              </span>
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
            </>
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
              <div className="video-edit-panel__fields">
                <SizeNumberField
                  label="W"
                  className="video-edit-panel__field"
                  value={edit.outputWidth}
                  min={2}
                  step={2}
                  disabled={locked}
                  onCommit={(width) =>
                    edit.setScale(scaleForTargetWidth(source, edit.draft.crop, width))
                  }
                />
                <SizeNumberField
                  label="H"
                  className="video-edit-panel__field"
                  value={edit.outputHeight}
                  min={2}
                  step={2}
                  disabled={locked}
                  onCommit={(height) =>
                    edit.setScale(scaleForTargetHeight(source, edit.draft.crop, height))
                  }
                />
              </div>
            </>
          )}

          {activeTool === "blur" && (
            <>
              <div className="video-edit-panel__tool-actions">
                <button
                  type="button"
                  className="video-edit-panel__control"
                  disabled={locked || edit.maskLimitReached}
                  onClick={edit.addMask}
                >
                  <Icon icon={iconPlus} />
                  Add
                </button>
                <button
                  type="button"
                  className="video-edit-panel__control"
                  disabled={locked || !modified.blur}
                  onClick={edit.clearMasks}
                >
                  <Icon icon={iconTrash2} />
                  Clear
                </button>
              </div>
              <ToolPresets label="Blur style">
                <PresetButton
                  active={edit.maskMode === "blur"}
                  disabled={locked}
                  onClick={() => edit.setMaskMode("blur")}
                >
                  Blur
                </PresetButton>
                <PresetButton
                  active={edit.maskMode === "pixelate"}
                  disabled={locked}
                  onClick={() => edit.setMaskMode("pixelate")}
                >
                  Pixelate
                </PresetButton>
              </ToolPresets>
              <ToolPresets label="Strength">
                {MASK_STRENGTHS.map((strength) => (
                  <PresetButton
                    key={strength.id}
                    active={edit.maskStrength === strength.value}
                    disabled={locked}
                    onClick={() => edit.setMaskStrength(strength.value)}
                  >
                    {strength.label}
                  </PresetButton>
                ))}
              </ToolPresets>
            </>
          )}
        </div>

        {edit.applying ? (
          <div className="video-edit-panel__actions">
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
